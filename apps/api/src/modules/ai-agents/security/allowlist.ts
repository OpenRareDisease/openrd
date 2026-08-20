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
 *
 * ══════════════════════════════════════════════════════════════════════
 * IT IS NO LONGER A LIST. IT IS FOUR TABLES OF KEY → CHINESE, AND THE
 * SET IS DERIVED FROM THEM.
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHY. `security/render.ts` applies its label table to TOP-LEVEL rows
 * only, so every row inside an OCR block printed under its raw key: the
 * model was handed 「d4z4Repeats_clinical: within_fshd1_repeat_range」 in
 * a block that is otherwise entirely Chinese, and copied the identifier
 * into the answer a Chinese-reading patient then read. The other lane's
 * `WIRE_TOKEN_ZH` rewrites some of those after the fact, and its own
 * note says what that arrangement is worth: 「a reading label added over
 * there does not fail to compile over here — it just reaches a patient
 * as a snake_case identifier」.
 *
 * A LIST CANNOT CARRY THE CHINESE AND A TABLE CANNOT BE ADDED TO
 * WITHOUT IT. That is the whole of the change: `OCR_FIELDS_SAFE_KEYS_PRECISE`
 * is `Object.keys` of these four tables, so admitting a key to the
 * prompt and naming it in Chinese are now one edit, and the compiler
 * rejects the half of it that omits the name. The renderer reads
 * `OCR_FIELD_LABELS_ZH` and prints the Chinese; a key that somehow
 * reaches a block without one still prints — see `ocrRowLabel` there —
 * because a raw key is a gap in a table and printing it says so, which
 * is the same fall-through `DOCUMENT_TYPE_VALUE_LABELS` takes.
 *
 * WHY FOUR TABLES AND NOT ONE. Only one of the four takes the flag and
 * interval siblings below, and which keys those are is not a property a
 * predicate over key names can recover. See `OCR_MEASURED_ANALYTE_LABELS_ZH`.
 *
 * THE TABLES ARE NOT REQUIRED TO BE INJECTIVE. Two spellings of one
 * cell (`ck` / `creatine_kinase`) are the same analyte and get the same
 * Chinese; `projectOcrFields` collapses that pair whenever the two
 * values agree, so both only ever print together when they disagree.
 * The renderer's inverse — `readRenderedRows` has to recover the key a
 * printed row belongs to — resolves a repeated label onto the FIRST key
 * that claimed it and leaves the later spelling printing its raw key,
 * so the round trip is exact without this file having to invent a
 * second Chinese name for one analyte. Camel before snake, throughout,
 * so the spelling that survives the collapse is the one that gets the
 * name.
 */

/**
 * THE DOCUMENT'S OWN IDENTITY. Not measurements and not results: what
 * kind of report this is, how it was run, and where this platform's
 * pipeline got to with it. No flag and no reference interval — a
 * laboratory does not print an abnormal marker against 检测方法.
 */
const OCR_REPORT_IDENTITY_LABELS_ZH: Readonly<Record<string, string>> = {
  classifiedType: '报告类型（本平台判定）',
  classified_type: '报告类型（本平台判定）',
  reportType: '报告类型（报告自述）',
  report_type: '报告类型（报告自述）',
  documentType: '文档类型',
  document_type: '文档类型',
  // 检测方法, UNDER THE SPELLING SOMETHING ACTUALLY WRITES.
  //
  // This entry read `testMethod` / `test_method` / `methodology`, and no
  // stage of this pipeline has ever produced one of the three. The
  // parser's field is `genetic_test_method` (see `_detect_genetic_method`
  // and the `genetic_summary` writer), the bridge mints its camel twin,
  // and `GENETIC_FIELD_KEYS.testMethod` in patient-profile/
  // genetic-evidence.ts — the closed list every reader on this platform
  // goes through — is exactly `['geneticTestMethod', 'genetic_test_method']`.
  // So three keys were advertised that cannot arrive and the one that
  // does was denied: a genetics report that states 二代测序 or Southern
  // blot reached the assistant with the method missing, which is the
  // cell that decides whether a repeat count is a count at all.
  //
  // Both halves of that are the SAME defect seen from its two sides —
  // the `ageGroup` shape in one direction and the D-二聚体 shape in the
  // other — and it is the pair the parity test is written to make
  // impossible to reintroduce.
  geneticTestMethod: '检测方法',
  genetic_test_method: '检测方法',
  status: '处理状态',
};

