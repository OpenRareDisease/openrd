/**
 * Three-layer PII redactor for patient-scoped retriever output.
 *
 * Operates on structured field maps (the `fields` retrievers expose in
 * their chunk metadata). Renders happen downstream in the
 * Context Builder, so the redactor never has to grep prose.
 *
 *   Layer 1 — hard delete: every key in `HARD_DELETE_KEYS` is removed
 *             unconditionally, in both strict and precise mode.
 *             These are pure identifiers with no clinical value.
 *
 *   Layer 2 — clinicalise: only in `strict` mode. Numeric / dated
 *             clinical fields gain a `_clinical` sibling holding a
 *             coarse category label (e.g. D4Z4 "3/22" -> "low_repeat
 *             _severe"). The raw original is then dropped.
 *             In `precise` mode the user has explicitly opted in to
 *             sharing the raw value, so this layer is a no-op and the
 *             original passes through.
 *
 *   Layer 3 — allowlist: only keys enumerated in
 *             `PROMPT_ALLOWLIST[scope][mode]` survive. Anything else
 *             (including any field added to a retriever but not yet
 *             reviewed) is dropped with a logger warning so the
 *             oversight is visible.
 */

import type { RedactionMode, RedactionScope } from './allowlist.js';
import {
  HARD_DELETE_KEYS_LOWER,
  OCR_FIELDS_SAFE_KEYS_PRECISE,
  PROMPT_ALLOWLIST,
} from './allowlist.js';
import type { AppLogger } from '../../../config/logger.js';

export type { RedactionMode, RedactionScope } from './allowlist.js';

export interface RedactOptions {
  scope: RedactionScope;
  mode: RedactionMode;
  logger?: AppLogger;
}

export interface RedactionStats {
  hardDeleted: string[];
  clinicalised: string[];
  notAllowed: string[];
}

export interface RedactionOutcome {
  fields: Record<string, unknown>;
  stats: RedactionStats;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- layer 1

/** Strip every key in HARD_DELETE_KEYS at any depth.
 *
 *  The previous implementation only inspected top-level keys, which
 *  meant nested OCR payloads (e.g. `metadata.fields.fields.patientName`
 *  from the patient_reports retriever) slipped through whenever the
 *  enclosing key itself was on the allowlist. Recursive removal closes
 *  that contract: "hard-delete keys never reach a prompt regardless of
 *  mode" now actually holds for nested objects too.
 *
 *  Only plain objects are descended into; arrays and primitives are
 *  left as-is — they cannot have keys to match.
 */
const hardDelete = (
  input: Record<string, unknown>,
  path: string[] = [],
): {
  cleaned: Record<string, unknown>;
  removed: string[];
} => {
  const cleaned: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (HARD_DELETE_KEYS_LOWER.has(key.toLowerCase())) {
      removed.push([...path, key].join('.'));
      continue;
    }
    if (isPlainObject(value)) {
      const nested = hardDelete(value, [...path, key]);
      cleaned[key] = nested.cleaned;
      for (const r of nested.removed) removed.push(r);
    } else {
      cleaned[key] = value;
    }
  }
  return { cleaned, removed };
};

// ---------------------------------------------------------------- layer 2

const ageGroupFromDate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isFinite(year)) return null;
  const age = new Date().getUTCFullYear() - year;
  if (age < 0 || age > 120) return null;
  if (age < 18) return 'under_18';
  if (age < 30) return '18_29';
  if (age < 40) return '30_39';
  if (age < 50) return '40_49';
  if (age < 60) return '50_59';
  if (age < 70) return '60_69';
  return '70_plus';
};

/** Bucket the D4Z4 repeat count (e.g. "3/22", "3", "3 repeats") into
 *  a clinical category. FSHD1 is typically caused by repeats <= 10 on
 *  a permissive allele; the buckets reflect commonly cited severity
 *  ranges. The label is descriptive, not diagnostic. */
const clinicaliseD4Z4 = (raw: unknown): string | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const text = String(raw);
  const match = text.match(/(\d{1,3})/);
  if (!match) return 'unspecified';
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return 'unspecified';
  if (n <= 3) return 'low_repeat_severe';
  if (n <= 7) return 'low_repeat_moderate';
  if (n <= 10) return 'low_repeat_mild';
  if (n <= 30) return 'borderline';
  return 'normal_range';
};

/** Methylation values are usually percentages or decimals. Lower
 *  values are associated with FSHD2. Buckets are descriptive. */
