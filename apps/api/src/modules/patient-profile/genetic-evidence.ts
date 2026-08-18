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
  /**
   * The row's stored `patient_documents.document_type`, WHICH IS NOT
   * RELIABLY THE TYPE ITS UPLOADER DECLARED.
   *
   * The upload INSERT writes the dropdown value here, and then the
   * parse overwrites it: `startOcrJob` in profile.controller.ts calls
   * `resolveDocumentTypeFromPayload(declared, payload)`, which prefers
   * `ocrPayload.fields.classifiedType`, and
   * `updateDocumentOcrResult` in profile.service.ts UPDATEs the column
   * with the answer. So for every row the current pipeline has parsed,
   * this holds the classifier's label canonicalised onto the four-value
   * enum, and the declaration it replaced is not stored anywhere.
   *
   * That is why nothing in this module may read this field as 「what the
   * uploader said」. `readUploaderDeclaredType` is the only reader
   * permitted to, and it reads the declaration off the payload cell the
   * parse stamps it into, falling back to this column only on rows the
   * parse never labelled.
   */
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

/**
 * THE `fields` CELL THE UPLOADER'S OWN DECLARATION IS STAMPED INTO, AND
 * THE ONE COPY OF IT THE CLASSIFIER DOES NOT OVERWRITE.
 *
 * Every OCR provider in this pipeline writes it, first thing, out of
 * the `documentType` it was CALLED with — `buildFields` in
 * apps/api/src/services/ocr/embedded-report-ocr.ts, and the same line
 * in mock-ocr.ts and baidu-ocr.ts — and that argument is the value the
 * upload form put in `patient_documents.document_type` before any
 * parse ran. The classification lands in a different cell
 * (`classifiedType`, see above) and the column UPDATE reads that one,
 * so the two never touch: one blob carries what the patient said AND
 * what the parser decided, side by side, and they can disagree.
 *
 * Deliberately NOT on `CLASSIFIED_TYPE_KEYS`, and the separation is the
 * whole mechanism — if a classifier label could be read here the fourth
 * question would be the first question again. `resolveDocumentTypeFromPayload`
 * in profile.controller.ts does consider this key, but LAST, behind
 * every classifier spelling, which is the same statement: it is the
 * fallback, i.e. the declaration.
 *
 * NOTHING ELSE WRITES IT. It is absent from `EDITABLE_OCR_FIELDS` in
 * profile.schema.ts, so `patchDocumentOcrFields` refuses a patch naming
 * it; the Python parser mints `fields` entries from `structured_fields`
 * and emits no field called `document_type`; and `startOcrJob` now
 * takes an `UploaderDeclaredDocumentType`, so no caller can hand the
 * parse a resolved label to stamp here.
 */
const UPLOADER_DECLARED_TYPE_KEYS = ['documentType', 'document_type'];

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

declare const uploaderDeclaredBrand: unique symbol;

/**
 * A DOCUMENT TYPE THAT IS THE UPLOADER'S OWN DECLARATION AND CANNOT BE
 * ANYTHING ELSE.
 *
 * Nominal on purpose. The brand symbol is module-private and no value
 * carries it at runtime, so the only way to obtain one of these is
 * `readUploaderDeclaredType` below — a plain `string`, and in
 * particular `document.documentType` or any resolved/classified label,
 * is not assignable to it and the compiler says so at the call site.
 *
 * This exists because two rounds of comments did not hold. The rule
 * 「the fourth question reads the uploader's declaration and never the
 * resolved type」 was written in this module and restated verbatim at
 * the caller in profile.controller.ts, and both were false anyway —
 * see the note on `GeneticEvidenceDocumentLike.documentType`. A
 * sentence asking callers to be careful cannot enforce a provenance
 * rule; a type they cannot satisfy by accident can.
 */
export type UploaderDeclaredDocumentType = string & {
  readonly [uploaderDeclaredBrand]: true;
};