/**
 * THE GENETICS CELLS. They get no flag and no interval siblings, and
 * that is structural rather than an omission: `geneticBranchFor` in
 * `pii-redactor.ts` dispatches on the substrings `d4z4` / `ecori` /
 * `methylation` / `haplotype` BEFORE the safe-key branch is reached, so
 * a `d4z4RepeatsFlag` minted here would not be published as a flag at
 * all — it would be handed to `clinicaliseD4Z4`, which would read
 * 「high」 as a repeat count cell and publish a refusal about it. The
 * cells this platform reads are read by their own readers; a marker
 * beside one of them would have to go through those readers, and that
 * is a change to the dispatch rather than to this table.
 *
 * `diagnosisType` sits here rather than with the report identity above
 * for the same reason: `GENETIC_TYPE_KEYS_LOWER` dispatches it to
 * `publishDiagnosisTypeCell`, which is not the safe-key branch either.
 */
const OCR_GENETIC_CELL_LABELS_ZH: Readonly<Record<string, string>> = {
  diagnosisType: '分型/诊断方式',
  diagnosis_type: '分型/诊断方式',
  geneType: '基因分型',
  gene_type: '基因分型',
  geneticType: '基因分型',
  genetic_type: '基因分型',
  d4z4Repeats: 'D4Z4 重复数',
  d4z4RepeatPathogenic: 'D4Z4 收缩等位基因重复数',
  d4z4RepeatOther: 'D4Z4 另一条等位基因重复数',
  d4z4_repeat_pathogenic: 'D4Z4 收缩等位基因重复数',
  d4z4_repeat_other: 'D4Z4 另一条等位基因重复数',
  methylationValue: '甲基化值',
  methylation_value: '甲基化值',
  ecoRIFragment: 'EcoRI 片段长度',
  ecoriFragmentKb: 'EcoRI 片段长度（kb）',
  ecori_fragment_kb: 'EcoRI 片段长度（kb）',
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
  haplotype: '单倍型',
};

/**
 * A MEASURED NUMBER, AND THE ONLY TABLE THAT TAKES THE FLAG AND THE
 * INTERVAL.
 *
 * WHAT WAS MISSING AND WHY IT WAS INVISIBLE. The parser reads the
 * laboratory's own abnormal marker and its own reference interval off
 * the row — 「*14肌酸激酶(CK) 693 ↑ 50-310 U/L」 — and the OCR bridge
 * writes them onto the payload as `${camelName}Flag` and
 * `${camelName}Reference` (see the flag/interval note in
 * services/ocr/embedded-report-ocr.ts). This list carried neither, and
 * carried instead a generic `referenceRange` / `normalRange` pair that
 * NOTHING in this pipeline has ever written — an inventory entry for a
 * key that cannot arrive, which is the `ageGroup` defect on the profile
 * scope. Those four are deleted here.
 *
 * So a CK at 2.2 times its stated upper limit reached the assistant as
 * 「ck: 693」 and nothing else: no direction, no interval to be 693
 * against, on the one enzyme this disease is monitored by. The model
 * has no way to know an ordinary-looking number is flagged, and the
 * answer it composes says so.
 *
 * THE TWO SIBLINGS ARE DERIVED, NOT LISTED. `flagKey` / `referenceKey`
 * below mint them from every key in this table, so an analyte added
 * here arrives with its marker and its interval already admitted and
 * already named. Listing 260 keys by hand is how the half of a pair
 * goes missing.
 *
 * WHAT EACH MODE DOES WITH THEM falls out of the rules already in
 * `projectOcrFields` and is exactly right in both:
 *   - the FLAG is `high` / `low` — no digit, so `isQualitativeResult`
 *     passes it in STRICT mode. That is the mode where the number
 *     itself is swept into `numericValuesWithheld`, and 「CK 偏高」 with
 *     no number is precisely what a patient who did not consent to
 *     precise values should have said about them.
 *   - the INTERVAL is 「50-310」 — digits, so strict withholds it and
 *     counts it. An interval is a measurement; precise consent is what
 *     buys it, and it is only useful beside the number it bounds, which
 *     that same consent buys.
 *
 * THE FLAG IS AN ENGLISH TOKEN THIS PLATFORM MINTS, not a word the
 * laboratory printed — `_read_row_flag` maps 「↑」/「偏高」/「H」 onto
 * `high`. So its Chinese is in the renderer's value table beside every
 * other wire token, not here: this table names KEYS.
 */
