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
 *   1. Decide its scope (profile / reports).
 *   2. List the redacted form under `strict` (or both if the field
 *      is fundamentally non-PII).
 *   3. List the raw form under `precise` only when there's a clear
 *      clinical benefit to having the precise value in the prompt.
 */

export type RedactionScope = 'profile' | 'reports';
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
 * whichever form the caller happens to pass in.
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
]);

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
]);
