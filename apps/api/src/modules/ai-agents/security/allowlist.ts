/**
 * Prompt allowlist.
 *
 * Every field a retriever may surface to the LLM must be enumerated
 * here, scoped to its origin and the active redaction mode. Anything
 * not listed is dropped by the PII redactor before the prompt is
 * built. This makes "I added a new field to the schema and forgot to
 * sanitise it" a code-review-visible diff rather than a silent
 * privacy regression.
 *
 * - `strict` mode (consent levels none / basic): only clinicalised
 *   forms make it through. Raw numeric values such as the original
 *   D4Z4 repeat count, methylation percentage or precise date never
 *   leave the server.
 * - `precise` mode (consent level precise): user has explicitly
 *   opted in to sharing raw values, so the raw originals pass —
 *   BESIDE this platform's reading of them, not instead of it. The
 *   `_clinical` sibling of a genetics cell is on this list too: it
 *   carries the bands and, more to the point, the refusals — a length
 *   in kb, a repeat count of 0, a negated haplotype, a value that was
 *   never read off a laboratory report. Listing it under `strict`
 *   alone left those unsaid for exactly the patients whose answers are
 *   built from the most detail. See the layer 2 note in
 *   `pii-redactor.ts`.
 *
 * Adding a new field:
 *   1. Decide its scope (profile / reports / followups).
 *   2. List the redacted form under `strict` (or both if the field
 *      is fundamentally non-PII).
 *   3. List the raw form under `precise` only when there's a clear
 *      clinical benefit to having the precise value in the prompt.
 */

export type RedactionScope = 'profile' | 'reports' | 'followups';
export type RedactionMode = 'strict' | 'precise';