const OCR_MEASURED_ANALYTE_LABELS_ZH: Readonly<Record<string, string>> = {
  // Muscle enzymes / biochemistry
  ck: '肌酸激酶 CK',
  ckmb: '肌酸激酶同工酶 CK-MB',
  // THE BRIDGE'S ALIAS FOR `ck`, AND ITS LABEL SAYS SO NOW. See
  // `OCR_ANALYTE_ALIASES` below: the two are one row on one report, they
  // are joined before either is published, and this spelling only ever
  // reaches a prompt in the one state the join refuses — the two
  // spellings holding DIFFERENT values. A label that read 「肌酸激酶」
  // beside 「肌酸激酶 CK」 in that state is two analytes to any reader.
  creatineKinase: '肌酸激酶 CK（另一种拼写）',
  ldh: '乳酸脱氢酶 LDH',
  alt: '丙氨酸氨基转移酶 ALT',
  ast: '天冬氨酸氨基转移酶 AST',
  creatinine: '肌酐',
  uricAcid: '尿酸',
  uric_acid: '尿酸',
  mb: '肌红蛋白 Mb',
  myoglobin: '肌红蛋白 Mb（另一种拼写）',

  // THE REST OF `_extract_labs`, WHICH IS ONE MAP AND WAS HALF A LIST.
  //
  // 钙 was here and 钠, 钾, 氯, 镁, 无机磷 were not — one member of the
  // electrolyte panel admitted and the other five denied, off the same
  // `analytes` dict in the parser, on a report that prints all six in a
  // column. Same for the liver set (总蛋白/白蛋白/球蛋白 present nowhere,
  // 转氨酶 present), the bilirubins, and the whole lipid panel. Nothing
  // chose those; they are what a list maintained by hand loses. See the
  // parity test.
  tbil: '总胆红素',
  dbil: '直接胆红素',
  ibil: '间接胆红素',
  tp: '总蛋白',
  alb: '白蛋白',
  globulin: '球蛋白',
  aGRatio: '白球比值 A/G',
  a_g_ratio: '白球比值 A/G',
  alp: '碱性磷酸酶 ALP',
  ggt: '谷氨酰转肽酶 GGT',
  urea: '尿素',
  glucose: '葡萄糖',
  cholesterol: '总胆固醇',
  triglyceride: '甘油三酯',
  hdlC: '高密度脂蛋白胆固醇 HDL-C',
  hdl_c: '高密度脂蛋白胆固醇 HDL-C',
  ldlC: '低密度脂蛋白胆固醇 LDL-C',
  ldl_c: '低密度脂蛋白胆固醇 LDL-C',
  vldlC: '极低密度脂蛋白胆固醇 VLDL-C',
  vldl_c: '极低密度脂蛋白胆固醇 VLDL-C',
  apoA1: '载脂蛋白 A1',
  apo_a1: '载脂蛋白 A1',
  apoB: '载脂蛋白 B',
  apo_b: '载脂蛋白 B',
  lpA: '脂蛋白 a',
  lp_a: '脂蛋白 a',
  phosphorus: '无机磷',
  magnesium: '镁',
  co2cp: '二氧化碳结合力 CO2CP',
  potassium: '钾',
  sodium: '钠',
  chloride: '氯',
  calcium: '钙',
  il6: '白介素-6 IL-6',

  // Haematology
  wbc: '白细胞计数',
  rbc: '红细胞计数',
  hgb: '血红蛋白',
  hct: '红细胞压积',
  plt: '血小板计数',
  mcv: '平均红细胞体积',
  mch: '平均红细胞血红蛋白量',
  mchc: '平均红细胞血红蛋白浓度',
  mpv: '平均血小板体积',
  pct: '血小板压积',
  pdw: '血小板分布宽度',
  plcr: '大血小板比率',
  nrbc: '有核红细胞',
  rdwCv: '红细胞分布宽度 CV',
  rdwSd: '红细胞分布宽度 SD',
  rdw_cv: '红细胞分布宽度 CV',
  rdw_sd: '红细胞分布宽度 SD',
  neutAbs: '中性粒细胞绝对值',
  neutPct: '中性粒细胞百分比',
  neut_abs: '中性粒细胞绝对值',
  neut_pct: '中性粒细胞百分比',
  lymphAbs: '淋巴细胞绝对值',
  lymphPct: '淋巴细胞百分比',
  lymph_abs: '淋巴细胞绝对值',
  lymph_pct: '淋巴细胞百分比',
  monoAbs: '单核细胞绝对值',
  monoPct: '单核细胞百分比',
  mono_abs: '单核细胞绝对值',
  mono_pct: '单核细胞百分比',
  eosAbs: '嗜酸性粒细胞绝对值',
  eos_abs: '嗜酸性粒细胞绝对值',
  // THE ONE DIFFERENTIAL ROW WITH NO PERCENTAGE. Every other lineage on
  // this panel carries both an absolute and a ratio, because a 血常规
  // prints both — 中性/淋巴/单核/嗜碱 all had the pair and 嗜酸 had only
  // the count. Measured on a synthetic 血常规五分类 whose eosinophil
  // ratio was the flagged row: the absolute printed with its marker and
  // its interval, and the percentage the laboratory flagged beside it
  // was not on the prompt at all, in either mode, with nothing said
  // about its absence.
  eosPct: '嗜酸性粒细胞百分比',
  eos_pct: '嗜酸性粒细胞百分比',
  basoAbs: '嗜碱性粒细胞绝对值',
  basoPct: '嗜碱性粒细胞百分比',
  baso_abs: '嗜碱性粒细胞绝对值',
  baso_pct: '嗜碱性粒细胞百分比',

  // Coagulation
  pt: '凝血酶原时间 PT',
  inr: '国际标准化比值 INR',
  aptt: '活化部分凝血活酶时间 APTT',
  tt: '凝血酶时间 TT',
  fibrinogen: '纤维蛋白原',
  // THE SIXTH ROW OF `_extract_coagulation`, and the list stopped at
  // five. D-二聚体 is the row a 凝血 panel is ordered FOR in an
  // immobilising myopathy, and it is the one this cohort's admissions
  // flag: a synthetic panel with the D-dimer above its interval reached
  // the prompt as PT/INR/APTT/TT/纤维蛋白原 and no sixth row, so the
  // abnormal analyte was the invisible one and its 异常标记 went with it.
  dDimer: 'D-二聚体',
  d_dimer: 'D-二聚体',

  // Thyroid
  ft3: '游离三碘甲状腺原氨酸 FT3',
  ft4: '游离甲状腺素 FT4',
  tsh: '促甲状腺激素 TSH',

  // Pulmonary — the systems this cohort is monitored for
  fvc: '用力肺活量 FVC',
  fvcPredPct: '用力肺活量占预计值百分比',
  fvc_pred_pct: '用力肺活量占预计值百分比',
  fev1: '第一秒用力呼气容积 FEV1',
  fev1PredPct: '第一秒用力呼气容积占预计值百分比',
  fev1_pred_pct: '第一秒用力呼气容积占预计值百分比',
  fev1Fvc: 'FEV1/FVC',
  fev1_fvc: 'FEV1/FVC',
  tlc: '肺总量 TLC',
  tlcPredPct: '肺总量占预计值百分比',
  tlc_pred_pct: '肺总量占预计值百分比',
  dlco: '一氧化碳弥散量 DLCO',
  dlcoPredPct: '弥散量占预计值百分比',
  dlco_pred_pct: '弥散量占预计值百分比',
  dlcoVa: '每单位肺泡容积弥散量 DLCO/VA',
  dlco_va: '每单位肺泡容积弥散量 DLCO/VA',

  // Cardiac — the intervals, which are numbers. The two cardiac cells
  // that are prose (`ecgSummary`, `conductionAbnormality`) and the one
  // that is an enum (`ecgRhythm`) are in the qualitative table below:
  // an abnormal marker beside 心电结论 is not a thing a report prints.
  heartRate: '心率',
  heart_rate: '心率',
  prIntervalMs: 'PR 间期（ms）',
  pr_interval_ms: 'PR 间期（ms）',
  qrsDurationMs: 'QRS 时限（ms）',
  qrs_duration_ms: 'QRS 时限（ms）',
  qtMs: 'QT 间期（ms）',
  qt_ms: 'QT 间期（ms）',
  qtcMs: 'QTc 间期（ms）',
  qtc_ms: 'QTc 间期（ms）',
  axisP: 'P 波电轴',
  axis_p: 'P 波电轴',
  axisQrs: 'QRS 电轴',
  axis_qrs: 'QRS 电轴',
  axisT: 'T 波电轴',
  axis_t: 'T 波电轴',

  // Echocardiography — the numbers. `_extract_echo` has emitted these
  // since it was written and this list named none of them, so a
  // patient's own 心超 reached the assistant as a report type and
  // nothing else. The three cells on that panel that are ENUMS
  // (`chamberSizeStatus`, `wallMotionStatus`, `valveStatus`) and the one
  // that is prose (`echoSummary`) are deliberately still absent — see
  // the decline list in `allowlist.parity.test.ts`, which is where that
  // is a recorded decision rather than an omission.
  lvef: '左室射血分数 LVEF',
  fs: '左室短轴缩短率 FS',
  co: '心输出量 CO',
  hr: '心率（心超）',
  lad: '左房内径 LAD',
  aod: '主动脉根部内径 AOD',
  lvdD: '左室舒张末内径 LVDd',
  lvd_d: '左室舒张末内径 LVDd',
  eOverEPrime: "二尖瓣 E/e'",
  e_over_e_prime: "二尖瓣 E/e'",

  // Urinalysis — the rows that are counts. See the qualitative table
  // below for the dipstick rows, and the 尿常规 paragraph there for what
  // the whole panel's absence did.
  urineSpecificGravity: '尿比重',
  urine_specific_gravity: '尿比重',
  urinePh: '尿 pH',
  urine_ph: '尿 pH',
  urineRbc: '尿红细胞计数',
  urine_rbc: '尿红细胞计数',
  urineWbc: '尿白细胞计数',
  urine_wbc: '尿白细胞计数',
  urineBacteria: '尿细菌计数',
  urine_bacteria: '尿细菌计数',
  urineEpithelialCells: '尿上皮细胞',
  urine_epithelial_cells: '尿上皮细胞',
  urineMucus: '尿粘液丝',
  urine_mucus: '尿粘液丝',

  // Stool — the 幽门螺杆菌 呼气试验 reading. Its qualitative twin
  // (`hpResult`) is in the table below, beside the rest of the panel.
  hpDob: '幽门螺杆菌呼气试验 DOB 值',
  hp_dob: '幽门螺杆菌呼气试验 DOB 值',

  // Infection screening — `trustTiter` is the one measurement on the
  // panel; the rest of it is 阴性 / 阳性 and lives below.
  trustTiter: '梅毒 TRUST 滴度',
  trust_titer: '梅毒 TRUST 滴度',
};

