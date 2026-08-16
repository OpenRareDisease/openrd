/**
 * WHICH UPLOADED DOCUMENT IS THIS PROFILE'S GENETIC EVIDENCE.
 *
 * The rule, and the alias table it reads through, are the API's. They
 * live in `pickGeneticEvidenceDocument` and `GENETIC_FIELD_KEYS` under
 * apps/api, which is where every server-side reader of a genetic value
 * gets its answer — the passport, the baseline autofill, the portable
 * exports. This bundle cannot import from that package, so this file
 * carries the same rule for the same reasons, exactly as
 * `isLargeD4Z4Deletion` in lib/surveillance-schedule.ts carries the
 * same threshold. IF EITHER SIDE'S RULE CHANGES THE OTHER HAS TO CHANGE
 * WITH IT: they are checked against the same cases and nothing in the
 * build links them.
 *
 * Why the copy is here rather than a fifth private answer inside
 * `buildReportInsights`: that reader used to take the newest document
 * typed `genetic_report`, falling back to the newest document carrying
 * any genetic key. 我的档案 and 病程 print its numbers, the clinical
 * passport prints the API's, and once the API's rule changed those two
 * were naming different reports on the same patient with nothing on
 * either page saying so. One rule stated once per bundle is the most
 * this repository's layout allows; four private ones is what it had.
 *
 * WHAT THIS FILE DOES NOT DECIDE: whether a value may drive a clinical
 * recommendation. That is `readLaboratoryRepeatCount`'s question and it
 * is not answered here or from a document at all — the API answers it
 * once, in `determinateRepeatCount`, and sends the answer as
 * `diagnosis.laboratoryRepeatCount`.
 */

/**
 * The shape this module needs from a document row.
 *
 * `id` and `status` are required, not optional-with-a-default. A caller
 * that cannot say whether a parse landed cannot be given a default,
 * because the default is the erasure this rule exists to stop: a report
 * whose parse has not come back says nothing yet, and treating its
 * silence as a reading is how a fresh upload used to empty a passport.
 */
export interface GeneticEvidenceDocumentLike {
  id: string;
  documentType?: string | null;
  /** The row's parse state: `parsed`, `needs_review`, `processing`,
   *  `parse_failed`, or the legacy `uploaded`. */
  status: string | null;
  uploadedAt?: string | null;
  ocrPayload?: {
    fields?: Record<string, string | number>;
  } | null;
}

/**
 * Every OCR key any writer in this pipeline has produced for a genetic
 * value, in the order they are preferred.
 *
 * The same table the API reads through, and the same order — the
 * hand-correctable spellings first, so a patient who fixed a misread
 * digit sees their own number rather than the OCR's. The lists that
 * used to sit inline in `buildReportInsights` were already identical
 * member for member, which is why moving onto this table changed no
 * displayed value; what it changes is that there is now one table to
 * add a key to.
 */
export const GENETIC_FIELD_KEYS = {
  geneticType: ['diagnosisType', 'geneticType', 'geneType', 'diagnosis_type', 'genetic_type'],
  haplotype: ['haplotype', 'haplotype4q', 'haplotype_4q'],
  ecoRIFragment: [
    'ecoRIFragment',
    'ecoriFragment',
    'ecoriFragmentKb',
    'ecori_fragment_kb',
    'EcoRI_kb',
    'EcoRIFragment',
  ],
  d4z4Repeats: ['d4z4Repeats', 'd4z4RepeatPathogenic', 'd4z4_repeat_pathogenic', 'd4z4_repeats'],
  methylationValue: ['methylationValue', 'methylation_value'],
  testMethod: ['geneticTestMethod', 'genetic_test_method'],
} as const;

/** The keys a 诊断日期 can come off. */
export const DIAGNOSIS_DATE_KEYS = ['diagnosisDate', 'diagnosis_date'];

/** The keys under which a report states a RESULT. A document not typed
 *  `genetic_report` is genetic evidence only if it carries one of these
 *  — 检测方法 and 诊断日期 are excluded on purpose, because a document
 *  whose only genetic content is 「Southern blot」 has reported nothing
 *  about this patient. */
