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

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE SWITCH ON THE REPORT-IMPRESSION CHANNEL. DEFAULT OFF.
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHAT IT SWITCHES. Whether the report's own impression — the sentence
 * the radiologist, geneticist or pulmonologist wrote — travels to the
 * model at all, together with the four markers that say what was done
 * to it. OFF, a report reaches the prompt as its structured cells and
 * nothing else, which is where every number in an answer already comes
 * from and what ten rounds of work have hardened. ON, the channel
 * behaves exactly as built: eligibility, identifier scrub, measurement
 * mask, in that order, all three failing closed. See the layer 4 block
 * in `pii-redactor.ts`.
 *
 * WHY IT IS OFF, AND WHY THAT IS A DECISION RATHER THAN A DEFAULT
 * NOBODY GOT ROUND TO CHANGING.
 *
 * The channel replaced a keyword extractor over the same text. That
 * extractor took six rounds of patches and never stopped asserting
 * findings the report had RULED OUT; it is deleted and it is not coming
 * back. The replacement was then red-teamed twice. The second round ran
 * AFTER a full repair pass and still produced 46 findings, 35 of them
 * clinical. The reviewers' summary of the residue was that it is
 *「the same shape of answer the deleted keyword extractor gave, and it
 * fails the same way」.
 *
 * Two of those findings are structural rather than incremental:
 *
 *   - THE IDENTIFIER SCRUB DOES NOT FAIL CLOSED ON A NAME. It
 *     enumerates label suffixes, name lengths, separators and scripts,
 *     and after all of it an unlabelled Chinese personal name in prose
 *     still publishes. All seven residual classes PUBLISH. A guardrail
 *     whose residue is 「it goes out」 is not one.
 *   - THE MEASUREMENT MASK DESTROYS THE VOCABULARY THIS DISEASE IS
 *     DEFINED ON. HGVS notation, a locus with a sub-band, an
 *     abbreviated vertebral level and a graded fat-infiltration stage
 *     were all read as measurements. Those specific defects are fixed
 *     (see `WHOLE_TOKEN_NAME_SHAPES` and `enumeratedOrdinalSpans` in
 *     `pii-redactor.ts`) — they were fixed BECAUSE they decide whether
 *     this switch can ever be turned on, not because fixing them turns
 *     it on.
 *
 * NOTHING IS DELETED. The channel stays in the codebase, its tests
 * stay running — they drive `gateReportImpression` directly, so the
 * gates are exercised on every CI run whether or not their answer
 * reaches a prompt — and turning it on is this one line. The point of
 * the switch is that the decision is now explicit and reversible
 * instead of implicit: what ships by default is the safe state, and
 * changing that is a reviewed diff with this comment attached to it.
 *
 * WHY A CONSTANT AND NOT AN ENVIRONMENT VARIABLE. `config/env.ts` is
 * this repo's convention for configuration, and every boolean on it is
 * a fact about a DEPLOYMENT — is there a container, does the database
 * speak SSL, was an insecure connection acknowledged. This is not one
 * of those. Three reasons it must be fixed at build time:
 *
 *   1. The patient-facing app has to agree with it. `humanize.ts` in
 *      apps/mobile labels these keys for the 「本次引用了你的」 citation
 *      line, and its parity test checks that label table against THIS
 *      file's source. A mobile bundle cannot read the API's
 *      environment, so a per-deployment value would put the two sides
 *      permanently out of step with no way to check them.
 *   2. `tool-descriptions.test.ts` checks that what `get_my_reports`
 *      TELLS the model is exactly what the allowlist can carry. That
 *      check is only meaningful if both are decided at build time; an
 *      environment variable makes 「the description is honest」
 *      unprovable in CI and true or false per deployment.
 *   3. It is a product decision taken on evidence, not an operational
 *      knob. An operator flipping it at 3am is precisely the event
 *      this shape is meant to prevent.
 *
 * TYPED `boolean` RATHER THAN LET TYPESCRIPT INFER `false`, so both
 * branches everywhere downstream keep type-checking and neither rots
 * into unreachable code that the compiler stops reading.
 */
export const REPORT_IMPRESSION_CHANNEL_ENABLED: boolean = false;