/**
 * A RESULT THAT IS A WORD RATHER THAN A NUMBER — an enum the extractor
 * emits, or the short prose a cardiology or imaging report prints.
 *
 * No flag and no interval: 阴性 is not high or low, and there is no
 * range for 窦性心律 to be outside. The prose members of this table are
 * the three `looksLikeFreeText` sends through gate 0 and gate 2 like
 * any other narrative — see the premise paragraph at the top of this
 * section.
 */
const OCR_QUALITATIVE_CELL_LABELS_ZH: Readonly<Record<string, string>> = {
  // Cardiac
  ecgRhythm: '心电节律',
  ecg_rhythm: '心电节律',
  ecgSummary: '心电结论',
  ecg_summary: '心电结论',
  conductionAbnormality: '传导异常',
  conduction_abnormality: '传导异常',

  // Imaging — fixed enums produced by the FSHD extractor
  fattyInfiltration: '脂肪浸润',
  fatty_infiltration: '脂肪浸润',
  inflammatoryChange: '炎性改变',
  inflammatory_change: '炎性改变',
  asymmetry: '左右不对称',
  // The fourth cell `_extract_mri` writes, and the only one of the four
  // this list did not carry. 萎缩 is a finding a muscle MRI is READ for
  // in this disease, and it was the one dropped.
  atrophy: '肌肉萎缩',

  // ══════════════════════════════════════════════════════════════════
  // URINALYSIS — THE PANEL THAT WAS ON NO TABLE AT ALL.
  // ══════════════════════════════════════════════════════════════════
  //
  // `_extract_urinalysis` writes seventeen cells; this file named none
  // of them, in either script, in either mode. Every one was therefore
  // deny-by-default, and the drop happens INSIDE `projectOcrFields`
  // before any counting — so it did not even reach `notAllowed`, and no
  // `numericValuesWithheld` counted it either. Measured on a synthetic
  // 尿常规 with a positive 潜血 and a raised red-cell count: the block
  // rendered as 报告类型: 尿常规 and one row, and the two statistics that
  // exist to say 「something was held back」 both read zero.
  //
  // That is the worst shape a deny-by-default list can fail in. A key
  // that is refused loudly costs the model a reading; a key nothing
  // knows to refuse costs it the knowledge that a reading existed, and
  // the model then answers a question about the patient's urine from a
  // urinalysis it has been shown as empty.
  //
  // THE COUNTS ARE IN THE MEASURED TABLE ABOVE, not here: 尿红细胞计数
  // is a number a laboratory flags and prints an interval against, and
  // putting it here would deny it the two siblings that carry those.
  // The rows below are the dipstick, whose result is 阴性/阳性/弱阳性 —
  // `_normalize_qualitative_value`'s vocabulary — plus the two that are
  // a printed word (颜色, 透明度).
  urineColor: '尿颜色',
  urine_color: '尿颜色',
  urineClarity: '尿透明度',
  urine_clarity: '尿透明度',
  urineProtein: '尿蛋白质',
  urine_protein: '尿蛋白质',
  urineGlucose: '尿葡萄糖',
  urine_glucose: '尿葡萄糖',
  urineKetone: '尿酮体',
  urine_ketone: '尿酮体',
  urineBilirubin: '尿胆红素',
  urine_bilirubin: '尿胆红素',
  urineUrobilinogen: '尿胆原',
  urine_urobilinogen: '尿胆原',
  urineNitrite: '尿亚硝酸盐',
  urine_nitrite: '尿亚硝酸盐',
  urineOccultBlood: '尿潜血',
  urine_occult_blood: '尿潜血',
  urineLeukocyte: '尿白细胞酯酶',
  urine_leukocyte: '尿白细胞酯酶',

  // Stool panel — enums plus counts
  stoolColor: '粪便颜色',
  stoolConsistency: '粪便性状',
  stoolBlood: '粪便肉眼血',
  stoolMucus: '粪便黏液',
  stoolRbc: '粪便红细胞',
  stoolWbc: '粪便白细胞',
  stoolFatGlobules: '粪便脂肪球',
  stoolOccultBlood: '粪便隐血试验',
  stool_color: '粪便颜色',
  stool_consistency: '粪便性状',
  stool_blood: '粪便肉眼血',
  stool_mucus: '粪便黏液',
  stool_rbc: '粪便红细胞',
  stool_wbc: '粪便白细胞',
  stool_fat_globules: '粪便脂肪球',
  stool_occult_blood: '粪便隐血试验',
  // The 幽门螺杆菌 result the same extractor writes; its DOB value is in
  // the measured table above.
  hpResult: '幽门螺杆菌检测结果',
  hp_result: '幽门螺杆菌检测结果',

  // Infection screening — the panel every neurology admission runs
  // before an immunosuppressant or a muscle biopsy, so an FSHD patient
  // accumulates these. `_extract_infection_screening` has emitted them
  // all along and this list never named one, so the whole panel was
  // dropped in *both* modes: the patient's own syphilis and hepatitis
  // results were unreadable to the assistant reading their file.
  hbsag: '乙肝表面抗原 HBsAg',
  antiHbs: '乙肝表面抗体 抗-HBs',
  anti_hbs: '乙肝表面抗体 抗-HBs',
  hbeag: '乙肝 e 抗原 HBeAg',
  antiHbe: '乙肝 e 抗体 抗-HBe',
  anti_hbe: '乙肝 e 抗体 抗-HBe',
  antiHbc: '乙肝核心抗体 抗-HBc',
  anti_hbc: '乙肝核心抗体 抗-HBc',
  hivAb: 'HIV 抗体',
  hiv_ab: 'HIV 抗体',
  antiHcv: '丙肝抗体 抗-HCV',
  anti_hcv: '丙肝抗体 抗-HCV',
  tppa: '梅毒螺旋体抗体 TPPA',
  trustAb: '梅毒 TRUST 定性',
  trust_ab: '梅毒 TRUST 定性',
};

