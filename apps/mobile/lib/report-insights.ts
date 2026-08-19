import { inferMriBodyMap, type BodyRegionMap } from './clinical-visuals';
import {
  DIAGNOSIS_DATE_KEYS,
  GENETIC_FIELD_KEYS,
  TRANSCRIBED_EVIDENCE_LABEL_ZH,
  isLaboratoryGeneticReport,
  pickGeneticEvidenceDocument,
  type GeneticEvidenceDocumentLike,
} from './genetic-evidence';

export type OcrPayload = {
  extractedText?: string;
  fields?: Record<string, string | number>;
} | null;

/**
 * A document row as this module reads it.
 *
 * Declared as an extension of what the genetic-evidence picker needs
 * rather than as a shape that happens to satisfy it, so that dropping
 * `id` or `status` from here is a compile error and not a silently
 * defaulted answer. `status` is the only thing separating a report
 * whose parse came back empty from one whose parse has not come back,
 * and `id` is the tiebreak that keeps an unchanged profile rendering
 * identically; a caller that cannot supply either cannot be asked
 * which of its documents is this profile's genetic evidence.
 */
export type DocumentLike = GeneticEvidenceDocumentLike & {
  ocrPayload?: OcrPayload;
};

export type ProfileLike = {
  diagnosisDate?: string | null;
  geneticMutation?: string | null;
};

/**
 * ONE READING, AS A SCREEN RECEIVES IT.
 *
 * `{ label, value, date }` was the whole of this type, and it is where
 * the laboratory's own verdict stopped: the payload has carried
 * `ckFlag: high` and `ckReference: 50-310` for two rounds, and no
 * member of this type could hold either, so 报告详情, 我的档案 and 病程
 * all rendered a CK at 2.2× its stated upper limit in the same words
 * and the same weight as a normal one.
 *
 * `value` IS THE DISPLAY STRING AND IT CARRIES THE BRACKET. The screens
 * that render these print `metric.value` into a `<Text>` and nothing
 * else, so a metric whose bracket lives only in a sibling member is a
 * metric whose bracket is not on screen. `flag` and `reference` are the
 * machine-readable halves of the same thing, for a renderer that wants
 * to colour the row or lay the interval out separately — they are never
 * the ONLY place the information exists.
 *
 * WHAT THIS SURFACE SHOWS, AND WHY IT IS NOT THE PASSPORT'S ANSWER
 * TWICE. The reader here is the PATIENT. On this disease the ordinary
 * finding is an out-of-range CK — it is the thing that sent them for a
 * diagnosis — so a screen that escalates every flagged row teaches them
 * to fear their own baseline, and one that hides the flag leaves them
 * unable to see the number a clinician will react to. The middle is to
 * print exactly what the laboratory printed and nothing more: its own
 * word for the direction (偏高 / 偏低 / 异常, the same register the
 * passport uses) and the interval verbatim, so the number can be
 * CHECKED rather than merely trusted or feared. No 警告, no 危险, no
 * severity this platform derived, and no colour decided here.
 *
 * AND THE INTERVAL PRINTS EVEN WITH NO FLAG — that is the case where a
 * bracket helps a patient most, because it is the one where they can
 * see for themselves that the number is inside it.
 */
export type ReportInsightMetric = {
  label: string;
  /** Label-free display string: the value, then the laboratory's own
   *  bracket where it printed one. */
  value: string;
  /** `high` | `low` | `abnormal_unspecified`, the parser's own closed
   *  vocabulary, or null where the laboratory marked nothing. */
  flag?: string | null;
  /** The interval exactly as the row printed it — 「50-310」, 「<25」,
   *  「>9」 — or null.
   *
   *  NULL IS AN ORDINARY STATE. Most rows print no interval; a renderer
   *  shows the value alone and must not read the absence as 「within
   *  range」. It means the report did not say. */
  reference?: string | null;
  date?: string | null;
};

export type ReportInsightPanel = {
  key: 'diagnosis' | 'imaging' | 'blood' | 'respiratory' | 'cardiac';
  title: string;
  summary: string;
  latestDate: string;
  metrics: ReportInsightMetric[];
};

export type SystemInsightSection = {
  key: string;
  title: string;
  metrics: ReportInsightMetric[];
  priority: 'core' | 'secondary';
  groupKey?: 'fshd_related' | 'other';
  groupLabel?: string;
};

export type SystemInsightPanel = ReportInsightPanel & {
  key: 'blood' | 'respiratory' | 'cardiac';
  state: 'updated' | 'partial' | 'missing';
  stateLabel: string;
  coverage: string[];
  sourceCount: number;
  sections: SystemInsightSection[];
};

export type LatestMriVisualization = {
  regions: BodyRegionMap;
  findings: string[];
  latestDate: string;
  summary: string;
  hasFindings: boolean;
  sourceDocument: DocumentLike | null;
};

const pickField = (
  fields: Record<string, string | number> | undefined,
  keys: readonly string[],
) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

/** `creatine_kinase` → `creatineKinase`. The API bridge writes an
 *  analyte's flag and its reference interval under the CAMEL spelling
 *  of the value's key and no other — the value itself is on the payload
 *  under both, because both spellings predate those two cells. So a
 *  value picked off a snake key asks for its siblings under the camel
 *  one. Mirrors `toCamelKey` in the API's profile.passport.ts. */
const toCamelKey = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

const OCR_FLAG_SUFFIX = 'Flag';
const OCR_REFERENCE_SUFFIX = 'Reference';

/**
 * THE LABORATORY'S ABNORMAL MARKER, IN CHINESE.
 *
 * `_read_row_flag` in the parser maps 「↑」, 「偏高」 and a bare 「H」 onto
 * `high`, so what arrives here is an English token this platform
 * minted. A closed vocabulary; anything outside it is dropped rather
 * than printed, because a marker this screen cannot read is not one it
 * should paraphrase for a patient.
 *
 * The same three words the API's passport prints, deliberately — a
 * patient comparing the app against the sheet their doctor is holding
 * must not find two different vocabularies for one row.
 */
const ANALYTE_FLAG_ZH: Record<string, string> = {
  high: '偏高',
  low: '偏低',
  abnormal_unspecified: '异常',
};

/**
 * 通气模式 IS A WIRE TOKEN AND WAS REACHING THE PATIENT AS ONE.
 *
 * `cardio_respiratory_panel.ventilatory_pattern` is `restrictive` —
 * a value this platform minted, not anything a Chinese 肺功能报告 ever
 * printed — and this file passed it through untranslated. It surfaced
 * as the 通气模式 metric on 报告详情 and on 临床护照, and inside
 * `respiratorySummary`, which reads 「restrictive / 61 / 74 / 95」 on 病程.
 *
 * Mirrors `VENTILATORY_PATTERN_ZH` in the API's profile.passport.ts and
 * `VENTILATORY_PATTERN_LABELS` in the report-detail screen's own field
 * table — the third copy of the same four words, and the reason it is a
 * copy rather than an import is that this bundle does not ship the
 * API's module. An unknown pattern falls through to the raw token
 * rather than being dropped: it is the report's own reading, and a
 * blank row would be a worse answer than an untranslated one.
 */
const VENTILATORY_PATTERN_ZH: Record<string, string> = {
  restrictive: '限制性通气功能障碍',
  obstructive: '阻塞性通气功能障碍',
  mixed: '混合性通气功能障碍',
  normal: '通气功能正常',
};

/** The whole reading off one document's payload — the number, the
 *  laboratory's verdict on it, and the interval that verdict was
 *  reached against.
 *
 *  Resolved in ONE call, so that a caller cannot be handed the value
 *  and then forget the rest of it. The siblings are read off the same
 *  `keys` list the value came from, and only across spellings whose own
 *  value agrees with the picked one — two spellings of a cell that
 *  disagree are the state the API's guard calls `contradictory_aliases`,
 *  and a marker read across a disagreement would belong to a number it
 *  was not about. The crossing has to happen at all because the API's
 *  bridge minted `creatineKinase` as a value-only twin of `ck` for the
 *  whole life of this archive: on a stored document the CK number is
 *  under the twin while the marker is under `ckFlag`. */
const pickReading = (
  fields: Record<string, string | number> | undefined,
  keys: readonly string[],
): { key: string; value: string; flag: string | null; reference: string | null } | undefined => {
  if (!fields) return undefined;
  const read = (key: string): string | undefined => {
    const value = fields[key];
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text || undefined;
  };

  let picked: { key: string; value: string } | undefined;
  for (const key of keys) {
    const text = read(key);
    if (text) {
      picked = { key, value: text };
      break;
    }
  }
  if (!picked) return undefined;
  const found = picked;

  const sibling = (suffix: string): string | null => {
    for (const key of keys) {
      const own = read(key);
      if (own !== undefined && own !== found.value) continue;
      const camel = toCamelKey(key);
      const value =
        read(`${camel}${suffix}`) ?? (camel === key ? undefined : read(`${key}${suffix}`));
      if (value !== undefined) return value;
    }
    return null;
  };

  return {
    ...found,
    flag: sibling(OCR_FLAG_SUFFIX),
    reference: sibling(OCR_REFERENCE_SUFFIX),
  };
};