export const PROMPT_ALLOWLIST: Record<RedactionScope, Record<RedactionMode, readonly string[]>> = {
  profile: {
    // A KEY LISTED HERE READS AS AN INVENTORY OF WHAT THE RESULT
    // CARRIES, and `get_my_profile`'s description was written from it.
    // So `ageGroup` and `symptomCategories` are gone from both modes:
    // no retriever could produce either, and listing them was enough
    // to put an age band and symptom categories into a sentence the
    // model then asserted. The birthday is hard-deleted before the
    // derivation that would band it is handed the input, and no
    // profile field carries symptoms at all.
    strict: [
      'gender',
      'diagnosisStage',
      'diagnosisYear',
      'diagnosisType', // category label like "FSHD1" is non-PII
      'd4z4_clinical',
      'haplotype_clinical',
      'methylation', // the laboratory's own word, when the cell is one
      'methylation_withheld', // ...and the statement that a number is not being shared
      // WHERE THE CELL CAME FROM, on the same footing as
      // `d4z4_clinical` and `haplotype_clinical` — and it was the one
      // genetics cell that carried no such statement at all. A
      // percentage typed into the registration form's 甲基化 box, or
      // quoted on a 病历摘要, reached the prompt as a bare result while
      // its two siblings on the same profile both said
      // `not_read_off_a_laboratory_report`. It is NOT `_clinical`:
      // this repo states no methylation boundary, so the key states an
      // origin and grades nothing. See `methylationCell`.
      'methylation_origin',
      // THE SAME STATEMENT OVER THE CELL THAT NAMES THE DIAGNOSIS, and
      // it was the last genetics cell on this scope without one.
      // `diseaseBackground.diagnosisType` is filled by the same
      // read-time autofill as `d4z4` and `methylation`
      // (`applyGeneticReportAutofill`), so it is a 病历摘要's quoted
      //「FSHD1」 as readily as a laboratory's — and it printed under
      // 分型/诊断方式 with nothing beside it while its siblings on the
      // same profile both said `not_read_off_a_laboratory_report`.
      // Same shape as the methylation origin: an origin, not a grade.
      'diagnosisType_origin',
      'onsetRegion',
      'familyHistory',
      'independentlyAmbulatory',
      'assistiveDevices',
    ],
    precise: [
      'gender',
      'diagnosisStage',
      'diagnosisYear',
      'diagnosisType',
      // In this mode too — a refusal to attribute a cell to a
      // laboratory report is not a redaction. See the strict list.
      'diagnosisType_origin',
      'd4z4', // raw repeat count, e.g. "3/22"
      'd4z4_clinical', // what this platform reads that cell as, or refuses to
      'haplotype', // raw, e.g. "4qA"
      'haplotype_clinical', // same, for the haplotype cell
      'methylation', // raw percentage, e.g. "12%"
      // ...and the statement that a number is not being shared, which
      // a precise-consent reader can now reach too: a methylation cell
      // holding an array is not a number this platform can publish in
      // any mode (see `methylationCell`), and 「there is a result on
      // file and no number is reaching you」 is a refusal rather than a
      // redaction — the same footing every other refusal on this list
      // sits on. Listed under strict alone, it left the precise reader
      // with the cell silently gone.
      'methylation_withheld',
      // The origin, in this mode too — a refusal to read a cell off a
      // laboratory report is not a redaction, so it belongs in BOTH
      // modes. Precise consent buys the number printed beside this
      // sentence; it does not buy the cell a promotion to a reading
      // this platform never made. See the strict list above.
      'methylation_origin',
      // There is no `methylation_clinical` in either mode, and it is
      // the only one of the three with no reading at all: this repo
      // states no methylation boundary, so the key held a consent
      // statement or the laboratory's own word under a label that
      // called it a grade. See `methylationCell`.
      'onsetRegion',
      'familyHistory',
      'independentlyAmbulatory',
      'assistiveDevices',
    ],
  },
  followups: {
    // Self-recorded functional measurements and event tallies. Two
    // things are deliberately absent from BOTH modes:
    //   - the patient's free-text `notes` / event `description`
    //     (routinely name-bearing; same rule as report titles), and
    //   - absolute timestamps — the series carries relative ages in
    //     days, which is both safer and more useful for trend talk.
    strict: [
      'metricKey',
      'metricLabel',
      'count',
      'countAtCap', // count hit MAX_ROWS_PER_SERIES; it is a floor, not a total
      'spanDays',
      'unableSummary', // 「做不到」days, phrased so they read as disjoint from the series
      'changeDirection',
      'latestBand', // direction as a phrase, no raw number
      'eventSummary',
      'eventCount',
    ],
    precise: [
      'metricKey',
      'metricLabel',
      'count',
      'countAtCap', // count hit MAX_ROWS_PER_SERIES; it is a floor, not a total
      'spanDays',
      'unableSummary', // 「做不到」days, phrased so they read as disjoint from the series
      'changeDirection',
      // `latestBand` IS ON THIS LIST TOO NOW. It carries two different
      // things: a direction as a phrase, which a precise reader can
      // derive from `series` anyway, and 「本期均记录为做不到」, which is
      // the ONLY string explaining a metric whose every row is a
      // patient who could not perform the test. That second one is a
      // refusal to read a series, not a number withheld for consent —
      // so listing it under strict alone left the precise-consent
      // reader with nothing but a bare direction to explain the chunk.
      'latestBand',
      'unit',
      'latestValue', // raw, e.g. 16
      'series', // raw points, e.g. "12sec(14天前)、16sec(0天前)"
      'eventSummary',
      'eventCount',
    ],
  },
  reports: {
    // Note: `title` is intentionally **not** in either allowlist.
    // Users routinely include their own (or a family member's) name
    // in the report title at upload time (e.g. "张三的基因检测报告"),
    // so titles are user-supplied free text that we cannot statically
    // prove are PII-free. The PR #23 follow-up review made it
    // explicit that precise mode is opt-in for clinical raw values,
    // not for free-form name-bearing text. The classified report
    // type carries enough context for the LLM.
    // `reportDate_year` AND `uploadYear` ARE TWO CELLS, NOT ONE
    // SPELLED TWICE. The first is the year the laboratory printed on
    // the report; the second is the year the file arrived here, and it
    // is what a row with no report date has instead. They were one key
    // — `reportDate_year`, derived from `uploaded_at` — so the prompt
    // said 报告年份: 2026 about a report the citation chip on the same
    // turn dated 2019-03. See `resolveReportDate` in
    // patient-reports.ts. Both are years and neither carries a day, so
    // both are on both lists.
    strict: [
      'classifiedType',
      'documentType',
      'reportDate_year',
      'uploadYear',
      'status',
      'fields_clinical',
      'findings_summary',
    ],
    precise: [
      'classifiedType',
      'documentType',
      'reportDate_year',
      'uploadYear',
      'status',
      'fields',
      'findings_summary',
    ],
  },
} as const;