/**
 * THE LABORATORY'S ABNORMAL MARKER, AND THE INTERVAL IT WAS READ
 * AGAINST, as suffixes on the analyte's own key.
 *
 * ONE SPELLING EACH, and it is the bridge's: `embedded-report-ocr.ts`
 * writes `${camelName}Flag` / `${camelName}Reference` and no snake
 * twin, deliberately, because these two cells are new and nothing on
 * disk predates them. Exported so nothing has to spell them a second
 * time — a suffix written twice is a suffix that can disagree with
 * itself, which is what `reportDate_year` and `uploadYear` cost.
 */
export const OCR_FLAG_SUFFIX = 'Flag';
export const OCR_REFERENCE_SUFFIX = 'Reference';

export const flagKey = (analyteKey: string): string => `${analyteKey}${OCR_FLAG_SUFFIX}`;
export const referenceKey = (analyteKey: string): string => `${analyteKey}${OCR_REFERENCE_SUFFIX}`;

/**
 * THE SIBLINGS ARE MINTED OFF THE CAMEL SPELLING ONLY, AND THE SNAKE
 * ONE IS SKIPPED RATHER THAN GIVEN A TWIN.
 *
 * The paragraph above states the bridge's rule — `${camelName}Flag` and
 * no snake twin — and this derivation did not implement it. It walked
 * EVERY key in the measured table, snake spellings included, so the
 * inventory carried `neut_absFlag`, `uric_acidReference`,
 * `qtc_msFlag` and forty-one more: forty-four rows advertising cells
 * that nothing on this platform has ever written, on a list whose whole
 * job is to be an honest inventory of what a result can carry. It is
 * the `ageGroup` defect — a key admitted that cannot arrive — and it was
 * invisible for the reason the same paragraph names about the OTHER
 * direction: a derivation is trusted not to be hand-maintained, so
 * nobody read it against the writer.
 *
 * `writeReading` in services/ocr/embedded-report-ocr.ts is the only way
 * a reading enters `fields`, and it writes `flagKey(toCamelCase(key))`
 * whichever spelling the value went under — so `uric_acid` and
 * `uricAcid` share one `uricAcidFlag`, exactly as its own note says.
 * A key with no underscore IS its camel spelling, so that is the test:
 * the analyte tables are written camel-before-snake and every snake
 * entry in them has its camel twin one line above (checked by
 * `allowlist.parity.test.ts`, which fails if one ever does not).
 */
