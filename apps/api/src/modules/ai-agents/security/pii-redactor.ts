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
import { HARD_DELETE_KEYS, PROMPT_ALLOWLIST } from './allowlist.js';
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

const hardDelete = (
  input: Record<string, unknown>,
): {
  cleaned: Record<string, unknown>;
  removed: string[];
} => {
  const cleaned: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (HARD_DELETE_KEYS.has(key)) {
      removed.push(key);
      continue;
    }
    cleaned[key] = value;
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
    // Clinicalise the OCR fields blob the patient_reports retriever
    // surfaces. Strict mode is deny-by-default for OCR keys: only
    // patterns we explicitly know how to scrub (`d4z4*`,
    // `methylation*`, `haplotype*`, `*date*`) project into
    // `fields_clinical`. Free-form OCR values — including narrative
    // findings, raw report titles, patient demographics the OCR may
    // have extracted, and anything we have not yet reviewed — are
    // **dropped**, because we cannot guarantee they are PII-free.
    // Precise mode keeps the entire raw `fields` blob via the
    // allowlist.
    if ('fields' in input && isPlainObject(input.fields)) {
      const rawFields = input.fields;
      const cleanedFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawFields)) {
        const lower = key.toLowerCase();
        if (lower.includes('d4z4')) {
          const v = clinicaliseD4Z4(value);
          if (v !== null) cleanedFields[`${key}_clinical`] = v;
        } else if (lower.includes('methylation')) {
          const v = clinicaliseMethylation(value);
          if (v !== null) cleanedFields[`${key}_clinical`] = v;
        } else if (lower.includes('haplotype')) {
          const v = clinicaliseHaplotype(value);
          if (v !== null) cleanedFields[`${key}_clinical`] = v;
        } else if (lower.includes('date')) {
          const v = yearFromDate(value);
          if (v !== null) cleanedFields[`${key}_year`] = v;
        }
        // No `else` branch: unknown OCR keys are intentionally dropped
        // in strict mode to avoid leaking free-form values.
      }
      added.fields_clinical = cleanedFields;
      drop.add('fields');
      changed.push('fields');
    }
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

  // Layer 1.
  const layer1 = hardDelete(fields);
  stats.hardDeleted = layer1.removed;
  let working = layer1.cleaned;

  // Layer 2 — only in strict mode.
  if (mode === 'strict') {
    const layer2 = clinicalise(working, scope);
    stats.clinicalised = layer2.changed;
    working = { ...working, ...layer2.added };
    for (const k of layer2.drop) {
      delete working[k];
    }
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
