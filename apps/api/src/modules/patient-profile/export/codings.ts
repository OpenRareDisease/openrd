/**
 * The coding ledger: the ONLY place an external terminology code may
 * enter a portable export.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * A receiving registry or hospital system does not read our Chinese
 * labels — it reads the codes. A wrong LOINC code does not fail
 * loudly; it silently files a 6-minute-walk distance under a
 * potassium result, and the patient never finds out. That is a worse
 * outcome than sending no code, because an omitted code degrades to
 * "a human has to read this", while a wrong code degrades to "a
 * machine confidently believes something false".
 *
 * So the rule this module enforces mechanically: a serialiser can
 * only emit a coding by asking `verifiedCoding(key)`, and that
 * function only answers for entries in VERIFIED_CODINGS. Every entry
 * there carries `verifiedAgainst` — a source that exists on this
 * machine and that a reviewer can open. "I am fairly sure I remember
 * this code" is not a source and does not get an entry.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 *
 * The five LOINC codes this export was scoped around —
 *
 *   CK 2157-6, FVC 19870-5, FVC %predicted 19872-1,
 *   DLCO 19911-7, 6MWT 64098-7
 *
 * — are listed in PENDING_VERIFICATION and are NOT emitted. This
 * repository holds no LOINC release, no LOINC table and no document
 * that states any of these code-to-concept mappings (checked: a
 * pdftotext pass over all 184 PDFs under content/medical-kb/source
 * matches "loinc" zero times). With no local source to check them
 * against, asserting them would be exactly the failure the paragraph
 * above describes. Everything they would have coded is emitted as
 * text with a display name and no coding instead — which is valid
 * FHIR, valid Phenopacket, and true.
 *
 * TO PROMOTE A PENDING CODE: open it in the LOINC browser (or any
 * offline LOINC release), confirm the LONG_COMMON_NAME matches the
 * concept, then move the entry into VERIFIED_CODINGS with
 * `verifiedAgainst` naming the release version you checked and
 * `fhirSystem` set to the canonical system URI the FHIR release you
 * are targeting gives that code system. The serialisers pick it up
 * with no other change: the report-field loop in fhir-r4.ts asks
 * `verifiedCoding(field.codingKey)` for every OCR-derived value and
 * feeds whatever it emitted into `buildCodingProvenance`, so the code
 * appears on the Observation AND moves from `withheld` to `emitted`
 * in the same edit. coding-promotion.test.ts pins both halves — it
 * was written after a review found `codingKey` was read by nothing at
 * all, which made this paragraph false and would have let a promotion
 * ship as a no-op whose only visible effect was CK quietly dropping
 * out of the withheld list.
 *
 * FORMAT-INTERNAL CODES ARE NOT LEDGERED. `Observation.status =
 * 'final'`, `Bundle.type = 'document'`,
 * `http://terminology.hl7.org/CodeSystem/condition-clinical#active`
 * and friends are part of the FHIR R4 specification itself, not an
 * external terminology bound into it. They are as much "the format"
 * as the field names are, so they live in fhir-r4.ts next to the
 * resources that use them. The line this ledger draws is: anything a
 * receiver would resolve against a THIRD-PARTY vocabulary release
 * (LOINC, SNOMED CT, UCUM, HPO, OMIM, MONDO) needs an entry here.
 */

export interface VerifiedCoding {
  /** Stable key the serialisers ask for. Not emitted. */
  readonly key: string;
  /** CURIE prefix, for Phenopacket OntologyClass.id (`OMIM:158900`). */
  readonly curiePrefix: string;
  /**
   * The canonical system URI for a FHIR `Coding`, or null to say 「本
   * 条目不作为 FHIR Coding 输出」.
   *
   * Null is not "not filled in yet". A CURIE prefix and a FHIR system
   * URI are different assertions — the prefix identifies the
   * vocabulary, the URI identifies it to a machine that will resolve
   * it — and the two OMIM entries below deliberately carry the first
   * and not the second, for the reason given above them.
   */
  readonly fhirSystem: string | null;
  /** The bare code. */
  readonly code: string;
  /** English label, as the source states it. */
  readonly label: string;
  /** Chinese label, for the human-readable half of every export. */
  readonly labelZh: string;
  /**
   * Where this mapping was checked, precisely enough to re-open.
   * A citation to something that is not on this machine is not a
   * verification — it is a second-hand claim.
   */
  readonly verifiedAgainst: readonly string[];
}

/**
 * OMIM 158900 / 158901.
 *
 * These are the only two external codes this exporter emits, and they
 * are the two it can actually check: four independent peer-reviewed
 * papers in this repository's own corpus state the mapping in running
 * text, two of them for both numbers at once. Quoted in
 * `verifiedAgainst` so a reviewer does not have to take my word for
 * which page said what.
 *
 * They are emitted ONLY as a Phenopacket `OntologyClass` (where the
 * `OMIM:` CURIE prefix is unambiguous) and inside human-readable FHIR
 * `.text`. They are deliberately NOT emitted as a FHIR `Coding` with
 * an OMIM `system` URI: which URI is the canonical one for OMIM in
 * FHIR is precisely the kind of thing this file refuses to guess at,
 * and a number inside a Chinese label cannot be silently machine-
 * consumed the way a system+code pair can.
 */