/**
 * ══════════════════════════════════════════════════════════════════════
 * A NUMBER THE LABORATORY DID NOT MARK, OUTSIDE THE INTERVAL THAT
 * LABORATORY PRINTED BESIDE IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The API's twin, and it has to answer identically or 报告详情 and
 * 临床护照 — one tap apart, built off the same payload — disagree about
 * whether a number fits the interval on its own row. See
 * `compareWithPrintedInterval` in
 * apps/api/src/modules/patient-profile/profile.passport.ts for the full
 * argument; the short form is that 「CK 693（参考区间 50-310）」 with
 * nothing else on the row is not this platform staying neutral, it is
 * this platform withholding a comparison it has already made, and
 * asking a patient to do the arithmetic again.
 *
 * It is a COPY rather than an import for the reason every rule in this
 * file is: a handset bundle cannot import from apps/api. What holds the
 * two together is that each side's test file pins the SAME literal
 * strings — apps/api/src/modules/patient-profile/
 * profile.passport.printed-interval.test.ts and
 * __tests__/report-insights.printed-interval.test.ts — so a reworded
 * clause on one side fails on that side and is visible as a divergence.
 */
type PrintedIntervalVerdict = 'above' | 'below';

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE PUNCTUATION AN INTERVAL IS ACTUALLY PRINTED WITH. ONE GRAMMAR,
 * AND IT IS THE PARSER'S.
 * ══════════════════════════════════════════════════════════════════════
 *
 * These classes understood the half-width spellings only — 「-」 and
 * 「~」 between two bounds, 「<」 「>」 「≤」 「≥」 before one — and a
 * Chinese laboratory does not type those. An IME in Chinese mode gives
 * 「－」 (U+FF0D) for a hyphen and 「＜」 (U+FF1C) for a less-than, and an
 * OCR pass hands back 「–」 (U+2013) for a printed en dash at least as
 * often as the ASCII one. So on a report typed the ordinary way the
 * comparison SILENTLY DID NOT HAPPEN: 报告详情 printed 「CK 693（参考区间
 * 50－310）」, the value and the interval side by side with nothing
 * between them. On the value side it was worse than silence —
 * 「0.5－1.2」 in the result column walked past `VALUE_IS_A_RANGE` and
 * 0.5 was compared, publishing a verdict about a number nobody
 * measured.
 *
 * AND THE WORDS WERE WHAT THAT WIDENING LEFT BEHIND. Thirteen dashes
 * went in and 至/到 did not, so 「0.5至1.2」 in a result cell — the very
 * same mis-parse, spelled the way a Chinese laboratory writes an
 * interval OUT — still walked past `VALUE_IS_A_RANGE` and 报告详情 still
 * published 「本平台比对：低于该区间」 about 0.5. The four ASCII digraphs
 * were missing with them: 「<=25」 is what a keyboard-typed reference
 * looks like and it read as no bound at all.
 *
 * THE SET IS COPIED FROM THE PRODUCER. `_read_row_reference` in
 * apps/report-manager/app/services/fshd_report_service.py returns the
 * interval RAW, so whatever the laboratory typed arrives here
 * unaltered, and its `_RANGE_DASHES` / `_RANGE_WORDS` / `_COMPARATORS`
 * / `_DIGIT_GROUPS` are the floor this side has to reach. The full
 * argument, the codepoint-by-codepoint listing and what is still NOT
 * accepted are in apps/api/src/utils/clinical-notation.ts; the
 * literals below are its word-for-word twin and have to stay identical
 * or the two screens disagree about whether a number fits its own row.
 *
 * THE EXCLUSIVE / INCLUSIVE SPLIT IS THE PART A WIDENING LOSES. The
 * parser only needs to know 「＜」 names a CEILING; this file needs to
 * know it EXCLUDES its own limit while 「⩽」 does not — and that the
 * digraph 「<=」 is INCLUSIVE even though it starts with the exclusive
 * mark, which is why it is matched whole and never stripped down to
 * the character it begins with. Hence four classes, not two.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS IS A COPY, AND EXACTLY WHAT WOULD MAKE IT AN IMPORT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The api half of this vocabulary is now ONE module —
 * apps/api/src/utils/clinical-notation.ts — read by the interval
 * comparison, the MMT cell reader and the D4Z4 bound reader alike. This
 * file cannot import it: a handset bundle has no path into apps/api,
 * and adding one would pull a server module's whole transitive graph
 * (`node:` builtins, the Prisma client) into a Metro bundle.
 *
 * The change that would fix it, written out so it is decided rather
 * than rediscovered:
 *
 *   1. A NEW WORKSPACE, `packages/clinical-notation`, holding nothing
 *      but the character sets, the two regex sources, `PRINTED_NUMBER`
 *      and `classifyComparator` — no imports at all, so it is bundler-
 *      neutral and Metro-safe.
 *   2. A ROOT-MANIFEST CHANGE: `packages/*` added to the root
 *      package.json `workspaces` array, which today lists only
 *      `apps/*`. This is the part that cannot be done from inside
 *      either app and is why the split survives.
 *   3. `@openrd/clinical-notation` added as a dependency of
 *      @openrd/api and @openrd/mobile, plus a `metro.config.js`
 *      `watchFolders` entry so Metro follows the symlink out of
 *      apps/mobile, and a `moduleNameMapper` / path alias for the two
 *      test runners.
 *   4. THE TWO TABLE TESTS STAY. They would then assert one imported
 *      set instead of two literal ones, which is a smaller assertion
 *      but the same one.
 *
 * UNTIL THAT IS DONE, what holds the two sides together is that each
 * side's test pins the SAME table — the sets below are asserted
 * character by character in __tests__/report-insights.printed-interval
 * .test.ts and in apps/api/src/utils/clinical-notation.test.ts — so a
 * mark added to one side and not the other fails on the side that was
 * not updated.
 */
const RANGE_DASHES = '-~‐‑‒–—―−〜﹣－～';
/** 「1至10」 and 「1到10」 are the same interval as 「1-10」, written out.
 *  Not punctuation, so they cannot live in a character class — which is
 *  the whole reason the separator is a regex SOURCE below. */
const RANGE_WORDS = ['到', '至'];
const CEILING_EXCLUSIVE = '<＜﹤';
const CEILING_INCLUSIVE = '≤⩽≦';
const FLOOR_EXCLUSIVE = '>＞﹥';
const FLOOR_INCLUSIVE = '≥⩾≧';
/** The ASCII spellings of 「≤」 and 「≥」, both orders. INCLUSIVE. */
const CEILING_INCLUSIVE_DIGRAPHS = ['<=', '=<'];
const FLOOR_INCLUSIVE_DIGRAPHS = ['>=', '=>'];
const COMPARATOR_CHARS = `${CEILING_EXCLUSIVE}${CEILING_INCLUSIVE}${FLOOR_EXCLUSIVE}${FLOOR_INCLUSIVE}`;
const COMPARATOR_DIGRAPHS = [...CEILING_INCLUSIVE_DIGRAPHS, ...FLOOR_INCLUSIVE_DIGRAPHS];

/** A character class body with every regex-significant member escaped,
 *  so a class stays correct no matter what order it is declared in. */
const charClass = (chars: string) => `[${chars.replace(/[\\\]^-]/g, (mark) => '\\' + mark)}]`;

/** 「A to B」, as one regex source. A non-capturing GROUP and not a bare
 *  alternation, or dropped into a longer pattern it would split that
 *  whole pattern in two. */
const RANGE_SEPARATOR_SOURCE = `(?:${charClass(RANGE_DASHES)}|${RANGE_WORDS.join('|')})`;

/** A comparator, as one regex source. THE DIGRAPHS COME FIRST: a regex
 *  alternation is ordered, so with the character class first 「<=25」
 *  would match 「<」, leave 「=25」 behind, and an unanchored reader
 *  would answer EXCLUSIVE about a limit the laboratory wrote as
 *  inclusive. */
const COMPARATOR_SOURCE = `(?:${COMPARATOR_DIGRAPHS.join('|')}|${charClass(COMPARATOR_CHARS)})`;

type ComparatorKind =
  | 'ceiling_exclusive'
  | 'ceiling_inclusive'
  | 'floor_exclusive'
  | 'floor_inclusive';

/** Which side a comparator names, and whether it admits its own limit.
 *  Digraphs before single characters, and emptiness before either —
 *  every 「includes('')」 is true, so an absent capture would otherwise
 *  be answered by whichever class is asked first. */
const classifyComparator = (mark: string | undefined | null): ComparatorKind | null => {
  if (!mark) return null;
  if (CEILING_INCLUSIVE_DIGRAPHS.includes(mark)) return 'ceiling_inclusive';
  if (FLOOR_INCLUSIVE_DIGRAPHS.includes(mark)) return 'floor_inclusive';
  if (mark.length !== 1) return null;
  if (CEILING_EXCLUSIVE.includes(mark)) return 'ceiling_exclusive';
  if (CEILING_INCLUSIVE.includes(mark)) return 'ceiling_inclusive';
  if (FLOOR_EXCLUSIVE.includes(mark)) return 'floor_exclusive';
  if (FLOOR_INCLUSIVE.includes(mark)) return 'floor_inclusive';
  return null;
};