const clinicaliseMethylation = (raw: unknown): string | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const text = String(raw);
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 'unspecified';
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return 'unspecified';
  // Accept both percentage and decimal inputs.
  const pct = n > 1 ? n : n * 100;
  if (pct < 25) return 'hypomethylated_severe';
  if (pct < 35) return 'hypomethylated';
  if (pct < 50) return 'low_normal';
  return 'normal_range';
};

/** 4qA permissive haplotypes carry the FSHD-associated polyadenylation
 *  signal; 4qB does not. Anything else is unspecified rather than
 *  silently passed through. */
const clinicaliseHaplotype = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.includes('4qa')) return 'pathogenic_haplotype_permissive';
  if (trimmed.includes('4qb')) return 'non_permissive_haplotype';
  return 'unspecified_haplotype';
};

/** Strip the day from any date-looking string, keeping only the year
 *  as a structured field. */
const yearFromDate = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  const match = text.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year > 1900 && year <= new Date().getUTCFullYear() + 1
    ? year
    : null;
};

interface ClinicaliseResult {
  added: Record<string, unknown>;
  drop: Set<string>;
  changed: string[];
}

/**
 * `stool_color` → `stoolColor`. Used to collapse the alias pairs the
 * OCR pipeline emits.
 */
const toCamel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Reject a value that a safe key should never have been holding.
 *
 * `OCR_FIELDS_SAFE_KEYS_PRECISE` is a list of keys, and it carries an
 * unstated premise: that a listed key holds a short, structured value
 * — a number, an enum, a one-line impression. The extractor is what
 * makes that true, and the extractor broke it. Observed in production,
 * inside `ecgSummary`, a key on the precise list:
 *
 *   "房室… 年龄:23 … 科别:神经内科 … 门诊号: 住院号:R000000 …
 *    本报告仅供临床医师结合临床参考"
 *
 * An inpatient medical-record number, a department and an age, on their
 * way to the model, through a key the allowlist trusted. The Python
 * extractor is fixed, but "the allowlist is safe as long as the
 * extractor behaves" is not a security property — every row already in
 * the database still has the old value, and the next extractor change
 * is one commit away.
 *
 * So the value is checked as well as the key. This is the same
 * deny-by-default stance the rest of this module takes.
 */
const ID_PATTERNS: readonly RegExp[] = [
  // Chinese record-number labels, with or without a value after them.
  /(住院号|门诊号|病历号|就诊号|登记号|标本号|样本号|条形码|检验号|影像号|身份证)/,
  // A bare identifier: a letter-prefixed run of digits (R000000), or a
  // long digit run (barcode, ID card).
  /\b[A-Za-z]{1,3}\d{5,}\b/,
  /\b\d{9,}\b/,
];

/** A free-text field long enough that it is evidently not the short
 *  value the key promised. Impressions in these reports run well under
 *  this; the observed ECG dump was 230+. */
const SAFE_VALUE_MAX_LENGTH = 200;

const isUntrustworthyValue = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length > SAFE_VALUE_MAX_LENGTH) return true;
  return ID_PATTERNS.some((pattern) => pattern.test(text));
};

/**
 * Is this OCR value a qualitative result rather than a measurement?
 *
 * Qualitative results survive strict mode (see projectOcrFields). The
 * test is deliberately conservative: anything carrying a digit is
 * treated as a measurement, so「1.02」stays withheld and so does a
 * borderline string like「阳性(1:8)」whose titre is the number the
 * patient did not consent to share.
 */
const isQualitativeResult = (value: unknown): boolean => {
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || text.length > 24) return false;
  return !/\d/.test(text);
};

/** Project an OCR fields blob through a mode-specific filter.
 *
 *  In **both** modes this is deny-by-default: only keys we know how to
 *  scrub (d4z4 / methylation / haplotype / date), or that are on
 *  `OCR_FIELDS_SAFE_KEYS_PRECISE`, pass through. Free-form OCR keys —
 *  including `findings`, `impression`, unknown vendor-specific fields,
 *  anything the OCR happened to extract that we haven't reviewed — are
 *  dropped.
 *
 *  What the two modes differ on is *values*, not keys. Precise emits
 *  the measurement; strict emits qualitative results verbatim and
 *  replaces the measurements with a `numericValuesWithheld` count. The
 *  safe-key list is shared because a key being safe to name has never
 *  depended on consent — only the number beside it does.
 *
 *  This is the fix for the PR #23 follow-up review: precise mode used
 *  to accept the entire raw `fields` blob via the allowlist, leaking
 *  whatever the OCR pipeline happened to put in there.
 */
