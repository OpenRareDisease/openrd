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
    // Note: `title` is intentionally **not** in the strict allowlist.
    // Users frequently include their own name in the report title at
    // upload time (e.g. "张三的基因检测报告"), and strict mode promises
    // raw identifiers never leave the server. Precise mode keeps
    // `title` because the user has explicitly opted in.
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
      'title',
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
  'patientCode',
  'patient_code',
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
  'notes', // free text notes may contain PII; never auto-ship
]);