const isCamelSpelling = (key: string): boolean => !key.includes('_');

const analyteSiblingLabels = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(OCR_MEASURED_ANALYTE_LABELS_ZH)) {
    if (!isCamelSpelling(key)) continue;
    out[flagKey(key)] = `${label} 异常标记`;
    out[referenceKey(key)] = `${label} 参考区间`;
  }
  return out;
};

/**
 * EVERY OCR CELL THIS PIPELINE MAY NAME, WITH THE CHINESE IT IS NAMED
 * IN. The renderer reads this; the set below is its `Object.keys`.
 *
 * Order is load-bearing in exactly one way, and it is a small one: a
 * label claimed by two spellings of one analyte resolves back to the
 * first, so the tables are written camel-before-snake. See the
 * injectivity paragraph at the top of this section.
 */
export const OCR_FIELD_LABELS_ZH: Readonly<Record<string, string>> = {
  ...OCR_REPORT_IDENTITY_LABELS_ZH,
  ...OCR_GENETIC_CELL_LABELS_ZH,
  ...OCR_MEASURED_ANALYTE_LABELS_ZH,
  ...analyteSiblingLabels(),
  ...OCR_QUALITATIVE_CELL_LABELS_ZH,
};

/**
 * The keys of the table above, which is the question the redactor
 * asks: may this OCR cell be named in a prompt at all.
 *
 * IT IS DERIVED AND NO LONGER WRITTEN OUT, which is the fence. A key
 * admitted here without its Chinese is not a diff a reviewer has to
 * catch — it does not compile.
 */