const projectOcrFields = (
  rawFields: Record<string, unknown>,
  mode: RedactionMode,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  // Counted, not listed. The model needs to know that measurements
  // exist and are withheld — otherwise it reports the report as
  // unreadable — but naming which analytes were measured is itself a
  // disclosure the patient did not opt into.
  let withheldNumeric = 0;
  /** Safe keys whose *value* failed the content check. Logged by the
   *  caller so a regression in the extractor is visible rather than
   *  silently absorbed here. */
  const droppedUntrusted: string[] = [];

  // The extractor writes every lab field twice — `stoolColor` and
  // `stool_color`, `trustAb` and `trust_ab` — and both spellings are on
  // the safe-key list, so the prompt carried each analyte twice. That
  // is not just waste: the model reads the second spelling as a
  // separate test and reports it as one. Observed verbatim, a syphilis
  // screen with two analytes was summarised as three, the third being
  //「trust_ab：阴性」.
  //
  // Snake_case yields to camelCase when both are present and agree.
  // When they disagree, both stay — a silent pick between two different
  // values would be the redactor editing clinical data.
  const camelKeys = new Map<string, unknown>();
  for (const [key, value] of Object.entries(rawFields)) {
    if (!key.includes('_')) camelKeys.set(key, value);
  }

  for (const [key, value] of Object.entries(rawFields)) {
    if (key.includes('_') && camelKeys.has(toCamel(key)) && camelKeys.get(toCamel(key)) === value) {
      continue;
    }
    const lower = key.toLowerCase();
    if (lower.includes('d4z4')) {
      if (mode === 'strict') {
        const v = clinicaliseD4Z4(value);
        if (v !== null) out[`${key}_clinical`] = v;
      } else {
        if (value !== null && value !== undefined && value !== '') out[key] = value;
      }
    } else if (lower.includes('methylation')) {
      if (mode === 'strict') {
        const v = clinicaliseMethylation(value);
        if (v !== null) out[`${key}_clinical`] = v;
      } else {
        if (value !== null && value !== undefined && value !== '') out[key] = value;
      }
    } else if (lower.includes('haplotype')) {
      if (mode === 'strict') {
        const v = clinicaliseHaplotype(value);
        if (v !== null) out[`${key}_clinical`] = v;
      } else {
        if (value !== null && value !== undefined && value !== '') out[key] = value;
      }
    } else if (lower.includes('date')) {
      // Both modes: strip to year-only. Even in precise mode we don't
      // want the exact day-of-month leaving the server.
      const y = yearFromDate(value);
      if (y !== null) out[`${key}_year`] = y;
    } else if (OCR_FIELDS_SAFE_KEYS_PRECISE.has(key)) {
      if (value === null || value === undefined || value === '') continue;
      // A safe key is not a safe value — see isUntrustworthyValue.
      if (isUntrustworthyValue(value)) {
        droppedUntrusted.push(key);
        continue;
      }
      if (mode === 'precise') {
        out[key] = value;
      } else if (isQualitativeResult(value)) {
        // Strict mode keeps qualitative results.
        //
        // The consent step the patient did not take is「精确数值」— the
        // exact numbers. 阴性 / 阳性 / 黄色 / 软 are not numbers; they
        // are the test's own conclusion, and they identify nobody.
        //
        // Withholding them was not a privacy decision, it was a gap:
        // the strict branch here was written for the genetic fields
        // (d4z4 / methylation / haplotype) and never extended when the
        // safe-key list grew to ~90 lab keys. So every ordinary panel —
        // stool, syphilis screen, coagulation — projected to `{}`, and
        // the report summariser, handed an empty object, wrote
        //「这是一份血液检测报告，但未提取到具体检测数据」about a stool
        // report holding eight extracted values. Wrong on the data and
        // wrong on the report type, because even `classifiedType` was
        // gone.
        out[key] = value;
      } else {
        withheldNumeric += 1;
      }
    }
    // else: deny-by-default. Free-form / unknown OCR keys never make
    // it into the prompt regardless of mode.
  }
  if (withheldNumeric > 0) {
    out.numericValuesWithheld = withheldNumeric;
  }
  if (droppedUntrusted.length > 0) {
    // Named, not silent: the model should say「这份报告的这几项读不出来」
    // rather than answer as though the fields did not exist.
    out.fieldsDroppedAsUnsafe = droppedUntrusted.length;
  }
  return out;
};

/**
 * Strict-mode transform: for each known-sensitive raw key, compute a
 * clinical sibling and mark the original for removal. Unknown keys
 * fall through untouched here (the allowlist layer is the final
 * gate).
 */