/**
 * Fields removed before any other layer runs, regardless of scope or
 * mode. These are purely identifying and never have clinical value
 * worth shipping to an LLM.
 *
 * The list intentionally covers both camelCase (retriever output) and
 * snake_case (raw DB column) so the redactor can short-circuit
 * whichever form the caller happens to pass in. The redactor matches
 * case-insensitively (see HARD_DELETE_KEYS_LOWER) so OCR pipelines
 * that emit `PatientName`, `PATIENT_NAME`, or `Date_Of_Birth` are
 * caught as well.
 */
export const HARD_DELETE_KEYS: ReadonlySet<string> = new Set([
  'fullName',
  'full_name',
  'preferredName',
  'preferred_name',
  'patientName', // OCR-extracted patient name routinely lands under this key
  'patient_name',
  'patientCode',
  'patient_code',
  'patientId', // OCR-extracted patient identifier
  'patient_id',
  'phoneNumber',
  'phone_number',
  'contactPhone',
  'contact_phone',
  'contactEmail',
  'contact_email',
  'email',
  'idCard',
  'id_card',
  'idNumber',
  'id_number',
  'regionDistrict', // city-level is kept; district is identifying
  'region_district',
  'regionStreet',
  'region_street',
  'exactAddress',
  'address',
  'dateOfBirth',
  'date_of_birth',
  'birthday',
  'primaryPhysician',
  'primary_physician',
  'doctorName', // OCR sometimes extracts the issuing physician's name
  'doctor_name',
  'physician',
  'notes', // free text notes may contain PII; never auto-ship
  'rawFreeText', // OCR full-text dump — almost always carries identifiers
  'raw_free_text',
  'rawText',
  'raw_text',
  'fullText',
  'full_text',
  // THE OCR PAGE ITSELF, under the two names the pipeline has given it.
  //
  // It is on this list for the reason the rest of that family is — the
  // full-text dump carries the patient's name, the issuing physician's
  // name and every identifier the page printed — and
  // profile.controller.ts's `generateDocumentSummary` already told its
  // reader that 「the `extractedText` / `rawFreeText` / `fullText`
  // family is in HARD_DELETE_KEYS」. It was not: the family had two of
  // the three, so the one key actually spelled `extractedText` was
  // being dropped by layer 3 for want of an allowlist entry rather
  // than deleted for what it holds — which is a different guarantee,
  // and not the one the comment claimed.
  //
  // AND IT IS NOW A KEY A RETRIEVER DELIBERATELY WRITES.
  // `buildReportFields` puts the page on the chunk so the laboratory
  // gate can read the document's own structure (see
  // `chunkIsLaboratoryGeneticReport`); that question is asked of the
  // redactor's INPUT, before layer 1 runs, and this entry is what
  // guarantees the text itself goes no further — in both modes, at any
  // depth, whatever any future allowlist entry says.
  'extractedText',
  'extracted_text',
  // Medical identifiers — beyond patientId / patientCode, OCR pipelines
  // and import schemas surface a long tail of equally identifying ids.
  // Listed explicitly so a future allowlist addition can never let one
  // through by accident.
  'mrn',
  'medicalRecordNumber',
  'medical_record_number',
  'hospitalNumber',
  'hospital_number',
  'caseNumber',
  'case_number',
  // Government / insurance identifiers
  'passport',
  'passportNumber',
  'passport_number',
  'insurance',
  'insuranceNumber',
  'insurance_number',
  'policyNumber',
  'policy_number',
  'socialSecurity',
  'social_security',
  'ssn',
  // Contact / relationships
  'emergencyContact',
  'emergency_contact',
  'emergencyPhone',
  'emergency_phone',
  'guardian',
  'guardianName',
  'guardian_name',
  'guardianPhone',
  'guardian_phone',
  'nextOfKin',
  'next_of_kin',
]);

/**
 * Case-insensitive shadow of HARD_DELETE_KEYS. The redactor matches
 * against this so that source-system casing variants (e.g. PatientName,
 * PATIENT_NAME, Date_Of_Birth) hit the same deny list as the canonical
 * entries above.
 */
export const HARD_DELETE_KEYS_LOWER: ReadonlySet<string> = new Set(
  Array.from(HARD_DELETE_KEYS, (key) => key.toLowerCase()),
);