export const OCR_FIELDS_SAFE_KEYS_PRECISE: ReadonlySet<string> = new Set(
  Object.keys(OCR_FIELD_LABELS_ZH),
);

/**
 * THE MEASURED TABLE'S KEYS, AS A SET.
 *
 * `projectOcrFields` needs to know whether a cell is a NUMBER a
 * laboratory prints an interval against before it may compare the two —
 * see the out-of-interval note there. That is precisely the question
 * the four-table split above answers and precisely the question
 * `OCR_FIELDS_SAFE_KEYS_PRECISE` throws away, so it is exported
 * separately rather than recomputed from a predicate over key names.
 */
export const OCR_MEASURED_ANALYTE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(OCR_MEASURED_ANALYTE_LABELS_ZH),
);

/**
 * ══════════════════════════════════════════════════════════════════════
 * TWO SPELLINGS OF ONE ANALYTE THAT ARE NOT A SNAKE/CAMEL PAIR.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `LEGACY_ANALYTE_TWINS` in services/ocr/embedded-report-ocr.ts mints
 * `creatineKinase` off `ck` and `myoglobin` off `mb` — deliberately, and
 * the note there says why: every reader's alias list on this platform is
 * headed by the readable name, so an archived payload and a live one
 * both have to carry it. The twin is written through `writeReading`, so
 * it arrives with its own `creatineKinaseFlag` and
 * `creatineKinaseReference` as well.
 *
 * `projectOcrFields` has exactly one join and it cannot see this pair.
 * That join is `collapsesToCamelAlias`, which collapses `uric_acid` onto
 * `uricAcid`; `ck` and `creatineKinase` are BOTH camel spellings and
 * neither camelises to the other, so both survived it. Measured on a
 * synthetic 心肌酶谱 whose CK row printed 「693 ↑ 50-310」 and whose Mb row
 * printed 「210 ↑ 0-110」: precise mode published twelve rows for two
 * rows of the report — 肌酸激酶 CK / 肌酸激酶 / 肌红蛋白 Mb / 肌红蛋白, each
 * with its own 异常标记 and 参考区间 — and strict mode published four
 * 异常标记 rows and 「按当前授权扣下的测量值个数: 8」. Four flagged
 * analytes where the laboratory ran two, on the one enzyme this disease
 * is monitored by, into a model that is asked 「我的肌酶高不高」.
 *
 * THE JOIN BELONGS HERE AND NOT IN THE BRIDGE. The twin is minted for
 * compatibility with what is already on disk, so it cannot stop being
 * minted; what has to stop is one report row reaching a prompt as two
 * analytes. `alias → canonical`, and the canonical is the spelling the
 * laboratory's own row is read into (`ck` / `mb`), so the surviving row
 * is the one whose Chinese carries the abbreviation the report printed.
 *
 * THE SAME RULE AS THE SNAKE/CAMEL JOIN, INCLUDING ITS REFUSAL: the
 * alias yields only when the canonical holds the SAME value. Two
 * spellings that disagree both stay, because a silent pick between two
 * different values is the redactor editing clinical data — and that is
 * the state the alias's own label above is written for.
 */
