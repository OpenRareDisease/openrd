/**
 * WHICH UPLOADED DOCUMENT IS THIS PROFILE'S GENETIC EVIDENCE.
 *
 * One answer, computed here, used by everything that has to name one.
 *
 * Every reader of a genetic value used to decide this for itself, and
 * the answers had drifted apart: `buildReportInsights` ranked
 * candidates by how much they carried, `applyGeneticReportAutofill`
 * took the newest document typed `genetic_report`, and the exports
 * asked the autofill — so the same profile could have the passport
 * printing one report's D4Z4 count while the registry export printed
 * another's, both labelled as this patient's genetic result. Two
 * answers about one measurement is worse than one wrong answer,
 * because nothing on either page says the other exists.
 *
 * Keeping the pickers in step with comments was tried and is what
 * failed. The rule lives in `pickGeneticEvidenceDocument` and callers
 * do not restate it.
 */

/**
 * The shape this module needs from a document row.
 *
 * Deliberately structural and deliberately not `PatientDocumentDTO`:
 * the autofill runs inside the service on a narrower projection, and
 * an import back into `profile.service.ts` would be a cycle. Every
 * member is required, `status` included — a caller that cannot say
 * whether the parse landed cannot be given a default, because the
 * default would be the erasure this module was written to stop.
 */
export interface GeneticEvidenceDocumentLike {
  readonly id: string;
  readonly documentType: string | null;
  /** The row's parse state: `parsed`, `needs_review`, `processing`,
   *  `parse_failed`, or the legacy `uploaded`. */
  readonly status: string | null;
  readonly uploadedAt: string | null;
  readonly ocrPayload: unknown;
}

/**
 * Every OCR key any writer in this pipeline has ever produced for a
 * genetic value, in the order they are preferred, with the writer named.
 *
 * These lists used to sit inline in `buildReportInsights` as anonymous
 * string arrays, and the file had no record of where any of the keys
 * came from — so nobody could add one, drop one, or say which of them a
 * given report would actually carry. Collected here because the answer
 * differs per key and is knowable:
 *
 *   `d4z4Repeats`, `haplotype`, `methylationValue`, `diagnosisType`
 *     — written by apps/api/src/services/ocr/embedded-report-ocr.ts from
 *       `normalized_summary.genetic_summary`, AND the keys a patient
 *       may hand-correct (EDITABLE_OCR_FIELDS in profile.schema.ts).
 *       Hand-correction is why these come FIRST: a patient who fixed a
 *       misread digit must see their own number, not the OCR's.
 *   `d4z4RepeatPathogenic` / `d4z4_repeat_pathogenic`,
 *   `ecoriFragmentKb` / `ecori_fragment_kb`, `methylation_value`
 *     — the same bridge copies every Python `structured_fields` entry in
 *       under both its snake_case name and its camelCase form.
 *   `ecoRIFragment`
 *     — bridge-only alias, built as the kb reading with its unit.
 *   `haplotype4q`, `haplotype_4q`, `EcoRI_kb`, `EcoRIFragment`,
 *   `ecoriFragment`, `d4z4_repeats`, `geneticType`, `geneType`,
 *   `genetic_type`
 *     — LEGACY. No writer in the current pipeline emits these; they are
 *       kept because payloads written by earlier extraction paths are
 *       still on disk and dropping a key silently blanks a real
 *       patient's evidence. Do not add to this group.
 *
 * This table lives here rather than beside any one reader for the same
 * reason the picker does: the passport, the autofill and the exports
 * all have to agree about what a report SAYS, not only about which
 * report it is.
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

/** The report keys a 诊断日期 can come off. The same two the autofill
 *  reads when it fills an empty `patient_profiles.diagnosis_date`, which
 *  is what makes 「a report carries one」 the question worth asking about
 *  the column's own value. */
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

