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
 *   opted in to sharing raw values. The clinicalised duplicates are
 *   removed; the raw originals pass.
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
    strict: [
      'ageGroup',
      'gender',
      'diagnosisStage',
      'diagnosisYear',
      'diagnosisType', // category label like "FSHD1" is non-PII
      'd4z4_clinical',
      'haplotype_clinical',
      'methylation_clinical',
      'onsetRegion',
      'familyHistory',
      'independentlyAmbulatory',
      'assistiveDevices',
      'symptomCategories',
    ],
    precise: [
      'ageGroup',
      'gender',
      'diagnosisStage',
      'diagnosisYear',
      'diagnosisType',
      'd4z4', // raw repeat count, e.g. "3/22"
      'haplotype', // raw, e.g. "4qA"
      'methylation', // raw percentage, e.g. "12%"
      'onsetRegion',
      'familyHistory',
      'independentlyAmbulatory',
      'assistiveDevices',
      'symptomCategories',
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
    strict: [
      'classifiedType',
      'documentType',
      'reportDate_year',
      'status',
      'fields_clinical',
      'findings_summary',
    ],
    precise: [
      'classifiedType',
      'documentType',
      'reportDate_year',
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
  'geneticPositive',
  'genetic_positive',
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