const GENETIC_RESULT_KEY_GROUPS: readonly (readonly string[])[] = [
  GENETIC_FIELD_KEYS.geneticType,
  GENETIC_FIELD_KEYS.haplotype,
  GENETIC_FIELD_KEYS.ecoRIFragment,
  GENETIC_FIELD_KEYS.d4z4Repeats,
  GENETIC_FIELD_KEYS.methylationValue,
];

/** Everything a reader can take off the one document this module picks
 *  — the results plus the report's stated 检测方法 and 诊断日期. Derived
 *  from the tables above rather than restated, so a group added there is
 *  weighed here without a second edit. */
const GENETIC_DOCUMENT_VALUE_KEY_GROUPS: readonly (readonly string[])[] = [
  ...GENETIC_RESULT_KEY_GROUPS,
  GENETIC_FIELD_KEYS.testMethod,
  DIAGNOSIS_DATE_KEYS,
];

const CLASSIFIED_TYPE_KEYS = ['classifiedType', 'classified_type', 'reportType', 'report_type'];

/** Statuses in which the extraction job has come back. Everything else
 *  — `processing`, `parse_failed`, the legacy `uploaded` — is a row
 *  whose file this platform has not read. */
const PARSE_LANDED_STATUSES: ReadonlySet<string> = new Set(['parsed', 'needs_review']);

/**
 * One value off a payload, under the first key that holds one.
 *
 * Strings and finite numbers only. A field holding an array or an
 * object is not a reading: stringifying one produced 「4qA,4qB」 for a
 * haplotype field listing the probes and printed it where a real result
 * goes. There is no sensible coercion, so there is none — and the
 * payload arrives as whatever the server stored, so the guard is a
 * runtime one and not only a type.
 */
const pickReading = (
  fields: Record<string, string | number> | undefined,
  keys: readonly string[],
): string | null => {
  if (!fields) return null;
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};

const payloadFields = (document: GeneticEvidenceDocumentLike) => document.ocrPayload?.fields;

/** What kind of document this is, as the parser classified it when it
 *  managed to, else as the uploader declared it. */
const documentClassifiedType = (document: GeneticEvidenceDocumentLike): string =>
  pickReading(payloadFields(document), CLASSIFIED_TYPE_KEYS) ?? document.documentType ?? '';

/**
 * IS THIS DOCUMENT THE GENETICS LABORATORY'S OWN REPORT.
 *
 * The API's `isLaboratoryGeneticReport`, carried here for the reason
 * the picker is — this bundle cannot import from that package, and both
 * halves of the rule have to move together.
 *
 * Exported because the question does not stop mattering once the pick
 * is made. The picker takes a 病历摘要 quoting a repeat count when the
 * laboratory's report read out nothing, on purpose, because for some
 * patients it is the only copy of the number in existence. That is a
 * decision about DISPLAY: the value may be shown, always with its
 * origin beside it, and no sentence over it may be written in a
 * laboratory's voice.
 */
export const isLaboratoryGeneticReport = (document: GeneticEvidenceDocumentLike): boolean =>
  documentClassifiedType(document) === 'genetic_report';

/**
 * WHAT A VALUE READ OFF SUCH A DOCUMENT IS CALLED.
 *
 * The API's `TRANSCRIBED_EVIDENCE_LABEL_ZH`, and the same string the
 * server already sends this bundle as `origin.labelZh` for a
 * transcribed value — 临床护照, 我的档案 and 我的随访计划 all print it
 * from the wire. It is copied here for the one reader that has no
 * origin to print: `buildReportInsights` picks the document itself, off
 * `profile.documents`, and 病程 → 检查结果 renders what it returns.
 *
 * IF THE API'S CHANGES THIS HAS TO CHANGE WITH IT, exactly as the
 * picker above does. Two wordings of one claim across two screens of
 * one app is the defect this constant exists to avoid, and nothing in
 * the build links them.
 */