export const VERIFIED_CODINGS: readonly VerifiedCoding[] = [
  {
    key: 'disease.fshd1',
    curiePrefix: 'OMIM',
    fhirSystem: null,
    code: '158900',
    label: 'Facioscapulohumeral muscular dystrophy 1 (FSHD1)',
    labelZh: '面肩肱型肌营养不良 1 型（FSHD1）',
    verifiedAgainst: [
      'content/medical-kb/source/FSHD_知识库/01.疾病定义和科普/第一批：2025年3月31日/B.FSHD REVIEW 2017.pdf — 「we review what is known about the genetics of FSHD1 (OMIM: 158900)」',
      'content/medical-kb/source/FSHD_知识库/2025.08.01.668136v1.full.pdf — 「type 1 Facioscapulohumeral Dystrophy (FSHD1, OMIM 158900)」',
      'content/medical-kb/source/FSHD_知识库/01.疾病定义和科普/第一批：2025年3月31日/B.A Unifying Genetic Model.pdf — 「autosomal dominant FSHD (FSHD1; OMIM 158900)」',
    ],
  },
  {
    key: 'disease.fshd2',
    curiePrefix: 'OMIM',
    fhirSystem: null,
    code: '158901',
    label: 'Facioscapulohumeral muscular dystrophy 2 (FSHD2)',
    labelZh: '面肩肱型肌营养不良 2 型（FSHD2）',
    verifiedAgainst: [
      'content/medical-kb/source/FSHD_知识库/01.疾病定义和科普/第一批：2025年3月31日/B.FSHD REVIEW 2017.pdf — 「the epigenetic causes of FSHD2 (OMIM: 158901)」',
      'content/medical-kb/source/FSHD_知识库/2025.08.01.668136v1.full.pdf — 「FSHD2 (5% of patients, OMIM #158901)」',
    ],
  },
];

/**
 * Candidate codes that are NOT emitted, kept so that promoting one is
 * a five-line edit by whoever has a LOINC release open rather than a
 * fresh research task.
 *
 * `whyNotVerified` is the honest state of each, written down rather
 * than rounded to "TODO". This array is read by codings.test.ts,
 * which asserts none of these codes appears anywhere in any of the
 * three serialised documents — so if someone pastes one in by hand
 * without promoting it, the suite goes red.
 */
export interface PendingCoding {
  readonly key: string;
  readonly system: 'LOINC';
  readonly code: string;
  readonly wouldMean: string;
  readonly whyNotVerified: string;
}

export const PENDING_VERIFICATION: readonly PendingCoding[] = [
  {
    key: 'lab.creatineKinase',
    system: 'LOINC',
    code: '2157-6',
    wouldMean: 'Creatine kinase [Enzymatic activity/volume] in Serum or Plasma',
    whyNotVerified: 'No LOINC release or LOINC-bearing document exists in this repository.',
  },
  {
    key: 'pft.fvc',
    system: 'LOINC',
    code: '19870-5',
    wouldMean: 'Forced vital capacity [Volume] Respiratory system',
    whyNotVerified: 'No LOINC release or LOINC-bearing document exists in this repository.',
  },
  {
    key: 'pft.fvcPercentPredicted',
    system: 'LOINC',
    code: '19872-1',
    wouldMean: 'FVC percent predicted',
    whyNotVerified:
      'No LOINC release in this repository, and the %-predicted spirometry codes are a family that is easy to confuse with the plain-volume ones — the highest-risk entry in this list.',
  },
  {
    key: 'pft.dlco',
    system: 'LOINC',
    code: '19911-7',
    wouldMean: 'Diffusing capacity of the lung for carbon monoxide (DLCO)',
    whyNotVerified: 'No LOINC release or LOINC-bearing document exists in this repository.',
  },
  {
    key: 'function.sixMinuteWalk',
    system: 'LOINC',
    code: '64098-7',
    wouldMean: '6 minute walk test distance',
    whyNotVerified: 'No LOINC release or LOINC-bearing document exists in this repository.',
  },
];

const BY_KEY = new Map(VERIFIED_CODINGS.map((entry) => [entry.key, entry]));

/**
 * The single gate. Returns `null` for anything unledgered, and every
 * caller is written to fall back to text-with-no-coding on `null` —
 * so adding a new mapped concept to a serialiser without a ledger
 * entry degrades to "honest but uncoded" rather than to a wrong code.
 */
export const verifiedCoding = (key: string): VerifiedCoding | null => BY_KEY.get(key) ?? null;

/** `OMIM:158900` — the Phenopacket / OBO CURIE form. */
export const toCurie = (entry: VerifiedCoding): string => `${entry.curiePrefix}:${entry.code}`;

/**
 * The per-document provenance block. Every export carries it, because
 * "this field has no code" is information the receiver needs and will
 * not otherwise get: without it, an absent coding is indistinguishable
 * from a concept we simply did not collect.
 */
export interface CodingProvenance {
  readonly emitted: ReadonlyArray<{
    curie: string;
    label: string;
    labelZh: string;
    verifiedAgainst: readonly string[];
  }>;
  readonly withheld: ReadonlyArray<{
    system: string;
    code: string;
    wouldMean: string;
    whyNotVerified: string;
  }>;
  readonly noteZh: string;
}

export const buildCodingProvenance = (emittedKeys: readonly string[]): CodingProvenance => ({
  emitted: emittedKeys
    .map((key) => verifiedCoding(key))
    .filter((entry): entry is VerifiedCoding => entry !== null)
    .map((entry) => ({
      curie: toCurie(entry),
      label: entry.label,
      labelZh: entry.labelZh,
      verifiedAgainst: entry.verifiedAgainst,
    })),
  withheld: PENDING_VERIFICATION.map((entry) => ({
    system: entry.system,
    code: entry.code,
    wouldMean: entry.wouldMean,
    whyNotVerified: entry.whyNotVerified,
  })),
  noteZh:
    '本导出只使用可在本仓库内核对来源的编码。无法核对的编码一律不写入，相关项目改为「有显示名、无编码」的纯文本形式——这在 FHIR 与 Phenopacket 中都是合法的，且不会让接收系统误信一个未经核对的代码。withheld 列出的是本应编码、但因缺少可核对来源而留空的项目。',
});