/**
 * THE TYPE THE UPLOADER PICKED FROM THE DROPDOWN, or `null` when this
 * row cannot say.
 *
 * Read off `ocr_payload.fields.documentType` — see
 * `UPLOADER_DECLARED_TYPE_KEYS`, which is why that cell is the answer —
 * and NOT off `patient_documents.document_type`, which the parse
 * overwrites with the classification.
 *
 * THE COLUMN IS STILL THE ANSWER ON A ROW THE PARSE NEVER LABELLED, and
 * that fallback is not a guess: `resolveDocumentTypeFromPayload`
 * replaces the column exactly when the payload carries a usable label
 * under one of `CLASSIFIED_TYPE_KEYS`, so a payload carrying none of
 * them is a column that has only ever held the declaration. Where the
 * payload carries one AND has no stamped declaration — a blob written
 * by some path that is not one of this pipeline's three providers —
 * there is nothing left to read and this returns `null`.
 *
 * `null` rather than a guess. A gate that cannot find out what the
 * patient declared must refuse, not assume: being wrong toward the
 * narrative costs a DISPLAY with its origin attached, being wrong the
 * other way costs a laboratory's sentence with no laboratory behind it.
 *
 * Exported because the OCR pipeline has to write back what it reads:
 * `reparseDocument` re-runs a parse and the value it passes is stamped
 * into the new payload, so it has to pass THIS and not the row's
 * column — otherwise the second parse launders the classifier's label
 * into the declaration's cell and the fourth question is the first one
 * again, one round later. The branded return type is what makes that a
 * compile error rather than a comment.
 */
export const readUploaderDeclaredType = (
  document: GeneticEvidenceDocumentLike,
): UploaderDeclaredDocumentType | null => {
  const fields = payloadFields(document);
  const stamped = pickReading(fields, UPLOADER_DECLARED_TYPE_KEYS);
  if (stamped) return stamped as UploaderDeclaredDocumentType;
  if (pickReading(fields, CLASSIFIED_TYPE_KEYS)) return null;
  const declared = document.documentType?.trim();
  return declared ? (declared as UploaderDeclaredDocumentType) : null;
};

/**
 * THE DECLARATION AS THE UPLOAD FORM ITSELF STATED IT.
 *
 * The only other way to obtain an `UploaderDeclaredDocumentType`, and
 * deliberately awkward to reach for: it names its one legitimate caller
 * in its own name. `documentUploadSchema` validates the dropdown value
 * a patient submitted, and at that instant — before any parse — the
 * value IS the declaration. Every later reader has to go through
 * `readUploaderDeclaredType`, because by then the column may not be.
 */
export const uploaderDeclaredTypeFromUploadForm = (
  declaredOnTheUploadForm: string,
): UploaderDeclaredDocumentType => declaredOnTheUploadForm as UploaderDeclaredDocumentType;

/** Did the patient themselves pick 基因检测报告 from the upload menu.
 *  The only comparison made against an `UploaderDeclaredDocumentType`,
 *  kept here so the branded value never has to be widened back to
 *  `string` at a call site where a resolved label could take its
 *  place. */
const uploaderDeclaredGeneticReport = (document: GeneticEvidenceDocumentLike): boolean =>
  (readUploaderDeclaredType(document) as string | null) === 'genetic_report';

/** Both spellings the parser has emitted for the page it read. The
 *  profile projection in profile.service.ts already collapses them to
 *  the first; a row fetched by another path can still carry either. */
const OCR_TEXT_KEYS = ['extractedText', 'extracted_text'];

/**
 * The `fields` cells whose value is TEXT OFF THE PAGE, as opposed to a
 * reading, a bookkeeping entry, or the classifier's own output.
 *
 * An allowlist, not 「every string on the blob」, and for the reason
 * everything else here is deny-by-default: an arbitrary OCR key can
 * hold arbitrary prose — an observed one held
 * 「患者张三主诉下肢无力」 — and a two-character section label matched
 * inside somebody's free text is not the document showing its
 * structure. These four are cells this pipeline writes and whose
 * contents it knows: 检测结论 travels in `interpretationSummary`, the
 * issuing laboratory's name in `facility`.
 *
 * `classifiedType` and `reportTypeLabel` are absent on purpose and that
 * absence is load-bearing: `reportTypeLabel` for a document the
 * classifier called a genetics report is the literal string
 * 基因检测报告, so reading it here would let the classifier corroborate
 * itself and put the whole defect back.
 */
const PAGE_TEXT_FIELD_KEYS: readonly string[] = [
  'interpretationSummary',
  'interpretation_summary',
  'facility',
  'department',
  'specimen',
];

/**
 * The document's own page, as much of it as the payload kept, lowercased
 * for matching.
 *
 * `extractedText` when the payload has it — the profile path always
 * does — plus the page-text cells above, which is what keeps this test
 * answerable at all on the assistant path, where the projection a chunk
 * carries is the `fields` blob and nothing else.
 */