/**
 * Everything a reader can take off the ONE document this module picks
 * — the results plus the report's stated 检测方法 and 诊断日期. Derived
 * from the key tables rather than restated, so a key group added there
 * is counted here without a second edit.
 *
 * The measure is what the document can put on the page, which is why
 * `testMethod` is in it although no row prints it: it is what
 * `buildGeneticEvidence` grades, and the grade is printed.
 */
const GENETIC_DOCUMENT_VALUE_KEY_GROUPS: readonly (readonly string[])[] = [
  ...GENETIC_RESULT_KEY_GROUPS,
  GENETIC_FIELD_KEYS.testMethod,
  DIAGNOSIS_DATE_KEYS,
];

const CLASSIFIED_TYPE_KEYS = ['classifiedType', 'classified_type', 'reportType', 'report_type'];

/** Statuses in which the extraction job has come back. Everything else
 *  — `processing`, `parse_failed`, the legacy `uploaded` — is a row
 *  whose file this platform has not read. The same pair
 *  `patchDocumentOcrFields` requires before it will accept a
 *  correction, for the same reason: there is nothing yet to correct. */
const PARSE_LANDED_STATUSES: ReadonlySet<string> = new Set(['parsed', 'needs_review']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * One value off a payload, under the first key that holds one.
 *
 * Strings and finite numbers only. A payload field holding an array or
 * an object is NOT a reading: stringifying one produced 「4qA,4qB」 for a
 * haplotype field listing the probes, and printed it in the same row a
 * real result goes in. There is no sensible coercion, so there is none.
 */
export const pickReading = (
  fields: Record<string, unknown> | null | undefined,
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

const payloadFields = (document: GeneticEvidenceDocumentLike): Record<string, unknown> | null => {
  const payload = isRecord(document.ocrPayload) ? document.ocrPayload : null;
  return payload && isRecord(payload.fields) ? payload.fields : null;
};

/**
 * What kind of document this is, as classified by the parser when it
 * managed to classify one, else as the uploader declared it.
 */
export const documentClassifiedType = (document: GeneticEvidenceDocumentLike): string =>
  pickReading(payloadFields(document), CLASSIFIED_TYPE_KEYS) ?? document.documentType ?? '';

/**
 * IS THIS DOCUMENT THE GENETICS LABORATORY'S OWN REPORT.
 *
 * The ordering key `pickGeneticEvidenceDocument` ranks on right after
 * 「it says something」, exported because the question does not stop
 * mattering once the pick is made. A 病历摘要 quoting a repeat count is
 * picked on purpose when the genetics report read out nothing — for
 * some patients it is the only copy of the number that exists, and
 * dropping it loses the value entirely. That is a decision about
 * DISPLAY. It is not a decision about grading: a transcription is not a
 * measurement, so the value it carries may be shown, always with its
 * origin beside it, and may never earn a confirmation, an evidence
 * grade, or a sentence written in a laboratory's voice.
 *
 * Exported rather than restated per surface for the reason the picker
 * itself is: four readers comparing a string against `genetic_report`
 * is four rules, and they drift. `buildGeneticEvidence` in
 * profile.passport.ts is where the grading half of the rule is
 * enforced; this is the question it asks.
 */
export const isLaboratoryGeneticReport = (document: GeneticEvidenceDocumentLike): boolean =>
  documentClassifiedType(document) === 'genetic_report';

/**
 * WHAT THIS PLATFORM CALLS THE VALUE IT READ OFF A DOCUMENT THAT IS NOT
 * THE LABORATORY'S REPORT, in the one wording every surface uses.
 *
 * Names the document CLASS rather than the document, because one phrase
 * has to be true of every document that reaches it: a 病历摘要 is the
 * common one, and anything the parser did not classify as a genetics
 * report can be another. 「转录」 is the whole claim — this platform read
 * the value off a page, and that page is not the report.
 *
 * Lives here, beside the question it answers, rather than inside the
 * passport's origin-label table: the passport prints it in a bracket,
 * the referral pack names the document with it, and the registry export
 * writes it into a provenance sentence a receiver reads without any of
 * this app's other pages. A second phrasing for the same fact is a
 * second thing to keep true.
 */
export const TRANSCRIBED_EVIDENCE_LABEL_ZH = '转录自非基因报告文件';

const getTimestamp = (value: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

/** How much of the diagnosis block this document can supply. Zero for a
 *  document whose parse has not landed: a row in `processing` has no
 *  payload at all, because the upload path inserts it empty and the
 *  reparse path nulls `ocr_payload` before it starts the job. */
const countGeneticValues = (document: GeneticEvidenceDocumentLike) => {
  const fields = payloadFields(document);
  if (!fields) return 0;
  return GENETIC_DOCUMENT_VALUE_KEY_GROUPS.filter((keys) => pickReading(fields, keys)).length;
};

/**
 * WHICH ONE DOCUMENT IS THIS PROFILE'S GENETIC EVIDENCE.
 *
 * A candidate is a document typed `genetic_report`, or any document
 * carrying a genetic RESULT — a 病历摘要 that quotes the repeat count is
 * the only copy some patients have. Among candidates the order is:
 *
 * IT SAYS SOMETHING. A document this platform has read nothing off
 * cannot be the evidence for anything. That is what stops a new upload
 * from emptying a passport: the row sits in `processing` with no
 * payload for as long as the parse takes, a parse that raises lands in
 * `parse_failed` and stays there, and on a date order both outranked
 * the older report that had parsed — so D4Z4 重复数, 分型 and the
 * evidence grade dropped off the passport, off the share page a
 * clinician was already holding, and out of the PDF, while the patient
 * was doing the one thing the app asks of them. A silent document is
 * still picked when nothing else is on file, so the 基因检测 row can
 * still say when the patient last uploaded something; it supplies no
 * value, which is the honest answer for a file we have not read.
 *
 * THEN THE LABORATORY, ahead of anything else, and ahead of how much
 * either carries. Ranking by information content first is how a 病历摘要
 * quoting a repeat count came to outrank the genetics report it was
 * quoting: a transcription is not a measurement, and a sparse report
 * from the laboratory is still the laboratory. The one place this
 * yields is above — where the genetics report read out nothing at all,
 * the transcription is what there is.
 *
 * AND WHERE IT YIELDS, THE ANSWER IS STILL CARRIED. This function
 * decides which document is DISPLAYED from; `isLaboratoryGeneticReport`
 * is the same question asked of the winner, and it decides what may be
 * GRADED off it. Picking the transcription is what keeps the patient's
 * only copy of a repeat count on the page; grading it would be a
 * laboratory's sentence with no laboratory behind it.
 *
 * THEN THE LANDED PARSE, which separates two documents that are
 * otherwise equal — a legacy `uploaded` row carrying fields from a
 * pre-async extraction path, against a row the current pipeline
 * finished.
 *
 * THEN RICHER, and only then newer. `parsed` is a statement about the
 * job, not about the document: it means the extractor returned, and
 * `reparseDocument` treats a `parsed` row that extracted nothing as a
 * failure wearing a success label, recoverable by re-running the same
 * file — the file did not change, the parser did. So a newer report's
 * SILENCE about D4Z4 重复数 is not a measurement, and letting it delete
 * a real one is the same erasure with a slower fuse. `needs_review` is
 * ranked by what it carries like any other: the reviewer flag is about
 * confidence in fields that ARE there.
 *
 * THEN `id`, so an unchanged profile re-renders byte-identical.
 *
 * ONE DOCUMENT AND NOT A MERGE of the best value for each row. 分型,
 * 单倍型, EcoRI 片段, D4Z4 重复数 and 甲基化 are one assay's reading, and
 * `buildGeneticEvidence` grades them against the `geneticTestMethod` of
 * the same report — a D4Z4 count taken from a Southern blot and a
 * haplotype taken from a WES would be graded as one report that has
 * both, which is the sentence this product exists to avoid saying.
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
        laboratory: isLaboratoryGeneticReport(document),
        carriesResult: GENETIC_RESULT_KEY_GROUPS.some((keys) => pickReading(fields, keys)),
        values: countGeneticValues(document),
        parseLanded: PARSE_LANDED_STATUSES.has(document.status ?? ''),
        time: getTimestamp(document.uploadedAt),
      };
    })
    .filter((candidate) => candidate.laboratory || candidate.carriesResult);
  if (candidates.length === 0) return null;
  return (
    candidates.sort(
      (a, b) =>
        Number(b.values > 0) - Number(a.values > 0) ||
        Number(b.laboratory) - Number(a.laboratory) ||
        Number(b.parseLanded) - Number(a.parseLanded) ||
        b.values - a.values ||
        b.time - a.time ||
        (a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0),
    )[0]?.document ?? null
  );
};

/**
 * The genetic values this profile's evidence states, read off the one
 * document `pickGeneticEvidenceDocument` names.
 *
 * The baseline autofill writes these into empty slots and the portable
 * exports read them back to say whether an archived value can be
 * attributed to a report. Sharing the reader is what makes the second
 * question answerable at all: two readers over two documents would have
 * the export comparing an archived value against a report that never
 * supplied it.
 *
 * `diagnosisDate` is returned as the report printed it. Normalising it
 * is the autofill's business, because the column it fills is a `date`
 * and no other caller writes one.
 */
export interface GeneticEvidenceReading {
  readonly documentId: string | null;
  /**
   * Whether the document those values were read off is the genetics
   * laboratory's own report — `isLaboratoryGeneticReport` asked of the
   * picked document, carried rather than left for the caller to ask
   * again.
   *
   * `false` WITH A NULL `documentId` MEANS THERE IS NO DOCUMENT, not
   * that a transcription supplied something. Nothing was read in that
   * state, so there is nothing to attribute either way; a caller
   * writing prose about the source has to branch on `documentId` first,
   * which is the branch the registry export already had.
   *
   * It travels with the values because the sentence written about a
   * value depends on it. The registry export ends its provenance
   * sentences by naming what supplied the archived string, and with no
   * flag here it named 基因报告 in every state — telling a registry a
   * laboratory had parsed a value for a patient whose only document is
   * a 病历摘要 quoting one, in the same document whose 是否有基因报告
   * item says false.
   */
  readonly laboratory: boolean;
  readonly diagnosisType: string | null;
  readonly d4z4: string | null;
  readonly haplotype: string | null;
  readonly methylation: string | null;
  readonly diagnosisDate: string | null;
}

const EMPTY_READING: GeneticEvidenceReading = {
  documentId: null,
  laboratory: false,
  diagnosisType: null,
  d4z4: null,
  haplotype: null,
  methylation: null,
  diagnosisDate: null,
};

export const readGeneticEvidence = (
  documents: readonly GeneticEvidenceDocumentLike[],
): GeneticEvidenceReading => {
  const document = pickGeneticEvidenceDocument(documents);
  if (!document) return EMPTY_READING;
  const laboratory = isLaboratoryGeneticReport(document);
  const fields = payloadFields(document);
  if (!fields) return { ...EMPTY_READING, documentId: document.id, laboratory };
  return {
    documentId: document.id,
    laboratory,
    diagnosisType: pickReading(fields, GENETIC_FIELD_KEYS.geneticType),
    d4z4: pickReading(fields, GENETIC_FIELD_KEYS.d4z4Repeats),
    haplotype: pickReading(fields, GENETIC_FIELD_KEYS.haplotype),
    methylation: pickReading(fields, GENETIC_FIELD_KEYS.methylationValue),
    diagnosisDate: pickReading(fields, DIAGNOSIS_DATE_KEYS),
  };
};