/**
 * THE FIVE KEYS THE CHANNEL PUBLISHES UNDER, NAMED ONCE.
 *
 * The redactor's channel table, the renderer's label table and the
 * allowlist slice below are all keyed off this object, so the three
 * cannot drift apart the way `findings_summary` and its label did.
 */
export const REPORT_IMPRESSION_KEYS = {
  text: 'reportImpression',
  withheld: 'reportImpressionWithheld',
  valuesMasked: 'reportImpressionValuesMasked',
  identifiersRemoved: 'reportImpressionIdentifiersRemoved',
  charactersCut: 'reportImpressionCharactersCut',
} as const;

/**
 * THE ALLOWLIST'S OWN VIEW OF THE SWITCH, AND THE REASON THE SWITCH
 * LIVES IN THIS FILE.
 *
 * The allowlist is the inventory a tool description is written from and
 * the inventory the patient-facing citation line is labelled from. A
 * key sitting on it while the switch is off would advertise a field the
 * result can never carry — the exact defect `tool-descriptions.test.ts`
 * exists to catch, and the exact defect the 年龄段 note in mobile's
 * `humanize.ts` describes from the other side. So with the switch off
 * these lists are EMPTY, not present-and-unused.
 *
 * `valuesMasked` is strict-only when the switch is on, and that is not
 * an oversight: precise consent masks nothing, so the count is always
 * zero there and a key that can only ever hold zero says something
 * false about the mode it sits in. The other three markers are on both,
 * because a refusal and a removal are not redactions — they are this
 * platform stating what it did, and that is true whatever the patient
 * shared.
 *
 * NOTE FOR THE READER THAT IS NOT A COMPILER. `humanize-allowlist-
 * parity.test.ts` in apps/mobile reads THIS FILE AS TEXT — it cannot
 * import from the API — and pulls key names out of the two arrays below
 * with a regular expression. It therefore cannot see through the spread
 * of this constant, in either position of the switch, and a spelling
 * that let it see the names in both positions would be worse: it would
 * tell the mobile side five keys are reachable when the shipped API
 * cannot send one of them.
 *
 * So a text reader that wants the truth has to read two things, and
 * both are written here to be read: the single line
 * `export const REPORT_IMPRESSION_CHANNEL_ENABLED: boolean = <value>;`
 * above, and the quoted key names on `REPORT_IMPRESSION_KEYS` above
 * that. Those two are the contract for anything outside this workspace;
 * the arrays below are the contract for anything inside it.
 */