/** 「3,250」 is one number, and the grouped spelling has to come first
 *  in the alternation or the scan stops at the first group. The comma
 *  in both widths, as `_DIGIT_GROUPS` has it. */
const PRINTED_NUMBER = String.raw`\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const PRINTED_RANGE = new RegExp(
  `^(${PRINTED_NUMBER})\\s*${RANGE_SEPARATOR_SOURCE}\\s*(${PRINTED_NUMBER})$`,
);
const PRINTED_BOUND = new RegExp(`^(${COMPARATOR_SOURCE})\\s*(${PRINTED_NUMBER})$`);
const LEADING_NUMBER = new RegExp(`^(${PRINTED_NUMBER})`);
/** A READING that is itself a bound — 「<0.01」, 「＜0.01」, 「<=0.01」 —
 *  is a detection limit, not a number that sits anywhere on an
 *  interval. */
const READING_IS_A_BOUND = new RegExp(`^${COMPARATOR_SOURCE}`);
/** A value cell holding an interval rather than a result — 「0.5-1.2」
 *  or 「0.5至1.2」 in the result column is the row's reference interval
 *  mis-parsed, and placing its low end against another interval would
 *  compare a number nobody measured. */
const VALUE_IS_A_RANGE = new RegExp(
  `^(?:${PRINTED_NUMBER})\\s*${RANGE_SEPARATOR_SOURCE}\\s*(?:${PRINTED_NUMBER})`,
);

const toNumber = (text: string): number | null => {
  const parsed = Number(text.replace(/[,，]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Null for everything it cannot place — a qualitative result, a
 *  one-sided READING (「<0.01」 is a detection limit, not a number that
 *  sits anywhere on an interval), an interval in words, an interval
 *  whose bounds arrive inverted. Each of those is a row where the
 *  honest thing is the row as it stands. */
const compareWithPrintedInterval = (
  value: string,
  reference: string | null | undefined,
): PrintedIntervalVerdict | null => {
  if (!reference) return null;
  const printed = reference.trim();
  const reading = value.trim();
  if (READING_IS_A_BOUND.test(reading)) return null;
  if (VALUE_IS_A_RANGE.test(reading)) return null;
  const head = LEADING_NUMBER.exec(reading);
  if (!head) return null;
  const measured = toNumber(head[1]);
  if (measured === null) return null;

  const range = PRINTED_RANGE.exec(printed);
  if (range) {
    const low = toNumber(range[1]);
    const high = toNumber(range[2]);
    if (low === null || high === null || low > high) return null;
    if (measured < low) return 'below';
    if (measured > high) return 'above';
    return null;
  }

  const bound = PRINTED_BOUND.exec(printed);
  if (bound) {
    const limit = toNumber(bound[2]);
    if (limit === null) return null;
    // 「<25」 excludes 25 and 「≤25」 does not; the mark is the laboratory
    // saying which, and `classifyComparator` is the one place that
    // knows. The default is a REFUSAL and not a fifth reading: a mark
    // `PRINTED_BOUND` matched but the vocabulary cannot place is a hole
    // between the two, and the honest answer to a hole is the row as it
    // stands.
    switch (classifyComparator(bound[1])) {
      case 'ceiling_exclusive':
        return measured >= limit ? 'above' : null;
      case 'ceiling_inclusive':
        return measured > limit ? 'above' : null;
      case 'floor_exclusive':
        return measured <= limit ? 'below' : null;
      case 'floor_inclusive':
        return measured < limit ? 'below' : null;
      default:
        return null;
    }
  }

  return null;
};

/** Word for word what the API prints, because it is the same claim
 *  about the same number. Not 偏高 — that is the laboratory's word for
 *  the laboratory's verdict, and this one is ours. */
const PRINTED_INTERVAL_NOTE_ZH: Record<PrintedIntervalVerdict, string> = {
  above: '报告未标注异常，本平台比对：高于该区间',
  below: '报告未标注异常，本平台比对：低于该区间',
};

/**
 * The value as a patient reads it: the number, then the laboratory's
 * own bracket where it printed one.
 *
 * `values` localises a closed wire enum (通气模式) before anything else
 * happens, because a bracket beside an English token would be two
 * problems on one row.
 *
 * ONE HALF IS ENOUGH. A flag with no interval still prints — it is the
 * laboratory's verdict and it stands on its own — and an interval with
 * no flag prints too, which is the case that lets a patient check a
 * normal result for themselves rather than take it on trust. A value
 * with NEITHER prints bare, and that is the ordinary state, not a gap.
 *
 * AND WHERE THE ROW CARRIES NO FLAG AND THE NUMBER IS OUTSIDE THE
 * INTERVAL ANYWAY, this platform says so in its own name, behind a
 * semicolon that separates it from everything the laboratory wrote.
 * Only where there is no flag: a second opinion beside a first one is
 * not ours to give, and 正常 / 未见异常 reach this file as no flag at
 * all, which is why the sentence says 未标注异常 rather than 未标注.
 */
const readingText = (
  reading: { value: string; flag: string | null; reference: string | null },
  values?: Record<string, string>,
): string => {
  const value = values?.[reading.value] ?? reading.value;
  const flag = reading.flag ? ANALYTE_FLAG_ZH[reading.flag.trim().toLowerCase()] : undefined;
  const reported = [flag, reading.reference ? `参考区间 ${reading.reference}` : undefined]
    .filter(Boolean)
    .join('，');
  // Against the payload's own value, not the localised display string:
  // a wire enum swapped for Chinese words is not the number the
  // laboratory measured.
  const observed = reading.flag
    ? null
    : compareWithPrintedInterval(reading.value, reading.reference);
  const bracket = [reported, observed ? PRINTED_INTERVAL_NOTE_ZH[observed] : '']
    .filter(Boolean)
    .join('；');
  return bracket ? `${value}（${bracket}）` : value;
};

const pickFieldValue = (doc: DocumentLike | undefined, keys: string[]) => {
  const fields = doc?.ocrPayload?.fields;
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

/**
 * A calendar date with no time part. Same guard, same reason, as the
 * API's `formatDate` in `profile.passport.ts` — this function is its
 * twin and has to answer identically or the two screens disagree.
 *
 * `patient_profiles.diagnosis_date` is a `date` column, so it arrives
 * as 「YYYY-MM-DD」, and an OCR 报告日期 arrives as whatever the parser
 * read off the page — which is why this is a test and not an
 * assumption. `new Date('2025-05-09')` is UTC midnight, and
 * `getFullYear` / `getMonth` / `getDate` then read it back in the
 * DEVICE's zone, so every phone west of Greenwich turned a 05-09
 * report into 2025-05-08 and fed that wrong day on to the anesthesia
 * card, the surveillance schedule and the printed passport.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const maxDate = (values: Array<string | null | undefined>) => {
  const candidates = values
    .map((value) => formatDate(value ?? null))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return candidates[0] ?? '—';
};

const latestDocByType = (docs: DocumentLike[], docType: string) => {
  const candidates = docs.filter((doc) => getDocumentType(doc) === docType && doc.uploadedAt);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt as string).getTime();
    const currentTime = new Date(current.uploadedAt as string).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const latestDocByTypes = (docs: DocumentLike[], docTypes: string[]) => {
  const candidates = docs.filter(
    (doc) => doc.uploadedAt && docTypes.includes(getDocumentType(doc)),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt as string).getTime();
    const currentTime = new Date(current.uploadedAt as string).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const filterDocsByTypes = (docs: DocumentLike[], docTypes: string[]) =>
  docs
    .filter((doc) => docTypes.includes(getDocumentType(doc)))
    .sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());

const latestDocWithFields = (docs: DocumentLike[], keys: string[]) => {
  const candidates = docs.filter((doc) => {
    const fields = doc.ocrPayload?.fields;
    return Boolean(pickField(fields, keys));
  });
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt ?? 0).getTime();
    const currentTime = new Date(current.uploadedAt ?? 0).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const latestDocContainingText = (docs: DocumentLike[], patterns: string[]) => {
  const candidates = docs.filter((doc) => {
    const fullText = `${JSON.stringify(doc.ocrPayload?.fields ?? {})} ${
      doc.ocrPayload?.extractedText ?? ''
    }`.toLowerCase();
    return patterns.some((pattern) => fullText.includes(pattern.toLowerCase()));
  });
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt ?? 0).getTime();
    const currentTime = new Date(current.uploadedAt ?? 0).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const filterDocsContainingText = (docs: DocumentLike[], patterns: string[]) =>
  docs
    .filter((doc) => {
      const fullText = `${JSON.stringify(doc.ocrPayload?.fields ?? {})} ${
        doc.ocrPayload?.extractedText ?? ''
      }`.toLowerCase();
      return patterns.some((pattern) => fullText.includes(pattern.toLowerCase()));
    })
    .sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());

const getDocumentType = (doc: DocumentLike) => {
  const fields = doc.ocrPayload?.fields;
  return (
    pickField(fields, ['classifiedType', 'classified_type', 'reportType', 'report_type']) ||
    doc.documentType ||
    'other'
  );
};

/**
 * ══════════════════════════════════════════════════════════════════════
 * ONE PAGE, TWO PANELS, AND ONLY ONE LABEL TO CARRY BOTH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * An 入院常规 printout prints 血常规 and 尿常规 under their own headings
 * on one sheet, and the parser reads both off it —
 * `_split_blood_and_urine_sections` in fshd_report_service.py splits on
 * the headings and runs BOTH extractors, whichever of the two labels the
 * classifier landed on. So the payload carries `hgb` AND `urineProtein`.
 *
 * THE CLASSIFICATION CANNOT CARRY BOTH, and it is a single string: the
 * page scores `blood_routine`, because it prints haemoglobin and
 * platelets and the specimen rule that rescues a pure urine report
 * cannot fire. This screen's per-metric `docTypes` gate then asked
 * whether the document's ONE type was `urinalysis`, and every 尿蛋白,
 * 尿潜血, 尿糖, 尿比重 and 尿 pH the parser had just extracted was
 * filtered back out — off 检查结果 on 报告详情, off 我的档案 and off
 * 病程. The fix landed in the parser and stopped at the screen.
 *
 * SO THE TWO LABELS ADMIT EACH OTHER, and nothing else changes: a
 * document typed `urinalysis` was always allowed to supply urine rows
 * and still is, and the gate still refuses every OTHER type — a
 * biochemistry panel does not get to supply a urine sediment count.
 * What it stops doing is trusting a single label to describe a page
 * this platform already knows prints two panels.
 */
const ADMISSION_PANEL_DOC_TYPES = ['blood_routine', 'urinalysis'];

const REPORT_TYPE_LABELS: Record<string, string> = {
  pulmonary_function: '肺功能',
  diaphragm_ultrasound: '膈肌超声',
  ecg: '心电图',
  echocardiography: '心脏超声',
  muscle_enzyme: '肌酶',
  biochemistry: '生化',
  blood_routine: '血常规',
  thyroid_function: '甲功',
  coagulation: '凝血',
  urinalysis: '尿常规',
  infection_screening: '感染筛查',
  stool_test: '粪便/HP',
  abdominal_ultrasound: '腹部超声',
};

const getReportTypeLabel = (docType: string) => REPORT_TYPE_LABELS[docType] ?? docType;

const collectCoverage = (docs: DocumentLike[], docTypes: string[]) =>
  Array.from(
    new Set(
      filterDocsByTypes(docs, docTypes)
        .map((doc) => getDocumentType(doc))
        .filter((docType) => docTypes.includes(docType)),
    ),
  ).map((docType) => getReportTypeLabel(docType));

const SYSTEM_HERO_LABELS: Record<SystemInsightPanel['key'], string[]> = {
  blood: ['CK', 'Mb', 'LDH', 'CKMB'],
  respiratory: ['FVC %Pred', 'FEV1 %Pred', 'TLC %Pred', 'DLCO %Pred'],
  cardiac: ['心电结论', 'QTc', 'LVEF', '心率'],
};

export const getSystemPanelTabs = (panel: SystemInsightPanel) => {
  if (panel.key === 'blood') {
    const activeSections = panel.sections.filter((section) => section.metrics.length > 0);
    const hasFshdRelated = activeSections.some((section) => section.groupKey === 'fshd_related');
    const hasOther = activeSections.some((section) => section.groupKey === 'other');
    const groupCount = Number(hasFshdRelated) + Number(hasOther);
    const tabs: Array<{
      key: string;
      label: string;
      priority: 'all' | 'core' | 'secondary';
      scope: 'all' | 'group' | 'section';
    }> = [];

    if (groupCount > 1) {
      tabs.push({ key: 'all', label: '全部', priority: 'all', scope: 'all' });
    }
    if (hasFshdRelated) {
      tabs.push({
        key: 'group:fshd_related',
        label: 'FSHD相关',
        priority: 'core',
        scope: 'group',
      });
    }
    if (hasOther) {
      tabs.push({
        key: 'group:other',
        label: '其他',
        priority: 'secondary',
        scope: 'group',
      });
    }

    return tabs;
  }

  const tabs = panel.sections
    .filter((section) => section.metrics.length > 0)
    .map((section) => ({
      key: section.key,
      label: section.title,
      priority: section.priority,
      scope: 'section' as const,
    }));

  if (tabs.length <= 1) {
    return tabs;
  }

  return [{ key: 'all', label: '全部', priority: 'all' as const, scope: 'all' as const }, ...tabs];
};

export const getSystemPanelScopedSections = (
  panel: SystemInsightPanel,
  viewKey: string = 'all',
) => {
  if (viewKey === 'all') {
    return panel.sections.filter((section) => section.metrics.length > 0);
  }

  if (viewKey.startsWith('group:')) {
    return panel.sections.filter(
      (section) => section.groupKey === viewKey.replace('group:', '') && section.metrics.length > 0,
    );
  }

  return panel.sections.filter((section) => section.key === viewKey && section.metrics.length > 0);
};

export const getSystemPanelSectionTabs = (panel: SystemInsightPanel, viewKey: string = 'all') => {
  if (panel.key !== 'blood') {
    return [];
  }

  const scopedSections = getSystemPanelScopedSections(panel, viewKey);
  if (!scopedSections.length) {
    return [];
  }

  const sectionTabs = scopedSections.map((section) => ({
    key: section.key,
    label: section.title,
  }));

  if (scopedSections.length === 1) {
    return sectionTabs;
  }

  return [{ key: 'all', label: '全部' }, ...sectionTabs];
};

export const getSystemPanelHeroMetrics = (
  panel: SystemInsightPanel,
  viewKey: string = 'all',
  subViewKey: string = 'all',
) => {
  const sourceSections =
    subViewKey !== 'all'
      ? panel.sections.filter((section) => section.key === subViewKey && section.metrics.length > 0)
      : viewKey === 'all'
        ? panel.sections.filter(
            (section) => section.priority === 'core' && section.metrics.length > 0,
          )
        : getSystemPanelScopedSections(panel, viewKey);

  if (sourceSections.length === 0) {
    return [];
  }

  const sourceMetrics = sourceSections.flatMap((section) => section.metrics);

  const picked: ReportInsightMetric[] = [];
  const seen = new Set<string>();

  SYSTEM_HERO_LABELS[panel.key].forEach((label) => {
    const metric = sourceMetrics.find((item) => item.label === label);
    if (metric && !seen.has(metric.label)) {
      picked.push(metric);
      seen.add(metric.label);
    }
  });

  sourceMetrics.forEach((metric) => {
    if (picked.length >= 4 || seen.has(metric.label)) {
      return;
    }
    picked.push(metric);
    seen.add(metric.label);
  });

  return picked.slice(0, 4);
};

const latestDocForField = (docs: DocumentLike[], keys: string[], docTypes?: string[]) => {
  const candidates = docs
    .filter((doc) => {
      if (docTypes?.length && !docTypes.includes(getDocumentType(doc))) {
        return false;
      }
      return Boolean(pickField(doc.ocrPayload?.fields, keys));
    })
    .sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());

  return candidates[0];
};

/**
 * The reading, the day it was read, and the document it came off.
 *
 * `pickReading` AND NOT `pickField`: the flag and the interval are
 * resolved off the SAME document and the SAME key list the value was —
 * never by a second `latestDocForField` call, which is how a flag from
 * one report would come to stand beside a value from another.
 */
const resolveMetric = (
  docs: DocumentLike[],
  keys: string[],
  docTypes?: string[],
  values?: Record<string, string>,
) => {
  const doc = latestDocForField(docs, keys, docTypes);
  const reading = pickReading(doc?.ocrPayload?.fields, keys);
  return {
    value: reading ? readingText(reading, values) : undefined,
    flag: reading?.flag ?? null,
    reference: reading?.reference ?? null,
    date: formatDate(pickFieldValue(doc, ['reportTime', 'report_time']) ?? doc?.uploadedAt ?? null),
  };
};

const buildMetric = (
  docs: DocumentLike[],
  label: string,
  keys: string[],
  docTypes?: string[],
  values?: Record<string, string>,
): ReportInsightMetric | null => {
  const resolved = resolveMetric(docs, keys, docTypes, values);
  if (!resolved.value) {
    return null;
  }

  return {
    label,
    value: resolved.value,
    flag: resolved.flag,
    reference: resolved.reference,
    date: resolved.date,
  };
};

const buildMetricSection = (
  key: string,
  title: string,
  defs: Array<{
    label: string;
    keys: string[];
    docTypes?: string[];
    /** Localisation for a closed wire enum — see
     *  `VENTILATORY_PATTERN_ZH`. Absent for every real measurement. */
    values?: Record<string, string>;
  }>,
  docs: DocumentLike[],
  priority: 'core' | 'secondary' = 'secondary',
  groupKey?: 'fshd_related' | 'other',
  groupLabel?: string,
): SystemInsightSection | null => {
  const metrics = defs
    .map((def) => buildMetric(docs, def.label, def.keys, def.docTypes, def.values))
    .filter((item): item is ReportInsightMetric => Boolean(item));

  if (!metrics.length) {
    return null;
  }

  return { key, title, metrics, priority, groupKey, groupLabel };
};

const flattenSections = (sections: SystemInsightSection[]) =>
  sections.flatMap((section) => section.metrics);

const getPanelState = (
  sections: SystemInsightSection[],
): Pick<SystemInsightPanel, 'state' | 'stateLabel'> => {
  const metricCount = flattenSections(sections).length;
  if (metricCount === 0) {
    return { state: 'missing', stateLabel: '缺失' };
  }

  const coreSections = sections.filter((section) => section.priority === 'core');
  const coveredCoreSections = coreSections.filter((section) => section.metrics.length > 0);
  if (coreSections.length > 0 && coveredCoreSections.length === coreSections.length) {
    return { state: 'updated', stateLabel: '已覆盖' };
  }

  return { state: 'partial', stateLabel: '部分覆盖' };
};

const buildCoverageSummary = (
  coverage: string[],
  state: SystemInsightPanel['state'],
  missingText: string,
  completeText: string,
  partialText: string,
) => {
  if (state === 'missing') {
    return missingText;
  }

  const joined = coverage.join('、');
  if (state === 'updated') {
    return `已覆盖 ${joined}，${completeText}`;
  }

  return `当前已识别 ${joined}，${partialText}`;
};

/**
 * ══════════════════════════════════════════════════════════════════════
 * A RANGE IN AN MMT CELL, AND THE MRC ± MODIFIER, TOLD APART BY WHETHER
 * A NUMBER FOLLOWS THE SIGN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The API's twin, for the same reason `compareWithPrintedInterval` is:
 * 我的档案 and 临床护照 are one tap apart, they are built off the SAME
 * payload, and they were answering differently about the same cell.
 * This side read the first run of digits and stopped, so
 *
 *   「4-5级」  — an examiner declining to choose between 4 and 5 —
 *              printed 平均肌力 4.0 here and was excluded from the
 *              average by the passport;
 *   「4-级」   — grade four MINUS — printed 4.0 here and 3.7 there.
 *
 * Neither number was measured by anybody, and the one on the phone was
 * the one the patient sees first.
 *
 * THE SEPARATOR IS THE SAME `RANGE_SEPARATOR_SOURCE` the interval
 * comparison above uses, which is what makes 「4‐5级」 (U+2010, what an
 * OCR pass hands back for a printed dash) a range on both screens
 * rather than on neither.
 *
 * EVERY DASH THE ± MODIFIER ACCEPTS IS IN THAT SEPARATOR, which is what
 * keeps 「4-5级」 from being read as grade 4 minus and averaged as 3.7 —
 * a number below BOTH bounds of the interval it came off.
 *
 * 「4/5」 is NOT a range: it is grade 4 out of 5, the commonest way an
 * MMT sheet writes a single grade, so the separator and not the count
 * of digits is what decides. The cell is still DISPLAYED verbatim by
 * `buildStrengthSummary` — what a range loses is its vote in the
 * average, not its place on the page.
 */
const STRENGTH_RANGE_CELL = new RegExp(`\\d\\s*${RANGE_SEPARATOR_SOURCE}\\s*\\d`);

/** The ± of an MRC grade in both widths — a Chinese physical-exam sheet
 *  is typed in a full-width IME, so 「4＋」 has to mean what 「4+」 means. */
const STRENGTH_PLUS = /[+＋﹢]/;
const STRENGTH_MODIFIER = /(\d+(?:\.\d+)?)\s*([-+＋﹢−﹣－])?/;

const parseScore = (value: string) => {
  if (STRENGTH_RANGE_CELL.test(value)) return null;
  const match = STRENGTH_MODIFIER.exec(value);
  if (!match) return null;
  const base = Number(match[1]);
  if (Number.isNaN(base)) return null;
  const modifier = match[2] ? (STRENGTH_PLUS.test(match[2]) ? 0.3 : -0.3) : 0;
  return Math.min(5, Math.max(0, base + modifier));
};

const compactText = (value?: string | null, fallback = '暂无数据') => {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 88 ? `${text.slice(0, 88)}...` : text;
};

const MRI_TEXT_PATTERNS = ['mri', '脂肪浸润', '前锯', 'hamstring', '臀肌', '胫前'];

const collectMriDocuments = (docs: DocumentLike[]) => {
  const byKey = new Map<string, DocumentLike>();
  [
    ...filterDocsByTypes(docs, ['muscle_mri', 'mri']),
    ...filterDocsContainingText(docs, MRI_TEXT_PATTERNS),
  ].forEach((doc, index) => {
    // The `||` fallback that used to sit here could never fire — a
    // template literal is always truthy — so two documents with no
    // upload time, the same type and no parsed fields produced the
    // identical key and one was silently dropped from the map. Fall
    // back on the parts actually being absent instead.
    const identity = `${doc.uploadedAt ?? ''}::${getDocumentType(doc) ?? ''}::${JSON.stringify(
      doc.ocrPayload?.fields ?? {},
    )}`;
    const mapKey = identity === '::::{}' ? `fallback-${index}` : identity;
    byKey.set(mapKey, doc);
  });

  return [...byKey.values()].sort(
    (a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime(),
  );
};

export const buildLatestMriVisualization = (docs: DocumentLike[]): LatestMriVisualization => {
  const sourceDocument = collectMriDocuments(docs)[0] ?? null;

  if (!sourceDocument) {
    return {
      regions: {},
      findings: [],
      latestDate: '—',
      summary: '等待 MRI 识别结果',
      hasFindings: false,
      sourceDocument: null,
    };
  }

  const inferred = inferMriBodyMap(sourceDocument.ocrPayload ?? null);
  const impression = pickFieldValue(sourceDocument, [
    'reportImpression',
    'report_impression',
    'impressionText',
    'impression_text',
  ]);
  const finding = pickFieldValue(sourceDocument, ['findingText', 'finding_text']);
  const summary =
    inferred.findings.length > 0
      ? `影像提示：${inferred.findings.join('、')}`
      : compactText(
          impression ?? finding ?? sourceDocument.ocrPayload?.extractedText,
          '等待 MRI 识别结果',
        );

  return {
    regions: inferred.regions,
    findings: inferred.findings,
    latestDate:
      formatDate(
        pickFieldValue(sourceDocument, ['reportTime', 'report_time']) ??
          sourceDocument.uploadedAt ??
          null,
      ) ?? '—',
    summary,
    hasFindings: inferred.hasFindings,
    sourceDocument,
  };
};

export const buildStrengthSummary = (fields?: Record<string, string | number>) => {
  const entries = [
    { label: '三角肌', key: 'deltoidStrength', alt: 'deltoid_strength' },
    { label: '肱二头肌', key: 'bicepsStrength', alt: 'biceps_strength' },
    { label: '肱三头肌', key: 'tricepsStrength', alt: 'triceps_strength' },
    { label: '股四头肌', key: 'quadricepsStrength', alt: 'quadriceps_strength' },
    { label: '胫前肌', key: 'tibialisStrength', alt: 'tibialis_strength' },
  ];
  const parts: string[] = [];
  const scores: number[] = [];

  entries.forEach((entry) => {
    const value = pickField(fields, [entry.key, entry.alt]);
    if (!value) return;
    parts.push(`${entry.label}${value}`);
    const score = parseScore(value);
    if (score !== null) {
      scores.push(score);
    }
  });

  const average =
    scores.length > 0
      ? Number((scores.reduce((sum, v) => sum + v, 0) / scores.length).toFixed(1))
      : null;

  return {
    summary: parts.join('，') || null,
    average,
  };
};

export const buildReportInsights = (docs: DocumentLike[], profile?: ProfileLike | null) => {
  /**
   * THE ONE DOCUMENT THE GENETIC BLOCK BELOW READS.
   *
   * This used to be two expressions — the newest document typed
   * `genetic_report`, else the newest document carrying any genetic
   * key — and it was one of four private answers to the same question.
   * The API's is now the only one, and `pickGeneticEvidenceDocument`
   * is it (see lib/genetic-evidence.ts for why a copy of the rule
   * lives in this bundle). 我的档案 prints these values ahead of the
   * passport's own, so while the two rules disagreed, one profile's
   * repeat count could be read off one report on 我的档案 and off
   * another on 临床护照, with neither page mentioning the other.
   *
   * Everything else in this function still ranks per system by upload
   * time, and should: two CK values off two blood panels are two real
   * results and both belong on the page. The genetic values are the
   * exception because they are one assay's reading — see the picker.
   */
  const geneticDoc = pickGeneticEvidenceDocument(docs);
  const latestMri = collectMriDocuments(docs)[0];
  const latestBlood = latestDocByTypes(docs, [
    'blood_panel',
    'biochemistry',
    'muscle_enzyme',
    'blood_routine',
    'thyroid_function',
    'coagulation',
    'urinalysis',
    'infection_screening',
    'stool_test',
  ]);
  const latestPhysicalExam = latestDocByType(docs, 'physical_exam');

  const geneticFields = geneticDoc?.ocrPayload?.fields;
  /**
   * WHOSE PAGE THE VALUES BELOW ARE ON.
   *
   * The picker takes a 病历摘要 quoting a repeat count when the genetics
   * report read out nothing, and 病程 → 检查结果 then printed 分型, D4Z4,
   * 单倍型 and 甲基化 in the panel a laboratory's numbers get, under a
   * summary that named 这份报告 and a date that dated it. Nothing on the
   * tab said a clinic had written the page.
   */
  const geneticFromLaboratory = geneticDoc ? isLaboratoryGeneticReport(geneticDoc) : false;
  const geneticTypeFromReport = pickField(geneticFields, GENETIC_FIELD_KEYS.geneticType);
  // Whether the picked document supplied the 分型 or the profile column
  // did, kept rather than discarded. The 诊断与分型 panel prints its
  // summary directly under that panel's `latestDate`, which is the
  // upload date of the picked document — so a 分型 the patient typed
  // into their profile would appear to have been read off it.
  // `profile.geneticMutation` is free text the patient maintains, and
  // `applyGeneticReportAutofill` can also fill it from OCR without
  // recording that it did, so 「came from the column」 is not the same
  // claim as 「the patient typed it」 and this says only the first.
  const geneticTypeFromProfile = geneticTypeFromReport
    ? undefined
    : (profile?.geneticMutation ?? undefined);
  const geneticType = geneticTypeFromReport || geneticTypeFromProfile;
  const haplotype = pickField(geneticFields, GENETIC_FIELD_KEYS.haplotype);
  const ecoRIFragment = pickField(geneticFields, GENETIC_FIELD_KEYS.ecoRIFragment);
  const d4z4Repeats = pickField(geneticFields, GENETIC_FIELD_KEYS.d4z4Repeats);
  const methylationValue = pickField(geneticFields, GENETIC_FIELD_KEYS.methylationValue);

  const diagnosisDate =
    formatDate(profile?.diagnosisDate ?? null) ||
    formatDate(pickField(geneticFields, DIAGNOSIS_DATE_KEYS)) ||
    null;

  const mriDoc = latestMri;
  const mriFields = mriDoc?.ocrPayload?.fields;
  const mriGrade = pickField(mriFields, ['serratusFatigueGrade', 'serratus_fatigue_grade']);
  const mriImpression = pickFieldValue(mriDoc, [
    'reportImpression',
    'report_impression',
    'impressionText',
    'impression_text',
  ]);
  const mriFinding = pickFieldValue(mriDoc, ['findingText', 'finding_text']);
  const mriReportTime = pickFieldValue(mriDoc, ['reportTime', 'report_time']);
  const mriSummary = mriGrade
    ? `前锯肌脂肪化等级 ${mriGrade}`
    : compactText(
        mriImpression ?? mriFinding ?? mriDoc?.ocrPayload?.extractedText,
        '暂无MRI分析数据',
      );

  const bloodDoc =
    latestBlood || latestDocContainingText(docs, ['ck', '肌酸激酶', 'ldh', 'mb', 'ckmb']);
  const bloodFields = bloodDoc?.ocrPayload?.fields;
  const bloodReportTime = pickFieldValue(bloodDoc, ['reportTime', 'report_time']);
  /**
   * 病程 → 血检 summary, and the bracket now rides in it.
   *
   * Six `pickField` calls stood here and each threw the key away, so
   * this row printed 「CK 693U/L，Mb 48ng/mL」 for the same payload the
   * API's passport printed 「CK 693U/L（偏高，参考区间 50-310）」 off —
   * two surfaces of one product disagreeing about what the report said,
   * on the analyte this disease is monitored by.
   */
  const bloodParts = (
    [
      { label: 'CK', keys: ['creatineKinase', 'creatine_kinase', 'CK', 'ck'] },
      { label: 'Mb', keys: ['myoglobin', 'MYO', 'Myo', 'MB', 'Mb', 'mb'] },
      { label: 'LDH', keys: ['LDH', 'ldh'] },
      { label: 'CKMB', keys: ['CKMB', 'ckmb'] },
      { label: 'Cr', keys: ['creatinine'] },
      { label: 'UA', keys: ['uricAcid', 'uric_acid'] },
    ] as const
  ).flatMap((spec) => {
    const reading = pickReading(bloodFields, spec.keys);
    return reading ? [`${spec.label} ${readingText(reading)}`] : [];
  });
  const bloodSummary =
    bloodParts.join('，') || compactText(bloodDoc?.ocrPayload?.extractedText, '暂无血检摘要');

  const respiratoryDoc =
    latestDocByTypes(docs, ['pulmonary_function', 'diaphragm_ultrasound']) ||
    latestDocContainingText(docs, ['fvc', 'fev1', 'tlc', 'dlco', '肺功能', '膈肌']);
  const respiratoryFields = respiratoryDoc?.ocrPayload?.fields;
  const respiratoryReportTime = pickFieldValue(respiratoryDoc, ['reportTime', 'report_time']);
  // The wire token is localised HERE and not only on the metric: this
  // string is 病程's own 呼吸 row, and it read 「restrictive / 61 / 74 /
  // 95」 to a patient.
  const respiratoryMetrics = (
    [
      { keys: ['ventilatoryPattern', 'ventilatory_pattern'], values: VENTILATORY_PATTERN_ZH },
      { keys: ['fvcPredPct', 'fvc_pred_pct'] },
      { keys: ['tlcPredPct', 'tlc_pred_pct'] },
      { keys: ['dlcoPredPct', 'dlco_pred_pct'] },
      { keys: ['diaphragmMotionSummary', 'diaphragm_motion_summary'] },
    ] as ReadonlyArray<{ keys: string[]; values?: Record<string, string> }>
  ).flatMap((spec) => {
    const reading = pickReading(respiratoryFields, spec.keys);
    return reading ? [readingText(reading, spec.values)] : [];
  });
  const respiratorySummary =
    respiratoryMetrics.length > 0
      ? respiratoryMetrics.join(' / ')
      : compactText(respiratoryDoc?.ocrPayload?.extractedText, '暂无呼吸检查数据');

  const cardiacDoc =
    latestDocByTypes(docs, ['ecg', 'echocardiography']) ||
    latestDocContainingText(docs, ['ecg', 'echo', 'lvef', 'qtc', 'qrs', '心电', '超声心动']);
  const cardiacFields = cardiacDoc?.ocrPayload?.fields;
  const cardiacReportTime = pickFieldValue(cardiacDoc, ['reportTime', 'report_time']);
  const cardiacMetrics = (
    [
      ['ecgSummary', 'ecg_summary'],
      ['echoSummary', 'echo_summary'],
      ['LVEF', 'lvef'],
      ['QTc', 'qtc', 'qtcMs', 'qtc_ms'],
    ] as ReadonlyArray<string[]>
  ).flatMap((keys) => {
    const reading = pickReading(cardiacFields, keys);
    return reading ? [readingText(reading)] : [];
  });
  const cardiacSummary =
    cardiacMetrics.length > 0
      ? cardiacMetrics.join(' / ')
      : compactText(cardiacDoc?.ocrPayload?.extractedText, '暂无心脏检查数据');

  const strengthDoc =
    latestPhysicalExam ||
    latestDocWithFields(docs, [
      'deltoidStrength',
      'bicepsStrength',
      'tricepsStrength',
      'quadricepsStrength',
      'tibialisStrength',
      'deltoid_strength',
      'biceps_strength',
      'triceps_strength',
      'quadriceps_strength',
      'tibialis_strength',
    ]);
  const strengthFields = strengthDoc?.ocrPayload?.fields;
  const strengthSummary = buildStrengthSummary(strengthFields);

  const geneEvidence = [geneticType, haplotype, ecoRIFragment, d4z4Repeats]
    .filter(Boolean)
    .join(' · ');
  const mriHighlights = [mriImpression, mriFinding]
    .filter((value): value is string => Boolean(value))
    .map((value) => compactText(value, value));

  /** The upload date of the document the values below were read off.
   *
   *  It reaches a reader as the 诊断与分型 panel's `latestDate`, printed
   *  on 病程 in the same row as the panel title and above the values —
   *  a date over a set of numbers is a claim about those numbers. It
   *  used to be the newest `genetic_report`'s date instead, which was
   *  the date of a report whose fields were not necessarily the ones
   *  on screen: the fallback could take the values off an entirely
   *  different document and this line went on naming the typed one, or
   *  printed 「—」 when no typed report existed at all. One document
   *  supplies the values and the date now.
   *
   *  It is also written onto each metric, where nothing reads it —
   *  `ReportInsightMetric.date` has no renderer on any screen. Set
   *  from the same source anyway rather than left pointing at the old
   *  one, because a stale field is worse than an unused one. */
  const geneticEvidenceDate = formatDate(geneticDoc?.uploadedAt ?? null);

  const diagnosisPanelMetrics: ReportInsightMetric[] = [
    {
      label: '分型',
      value: geneticType ?? '—',
      date: geneticEvidenceDate,
    },
    {
      label: 'D4Z4',
      value: d4z4Repeats ?? '—',
      date: geneticEvidenceDate,
    },
    {
      label: '单倍型',
      value: haplotype ?? '—',
      date: geneticEvidenceDate,
    },
    {
      label: '甲基化',
      value: methylationValue ?? '—',
      date: geneticEvidenceDate,
    },
  ].filter((item) => item.value && item.value !== '—');

  const respiratoryPattern = resolveMetric(
    docs,
    ['ventilatoryPattern', 'ventilatory_pattern'],
    ['pulmonary_function'],
    VENTILATORY_PATTERN_ZH,
  );
  const respiratoryFvc = resolveMetric(
    docs,
    ['fvcPredPct', 'fvc_pred_pct'],
    ['pulmonary_function'],
  );
  const respiratoryFev1 = resolveMetric(
    docs,
    ['fev1PredPct', 'fev1_pred_pct'],
    ['pulmonary_function'],
  );
  const respiratoryTlc = resolveMetric(
    docs,
    ['tlcPredPct', 'tlc_pred_pct'],
    ['pulmonary_function'],
  );
  const respiratoryDlco = resolveMetric(
    docs,
    ['dlcoPredPct', 'dlco_pred_pct'],
    ['pulmonary_function'],
  );
  const diaphragmSummaryMetric = resolveMetric(
    docs,
    ['diaphragmMotionSummary', 'diaphragm_motion_summary'],
    ['diaphragm_ultrasound'],
  );
  const diaphragmThickeningMetric = resolveMetric(
    docs,
    ['diaphragmThickeningSummary', 'diaphragm_thickening_summary'],
    ['diaphragm_ultrasound'],
  );

  const cardiacHr = resolveMetric(docs, ['heartRate', 'heart_rate'], ['ecg']);
  const cardiacQtc = resolveMetric(docs, ['qtcMs', 'qtc_ms', 'QTc', 'qtc'], ['ecg']);
  const cardiacLvef = resolveMetric(docs, ['LVEF', 'lvef'], ['echocardiography']);
  const cardiacRhythm = resolveMetric(docs, ['ecgRhythm', 'ecg_rhythm'], ['ecg']);
  const cardiacEcgSummary = resolveMetric(docs, ['ecgSummary', 'ecg_summary'], ['ecg']);
  const cardiacEchoSummary = resolveMetric(
    docs,
    ['echoSummary', 'echo_summary'],
    ['echocardiography'],
  );

  const labCk = resolveMetric(
    docs,
    ['creatineKinase', 'creatine_kinase', 'CK', 'ck'],
    ['muscle_enzyme', 'biochemistry'],
  );
  const labMb = resolveMetric(
    docs,
    ['myoglobin', 'MYO', 'Myo', 'MB', 'Mb', 'mb'],
    ['muscle_enzyme', 'biochemistry'],
  );
  const labLdh = resolveMetric(docs, ['LDH', 'ldh'], ['muscle_enzyme', 'biochemistry']);
  const labCkmb = resolveMetric(docs, ['CKMB', 'ckmb'], ['muscle_enzyme', 'biochemistry']);
  const labCreatinine = resolveMetric(docs, ['creatinine'], ['biochemistry']);
  const labUricAcid = resolveMetric(docs, ['uricAcid', 'uric_acid'], ['biochemistry']);
  const labWbc = resolveMetric(docs, ['wbc'], ADMISSION_PANEL_DOC_TYPES);
  const labHgb = resolveMetric(docs, ['hgb'], ADMISSION_PANEL_DOC_TYPES);
  const labPlt = resolveMetric(docs, ['plt'], ADMISSION_PANEL_DOC_TYPES);
  const labFt3 = resolveMetric(docs, ['ft3'], ['thyroid_function']);
  const labFt4 = resolveMetric(docs, ['ft4'], ['thyroid_function']);
  const labTsh = resolveMetric(docs, ['tsh'], ['thyroid_function']);
  const labPt = resolveMetric(docs, ['pt'], ['coagulation']);
  const labAptt = resolveMetric(docs, ['aptt'], ['coagulation']);
  const labFibrinogen = resolveMetric(docs, ['fibrinogen'], ['coagulation']);
  const labDdimer = resolveMetric(docs, ['dDimer', 'd_dimer'], ['coagulation']);

  const imagingPanelMetrics: ReportInsightMetric[] = [
    {
      label: '重点区域',
      value: mriHighlights.length > 0 ? mriHighlights.join('、') : '—',
      date: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null),
    },
  ].filter((item) => item.value && item.value !== '—');

  const bloodSections = [
    buildMetricSection(
      'fshd_core',
      '肌损伤',
      [
        {
          label: 'CK',
          keys: ['creatineKinase', 'creatine_kinase', 'CK', 'ck'],
          docTypes: ['muscle_enzyme', 'biochemistry'],
        },
        {
          label: 'Mb',
          keys: ['myoglobin', 'MYO', 'Myo', 'MB', 'Mb', 'mb'],
          docTypes: ['muscle_enzyme', 'biochemistry'],
        },
        { label: 'LDH', keys: ['LDH', 'ldh'], docTypes: ['muscle_enzyme', 'biochemistry'] },
        { label: 'CKMB', keys: ['CKMB', 'ckmb'], docTypes: ['muscle_enzyme', 'biochemistry'] },
      ],
      docs,
      'core',
      'fshd_related',
      'FSHD相关',
    ),
    buildMetricSection(
      'metabolic',
      '代谢/肾功能',
      [
        { label: 'Cr', keys: ['creatinine'], docTypes: ['biochemistry'] },
        { label: 'UA', keys: ['uricAcid', 'uric_acid'], docTypes: ['biochemistry'] },
      ],
      docs,
      'secondary',
      'fshd_related',
      'FSHD相关',
    ),
    buildMetricSection(
      'blood_routine',
      '血常规',
      [
        { label: 'WBC', keys: ['wbc'], docTypes: ADMISSION_PANEL_DOC_TYPES },
        { label: 'HGB', keys: ['hgb'], docTypes: ADMISSION_PANEL_DOC_TYPES },
        { label: 'PLT', keys: ['plt'], docTypes: ADMISSION_PANEL_DOC_TYPES },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'thyroid_function',
      '甲功',
      [
        { label: 'FT3', keys: ['ft3'], docTypes: ['thyroid_function'] },
        { label: 'FT4', keys: ['ft4'], docTypes: ['thyroid_function'] },
        { label: 'TSH', keys: ['tsh'], docTypes: ['thyroid_function'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'coagulation',
      '凝血',
      [
        { label: 'PT', keys: ['pt'], docTypes: ['coagulation'] },
        { label: 'APTT', keys: ['aptt'], docTypes: ['coagulation'] },
        { label: 'Fib', keys: ['fibrinogen'], docTypes: ['coagulation'] },
        { label: 'D-二聚体', keys: ['dDimer', 'd_dimer'], docTypes: ['coagulation'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'urinalysis',
      '尿常规',
      [
        {
          label: '尿蛋白',
          keys: ['urineProtein', 'urine_protein'],
          docTypes: ADMISSION_PANEL_DOC_TYPES,
        },
        {
          label: '尿潜血',
          keys: ['urineOccultBlood', 'urine_occult_blood'],
          docTypes: ADMISSION_PANEL_DOC_TYPES,
        },
        {
          label: '尿糖',
          keys: ['urineGlucose', 'urine_glucose'],
          docTypes: ADMISSION_PANEL_DOC_TYPES,
        },
        {
          label: '尿比重',
          keys: ['urineSpecificGravity', 'urine_specific_gravity'],
          docTypes: ADMISSION_PANEL_DOC_TYPES,
        },
        { label: '尿 pH', keys: ['urinePh', 'urine_ph'], docTypes: ADMISSION_PANEL_DOC_TYPES },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'infection_screening',
      '感染筛查',
      [
        { label: 'HBsAg', keys: ['hbsag'], docTypes: ['infection_screening'] },
        { label: 'HIV', keys: ['hivAb', 'hiv_ab'], docTypes: ['infection_screening'] },
        { label: 'TPPA', keys: ['tppa'], docTypes: ['infection_screening'] },
        { label: 'TRUST', keys: ['trustAb', 'trust_ab'], docTypes: ['infection_screening'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'digestive_screening',
      '消化筛查',
      [
        {
          label: '粪便隐血',
          keys: ['stoolOccultBlood', 'stool_occult_blood'],
          docTypes: ['stool_test'],
        },
        { label: 'HP DOB', keys: ['hpDob', 'hp_dob'], docTypes: ['stool_test'] },
        { label: 'HP 结果', keys: ['hpResult', 'hp_result'], docTypes: ['stool_test'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
  ].filter((item): item is SystemInsightSection => Boolean(item));

  const respiratorySections = [
    buildMetricSection(
      'pulmonary_function',
      '肺功能',
      [
        {
          label: '通气模式',
          keys: ['ventilatoryPattern', 'ventilatory_pattern'],
          docTypes: ['pulmonary_function'],
          values: VENTILATORY_PATTERN_ZH,
        },
        {
          label: 'FVC %Pred',
          keys: ['fvcPredPct', 'fvc_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
        {
          label: 'FEV1 %Pred',
          keys: ['fev1PredPct', 'fev1_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
        {
          label: 'TLC %Pred',
          keys: ['tlcPredPct', 'tlc_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
        {
          label: 'DLCO %Pred',
          keys: ['dlcoPredPct', 'dlco_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
      ],
      docs,
      'core',
    ),
    buildMetricSection(
      'diaphragm_ultrasound',
      '膈肌超声',
      [
        {
          label: '膈肌运动',
          keys: ['diaphragmMotionSummary', 'diaphragm_motion_summary'],
          docTypes: ['diaphragm_ultrasound'],
        },
        {
          label: '膈肌增厚',
          keys: ['diaphragmThickeningSummary', 'diaphragm_thickening_summary'],
          docTypes: ['diaphragm_ultrasound'],
        },
      ],
      docs,
      'core',
    ),
  ].filter((item): item is SystemInsightSection => Boolean(item));

  const cardiacSections = [
    buildMetricSection(
      'ecg',
      '心电图',
      [
        { label: '心电结论', keys: ['ecgSummary', 'ecg_summary'], docTypes: ['ecg'] },
        { label: '心率', keys: ['heartRate', 'heart_rate'], docTypes: ['ecg'] },
        { label: 'QTc', keys: ['qtcMs', 'qtc_ms', 'QTc', 'qtc'], docTypes: ['ecg'] },
        { label: '心律', keys: ['ecgRhythm', 'ecg_rhythm'], docTypes: ['ecg'] },
      ],
      docs,
      'core',
    ),
    buildMetricSection(
      'echocardiography',
      '心脏超声',
      [
        { label: 'LVEF', keys: ['LVEF', 'lvef'], docTypes: ['echocardiography'] },
        {
          label: '心超结论',
          keys: ['echoSummary', 'echo_summary'],
          docTypes: ['echocardiography'],
        },
      ],
      docs,
      'core',
    ),
  ].filter((item): item is SystemInsightSection => Boolean(item));

  const bloodPanelMetrics = flattenSections(bloodSections);
  const respiratoryPanelMetrics = flattenSections(respiratorySections);
  const cardiacPanelMetrics = flattenSections(cardiacSections);

  const bloodCoverage = collectCoverage(docs, [
    'muscle_enzyme',
    'biochemistry',
    'blood_routine',
    'thyroid_function',
    'coagulation',
    'urinalysis',
    'infection_screening',
    'stool_test',
  ]);
  const respiratoryCoverage = collectCoverage(docs, ['pulmonary_function', 'diaphragm_ultrasound']);
  const cardiacCoverage = collectCoverage(docs, ['ecg', 'echocardiography']);

  const bloodState = getPanelState(bloodSections);
  const respiratoryState = getPanelState(respiratorySections);
  const cardiacState = getPanelState(cardiacSections);

  /**
   * The bracket after the values, and the two things it has to be able
   * to say.
   *
   * 分型 CAN COME OFF THE PROFILE COLUMN while the rest come off the
   * document, which is what the first note is for. It said 「不是这份
   * 报告读出来的」 and called the document a 报告 while doing it.
   *
   * AND THE DOCUMENT IS NOT ALWAYS A REPORT. `pickGeneticEvidenceDocument`
   * takes a 病历摘要 quoting the results when the genetics report read
   * out nothing, so 检查结果 printed a clinic's transcription of a repeat
   * count in the panel a laboratory's number gets — same title, same
   * date line, same metric grid — with nothing on the tab saying who
   * wrote the page. 临床护照, one tap away, brackets each of those values
   * with the API's own phrase, which is the phrase repeated here.
   *
   * OUTSIDE `compactText`, and that is the point of building it
   * separately. The helper cuts its input at 88 characters, so a note
   * concatenated onto the values before the cut is the part that
   * disappears on exactly the profiles that carry the most values —
   * which the 分型 note already did.
   */
  const diagnosisSummaryNoteZh = [
    geneticTypeFromProfile ? '分型来自档案，不是从这份文件里读出来的' : null,
    geneticDoc && !geneticFromLaboratory
      ? `本平台读作基因证据的那一份不是基因报告，给它标的来源是「${TRANSCRIBED_EVIDENCE_LABEL_ZH}」，上面的结果是转录来的，不是实验室出的结论`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join('；');

  const diagnosisPanel: ReportInsightPanel = {
    key: 'diagnosis',
    title: '诊断与分型',
    summary: `${compactText(geneEvidence || geneticType, '暂无可直接展示的诊断证据')}${
      diagnosisSummaryNoteZh ? `（${diagnosisSummaryNoteZh}）` : ''
    }`,
    latestDate: geneticEvidenceDate ?? '—',
    metrics: diagnosisPanelMetrics,
  };

  const imagingPanel: ReportInsightPanel = {
    key: 'imaging',
    title: '肌肉 MRI',
    summary: compactText(mriSummary, '暂无 MRI 分析数据'),
    latestDate: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null) ?? '—',
    metrics: imagingPanelMetrics,
  };

  const respiratoryPanel: SystemInsightPanel = {
    key: 'respiratory',
    title: '呼吸检查',
    summary: buildCoverageSummary(
      respiratoryCoverage,
      respiratoryState.state,
      '暂无呼吸检查数据',
      '肺功能与膈肌状态都可直接查看。',
      '建议继续补齐肺功能或膈肌超声。',
    ),
    latestDate: maxDate([
      respiratoryReportTime,
      respiratoryPattern.date,
      respiratoryFvc.date,
      respiratoryFev1.date,
      respiratoryTlc.date,
      respiratoryDlco.date,
      diaphragmSummaryMetric.date,
      diaphragmThickeningMetric.date,
    ]),
    metrics: respiratoryPanelMetrics,
    state: respiratoryState.state,
    stateLabel: respiratoryState.stateLabel,
    coverage: respiratoryCoverage,
    sourceCount: respiratoryCoverage.length,
    sections: respiratorySections,
  };

  const cardiacPanel: SystemInsightPanel = {
    key: 'cardiac',
    title: '心脏检查',
    summary: buildCoverageSummary(
      cardiacCoverage,
      cardiacState.state,
      '暂无心脏检查数据',
      '心电和心超指标都已进入监测视图。',
      '建议继续补齐 ECG 或心脏超声。',
    ),
    latestDate: maxDate([
      cardiacReportTime,
      cardiacHr.date,
      cardiacQtc.date,
      cardiacLvef.date,
      cardiacEcgSummary.date,
      cardiacEchoSummary.date,
      cardiacRhythm.date,
    ]),
    metrics: cardiacPanelMetrics,
    state: cardiacState.state,
    stateLabel: cardiacState.stateLabel,
    coverage: cardiacCoverage,
    sourceCount: cardiacCoverage.length,
    sections: cardiacSections,
  };

  const bloodPanel: SystemInsightPanel = {
    key: 'blood',
    title: '实验室检查',
    summary: buildCoverageSummary(
      bloodCoverage,
      bloodState.state,
      '暂无实验室检查数据',
      'FSHD 相关实验室指标和分类结果都可直接查看。',
      '已按 FSHD 相关、甲功、血常规等分类整理。',
    ),
    latestDate: maxDate([
      bloodReportTime,
      labCk.date,
      labMb.date,
      labLdh.date,
      labCkmb.date,
      labCreatinine.date,
      labUricAcid.date,
      labWbc.date,
      labHgb.date,
      labPlt.date,
      labFt3.date,
      labFt4.date,
      labTsh.date,
      labPt.date,
      labAptt.date,
      labFibrinogen.date,
      labDdimer.date,
    ]),
    metrics: bloodPanelMetrics,
    state: bloodState.state,
    stateLabel: bloodState.stateLabel,
    coverage: bloodCoverage,
    sourceCount: bloodCoverage.length,
    sections: bloodSections,
  };

  return {
    geneticType: geneticType ?? '—',
    haplotype: haplotype ?? '—',
    ecoRIFragment: ecoRIFragment ?? '—',
    d4z4Repeats: d4z4Repeats ?? '—',
    methylationValue: methylationValue ?? '—',
    diagnosisDate: diagnosisDate ?? '—',
    geneEvidence: geneEvidence || '暂无可直接展示的基因证据',
    latestMriDate: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null) ?? '—',
    mriSummary,
    latestBloodDate: formatDate(bloodReportTime ?? bloodDoc?.uploadedAt ?? null) ?? '—',
    bloodSummary,
    latestRespiratoryDate:
      formatDate(respiratoryReportTime ?? respiratoryDoc?.uploadedAt ?? null) ?? '—',
    respiratorySummary,
    latestCardiacDate: formatDate(cardiacReportTime ?? cardiacDoc?.uploadedAt ?? null) ?? '—',
    cardiacSummary,
    strengthAverage: strengthSummary.average !== null ? strengthSummary.average.toFixed(1) : '—',
    strengthSummary: strengthSummary.summary ?? '暂无可用的肌力评估摘要',
    diagnosisPanel,
    imagingPanel,
    systemPanels: [respiratoryPanel, cardiacPanel, bloodPanel],
  };
};