/**
 * A free-text field long enough that it is evidently not the short
 * value its key promised. Impressions in these reports run well under
 * this; the ECG dump observed in production was 230+. The redactor
 * refuses anything over it — see `isUntrustworthyValue` in
 * pii-redactor.ts, which owns the rest of that check.
 *
 * IT LIVES HERE, WITH THE KEY LISTS, BECAUSE IT IS THE OTHER HALF OF
 * WHAT THOSE LISTS PROMISE. `OCR_FIELDS_SAFE_KEYS_PRECISE` is a list of
 * keys carrying an unstated premise — that a listed key holds a short,
 * structured value — and this number is where that premise is written
 * down.
 *
 * AND BECAUSE A SECOND CEILING EXISTED AND THE TWO DISAGREED.
 * `ocrFieldsPatchSchema` in patient-profile/profile.schema.ts, the
 * write path a patient hand-corrects their own OCR cells through,
 * accepted 300 characters — 100 above this line — so the product's own
 * correction screen could store under `d4z4Repeats` / `haplotype` /
 * `methylationValue` a value the read path would then refuse. That
 * schema imports this constant now. This module imports nothing, which
 * is what lets it: the constant cannot live in the redactor without
 * profile.schema.ts → pii-redactor.ts → profile.passport.ts →
 * profile.schema.ts closing a cycle that leaves it in the TDZ.
 */
export const SAFE_VALUE_MAX_LENGTH = 200;

/**
 * Per-key handling for OCR `fields` blobs in precise mode.
 *
 * Strict-mode OCR handling lives in the redactor's projector
 * (pattern-match → clinicalised sibling, deny-by-default). Precise
 * mode shares the same deny-by-default skeleton; the keys listed here
 * are the ones where we let the **raw** value through because the
 * user explicitly opted in to precise data and the key by its name
 * is structured / clinical rather than free-form.
 *
 * Free-form narrative keys (`findings`, `impression`) are
 * intentionally absent: OCR-extracted prose routinely embeds the
 * patient's name or other identifiers and we cannot statically prove
 * a value is safe. Curated structured equivalents (e.g.
 * `findings_summary` produced by a reviewed pipeline) can be added
 * when that path lands.
 */