const REPORT_IMPRESSION_ALLOWLIST: Readonly<Record<RedactionMode, readonly string[]>> =
  REPORT_IMPRESSION_CHANNEL_ENABLED
    ? {
        strict: [
          REPORT_IMPRESSION_KEYS.text,
          REPORT_IMPRESSION_KEYS.withheld,
          REPORT_IMPRESSION_KEYS.valuesMasked,
          REPORT_IMPRESSION_KEYS.identifiersRemoved,
          REPORT_IMPRESSION_KEYS.charactersCut,
        ],
        precise: [
          REPORT_IMPRESSION_KEYS.text,
          REPORT_IMPRESSION_KEYS.withheld,
          REPORT_IMPRESSION_KEYS.identifiersRemoved,
          REPORT_IMPRESSION_KEYS.charactersCut,
        ],
      }
    : { strict: [], precise: [] };

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
      // A CATEGORY LABEL LIKE 「FSHD1」 IS NON-PII, AND THE VALUE IS
      // TESTED FOR BEING ONE. This entry used to carry that sentence as
      // its whole justification, and nothing on this scope asked it of
      // the value: `applyGeneticReportAutofill` copies the picked
      // report's subtype verbatim into `diseaseBackground.diagnosisType`,
      // so 「FSHD1(D4Z4 3拷贝)」 — a subtype with a repeat count stapled
      // to it — landed here and strict mode printed it, out of the same
      // report whose OCR blob the reports scope withheld it from three
      // sections below. `isCategoryLabel` exists for exactly that value
      // and was consulted on one scope. It is asked on both now; see
      // `publishDiagnosisTypeCell` in pii-redactor.ts.
      'diagnosisType',
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
    // THE REPORT'S OWN IMPRESSION, AND THE FOUR CELLS THAT SAY WHAT WAS
    // DONE TO IT.
    //
    // `findings_summary` used to sit here. It held a summary this
    // PLATFORM wrote out of a fixed vocabulary — the report's sentence
    // never travelled — and six rounds of review found the same family
    // of defects in it and never ran out: a ruled-out finding emitted
    // as present, a hedge rendered as definite, a relative's diagnosis
    // rendered as the patient's own, a real finding dropped. It is
    // deleted, extractor and all.
    //
    // What replaces it is the report's OWN text, and it is a narrower
    // thing than the key it replaces in one way and a wider thing in
    // another, so both are stated:
    //
    //   - NARROWER: it travels only off a RESULT document. A 病历摘要,
    //     门诊病历, 出院小结 or 入院记录 sends nothing at all — see
    //     `documentEligibility` in pii-redactor.ts. `findings_summary`
    //     was computed off every document kind.
    //   - WIDER: what travels is prose the report printed, not tokens
    //     from a list. Identifiers are removed from it in BOTH modes,
    //     and in strict mode every measurement in it is masked, because
    //     the consent step the patient did not take is 「精确数值」 and a
    //     free-text path that carried numbers would be a hole straight
    //     through the consent model.
    //
    // AND ALL FIVE ARE BEHIND ONE SWITCH, DEFAULT OFF. The lists below
    // carry them only when `REPORT_IMPRESSION_CHANNEL_ENABLED` is true;
    // `REPORT_IMPRESSION_ALLOWLIST` at the top of this file is where
    // that is decided and why. With the switch off the six lines above
    // describe a channel that is built and not wired, and the reports
    // scope is the six structured cells it was before any of this.
    strict: [
      'classifiedType',
      'documentType',
      'reportDate_year',
      'uploadYear',
      'status',
      'fields_clinical',
      ...REPORT_IMPRESSION_ALLOWLIST.strict,
    ],
    precise: [
      'classifiedType',
      'documentType',
      'reportDate_year',
      'uploadYear',
      'status',
      'fields',
      ...REPORT_IMPRESSION_ALLOWLIST.precise,
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
 *
 * THE ONE PLACE A PUBLISHED VALUE MAY EXCEED IT is the gated impression,
 * and only by this platform's own words. `gateFreeText` cuts the
 * identifier-scrubbed text at this length and THEN masks measurements
 * inside what survived, so a strict-consent impression can come out
 * longer than a precise one by seven characters per marker. Cutting
 * after the mask was the alternative and it cost the strict reader the
 * tail of the sentence — which in a Chinese impression is where 结论
 * lives. What this number bounds is how much of the REPORT'S prose
 * travels, and that bound still holds exactly.
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
 * intentionally absent FROM THIS LIST, and that is no longer the same
 * statement as 「the impression does not travel」. It travels, off a
 * result document only and through the three gates in
 * `pii-redactor.ts`, under `reportImpression` — a key this projection
 * never sees, because the retriever offers the text top-level and the
 * gates run last.
 *
 * AND THE PREMISE THIS LIST USED TO CARRY — 「a key on it is published
 * as a CELL, verbatim, with nothing done to it beyond the value check」
 * — WAS ALREADY FALSE OF THREE OF ITS OWN ENTRIES. `ecgSummary`,
 * `conductionAbnormality` and `fattyInfiltration` hold prose, and prose
 * published verbatim off a 病历摘要 is precisely what the eligibility
 * gate exists to stop: one chunk refused that document's impression as
 * a narrative about a person and printed the same document's narrative
 * prose in the row below. So the gates are no longer wired to one key.
 * A value on this list that READS as free text — see `looksLikeFreeText`
 * in pii-redactor.ts — goes through gate 0 and gate 2 like any other
 * prose, and a key holding a short structured enum is published as the
 * cell it is. The list stays a list of keys whose NAME is safe to show;
 * what happens to the value is decided by the value.
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
  // be vouched for AS A CELL, which is the same rule that keeps report
  // titles off the allowlist. The report's own impression reaches the
  // prompt through `reportImpression` instead — a channel with an
  // eligibility gate, an identifier scrub and a measurement mask in
  // front of it, none of which this projection has or should have.

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