export const TRANSCRIBED_EVIDENCE_LABEL_ZH = '转录自非基因报告文件';

const getTimestamp = (value: string | null | undefined) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

/** How much of the diagnosis block this document can supply. Zero for a
 *  document whose parse has not landed: such a row has no payload,
 *  because the upload path inserts it empty and the reparse path blanks
 *  it before the job starts. */
const countGeneticValues = (document: GeneticEvidenceDocumentLike) => {
  const fields = payloadFields(document);
  if (!fields) return 0;
  return GENETIC_DOCUMENT_VALUE_KEY_GROUPS.filter((keys) => pickReading(fields, keys)).length;
};

/**
 * WHICH ONE DOCUMENT IS THIS PROFILE'S GENETIC EVIDENCE.
 *
 * A candidate is a document typed `genetic_report`, or any document
 * carrying a genetic RESULT — a 病历摘要 quoting the repeat count is the
 * only copy some patients have. Among candidates the order is:
 *
 * IT SAYS SOMETHING. A document this platform has read nothing off
 * cannot be the evidence for anything. That is what stops a new upload
 * from emptying the page: the row sits in `processing` with no payload
 * for as long as the parse takes, a parse that raises lands in
 * `parse_failed` and stays there, and on a date order both outranked
 * the older report that had parsed. A silent document is still picked
 * when nothing else is on file, so the page can still say when
 * something was last uploaded; it supplies no value, which is the
 * honest answer for a file we have not read.
 *
 * THEN THE LABORATORY, ahead of anything else and ahead of how much
 * either carries. Ranking by information content first is how a 病历摘要
 * quoting a repeat count came to outrank the genetics report it was
 * quoting: a transcription is not a measurement, and a sparse report
 * from the laboratory is still the laboratory.
 *
 * THEN THE LANDED PARSE, which separates two documents that are
 * otherwise equal — a legacy row carrying fields from a pre-async
 * extraction path, against a row the current pipeline finished.
 *
 * THEN RICHER, and only then newer. `parsed` is a statement about the
 * job, not about the document: it means the extractor returned, and a
 * `parsed` row that extracted nothing is recoverable by re-running the
 * same file — the file did not change, the parser did. So a newer
 * report's SILENCE about a value is not a measurement, and letting it
 * delete a real one is the same erasure with a slower fuse.
 *
 * THEN `id`, so an unchanged profile re-renders identically.
 *
 * ONE DOCUMENT AND NOT A MERGE of the best value for each row. 分型,
 * 单倍型, EcoRI 片段, D4Z4 重复数 and 甲基化 are one assay's reading, and
 * the passport grades them against the 检测方法 of the same report — a
 * D4Z4 count taken from a Southern blot beside a haplotype taken from a
 * WES would be graded as one report holding both, which is the sentence
 * this product exists to avoid saying.
 */
export const pickGeneticEvidenceDocument = <T extends GeneticEvidenceDocumentLike>(
  documents: readonly T[],
): T | null => {
  // Ranked once per document rather than inside the comparator:
  // classifying and counting both walk the payload, and a comparator
  // that re-walks it re-reads the same report for every comparison it
  // takes part in.
  const candidates = documents
    .map((document) => {
      const fields = payloadFields(document);
      return {
        document,
        typed: isLaboratoryGeneticReport(document),
        carriesResult: GENETIC_RESULT_KEY_GROUPS.some((keys) => pickReading(fields, keys)),
        values: countGeneticValues(document),
        parseLanded: PARSE_LANDED_STATUSES.has(document.status ?? ''),
        time: getTimestamp(document.uploadedAt),
      };
    })
    .filter((candidate) => candidate.typed || candidate.carriesResult);
  if (candidates.length === 0) return null;
  return (
    candidates.sort(
      (a, b) =>
        Number(b.values > 0) - Number(a.values > 0) ||
        Number(b.typed) - Number(a.typed) ||
        Number(b.parseLanded) - Number(a.parseLanded) ||
        b.values - a.values ||
        b.time - a.time ||
        (a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0),
    )[0]?.document ?? null
  );
};