export const OCR_FIELDS_SAFE_KEYS_PRECISE: ReadonlySet<string> = new Set([
  // --- Report identity -------------------------------------------
  'classifiedType',
  'classified_type',
  'reportType',
  'report_type',
  'documentType',
  'document_type',
  'diagnosisType',
  'diagnosis_type',
  'geneType',
  'gene_type',
  'geneticType',
  'genetic_type',
  'testMethod',
  'test_method',
  'methodology',
  'referenceRange',
  'reference_range',
  'normalRange',
  'normal_range',
  'status',

  // --- Clinical values -------------------------------------------
  //
  // This half was missing, and its absence was invisible: a genetics
  // report worked (its keys are all above), so the feature looked
  // fine, while every lab panel arrived stripped. The model was handed
  // a coagulation report whose PT 13.7 / APTT 34 / INR 1.12 /
  // fibrinogen 2.68 had all been extracted correctly, saw nothing but
  // the classification, and told the patient「系统没有解析出具体数据」
  // — pointing them at an OCR problem that did not exist.
  //
  // Each key below is a measured number or a fixed clinical enum. The
  // identity fields that travel in the same payload — patientName,
  // orderingDoctor, bedNo, facility, department, specimen, patientAge,
  // reportId, reportName — are deliberately NOT here and stay denied,
  // as do the free-text narrative keys (impressionText,
  // findingText, interpretationSummary, hint, aiSummary): prose cannot
  // be vouched for, which is the same rule that keeps report titles
  // off the allowlist. `findings_summary` remains the one narrative
  // channel, and it is vocabulary-matched rather than copied.

  // Genetics
  'd4z4Repeats',
  'd4z4RepeatPathogenic',
  'd4z4RepeatOther',
  'd4z4_repeat_pathogenic',
  'd4z4_repeat_other',
  'methylationValue',
  'methylation_value',
  'ecoRIFragment',
  'ecoriFragmentKb',
  'ecori_fragment_kb',
  // `geneticPositive` / `genetic_positive` ARE DELIBERATELY ABSENT.
  //
  // Every other key on this list is a value a laboratory printed. That
  // one was a verdict this platform computed: `_extract_genetic` in the
  // report parser set it to 「yes」 when the text named FSHD1 or FSHD2
  // or when any digit followed D4Z4, and to 「uncertain」 otherwise. So a
  // count cell reading 0, a length the report gave in kb, and 「未检出3个
  // 重复单元」 each came out 「yes」 — read off the same cell this
  // platform refuses to read, in a vocabulary of its own, with no 「no」
  // in it to say the other thing. And it reached the model in BOTH
  // modes: the value carries no digit, so strict mode passed it as a
  // qualitative result and set it directly beside
  // `d4z4Repeats_clinical: zero_repeat_count_not_a_valid_reading`.
  //
  // A value would invite a question; a flag reads as settled, which is
  // why the answer here is deletion rather than a caveat beside it. What
  // the verdict was computed FROM is still on this list — `diagnosisType`
  // is the report's own word for the diagnosis, and the D4Z4 cell
  // travels with this platform's reading of it (see `clinicaliseD4Z4`) —
  // so the model still has everything the laboratory stated.
  //
  // THE PARSER NO LONGER WRITES IT AT ALL, and this note used to say the
  // prompt was its only reader outside the parser, which was wrong: the
  // bridge in services/ocr/embedded-report-ocr.ts copies every
  // structured field into `ocr_payload.fields` under both spellings, so
  // the flag was also persisted on the document row, shown to the
  // patient in the report screen's raw payload panel, and counted by
  // `fieldCount`. The derivation is deleted at the source — see the note
  // in `_extract_genetic`. These entries stay absent so a payload
  // written before that deletion, still on disk, cannot reach a prompt.
  'haplotype',

  // Muscle enzymes / biochemistry
  'ck',
  'ckmb',
  'creatineKinase',
  'ldh',
  'alt',
  'ast',
  'creatinine',
  'uricAcid',
  'uric_acid',
  'calcium',
  'mb',
  'myoglobin',

  // Haematology
  'wbc',
  'rbc',
  'hgb',
  'hct',
  'plt',
  'mcv',
  'mch',
  'mchc',
  'mpv',
  'pct',
  'pdw',
  'plcr',
  'nrbc',
  'rdwCv',
  'rdwSd',
  'rdw_cv',
  'rdw_sd',
  'neutAbs',
  'neutPct',
  'neut_abs',
  'neut_pct',
  'lymphAbs',
  'lymphPct',
  'lymph_abs',
  'lymph_pct',
  'monoAbs',
  'monoPct',
  'mono_abs',
  'mono_pct',
  'eosAbs',
  'eos_abs',
  'basoAbs',
  'basoPct',
  'baso_abs',
  'baso_pct',

  // Coagulation
  'pt',
  'inr',
  'aptt',
  'tt',
  'fibrinogen',

  // Thyroid
  'ft3',
  'ft4',
  'tsh',

  // Pulmonary — the systems this cohort is monitored for
  'fvc',
  'fvcPredPct',
  'fvc_pred_pct',
  'fev1',
  'dlco',
  'dlcoPredPct',
  'dlco_pred_pct',

  // Cardiac
  'heartRate',
  'heart_rate',
  'ecgRhythm',
  'ecg_rhythm',
  'ecgSummary',
  'ecg_summary',
  'prIntervalMs',
  'pr_interval_ms',
  'qrsDurationMs',
  'qrs_duration_ms',
  'qtMs',
  'qt_ms',
  'qtcMs',
  'qtc_ms',
  'conductionAbnormality',
  'conduction_abnormality',

  // Imaging — fixed enums produced by the FSHD extractor
  'fattyInfiltration',
  'fatty_infiltration',
  'inflammatoryChange',
  'inflammatory_change',
  'asymmetry',

  // Stool panel — enums plus counts
  'stoolColor',
  'stoolConsistency',
  'stoolBlood',
  'stoolMucus',
  'stoolRbc',
  'stoolWbc',
  'stoolFatGlobules',
  'stoolOccultBlood',
  'stool_color',
  'stool_consistency',
  'stool_blood',
  'stool_mucus',
  'stool_rbc',
  'stool_wbc',
  'stool_fat_globules',
  'stool_occult_blood',

  // Infection screening — the panel every neurology admission runs
  // before an immunosuppressant or a muscle biopsy, so an FSHD patient
  // accumulates these. `_extract_infection_screening` has emitted them
  // all along and this list never named one, so the whole panel was
  // dropped in *both* modes: the patient's own syphilis and hepatitis
  // results were unreadable to the assistant reading their file.
  // Results are 阴性 / 阳性 enums; `trustTiter` is the one measurement.
  'hbsag',
  'antiHbs',
  'anti_hbs',
  'hbeag',
  'antiHbe',
  'anti_hbe',
  'antiHbc',
  'anti_hbc',
  'hivAb',
  'hiv_ab',
  'antiHcv',
  'anti_hcv',
  'tppa',
  'trustAb',
  'trust_ab',
  'trustTiter',
  'trust_titer',
]);