export const OCR_ANALYTE_ALIASES: Readonly<Record<string, string>> = {
  creatineKinase: 'ck',
  myoglobin: 'mb',
};

/**
 * The canonical spelling of an alias cell — or of one of its two
 * siblings, because a flag that outlives the value it describes is the
 * defect `deleteReading` exists to prevent one layer up.
 *
 * `null` for every key that is not an alias, which is nearly all of
 * them.
 */
export const canonicalAnalyteKey = (key: string): string | null => {
  const direct = OCR_ANALYTE_ALIASES[key];
  if (direct !== undefined) return direct;
  for (const [suffix, sibling] of [
    [OCR_FLAG_SUFFIX, flagKey],
    [OCR_REFERENCE_SUFFIX, referenceKey],
  ] as const) {
    if (!key.endsWith(suffix)) continue;
    const stem = OCR_ANALYTE_ALIASES[key.slice(0, -suffix.length)];
    if (stem !== undefined) return sibling(stem);
  }
  return null;
};

/**
 * ══════════════════════════════════════════════════════════════════════
 * CELLS WHOSE ABSENCE FROM A PROMPT IS NOT A MISSING RESULT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `projectOcrFields` is deny-by-default and now SAYS SO — it publishes
 * `fieldsNotRecognised`, a count of the cells on the payload that no
 * table above names. That count is a number a model repeats to a
 * patient, so it has to be a count of RESULTS. These keys are not
 * results and are excluded from it:
 *
 *   - PIPELINE BOOKKEEPING. `analysisStatus`, `ocrStatus`,
 *     `extractedTextLength`, `classifiedTypeConfidence`,
 *     `reportTypeLabel`, `fieldCount`, `reviewRecommendedCount` and
 *     `ocrIssue` are `buildFields`' record of its own run. They are
 *     declined in `allowlist.parity.test.ts` under exactly that word.
 *   - THE ENCOUNTER AND THE PEOPLE ON IT. `facility`, `department`,
 *     `specimen`, `bedNo`, `orderingDoctor`, `reportTime`, `patientSex`,
 *     `patientAge`. Their absence is a privacy decision this platform
 *     takes on purpose — `HARD_DELETE_KEYS` states the same decision
 *     about the ones that are unambiguously identifying — and counting
 *     them as 「检查项 this report has and you were not shown」 would be
 *     the count lying in the other direction.
 *
 * A KEY MISSING FROM THIS SET FAILS LOUD, which is why it may be a hand
 * list at all: a bookkeeping key nobody added here is counted, so the
 * number reads one too high and a reader goes looking. The reverse — a
 * result quietly excluded — is the failure this set must not have, and
 * `allowlist.parity.test.ts` is what holds it: nothing here may be a
 * cell the parser writes, and nothing here may be on the allowlist.
 */
export const OCR_NON_RESULT_KEYS: ReadonlySet<string> = new Set([
  'analysisStatus',
  'ocrStatus',
  'extractedTextLength',
  'classifiedTypeConfidence',
  'reportTypeLabel',
  'fieldCount',
  'reviewRecommendedCount',
  'ocrIssue',
  'facility',
  'department',
  'specimen',
  'bedNo',
  'orderingDoctor',
  'reportTime',
  'patientSex',
  'patientAge',
]);