const documentEvidenceText = (document: GeneticEvidenceDocumentLike): string => {
  const payload = isRecord(document.ocrPayload) ? document.ocrPayload : null;
  const parts: string[] = [];
  for (const key of OCR_TEXT_KEYS) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim()) parts.push(value);
  }
  const fields = payloadFields(document);
  if (fields) {
    for (const key of PAGE_TEXT_FIELD_KEYS) {
      const value = fields[key];
      if (typeof value === 'string' && value.trim()) parts.push(value);
    }
  }
  return parts.join('\n').toLowerCase();
};

/**
 * SECTIONS ONLY A CLINICAL NARRATIVE HAS.
 *
 * The mirror of MEDICAL_SUMMARY_STRUCTURE_MARKERS in
 * apps/report-manager/app/services/fshd_report_service.py, and it has
 * to move with it — the parser holds the line for documents parsed from
 * now on, this holds it for the ones already stored. Not a vocabulary:
 * no disease word belongs on this list, because scoring a document on
 * the words it contains is the defect it exists to end.
 *
 * AND NOT A SIGNATURE, A TIMESTAMP OR AN IDENTIFIER. 医师签名 was added
 * here and had to come out: every genetics report is signed, so one
 * 「医师签名：王医师」 on an otherwise unchanged Southern blot took it out
 * of `isLaboratoryGeneticReport` — 基因确诊 to self_reported, and 病历摘要
 * on the citation chip. A hit here is disqualifying on its own and
 * outranks every laboratory marker, so the test for an entry is 「no
 * genetics laboratory prints this」. Checked by execution against a real
 * Southern blot, a methylation report and a WES report: the seventeen
 * below score zero on all three.
 */
const CLINICAL_NARRATIVE_MARKERS: readonly string[] = [
  '病历摘要',
  '门诊病历',
  '住院病历',
  '出院小结',
  '住院小结',
  '出院记录',
  '入院记录',
  '病程记录',
  '主诉',
  '现病史',
  '既往史',
  '个人史',
  '婚育史',
  '查体',
  '体格检查',
  '专科检查',
  '诊疗经过',
];

/**
 * Cells only `_extract_medical_summary` writes.
 *
 * A second, key-shaped narrative witness for the same question, because
 * it survives where the text does not: a payload carrying 起病年龄 or
 * 家族史 was read by the narrative extractor, and the narrative
 * extractor runs on a document the parser called a 病历摘要.
 */
const CLINICAL_NARRATIVE_FIELD_KEYS: readonly string[] = [
  'onsetAge',
  'onset_age',
  'progressionNode',
  'progression_node',
  'familyHistory',
  'family_history',
  'keyClinicalSigns',
  'key_clinical_signs',
  'currentFunctionStatus',
  'current_function_status',
];

/**
 * SECTIONS A GENETICS LABORATORY'S REPORT HAS BECAUSE OF WHAT IT IS.
 *
 * This half has no counterpart in the parser, which decides the label
 * on the narrative markers alone; it exists here because this gate has
 * a second job the parser does not — telling a real report uploaded as
 * 其他 apart from a payload nothing corroborates. `southern` is the name
 * of an assay, a statement about what the laboratory DID, not a disease
 * word.
 */
const LABORATORY_REPORT_MARKERS: readonly string[] = [
  '基因检测报告',
  '遗传病检测报告',
  '分子诊断',
  '检测项目',
  '检测方法',
  '检测结果',
  '检测结论',
  '检测机构',
  '送检单位',
  '送检医师',
  '报告医师',
  '审核医师',
  '实验室',
  'southern',
];

/** Does this document read as a clinical narrative — the section labels
 *  its page shows, or the narrative-only cells the parser wrote off it. */
const showsClinicalNarrative = (document: GeneticEvidenceDocumentLike): boolean => {
  const fields = payloadFields(document);
  if (fields && CLINICAL_NARRATIVE_FIELD_KEYS.some((key) => pickReading(fields, [key]))) {
    return true;
  }
  const text = documentEvidenceText(document);
  return CLINICAL_NARRATIVE_MARKERS.some((marker) => text.includes(marker));
};

/** Does it read as a laboratory's report. The 检测方法 the parser read
 *  off the page counts: it is a statement about what the laboratory
 *  did, and it is the witness that most often carries a real report
 *  through on the assistant path, where a chunk has no `extractedText`
 *  to search. */