const clinicalise = (input: Record<string, unknown>, scope: RedactionScope): ClinicaliseResult => {
  const added: Record<string, unknown> = {};
  const drop = new Set<string>();
  const changed: string[] = [];

  if (scope === 'profile') {
    if ('d4z4' in input) {
      const v = clinicaliseD4Z4(input.d4z4);
      if (v !== null) {
        added.d4z4_clinical = v;
        changed.push('d4z4');
      }
      drop.add('d4z4');
    }
    if ('methylation' in input) {
      const v = clinicaliseMethylation(input.methylation);
      if (v !== null) {
        added.methylation_clinical = v;
        changed.push('methylation');
      }
      drop.add('methylation');
    }
    if ('haplotype' in input) {
      const v = clinicaliseHaplotype(input.haplotype);
      if (v !== null) {
        added.haplotype_clinical = v;
        changed.push('haplotype');
      }
      drop.add('haplotype');
    }
    // diagnosisDate is identifying down to the day; replace with just
    // the year so the orchestrator can still talk about "diagnosed
    // a year ago" without leaking the exact date.
    if ('diagnosisDate' in input) {
      const year = yearFromDate(input.diagnosisDate);
      if (year !== null && !('diagnosisYear' in input)) {
        added.diagnosisYear = year;
        changed.push('diagnosisDate');
      }
      drop.add('diagnosisDate');
    }
  }

  if (scope === 'reports') {
    if ('reportDate' in input) {
      const year = yearFromDate(input.reportDate);
      if (year !== null && !('reportDate_year' in input)) {
        added.reportDate_year = year;
        changed.push('reportDate');
      }
      drop.add('reportDate');
    }
    // OCR `fields` blob is handled in the top-level redact() flow now
    // (both modes need projection, not just strict). See projectOcrFields.
  }

  // Birthday handling lives outside the scope branch because both
  // profile and reports may carry one.
  if ('dateOfBirth' in input) {
    const ageGroup = ageGroupFromDate(input.dateOfBirth);
    if (ageGroup !== null && !('ageGroup' in input)) {
      added.ageGroup = ageGroup;
      changed.push('dateOfBirth');
    }
    drop.add('dateOfBirth');
  }

  return { added, drop, changed };
};

// ---------------------------------------------------------------- layer 3

const filterByAllowlist = (
  input: Record<string, unknown>,
  scope: RedactionScope,
  mode: RedactionMode,
): {
  kept: Record<string, unknown>;
  dropped: string[];
} => {
  const allowed = new Set(PROMPT_ALLOWLIST[scope][mode]);
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key)) {
      kept[key] = value;
    } else {
      dropped.push(key);
    }
  }
  return { kept, dropped };
};

// ---------------------------------------------------------------- public

export const redactFields = (
  fields: Record<string, unknown>,
  options: RedactOptions,
): RedactionOutcome => {
  const { scope, mode, logger } = options;
  const stats: RedactionStats = {
    hardDeleted: [],
    clinicalised: [],
    notAllowed: [],
  };

  // Layer 1 — recursive hard-delete (covers nested OCR blobs).
  const layer1 = hardDelete(fields);
  stats.hardDeleted = layer1.removed;
  let working = layer1.cleaned;

  // Layer 2 — strict-mode-only clinicalisation of profile-level fields
  // (D4Z4 / methylation / haplotype → _clinical, diagnosisDate → year,
  // dateOfBirth → ageGroup). Precise mode skips this layer for
  // top-level keys.
  if (mode === 'strict') {
    const layer2 = clinicalise(working, scope);
    stats.clinicalised = layer2.changed;
    working = { ...working, ...layer2.added };
    for (const k of layer2.drop) {
      delete working[k];
    }
  }

  // Layer 2b — OCR `fields` projection. Runs in **both** modes
  // because precise mode otherwise let the raw OCR blob through
  // verbatim (PR #23 follow-up). Strict mode emits `fields_clinical`
  // with clinicalised values; precise mode emits `fields` with raw
  // values, but only for keys we explicitly trust as structured /
  // non-PII. Free-form OCR keys are dropped in both modes.
  if (scope === 'reports' && isPlainObject(working.fields)) {
    const projected = projectOcrFields(working.fields, mode);
    if (mode === 'strict') {
      working.fields_clinical = projected;
      delete working.fields;
    } else {
      working.fields = projected;
    }
    stats.clinicalised.push('fields');
  }

  // Layer 3 — always.
  const layer3 = filterByAllowlist(working, scope, mode);
  stats.notAllowed = layer3.dropped;

  if (logger && layer3.dropped.length > 0) {
    logger.warn(
      { scope, mode, droppedKeys: layer3.dropped },
      'pii_redactor: dropped fields not in PROMPT_ALLOWLIST',
    );
  }

  return { fields: layer3.kept, stats };
};