const showsLaboratoryReportStructure = (document: GeneticEvidenceDocumentLike): boolean => {
  if (pickReading(payloadFields(document), GENETIC_FIELD_KEYS.testMethod)) return true;
  const text = documentEvidenceText(document);
  return LABORATORY_REPORT_MARKERS.some((marker) => text.includes(marker));
};

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
 *
 * A CLASSIFICATION ALONE NO LONGER SATISFIES IT. This was
 * `documentClassifiedType(document) === 'genetic_report'`, one string
 * compare against a label written by a keyword classifier that scores a
 * document on the genetics words it CONTAINS — so a 门诊病历摘要 quoting
 * the patient's own result classified as the laboratory's report
 * (measured on a real one: genetic_report 18 against medical_summary
 * 16, from 基因检测 + fshd1 + d4z4 + 4qa), and the classifier's answer
 * outranked the uploader's declared `other`. Rendered through the real
 * retriever, the transcribed count came out graded on the FSHD1
 * boundary and the transcribed haplotype called permissive, in BOTH
 * redaction modes, while the citation chip the patient taps called the
 * clinic letter 基因检测报告. The documents this rule exists to exclude
 * are the ones that tripped it, and the more of the result a 病历摘要
 * quotes the more certainly it flipped.
 *
 * THE CLASSIFIER IS FIXED AND THAT IS NOT ENOUGH. `_classify_report` in
 * apps/report-manager now decides this one label on document STRUCTURE
 * rather than vocabulary, but a classifier change reclassifies nothing
 * already on disk: every archived row keeps the label the old rule gave
 * it, and nothing re-runs the parse. So the gate has to be satisfiable
 * only by AGREEMENT between the inferred label and something that is
 * not it.
 *
 * The something is the document's own page, which the payload keeps —
 * `ocrPayload.extractedText`, plus whatever text the parser lifted into
 * `fields` — and the type its uploader declared, which is on the row.
 * Three questions, in order:
 *
 *   1. Did the parser call it a genetics report at all. A document the
 *      classifier calls a 病历摘要 is not promoted here by any other
 *      evidence; this half is unchanged.
 *   2. Does its own page show a CLINICAL NARRATIVE — the sections no
 *      laboratory prints (主诉, 现病史, 查体, 出院小结) — or did the
 *      parser read narrative-only cells off it. Any of them is
 *      disqualifying on its own, and it is asked before (3): a 病历摘要
 *      with the whole report pasted into it is still a 病历摘要, and it
 *      would otherwise show more laboratory sections than narrative
 *      ones and pass.
 *   3. Does its own page show a LABORATORY REPORT — 检测项目, 检测方法,
 *      送检单位, 报告医师 — or did the parser read the report's stated
 *      检测方法 off it. That is the agreeing witness, and it is the
 *      document itself rather than any label put on it.
 *   4. Only where the page shows NEITHER does the uploader's declared
 *      type decide. `readUploaderDeclaredType` is what answers it, and
 *      it reads the declaration off the CELL the parse stamps it into
 *      rather than off the column the parse overwrites. See below.
 *
 * (4) WAS THE DEFECT AND THIS IS THE THIRD ATTEMPT AT IT. The step read
 * `document.documentType`, and both this block and the call site in
 * profile.controller.ts stated in as many words that the value there is
 * the uploader's own declaration and 「deliberately NOT the resolved
 * documentType … feeding it back in as the fourth would make a
 * classifier corroborate itself」. Executed, it was the resolved type on
 * every parsed path: the parse UPDATEs `patient_documents.document_type`
 * with `resolveDocumentTypeFromPayload`'s answer, which prefers
 * `fields.classifiedType`, so a parsed row's column IS the
 * classification (1) has already read. Driven through: a 门诊病历摘要
 * the old keyword classifier scored `genetic_report`, uploaded under
 * 其他, with no page on the archived payload — (2) found no narrative,
 * (3) found no laboratory, and (4) read `genetic_report` off the column
 * and graded the transcribed count on the FSHD1 boundary, on the
 * profile, on the report-detail summary, in the assistant chunk and in
 * the mobile bundle. (1) and (4) were the same expression, which made
 * (3) — the agreeing witness this gate is built on — dead on every
 * parsed row.
 *
 * THE SECOND ATTEMPT REFUSED (4) OUTRIGHT on any row whose payload
 * carries a classifier label, on the reasoning that the declaration is
 * not stored anywhere. That reasoning was wrong about this pipeline and
 * it cost real patients their diagnosis. It is stored: every OCR
 * provider stamps the type it was CALLED with into
 * `ocr_payload.fields.documentType`, and the type it was called with is
 * the upload form's dropdown value. Refusing (4) made it unanswerable
 * on every parsed row instead of on the classifier-labelled ones, so a
 * GENUINE laboratory report whose page was not stored and whose 检测方法
 * the parser could not read — an ordinary, expected state, which is
 * exactly why the passport separates 方法对但结果不全 from 结果不全 —
 * became indistinguishable from a transcription and graded as one.
 * Executed over the matrix, that patient dropped from 基因确诊 to 自述,
 * from 可用于入组 to 仅有转录结果, the citation chip under their own
 * Southern blot's repeat count changed from 报告读取 to 转录自非基因报告
 * 文件, and both redaction modes started answering
 * `not_read_off_a_laboratory_report` about a laboratory's reading.
 *
 * SO THE DECLARATION IS READ WHERE THE PARSE PRESERVES IT, not where
 * the parse overwrites it. That is one witness, on the archived rows
 * too, and it needs no new column and no backfill — the alternative
 * considered was `patient_documents.declared_document_type` written at
 * upload time, which would be NULL on precisely the archived rows that
 * lose their grade without it, and whose only honest backfill source is
 * the cell being read here. A second stored copy of one fact is the
 * failure this module exists to prevent.
 *
 * Both halves are held by the brand rather than by this paragraph:
 * `readUploaderDeclaredType` is the only reader that mints an
 * `UploaderDeclaredDocumentType`, and `startOcrJob` is the only writer
 * that consumes one — so neither a resolved label nor a classifier's
 * output can be substituted at either end without the compiler saying
 * so. A comment was tried twice and did not hold.
 *
 * Being wrong toward the narrative costs a DISPLAY with its origin
 * attached; being wrong the other way costs a laboratory's sentence
 * with no laboratory behind it. That is why (2) outranks (3) rather
 * than being weighed against it, and why the text (2) searches is an
 * allowlist of cells whose contents this pipeline knows — a section
 * label matched inside an arbitrary key's free prose is not the
 * document showing its structure, and refusing on one would cost a real
 * report its grade for no evidence.
 *
 * A REAL GENETICS REPORT UPLOADED AS `other` KEEPS ITS GRADE, which is
 * why (2) reads the document and not the dropdown: patients leave the
 * picker alone constantly, and a rule that let the dropdown decide
 * whether a laboratory result counts would be a worse bug than the one
 * it replaced.
 *
 * WHAT (4) NOW COSTS: a row the parser classified as a genetics report,
 * whose payload shows neither structure — no page kept, no 检测方法 read
 * — and which was uploaded under any label BUT 基因检测报告 is refused.
 * That is the misclassified 病历摘要, and it is also the genuine report
 * of a patient who left the dropdown on 其他, who keeps the value on
 * the page with 转录自非基因报告文件 beside it and loses only the grade.
 * The cost of the two mistakes is not symmetric and this is the cheap
 * one; a page kept or a 检测方法 read carries that report through (3)
 * without ever reaching here, which is why (3) is asked first.
 *
 * AND WHAT IT STILL BELIEVES, STATED PLAINLY: a 病历摘要 the old
 * classifier scored `genetic_report`, whose page was not kept, whose
 * 检测方法 was not read, AND whose uploader also picked 基因检测报告 —
 * because that is where their genetic result is written down — is
 * graded. It is not distinguishable: it is byte-for-byte the genuine
 * report of a patient who declared it correctly and whose page was not
 * stored, and every witness this platform has is exhausted. Both
 * labels on the row say 基因报告 and there is no third thing to ask.
 * Refusing it means refusing that patient too, and this gate has
 * already been through that trade once. Where the page IS kept the
 * question never gets here — (2) reads 主诉 / 现病史 / 查体 off it and
 * refuses whatever either label says, which is the case that actually
 * occurs, because the profile projection carries the page on every row
 * the current pipeline wrote.
 *
 * WHAT (4) STILL REACHES WITHOUT THE STAMP: a row the parser classified
 * as NOTHING — `fields` with no `classifiedType`, which is every
 * pre-classifier archived row and every parse that failed to label.
 * There the column has never been overwritten, `documentClassifiedType`
 * falls through to it as well, and both (1) and (4) are reading the
 * patient's own answer — which is the arrangement this step was always
 * documented as.
 */
export const isLaboratoryGeneticReport = (document: GeneticEvidenceDocumentLike): boolean => {
  if (documentClassifiedType(document) !== 'genetic_report') return false;
  if (showsClinicalNarrative(document)) return false;
  if (showsLaboratoryReportStructure(document)) return true;
  return uploaderDeclaredGeneticReport(document);
};

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
