/**
 * Patient reports retriever.
 *
 * Joins `patient_documents` to the authenticated user's profile and
 * exposes the most recent reports as **structured fields** under each
 * chunk's `metadata.fields`.
 *
 * Privacy contract (see PR #23 review):
 *   - `chunk.content` and `citation.snippet` are deliberately generic
 *     placeholders. Raw OCR values, report titles (which can contain
 *     the patient's name), and exact upload dates never make it into
 *     a citation or a chunk body. The orchestrator must route the
 *     data through `security/render.ts → renderChunkForPrompt`.
 *   - The retriever still surfaces the raw OCR `fields` blob in
 *     `metadata.fields.fields` so the redactor can apply the
 *     strict-mode clinicalisation + allowlist before anything reaches
 *     the prompt.
 *
 * Optional filter keys:
 *   - `documentType`: filter to a specific report type
 *     (e.g. `genetic_report`, `mri`, `lab`).
 *   - `since`: ISO date string; only reports uploaded on/after this
 *     date are returned.
 *
 * Refuses to read when there's no user in scope or consent is `none`.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  Citation,
  IRetriever,
  RetrieveContext,
  RetrieveInput,
  RetrieveResult,
  RetrievedChunk,
} from './base.js';
import { emptyResult } from './base.js';

interface ReportRow {
  id: string;
  document_type: string;
  title: string | null;
  uploaded_at: string | Date;
  status: string;
  ocr_payload: Record<string, unknown> | null;
  classified_type: string | null;
  report_type_label: string | null;
}

const RECENT_LIMIT_DEFAULT = 5;
const RECENT_LIMIT_MAX = 20;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const formatTimestamp = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

/**
 * Keys the OCR pipeline files a report's narrative conclusion under.
 */
const IMPRESSION_KEYS = [
  'reportImpression',
  'report_impression',
  'impressionText',
  'impression',
  'interpretationSummary',
  'interpretation_summary',
  'findings',
  'conclusion',
];

/**
 * Clinical findings vocabulary — the ONLY things allowed out of a
 * report's narrative.
 *
 * Why a vocabulary and not a scrubber
 * -----------------------------------
 * The allowlist has had a `findings_summary` slot since PR #23 and
 * nothing filled it, so the model could learn a report's *type* but
 * never its *conclusion* —「这份报告说明什么」was unanswerable by
 * construction. Filling it is worth doing; the question is how.
 *
 * The first attempt scrubbed the impression: strip identifiers by
 * pattern, then strip any name the same payload had extracted. The
 * render.test.ts regression fence rejected it, correctly. Its fixture
 * reads「受检者张三，右大腿后群 STIR 信号显著增高」— a name the OCR
 * never filed under a key of its own, so there was nothing to strip it
 * by. Chinese names have no reliable pattern; a scrubber over
 * free-form prose is allow-by-default wearing a safety costume, and
 * this codebase is deny-by-default everywhere else for good reason.
 *
 * So nothing passes unless it is a phrase we already recognise. A name
 * cannot survive a vocabulary match, because a name is never in the
 * vocabulary. The cost is expressiveness — we emit
 * 「肌营养不良改变、脂肪浸润」rather than the radiologist's sentence —
 * and that is the right trade: it carries the clinical substance the
 * patient asked about while making leakage structurally impossible
 * rather than probabilistically unlikely.
 *
 * Extending this list is a deliberate, reviewable act. Add the phrase,
 * not a pattern that might match one.
 */
const CLINICAL_FINDING_TERMS: readonly string[] = [
  // Muscular dystrophy / FSHD core
  '肌营养不良改变',
  '肌营养不良',
  '脂肪浸润',
  '脂肪化',
  '肌肉萎缩',
  '肌萎缩',
  // THE BARE 萎缩, BECAUSE THE TWO COMPOUNDS ABOVE ARE NOT HOW A
  // RADIOLOGIST WRITES IT. 「肩胛带肌重度萎缩」 names the muscle and then
  // the change, so neither 肌肉萎缩 nor 肌萎缩 appears as a substring and
  // the finding was lost entirely — for the one region FSHD is named
  // after. `occurrenceIsAsserted` still rules out 未萎缩 / 萎缩不明显, and
  // the longer compounds still win the dedupe below, so this only adds
  // the occurrences the compounds could not reach.
  //
  // THAT LAST CLAUSE WAS NOT TRUE WHEN IT WAS WRITTEN. The dedupe keyed
  // on the severity qualifier, and a nested term reads a different one,
  // so 「肩胛带重度肌肉萎缩」 emitted 「重度肌肉萎缩、萎缩」 — this entry
  // duplicating the compound it was only ever meant to reach past. It is
  // true now: the dedupe asks about the match SPAN. See the span test in
  // `buildFindingsSummary`.
  '萎缩',
  '炎性改变',
  '水肿',
  '信号增高',
  '信号异常',
  '不对称',
  '受累',
  // NO 大致正常, AND NO SEVERITY QUALIFIERS.
  //
  // '未见明显异常' / '未见异常' were removed because they are
  // negation-shaped by construction and can never survive the clause
  // filter below. '大致正常' is the same claim in an assertion-shaped
  // wrapper and it survived that removal, so it went on being emitted
  // as a finding: 「肩胛带肌重度萎缩，余大致正常。」 — before the bare
  // 萎缩 above existed — reached the model as
  // 「影像/报告印象: 大致正常」, i.e. this platform telling a patient
  // their shoulder-girdle MRI was unremarkable because the vocabulary
  // missed the only finding on it. A report that asserts normality says
  // so through the ABSENCE of positive findings — findings_summary
  // returning null — which is the one form of this claim a vocabulary
  // miss cannot forge.
  //
  // '轻度' / '中度' / '重度' / '弥漫性' / '局灶性' were here as
  // INDEPENDENT terms and were emitted in this list's order, detached
  // from whatever they qualified: 「双侧大腿脂肪浸润轻度；肩胛带肌肉萎缩
  // 重度。」 came out as 「脂肪浸润、肌肉萎缩、轻度、重度」, which pairs
  // 脂肪浸润 with 轻度 by reading order and hands the model the severe
  // finding as the mild one. They live in SEVERITY_QUALIFIERS now and
  // are only emitted GLUED to the occurrence they sit against.
  // NO GENETICS VOCABULARY, AND THIS IS THE ONE SUBJECT THIS CHANNEL
  // HAS NOTHING TO ADD ABOUT.
  //
  // 'FSHD1', 'FSHD2', '4qA', '4qB', 'D4Z4', '重复单元缩短' and
  // '甲基化降低' were here, matched by substring against a sentence,
  // with no laboratory gate and no haplotype reader — and every
  // genetics cell on the same report reaches the same prompt block
  // through `projectOcrFields`, which reads it with the passport's own
  // readers (`parsePermissiveHaplotype`, `readSizeCell`), applies
  // `isLaboratoryGeneticReport` and applies the redaction mode. So this
  // list could only ever restate what those cells already say, and
  // being a substring match it restated them wrongly:
  //
  //   - 「采用4qA/4qB探针进行D4Z4重复单元缩短检测」 — a sentence naming
  //     the PROBES — emitted 「4qA、4qB、D4Z4、重复单元缩短」 while the
  //     structured haplotype cell on the same report, read by the
  //     passport's reader, correctly said `unspecified_haplotype`.
  //   - On a 病历摘要 the narrative asserted 「FSHD1、4qA、D4Z4、重复单
  //     元缩短」 while every structured genetics cell in the same block
  //     was stamped `not_read_off_a_laboratory_report`.
  //   - Strict mode withheld the raw haplotype cell and then reprinted
  //     4qA verbatim two lines above it.
  //
  // A finding this vocabulary can state about genetics is a finding the
  // structured channel states better; a finding it cannot is one this
  // platform has decided not to state at all. Do not add them back.
  // Cardiopulmonary — the other systems this cohort is monitored for.
  //
  // 障碍 / 心律不齐 / 传导阻滞 NAME AN ABNORMALITY; 射血分数 / 弥散功能 /
  // 膈肌 NAME A MEASUREMENT. The first three are findings on their own.
  // The last three are nouns whose entire clinical content is the
  // DIRECTION word that follows them, and that word is not in this
  // vocabulary and was never emitted, so:
  //
  //   - 「射血分数降低」 and 「射血分数升高」 — a failing heart and a
  //     normal-to-hyperdynamic one — both rendered
  //     「影像/报告印象: 射血分数」, byte-identical.
  //   - 「膈肌运动度正常范围」 rendered 「影像/报告印象: 膈肌」: a NORMAL
  //     diaphragm on a cohort screened for diaphragmatic weakness,
  //     delivered to the model as a diaphragm finding.
  //   - 「射血分数轻度降低」 rendered 「轻度射血分数」 — the severity
  //     binder gluing the qualifier that belonged to 降低 onto the bare
  //     noun, which is exactly the detached-severity reading
  //     SEVERITY_QUALIFIERS exists to prevent.
  //
  // They stay in the vocabulary, but only ever emitted BOUND to a
  // direction word from MEASUREMENT_DIRECTIONS. A noun that carries no
  // direction carries no finding, and is dropped.
  '限制性通气功能障碍',
  '通气功能障碍',
  '弥散功能',
  '射血分数',
  '心律不齐',
  '传导阻滞',
  '膈肌',
];

/** Cap on the assembled summary. Matched terms are short; a long
 *  result means the vocabulary matched too broadly. Applied by
 *  `capFindings`, which cuts on whole findings — never inside one. */
const FINDINGS_SUMMARY_MAX = 120;

/**
 * Negation markers. A term appearing after one of these inside the
 * same clause means the report is ruling the finding OUT.
 *
 * Substring matching alone inverts exactly the reports that matter
 * most: 「双侧大腿肌群未见明显脂肪浸润」would emit「脂肪浸润」, and
 * 「排除 FSHD1，未检出 D4Z4 重复单元缩短」would tell a patient who
 * just received a negative genetic result that they have FSHD1. The
 * raw impression is dropped by the redactor, so the model has nothing
 * to correct itself against — whatever this function says is the only
 * version of the report it will ever see.
 *
 * THIS LIST IS NO LONGER WHERE NEGATION IS DECIDED, and it is not
 * complete — five rounds of additions say it never will be. It is a
 * cheap first pass that discards a clause whole; the answer that has to
 * be right is computed per occurrence from NEGATION_ROOT_CHARS. The
 * 排除 of the second example above now comes from EXCLUSION_PATTERN,
 * because the negated spelling means the opposite.
 */
const NEGATION_MARKERS = [
  '未见',
  '未检出',
  '未发现',
  '未提示',
  '无明显',
  // BELT AND BRACES, ADDED WITH THE MATCH-SITE TEST BELOW. Each of
  // these is a form the list missed: 不明显 was here only as 无明显, and
  // 未受累 / 未累及 / 未及 are the bare 未 prefix, which no entry covered.
  // They are not what makes the negation correct — the computed scope
  // of NEGATION_ROOT_CHARS is — but a clause carrying one of them
  // asserts nothing, and killing it whole is cheaper than reading it.
  //
  // THE PRICE OF KILLING IT WHOLE, STATED. A listed marker discards its
  // clause even where the clause turns round afterwards, so
  // 「未见水肿而双侧大腿肌群脂肪浸润明显」 yields nothing while its
  // synonym 「没有水肿但双侧大腿肌群脂肪浸润明显」 — which only the
  // computed scope reads, and which honours NEGATION_SCOPE_RESETS —
  // yields 脂肪浸润. Two spellings of one sentence, two answers. It is a
  // dropped finding rather than an asserted negative, so it is the
  // direction this file is wrong in on purpose, but it is not a
  // property anything should rely on.
  '不明显',
  '未受累',
  '未累及',
  '未及',
  // 排除 IS NOT HERE, IT IS IN EXCLUSION_PATTERN. A bare list entry
  // killed the negated form too, and 不排除 / 不能排除 mean the OPPOSITE
  // of 排除 — see EXCLUSION_PATTERN.
  '阴性',
  '否认',
  '不支持',
];

/**
 * 排除 AND 除外 MEAN OPPOSITE THINGS DEPENDING ON ONE CHARACTER IN FRONT
 * OF THEM, AND THIS FILE READ BOTH HALVES WRONG.
 *
 * 不除外 / 未除外 are HEDGE_MARKERS — 「I cannot rule this out」, a
 * finding kept on the table. Their synonyms 不排除 / 不能排除 / 不能除外
 * were not, and the two spellings of one sentence rendered three
 * different ways on the shipped code:
 *
 *   「不除外脂肪浸润。」   → 「影像/报告印象: 脂肪浸润（不除外）」  ✓
 *   「不排除脂肪浸润。」   → no line at all — the bare 排除 entry above
 *                          killed the clause, so a finding the report
 *                          kept open vanished.
 *   「不能除外脂肪浸润。」 → 「影像/报告印象: 脂肪浸润」 — BYTE-IDENTICAL
 *                          to a definite finding, which is the exact
 *                          failure HEDGE_MARKERS says it exists to end.
 *
 * And the un-negated 除外, which really is a rule-out, was in neither
 * place: 「基本除外脂肪浸润。」 emitted 「影像/报告印象: 脂肪浸润」, the
 * excluded finding as the report's conclusion.
 *
 * So the exclusion verb kills its clause only where nothing negates it,
 * and the negated spellings are all in HEDGE_MARKERS.
 *
 * AND THE TWO SIDES OF THAT SENTENCE WERE TWO HAND-KEPT LISTS, WHICH
 * DISAGREED IN BOTH DIRECTIONS. The lookbehinds used to spell the
 * exempted prefixes out (「a negation root, optionally plus 能」) while
 * HEDGE_MARKERS spelled the same set out again as seven literals, and
 * NEGATION_ROOT_HEDGING spelled it out a third time as 「[能可]?」.
 * Executed against the family, three of the three lists were wrong:
 *
 *   「未能排除脂肪浸润。」     → 「影像/报告印象: 脂肪浸润」 — exempted by
 *                              the lookbehind, absent from the seven
 *                              literals, so it survived the clause
 *                              filter with NO hedge and reached the
 *                              model BYTE-IDENTICAL to a definite
 *                              finding. The 8th member of a set the
 *                              comment called complete at seven.
 *   「不可除外脂肪浸润。」     → no line at all — NEGATION_ROOT_HEDGING
 *                              knew 可, the lookbehind did not.
 *   「不能完全排除脂肪浸润。」 → no line at all. 完全 between the root and
 *   「不能完全除外脂肪浸润。」    the verb is how a Chinese radiologist
 *   「不完全排除脂肪浸润。」      actually writes this, and one word in
 *   「无法除外脂肪浸润。」        the middle put every spelling of it
 *                              outside all three lists at once.
 *   「脂肪浸润待除外。」       → no line at all, while its synonym
 *   「脂肪浸润待排除。」          「脂肪浸润待排」 rendered 「（待排）」.
 *
 * So the set is written ONCE, here, and the clause filter, the hedge
 * vocabulary and the occurrence-level root test are all DERIVED from
 * it. A spelling added below cannot be exempted from the kill without
 * also gaining a hedge to be emitted with, which is the invariant the
 * three lists asserted and none of them enforced.
 */
const EXCLUSION_VERBS: readonly string[] = ['除外', '排除'];

/**
 * Everything a report writes in front of an exclusion verb to mean the
 * OPPOSITE of it — 「I could not rule this out」, 「this is still to be
 * ruled out」. Both are findings kept on the table.
 *
 * 待 is not a negation and is here anyway: 待除外 / 待排除 is the same
 * statement as 待排, which HEDGE_MARKERS has always carried, and it
 * turns the verb the same way round. It is skipped when the occurrence
 * level derives its own view below, because 待 is not a negation root.
 */
const EXCLUSION_HEDGE_PREFIXES: readonly string[] = [
  '不',
  '未',
  '不能',
  '未能',
  '不可',
  '无法',
  '不完全',
  '不能完全',
  '未能完全',
  '待',
];

/** Every negated spelling of the exclusion verbs, as literals, so the
 *  hedge HEDGE_MARKERS emits is still a word from a list rather than
 *  one copied out of the report. */
const EXCLUSION_HEDGES: readonly string[] = EXCLUSION_HEDGE_PREFIXES.flatMap((prefix) =>
  EXCLUSION_VERBS.map((verb) => prefix + verb),
);

const EXCLUSION_PATTERN = new RegExp(
  '(?<!(?:' + EXCLUSION_HEDGE_PREFIXES.join('|') + '))(?:' + EXCLUSION_VERBS.join('|') + ')',
);

/**
 * A NEGATED HEDGE IS A RULE-OUT, AND IT IS THE STANDARD ONE.
 *
 * 不考虑 / 暂不考虑 / 可能性不大 are how a Chinese report says it is
 * RULING A FINDING OUT, and they are built out of the same words
 * HEDGE_MARKERS carries — 考虑, 可能 — so every one of them read as a
 * hedge and the finding came out asserted with a qualifier that says
 * the opposite of the report. None contains a listed negation marker,
 * and the 不 is not adjacent to the term, so neither the clause filter
 * nor the single-adjacent-character match-site test of the time caught
 * them either. Executed:
 *
 *   - 「双侧大腿肌群改变不考虑肌营养不良」 → 「影像/报告印象:
 *     肌营养不良（考虑）」
 *   - 「暂不考虑炎性改变」 → 「影像/报告印象: 炎性改变（考虑）」
 *   - 「脂肪浸润可能性不大」 → 「影像/报告印象: 脂肪浸润（可能）」
 *
 * The redactor drops the raw impression, so in all three the only
 * version of the report the model ever saw asserted the finding the
 * report had just excluded.
 *
 * These are patterns rather than list entries because the negation is
 * a CHARACTER against the hedge word rather than a word of its own:
 * 不/未/无/非 in front (不考虑, 未考虑, 不倾向于, 不可能), or a
 * diminishing tail behind 可能性 (可能性不大, 可能性较小).
 *
 * THE TAIL IS NOT ADJACENT TO 可能性 AND THE PATTERN MAY NOT ASSUME IT
 * IS. This read 可能性(?:不大|不高|较小|较低|小|低), which requires the
 * diminishing word to start at the character after 性, and an
 * intensifier is the ordinary way to write this rule-out:
 * 可能性极小 / 可能性极低 / 可能性甚小 / 可能性很小 / 可能性偏低 /
 * 可能性最小 / 可能性不太大 / 可能性并不大 all walked past it, and
 * every one of them then matched 可能 from HEDGE_MARKERS. Executed on
 * the shipped code, 「双侧大腿脂肪浸润可能性极小。」 reached the model as
 * 「影像/报告印象: 脂肪浸润（可能）」 in strict AND precise mode — the
 * finding the report had just ruled out, delivered as one still on the
 * table, with the raw impression dropped so nothing downstream could
 * correct it.
 *
 * The intensifier is optional and the polarity lives in the TAIL, so
 * 可能性极大 / 可能性很高 / 可能性较高 — the same intensifiers on an
 * ASSERTION — still survive the filter and are read as the hedges they
 * are. Only 小 / 低 / 不大 / 不高 (and 微乎其微) end a rule-out.
 *
 * 除外 IS ON THIS LIST NOW, AND WITH THE POLARITY THE OTHER WAY ROUND.
 * This block used to end 「不除外 / 未除外 are NOT matched — they are
 * hedges in their own right and 除外 is not one of the words below」,
 * and the second half of that stopped being true when EXCLUSION_PATTERN
 * arrived. The first half still is: for 考虑 / 倾向 / 可能 the BARE word
 * is the hedge and the negated one is the rule-out, and for 除外 / 排除
 * it is the reverse, so EXCLUSION_PATTERN matches the bare verb and
 * excludes the negated spellings, which live in HEDGE_MARKERS.
 *
 * A matching clause is killed whole, like every other negation here: a
 * clause that rules a finding out asserts nothing this channel wants.
 */
const NEGATION_PATTERNS: readonly RegExp[] = [
  /[不未无非](?:考虑|倾向|可能)/,
  /可能性(?:[极甚很颇较偏最稍略]?[小低]|(?:并|太)?不(?:太)?[大高]|微乎其微)/,
  EXCLUSION_PATTERN,
];

/**
 * A finding the report attributes to SOMEONE ELSE is not this patient's
 * imaging impression.
 *
 * 「患者母亲确诊肌营养不良，本人双侧大腿未见脂肪浸润。」 reached the model
 * as 「影像/报告印象: 肌营养不良」: the relative's diagnosis emitted as the
 * patient's own report conclusion, while the patient's own NEGATIVE
 * result in the next clause was correctly dropped — so the only thing
 * the model was told about this report was a fact about a different
 * person. The raw impression never reaches it, so there is nothing to
 * correct that against.
 *
 * A clause naming a third party is dropped whole rather than read: this
 * channel is 影像/报告印象, and a family history has a structured home
 * on the profile (`familyHistory`) that carries its own provenance.
 *
 * 其X IS A WHOLE FAMILY, NOT TWO ENTRIES. The list carried 其母 and 其父
 * and stopped there, so the identical construction with a sibling walked
 * straight through: executing 「其兄确诊肌营养不良，本人双侧大腿未见脂肪
 * 浸润。」 returned 「影像/报告印象: 肌营养不良」 — the BROTHER's
 * diagnosis emitted as this patient's imaging conclusion while their own
 * negative result in the next clause was correctly dropped, byte for
 * byte the failure above with a different relative. FSHD is autosomal
 * dominant and a proband is very often worked up because a sibling was
 * diagnosed first, so 其兄 / 其姐 / 其弟 / 其妹 are at least as common in
 * these reports as 其母.
 *
 * AND SPELLING OUT EIGHT RELATIVES DID NOT MAKE THE LIST A FAMILY
 * EITHER — the paragraph above asserted a whole family and the code
 * under it held a nuclear one, so the next ring of the pedigree walked
 * through exactly as 其兄 had. Executed, each returning
 * 「影像/报告印象: 肌营养不良」 with the patient's own negative in the
 * next clause correctly dropped, i.e. the relative's diagnosis as the
 * ONLY thing the model was told about the report:
 *
 *   「堂兄确诊肌营养不良，本人双侧大腿未见脂肪浸润。」
 *   「同胞确诊肌营养不良，本人双侧大腿未见脂肪浸润。」
 *   「其姑母确诊肌营养不良，本人双侧大腿未见脂肪浸润。」
 *   「表姐确诊肌营养不良。」「侄子确诊肌营养不良。」
 *   「舅舅确诊肌营养不良。」「姑姑确诊肌营养不良。」
 *   「先证者之弟确诊肌营养不良。」
 *
 * 同胞 is the clinical word for sibling, so it defeated the very
 * argument the paragraph above makes; and an autosomal dominant disease
 * is precisely the one whose reports name COLLATERAL relatives — the
 * affected cousin, aunt, uncle, nephew — which no enumeration of the
 * nuclear family can reach.
 *
 * So the possessive constructions (其X, X之Y, X的Y) and the collateral
 * prefixes (堂/表/胞 + a sibling word) are PATTERNS below rather than
 * entries, and the kinship morphemes that spell nothing else in
 * clinical Chinese — 侄 甥 舅 姨 叔 婶 嫂 — are bare markers.
 *
 * THIS IS STILL NOT EVERY RELATIVE, AND NOTHING HERE CLAIMS IT IS.
 * Chinese kinship is open-ended and a relative written in none of these
 * shapes still walks through; what the patterns buy is that the common
 * shapes no longer have to be discovered one funeral at a time. The
 * structured `familyHistory` on the profile, not this channel, is where
 * a family history is supposed to be read.
 *
 * THREE THINGS ARE DELIBERATELY LEFT ALIVE, EACH FOR A REASON:
 *   - Bare 先证者. The proband usually IS this patient, so killing on it
 *     would drop the patient's own findings. Only the possessive
 *     先证者之X / 先证者的X names someone else.
 *   - 姑息 / 姑且. 姑 is kinship everywhere else, but 姑息 is
 *     「palliative」 and killing it would drop a real clause.
 *   - Bare 孙. It is one of the commonest Chinese surnames, so only
 *     孙子 / 孙女 / 外孙 are read as kin; 孙 alone would kill the clause
 *     that names the reporting radiologist along with its finding.
 *
 * 其子 / 其女 cost a false kill on 其子宫: that drops a pelvic clause
 * this vocabulary has almost nothing to say about anyway, which is the
 * cheap direction of the trade. The X之Y / X的Y pattern deliberately
 * does NOT carry 子 / 女 for the same reason in reverse — 「的子宫」 is
 * a far likelier string than 「的子」 meaning a son.
 */
const THIRD_PARTY_MARKERS: readonly string[] = [
  '家族史',
  '家族中',
  '家系',
  '患者母亲',
  '患者父亲',
  '母亲',
  '父亲',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '兄弟',
  '姐妹',
  '儿子',
  '女儿',
  '同胞',
  '家属',
  '亲属',
  '家人',
  '亲人',
  '祖母',
  '祖父',
  '外祖母',
  '外祖父',
  '爷爷',
  '奶奶',
  '外公',
  '外婆',
  '姥姥',
  '姥爷',
  '侄',
  '甥',
  '舅',
  '姨',
  '叔',
  '婶',
  '嫂',
  '妻子',
  '丈夫',
  '配偶',
];

/** The kinship shapes an enumeration cannot hold. See the block above
 *  for what each one is for and what it deliberately spares. */
const THIRD_PARTY_PATTERNS: readonly RegExp[] = [
  // 其母 / 其兄 / 其女 / 其祖父 — the possessive that started this.
  /其[母父兄姐弟妹子女祖孙]/,
  // 先证者之弟 / 患者的姐姐 — the same possessive spelled out.
  /[之的][母父兄姐弟妹]/,
  // 堂兄 / 表姐 / 胞弟 — the collateral branches of the pedigree.
  /[堂表胞][兄弟姐妹哥姊]/,
  // 姑母 / 姑姑 / 其姑, but not 姑息 (palliative) or 姑且.
  /姑(?![息且])/,
  /伯[父母]|大伯/,
  /孙[子女]|外孙/,
];

/**
 * A finding the report places in the PAST is not the current
 * impression.
 *
 * Two shapes, one consequence:
 *   - 「既往水肿，现已吸收。」 emitted 「影像/报告印象: 水肿」 — a resolved
 *     finding stated as present.
 *   - 「前次报告示脂肪浸润，本次复查未见脂肪浸润。」 emitted
 *     「影像/报告印象: 脂肪浸润」 — the prior study's finding, asserted
 *     beside the current study that contradicts it, leaving the model a
 *     self-contradictory line to guess its way out of. The current
 *     study's answer (negative) was the half that got dropped.
 *
 * 原 IS THE BARE CHARACTER, WITH ONE EXCEPTION. As a plain substring it
 * is deliberately broad — 原有资料 / 原片 / 原报告 are all the past — and
 * a false kill costs a dropped finding, the direction this file is wrong
 * in on purpose everywhere else. But 原发性 is not the past, it is
 * 「primary」, and executing the bare marker over 「原发性肌营养不良改变」
 * returned nothing: the FSHD conclusion itself, dropped by a tense
 * marker, on a channel whose null result the model reads as 「the report
 * says nothing」. That one compound is worth reading before killing.
 */
const HISTORY_MARKERS: readonly string[] = ['既往', '曾', '外院', '前次', '上次'];
const HISTORY_PATTERNS: readonly RegExp[] = [/原(?!发)/];

/**
 * NOTHING GRADES A METHYLATION RESULT HERE. See the NO GENETICS
 * VOCABULARY block above: the genetics terms were stripped from
 * CLINICAL_FINDING_TERMS precisely so this channel could not restate
 * what the structured cells already say, and the severity qualifiers
 * walked straight past that decision — 「甲基化水平中度降低。」 emitted
 * 「影像/报告印象: 中度」, a bare grade of a methylation value, on a
 * platform that states no methylation boundary and therefore has no
 * grade to give. A clause about methylation is dropped before any term
 * is matched, so no future vocabulary addition can reopen the hole.
 */
const METHYLATION_MARKERS: readonly string[] = ['甲基化', 'methylation'];

/** Every clause-level kill, in one pass. Lower-cased before the test so
 *  the Latin entries match 「Methylation」 / 「METHYLATION」 too. */
const CLAUSE_KILL_MARKERS: readonly string[] = [
  ...NEGATION_MARKERS,
  ...THIRD_PARTY_MARKERS,
  ...HISTORY_MARKERS,
  ...METHYLATION_MARKERS,
];

const CLAUSE_KILL_PATTERNS: readonly RegExp[] = [
  ...NEGATION_PATTERNS,
  ...THIRD_PARTY_PATTERNS,
  ...HISTORY_PATTERNS,
];

const clauseIsDisqualified = (clause: string): boolean => {
  const lowered = clause.toLowerCase();
  if (CLAUSE_KILL_MARKERS.some((marker) => lowered.includes(marker))) return true;
  return CLAUSE_KILL_PATTERNS.some((pattern) => pattern.test(lowered));
};

/**
 * A HEDGE IS NOT A FINDING, AND IT IS NOT NOTHING EITHER.
 *
 * 待排 / 可疑 / 不除外 is how a radiologist writes 「I can see something
 * and I am not calling it」. Every one of them used to be flattened:
 * 「脂肪浸润待排」 and 「双侧大腿脂肪浸润明显」 produced BYTE-IDENTICAL
 * prompt lines (「影像/报告印象: 脂肪浸润」), so a patient whose MRI
 * raised a question was told by this platform that it had answered it.
 *
 * WE CARRY THE HEDGE RATHER THAN DROPPING THE CLAUSE. Dropping would be
 * the cheaper fix and it is the wrong one here: an equivocal muscle MRI
 * is the commonest early-FSHD imaging result, it is exactly the finding
 * that should send a patient to follow-up, and a null summary tells the
 * model nothing happened. The hedge word is emitted from THIS list, not
 * copied out of the text, so the deny-by-default property is unchanged
 * — a name still cannot ride out on it.
 *
 * 考虑 AND 可能 ARE BARE WORDS AND THEY NEGATE. Both are half of the
 * standard Chinese rule-out (不考虑 / 可能性不大), which is why
 * NEGATION_PATTERNS is tested against the clause BEFORE any of this
 * runs. Adding a marker to this list means checking whether the same
 * characters also spell a rule-out. The 除外 / 排除 family is the same
 * question answered the other way round — the BARE verb is the rule-out
 * and the NEGATED one is the hedge — and the whole of that family is
 * SPLICED IN FROM EXCLUSION_HEDGES rather than copied out here, so the
 * spellings this list carries and the spellings EXCLUSION_PATTERN
 * spares are the same strings by construction. Hand-copied, they were
 * not: see EXCLUSION_PATTERN for the four ways the two lists drifted,
 * including 未能排除, which the clause filter spared and this list did
 * not carry, so it reached the model with no hedge at all.
 *
 * MATCHED LONGEST FIRST, WHICH THE ORDER BELOW NO LONGER DECIDES. Two
 * callers take the FIRST entry that matches at a position
 * (`resolveHedge`, `readMeasurement`), and the family brings in
 * 待排除 while 待排 was already here — a prefix of it. Sorted by
 * descending length, 「脂肪浸润待排除」 resolves to 待排除 rather than
 * being read as 待排 with a stray 除 left over. Nothing else here is a
 * prefix of anything else, so the sort is the only thing keeping that
 * true as entries arrive.
 *
 * THE HEDGE IS RESOLVED AT THE OCCURRENCE, NOT OVER THE CLAUSE — see
 * `resolveHedge`. Resolved once per clause and glued onto every term in
 * it, a hedge on one finding downgraded its definite neighbours:
 * 「双侧大腿脂肪浸润明显伴可疑炎性改变」 rendered
 * 「影像/报告印象: 脂肪浸润（可疑）、炎性改变（可疑）」, and certainty is
 * what a clinician acts on.
 */
const HEDGE_MARKERS: readonly string[] = [
  '待排',
  '可疑',
  '疑似',
  // ONE STATEMENT, TWENTY SPELLINGS, AND NOT ONE OF THEM WRITTEN TWICE.
  // See EXCLUSION_PATTERN: this used to be seven literals kept by hand
  // against a lookbehind that spelled the same set out differently, and
  // the two drifted in both directions.
  ...EXCLUSION_HEDGES,
  '倾向于',
  '考虑',
  '可能',
  '建议随访',
].sort((a, b) => b.length - a.length);

/**
 * Severity, emitted ONLY glued to the occurrence it sits against.
 *
 * As independent vocabulary entries these were emitted in list order,
 * detached: 「双侧大腿脂肪浸润轻度；肩胛带肌肉萎缩重度。」 rendered as
 * 「脂肪浸润、肌肉萎缩、轻度、重度」, which any reader pairs by position
 * — handing the model 轻度脂肪浸润 and 重度肌肉萎缩 exactly inverted.
 * A detached 重度 carries no information; an incorrectly paired one is
 * worse than none.
 *
 * Chinese writes severity on either side of the finding (重度脂肪浸润,
 * 脂肪浸润重度); both are read, and both are emitted in the
 * qualifier-first form so two reports never disagree about word order.
 */
const SEVERITY_QUALIFIERS: readonly string[] = ['轻度', '中度', '重度', '弥漫性', '局灶性'];

/**
 * The measurement nouns from CLINICAL_FINDING_TERMS, and the direction
 * words that turn one into a finding. See the cardiopulmonary block
 * above for what these emitted before: opposite results as identical
 * bytes, and a normal diaphragm as a finding.
 *
 * The direction word is emitted from THIS list and never copied out of
 * the text, so the deny-by-default property is unchanged.
 *
 * THE QUALIFIER GOES BETWEEN THE NOUN AND THE DIRECTION, not in front
 * of the noun: 「射血分数轻度降低」, because 轻度 grades 降低 and not
 * 射血分数. That IS the qualifier-first rule of SEVERITY_QUALIFIERS,
 * applied to the word the qualifier actually belongs to — the same
 * reading that made 「轻度射血分数」 wrong.
 *
 * 运动 / 运动度 / 水平 / 值 / 功能 sit between the noun and its
 * direction often enough to be worth stepping over (膈肌运动受限), and
 * stepping over them cannot invert anything: the direction word still
 * has to be one of these, so 膈肌运动度正常范围 finds none and is
 * dropped.
 */
const MEASUREMENT_NOUNS: ReadonlySet<string> = new Set(['射血分数', '弥散功能', '膈肌']);
const MEASUREMENT_DIRECTIONS: readonly string[] = [
  '降低',
  '减低',
  '下降',
  '减退',
  '减弱',
  '受限',
  '升高',
  '增高',
  '抬高',
  '上抬',
  '上移',
  '麻痹',
];
const MEASUREMENT_BRIDGES: readonly string[] = ['运动度', '运动', '水平', '功能', '值'];

/**
 * Clause boundaries. Negation scopes to its own clause: in
 * 「见脂肪浸润，未见肌肉萎缩」the negation must not swallow the first
 * half.
 *
 * WHITESPACE IS A CLAUSE BOUNDARY, because OCR routinely gives us one.
 * Chinese radiology impressions are typeset with spaces between
 * clauses at least as often as with punctuation, and the OCR keeps
 * whatever the page had — spaces, full-width spaces, tabs. Without them
 * in this set the whole impression is ONE clause, so a single negated
 * clause anywhere in it trips the whole-clause marker filter below and
 * every asserted finding in the string is dropped with it:
 * 「双侧大腿脂肪浸润明显 未见肌肉萎缩」 — a report of definite fat
 * infiltration — produced no findings_summary at all, and the redactor
 * drops the raw impression, so the model was left with a report it
 * could see the type of and nothing else.
 *
 * BUT WHITESPACE IS ONLY A BOUNDARY WHERE THE PHRASE ALREADY ENDED —
 * see `healWrappedClauseMarkers`, which runs first.
 */
/** The punctuation half of the boundary set, named separately because
 *  `endsMidKillPhrase` has to ask where the CURRENT clause began — a
 *  negation two clauses back is not dangling over this wrap — and the
 *  whitespace half is exactly what is in question at that point. One
 *  definition, so the two tests cannot drift apart. */
const CLAUSE_PUNCTUATION = '，,。.；;、';
const CLAUSE_SPLIT = new RegExp('[' + CLAUSE_PUNCTUATION + '\\r\\n\\t 　]');

/**
 * THE NEGATION IS COMPUTED AT THE MATCH SITE, not looked up over the
 * clause.
 *
 * A marker list scanned over a whole clause answers 「does this clause
 * contain a negating word」, and Chinese negates a term by touching it:
 * the two commonest forms in these reports are a bare 未 glued to the
 * front (未受累) and a qualifier glued to the back (脂肪浸润不明显), and
 * neither contains a listed marker. Both were therefore asserted as
 * present. Rendered, 「双侧股四头肌未受累，肩胛带肌未见异常」 came out as
 * 「影像/报告印象: 受累」 and 「大腿后群脂肪浸润不明显」 as
 * 「影像/报告印象: 脂肪浸润」 — the ruled-OUT finding, reported as the
 * report's conclusion. The redactor drops the raw impression, so this
 * summary is the ONLY version of the report the model ever sees, in
 * both modes; there is nothing downstream to correct it against.
 *
 * AND THE MATCH-SITE TEST WAS A SINGLE ADJACENT CHARACTER, WHICH IS
 * THE SAME MISTAKE ONE SIZE DOWN. It asked only about `clause[start-1]`,
 * so it saw 未受累 and 无水肿 and nothing else: every Chinese negation
 * that puts a verb between the negating character and the finding —
 * which is most of them — walked through both this test and the marker
 * list above and was emitted as the report's conclusion. Executed, on
 * the shipped code:
 *
 *   「没有脂肪浸润。」   → 「影像/报告印象: 脂肪浸润」
 *   「未出现肌肉萎缩。」 → 「影像/报告印象: 肌肉萎缩」
 *   「不伴水肿。」       → 「影像/报告印象: 水肿」
 *   「未合并炎性改变。」 → 「影像/报告印象: 炎性改变」
 *   「未伴水肿。」       → 「影像/报告印象: 水肿」
 *   「无明确脂肪浸润。」 → 「影像/报告印象: 脂肪浸润」
 *
 * 无明确 is the one that says the list was never going to be finished:
 * NEGATION_MARKERS carries 无明显 and 不明显, its two nearest neighbours,
 * and radiology writes 明确 at least as often as 明显.
 *
 * THIS IS THE FIFTH NEGATION-VOCABULARY MISS IN FIVE ROUNDS, SO THE
 * VOCABULARY IS THE DEFECT. The scope of a negation is now COMPUTED
 * from the span between the negating character and the term rather than
 * looked up: see `negationScopes`. A negation root — 未 / 无 / 不 / 非 /
 * 没 / 否, the closed set Chinese actually builds negations out of —
 * that reaches a finding across a short span of ordinary predicate
 * material negates that finding and everything after it in the clause.
 * No entry has to be added for the next 未探及 / 未描述 / 不合并 / 无确切.
 *
 * WHAT COSTS THE STRUCTURE MONEY IS THE OPPOSITE DIRECTION: a negating
 * character that is part of a WORD rather than an operator. 肌营养不良,
 * 心律不齐 and 不对称 are the vocabulary's own entries and would have
 * negated everything written after them; 不同程度 (「双侧大腿肌群不同程
 * 度脂肪浸润」 — a definite positive finding), 非特异性 and 不完全性
 * are the same thing outside the vocabulary. Both are excluded by
 * `negationScopes`, the first structurally (a root inside a matched term
 * span is part of that term's name, so adding a vocabulary entry that
 * contains 不 cannot reopen this) and the second by
 * NEGATION_ROOT_LEXICAL, which is a list — a much smaller and much more
 * closed one than the negation vocabulary it replaces, because it names
 * adjectives rather than verbs.
 */
const NEGATION_ROOT_CHARS: ReadonlySet<string> = new Set(['未', '无', '非', '不', '没', '否']);

/**
 * How far a negation root may reach to pick up its first finding.
 *
 * The material between them is the predicate it negates plus, very
 * often, the region the report is talking about: 未见 / 没有 / 不伴 /
 * 未合并 is one to three characters, and 双侧大腿肌群 / 双侧肩胛带肌 /
 * 明显的 is another six to eight. Executed at five, the predicates were
 * caught and the region was not, so
 * 「没有双侧大腿肌群脂肪浸润。」 → 「影像/报告印象: 脂肪浸润」 and
 * 「未出现双侧肩胛带肌肉萎缩。」 → 「影像/报告印象: 肌肉萎缩」 — the
 * same inversion the reach exists to stop, moved one topic phrase to
 * the right.
 *
 * Twelve covers the region phrases these reports actually write. What
 * it costs is the other direction — a clause whose 不 is lexical, is
 * not one of the NEGATION_ROOT_LEXICAL adjectives and is not inside a
 * vocabulary term will now drop a finding up to twelve characters
 * behind it (「双侧大腿肌群显示不满意伴脂肪浸润」). That is a dropped
 * finding rather than an asserted negative, which is the direction this
 * file is wrong in on purpose.
 */
const NEGATION_REACH = 12;

/**
 * Root characters that are the first character of a WORD, not a
 * negation operator. See NEGATION_ROOT_CHARS: these are the adjectives,
 * and an adjective negates the syllable behind it rather than the
 * finding in front of it.
 *
 * 不完 is 不完全性右束支传导阻滞 — an incomplete block IS a block, and
 * reading the 不 as an operator would have deleted the finding the line
 * exists to report.
 */
const NEGATION_ROOT_LEXICAL: readonly string[] = [
  '不同',
  '不均',
  '不规',
  '不完',
  '不典',
  '不清',
  '不佳',
  '不良',
  '不对',
  '不齐',
  '不适',
  '不定',
  '非特',
  '非典',
  '非均',
  '无创',
  '无痛',
];

/**
 * A root followed by 除外 / 排除 is a HEDGE, not a negation: 不除外 and
 * 未除外 say the finding may be there, and both are in HEDGE_MARKERS.
 * Reading their 不 / 未 as an operator would invert the one construction
 * radiologists use to keep a finding on the table.
 *
 * THE CLAUSE FILTER SPARING A SPELLING BUYS NOTHING IF THIS KILLS IT AT
 * THE OCCURRENCE. This was a third hand-kept copy of the exclusion
 * family — 「[能可]?」 — and it did not agree with either of the other
 * two: it knew the 可 of 不可除外 that EXCLUSION_PATTERN did not, and
 * neither knew the 完全 of 不能完全排除. So 「不能完全排除脂肪浸润」
 * survives the clause filter only if the 不 at position 0 is also read
 * as part of the hedge here; otherwise its computed scope covers
 * 脂肪浸润 and the finding is dropped one layer further down, with the
 * clause filter's exemption having achieved nothing visible.
 *
 * Tested against the text AFTER the root character, so it is
 * EXCLUSION_HEDGE_PREFIXES with that character removed — and only the
 * prefixes that START with a negation root, because 待 never reaches
 * this test. The empty tail that 不除外 / 未除外 leave behind is what
 * used to be the 「?」 on 「[能可]?」.
 */
const EXCLUSION_HEDGE_ROOT_TAILS: readonly string[] = [
  ...new Set(
    EXCLUSION_HEDGE_PREFIXES.filter((prefix) => NEGATION_ROOT_CHARS.has(prefix[0])).map((prefix) =>
      prefix.slice(1),
    ),
  ),
].sort((a, b) => b.length - a.length);

const NEGATION_ROOT_HEDGING = new RegExp(
  '^(?:' + EXCLUSION_HEDGE_ROOT_TAILS.join('|') + ')(?:' + EXCLUSION_VERBS.join('|') + ')',
);

/**
 * Where a negation's scope ENDS before the clause does. Chinese resets
 * polarity with a contrastive: 「左侧无水肿而右侧水肿明显」 is one
 * clause, and the 水肿 after 而 is asserted. Without this the rightward
 * scope would swallow it.
 */
const NEGATION_SCOPE_RESETS: ReadonlySet<string> = new Set(['而', '但', '然', '余', '另']);

const NEGATION_SUFFIXES: readonly string[] = ['不明显', '未见', '阴性', '正常'];

/**
 * A finding the report says has RESOLVED is not a current finding.
 * 「水肿已基本吸收」 was emitted as 「影像/报告印象: 水肿」.
 *
 * 消失 IS THE MOST DIRECT FORM AND WAS THE ONE MISSING. 吸收 / 消退 /
 * 好转 / 恢复 all say a finding is receding; 消失 is how a Chinese
 * radiologist writes that it is GONE, and executing 「双侧大腿水肿已消
 * 失」 returned 「影像/报告印象: 水肿」 — the report saying the oedema
 * has cleared, delivered to the model as oedema present, with the raw
 * impression dropped by the redactor so nothing downstream disagrees.
 * 缓解 and 纠正 are the same statement for a symptom and for a rhythm
 * (「心律不齐已纠正」 → 「影像/报告印象: 心律不齐」).
 */
const RESOLUTION_SUFFIXES: readonly string[] = [
  '吸收',
  '消退',
  '好转',
  '恢复',
  '消失',
  '缓解',
  '纠正',
];

/** Adverbs that sit between the finding and the word that kills it —
 *  「水肿已基本吸收」,「信号增高大致正常」. Stripped before the suffix
 *  test, or the suffix list would only ever match the bare forms
 *  nobody writes. */
const SUFFIX_LEAD_ADVERBS: readonly string[] = [
  '已经',
  '已',
  '基本',
  '大部分',
  '大致',
  '完全',
  '明显',
  '较前',
];

const OCCURRENCE_KILL_SUFFIXES: readonly string[] = [...NEGATION_SUFFIXES, ...RESOLUTION_SUFFIXES];

/**
 * OCR LINE-WRAPS INSIDE PHRASES, AND A WRAP IS NOT A CLAUSE BOUNDARY.
 *
 * Adding whitespace to CLAUSE_SPLIT bought the space-separated clauses
 * OCR really does give us, and paid for them with the exact inversion
 * this whole function exists to prevent. 「未见明显脂肪浸润」 typeset
 * across two lines arrives as 「双侧大腿肌群未见\n明显脂肪浸润」 — one
 * ordinary two-line impression, not two clauses. Split on the wrap, the
 * negation marker becomes a clause that asserts nothing (correctly
 * killed, to no effect) and the RULED-OUT finding in the next fragment
 * is emitted as the report's conclusion: executing that string returned
 * 「影像/报告印象: 脂肪浸润」 for a report saying there is none. Same for
 * a space instead of a newline, which is what a justified two-column
 * page gives.
 *
 * So a whitespace run is healed away — treated as the wrap it is —
 * whenever the text to its LEFT ends mid-kill-phrase: on a clause-kill
 * marker or kinship pattern (未见 / 其母 / 堂兄 / 既往 / 甲基化 …) — see
 * THIRD_PARTY_WRAP_PATTERNS for the pattern half — on the 原 whose 原发
 * lookahead cannot see across a break, or on a NEGATION THAT HAS NOT YET REACHED
 * ITS OBJECT — see `endsInReachingNegation`. Everything else keeps its
 * boundary, so 「双侧大腿脂肪浸润明显 未见肌肉萎缩」 — whitespace AFTER a
 * completed finding, before the marker — still splits and still yields
 * 脂肪浸润.
 *
 * ONLY THE MARKERS THAT GOVERN WHAT COMES AFTER THEM. 不明显 / 未受累 /
 * 未累及 / 阴性 negate the finding to their LEFT, which is already in
 * the same fragment, so a wrap cannot strand them from anything and
 * healing there would only swallow the NEXT clause: 「基因检测阴性 双侧
 * 大腿脂肪浸润」 would lose a definite finding to a marker that was
 * never about it. They are excluded — and none of them is reachable
 * through `endsInReachingNegation` either, because each has already met
 * its object by the time the wrap arrives.
 *
 * A wrap we heal wrongly costs a dropped finding; a wrap we split
 * wrongly asserts the negative of one. This file is wrong in the first
 * direction on purpose — and until `endsInReachingNegation` existed it
 * was wrong in the SECOND direction for every negation the file had
 * just finished moving off the marker list. See that function.
 */
const WHITESPACE_RUN = /[\r\n\t 　]+/g;
const TRAILING_KILL_MARKERS: readonly string[] = ['不明显', '未受累', '未累及', '阴性'];
const WRAP_DANGLING_MARKERS: readonly string[] = [
  ...CLAUSE_KILL_MARKERS.filter((marker) => !TRAILING_KILL_MARKERS.includes(marker)),
  '原',
  // The exclusion verbs govern rightward like the rest of this list,
  // and they are no longer on CLAUSE_KILL_MARKERS — see
  // EXCLUSION_PATTERN — so a wrap between 排除 and its object would
  // split the rule-out off the finding it rules out and emit it.
  '排除',
  '除外',
];

/**
 * The kinship kills that are PATTERNS govern rightward exactly like the
 * markers above — 「其母\n确诊肌营养不良」 is one wrapped sentence — and
 * a marker list cannot see them. Moving 其母 / 其父 / 其兄 … off
 * THIRD_PARTY_MARKERS and into THIRD_PARTY_PATTERNS silently took them
 * out of this heal, and executing 「其母\n确诊肌营养不良」 returned
 * 「影像/报告印象: 肌营养不良」 again — the mother's diagnosis as the
 * patient's imaging conclusion, the very first failure in this file's
 * third-party block, reopened by the fix for its successor.
 *
 * Each pattern is re-anchored to the END of the left-hand text. The
 * group is explicit because these patterns contain alternations, and
 * 「伯[父母]|大伯$」 would anchor the last branch only.
 */
const THIRD_PARTY_WRAP_PATTERNS: readonly RegExp[] = THIRD_PARTY_PATTERNS.map(
  (pattern) => new RegExp('(?:' + pattern.source + ')$'),
);

/**
 * THE HEAL HAS TO BE COMPUTED FOR THE SAME REASON THE SCOPE IS.
 *
 * The marker list above answers 「does the left-hand text end on a
 * negating WORD」, and the negations this file reads are no longer
 * words — `NEGATION_ROOT_CHARS` moved them to a root plus whatever
 * predicate the radiologist happened to write. Every one of those ends
 * on an ordinary character (没有, 不伴, 未出现, 未合并, 无明确 end on
 * 有 / 伴 / 现 / 并 / 确), so the list matched none of them and the bare
 * single-character test matched none of them either: it asked only
 * about `before[before.length - 1]`, which is a root only when the wrap
 * falls INSIDE 未见. Executed on the shipped code, through the
 * retriever and the strict renderer:
 *
 *   「双侧大腿肌群没有明显\n脂肪浸润」  → 「影像/报告印象: 脂肪浸润」
 *   「双侧大腿肌群没有　明显脂肪浸润」  → 「影像/报告印象: 脂肪浸润」
 *   「双侧大腿脂肪浸润明显\n不伴\n水肿」→ 「影像/报告印象: 脂肪浸润、水肿」
 *   「未出现\n肌肉萎缩」                → 「影像/报告印象: 肌肉萎缩」
 *   「未合并\n炎性改变」                → 「影像/报告印象: 炎性改变」
 *   「无明确\n脂肪浸润」                → 「影像/报告印象: 脂肪浸润」
 *
 * — the ruled-OUT finding as the report's conclusion, in both redaction
 * modes, with the raw impression dropped so nothing downstream
 * disagrees. That is the second direction, the one the block above says
 * this file is never wrong in. The unwrapped spelling of every one of
 * those strings returns null.
 *
 * So the question asked is the one `negationScopes` asks, minus the
 * half that lives on the other side of the break: is there a negation
 * root in the current clause that has NOT yet met an object? Same three
 * exemptions — a root inside a matched term is part of that term's name
 * (肌营养不良, 心律不齐), a root beginning a lexical adjective
 * (NEGATION_ROOT_LEXICAL) or a hedge (NEGATION_ROOT_HEDGING) is not an
 * operator — plus: a root that has already reached a vocabulary term,
 * or whose polarity a contrastive (NEGATION_SCOPE_RESETS) has already
 * reset, is finished with, and a root further back than NEGATION_REACH
 * could not govern across the wrap even if it were healed.
 *
 * WHAT THIS COSTS, STATED. A negation whose object is real but is not
 * in this vocabulary reads as still-reaching, so the wrap heals, the
 * fragments merge and a definite finding on the far side is dropped:
 * 「双侧大腿肌群未见明显异常 肩胛带肌脂肪浸润」 and
 * 「双侧大腿肌群未见积液 肩胛带肌脂肪浸润」 both returned 脂肪浸润 before
 * and return null now — 异常 and 积液 are objects this vocabulary
 * deliberately does not carry (see the 未见明显异常 note in
 * CLINICAL_FINDING_TERMS), so nothing here can see that the 未见 is
 * already finished with them. That is not a new hole: NEGATION_REACH
 * already drops those findings for the same two sentences written
 * without the space, so the space-separated spelling now answers the
 * same way instead of differently. And it is a dropped finding, which
 * is the direction stated above — the alternative, a closure list of
 * normality nouns, buys them back by splitting 「未见异常\n信号增高」 and
 * asserting the increased signal the report just ruled out.
 */
const endsInReachingNegation = (before: string): boolean => {
  // A LEFTWARD MARKER HAS ALREADY MET ITS OBJECT, and its object is on
  // this side of the wrap. 不明显 / 未累及 / 未受累 / 阴性 all end on a
  // negation root plus a couple of characters that name no vocabulary
  // term, so the reaching test below would read every one of them as
  // still looking for something and heal a boundary the block above
  // spends a paragraph saying must stay: 「大腿萎缩不明显 肩胛带肌重度萎
  // 缩」 would merge and lose 重度萎缩 to a 不明显 that was never about
  // it. Same list, same reason, one test earlier.
  if (TRAILING_KILL_MARKERS.some((marker) => before.endsWith(marker))) return false;
  let clauseStart = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (CLAUSE_PUNCTUATION.includes(before[i])) clauseStart = i + 1;
  }
  const segment = before.slice(clauseStart);
  const terms = termOccurrences(segment);
  for (let i = 0; i < segment.length; i += 1) {
    if (!NEGATION_ROOT_CHARS.has(segment[i])) continue;
    if (segment.length - (i + 1) > NEGATION_REACH) continue;
    if (terms.some((term) => i >= term.start && i < term.end)) continue;
    const after = segment.slice(i);
    if (NEGATION_ROOT_LEXICAL.some((word) => after.startsWith(word))) continue;
    if (NEGATION_ROOT_HEDGING.test(segment.slice(i + 1))) continue;
    if (terms.some((term) => term.start > i)) continue;
    if (
      after
        .slice(1)
        .split('')
        .some((char) => NEGATION_SCOPE_RESETS.has(char))
    )
      continue;
    return true;
  }
  return false;
};

const endsMidKillPhrase = (before: string): boolean => {
  if (before.length === 0) return false;
  const lowered = before.toLowerCase();
  if (WRAP_DANGLING_MARKERS.some((marker) => lowered.endsWith(marker))) return true;
  if (THIRD_PARTY_WRAP_PATTERNS.some((pattern) => pattern.test(lowered))) return true;
  return endsInReachingNegation(before);
};

const healWrappedClauseMarkers = (raw: string): string =>
  raw.replace(WHITESPACE_RUN, (whitespace, offset: number) =>
    endsMidKillPhrase(raw.slice(0, offset)) ? '' : whitespace,
  );

const stripLeadingAdverbs = (text: string): string => {
  let rest = text;
  for (;;) {
    const adverb = SUFFIX_LEAD_ADVERBS.find((a) => rest.startsWith(a));
    if (!adverb) return rest;
    rest = rest.slice(adverb.length);
  }
};

/**
 * What a measurement noun is carrying: its direction word, any hedge
 * written INSIDE the noun-to-direction span, and how many characters
 * past the noun the whole phrase ends. Null when no direction word is
 * reached — see MEASUREMENT_DIRECTIONS for why that drops the finding.
 *
 * Steps over the adverbs, the severity qualifier and the measurement
 * bridges that can sit between the noun and its direction.
 *
 * AND OVER THE HEDGE, WHICH IT DID NOT. 「射血分数可能降低」 puts the
 * hedge exactly where this walk stopped, so `rest` began 可能降低, no
 * direction matched, and an equivocal ejection fraction produced no
 * 影像/报告印象 line at all — a cardiac finding on a cohort screened for
 * cardiomyopathy, deleted. It is carried out as `hedge` instead.
 *
 * `end` EXISTS BECAUSE THE HEDGE SCOPE NEEDS IT. The caller used to ask
 * `resolveHedge` what was written behind the NOUN while emitting a
 * phrase that runs on through the bridge and the direction word, so a
 * hedge written behind the direction — the only place Chinese can put
 * one for these nouns — was never in the window that was searched:
 * 「射血分数降低待排」 rendered 「影像/报告印象: 射血分数降低」,
 * byte-identical to the definite 「射血分数降低」. That is the failure
 * HEDGE_MARKERS says it exists to end, on the three nouns whose entire
 * clinical content is the direction word.
 */
interface MeasurementReading {
  direction: string;
  hedge: string;
  end: number;
}

const readMeasurement = (after: string): MeasurementReading | null => {
  let rest = after;
  let hedge = '';
  for (;;) {
    const before = rest;
    rest = stripLeadingAdverbs(rest);
    const severity = SEVERITY_QUALIFIERS.find((q) => rest.startsWith(q));
    if (severity) rest = rest.slice(severity.length);
    const bridge = MEASUREMENT_BRIDGES.find((b) => rest.startsWith(b));
    if (bridge) rest = rest.slice(bridge.length);
    const marker = HEDGE_MARKERS.find((m) => rest.startsWith(m));
    if (marker) {
      if (!hedge) hedge = marker;
      rest = rest.slice(marker.length);
    }
    if (rest === before) break;
  }
  const direction = MEASUREMENT_DIRECTIONS.find((d) => rest.startsWith(d));
  if (!direction) return null;
  return { direction, hedge, end: after.length - rest.length + direction.length };
};

/**
 * ONE OCCURRENCE IS THE UNIT OF READING.
 *
 * This function used to be `assertedOccurrence(clause, term)`, which
 * returned the FIRST asserted occurrence of a term and stopped. One
 * term, one answer per clause — so a clause carrying the same finding
 * twice at two different severities emitted only the first of them:
 * 「右侧轻度脂肪浸润伴左侧重度脂肪浸润」 rendered
 * 「影像/报告印象: 轻度脂肪浸润」, the MILD reading kept and the SEVERE
 * one gone, with the raw impression dropped by the redactor so nothing
 * downstream disagrees. Two comments asserted that both were kept and
 * that 「the span test above has already settled it」; the span test
 * never ran on the second occurrence because the search never reached
 * it.
 *
 * So the clause is enumerated instead: every occurrence of every
 * vocabulary term, and negation, hedge, severity and direction are each
 * read off the characters around THAT occurrence. The context tests
 * below take a span rather than a term for the same reason.
 */
interface TermOccurrence {
  term: string;
  start: number;
  end: number;
}

/**
 * Every vocabulary occurrence in the clause, in READING ORDER, longest
 * first where two start together.
 *
 * Reading order is the order the report itself puts them in, and it is
 * the order the qualifiers are bound in. `buildFindingsSummary` has
 * claimed to emit reading order since the severity binder landed and
 * did not: it looped over `CLINICAL_FINDING_TERMS`, so within a clause
 * the output came out in VOCABULARY order — 「双侧大腿水肿伴脂肪浸润」
 * rendered 「影像/报告印象: 脂肪浸润、水肿」, the two findings swapped
 * against the sentence they were read from. It is reading order now.
 */
const termOccurrences = (clause: string): TermOccurrence[] => {
  const found: TermOccurrence[] = [];
  for (const term of CLINICAL_FINDING_TERMS) {
    for (let from = 0; from <= clause.length - term.length; ) {
      const at = clause.indexOf(term, from);
      if (at === -1) break;
      found.push({ term, start: at, end: at + term.length });
      from = at + 1;
    }
  }
  return found.sort((a, b) => a.start - b.start || b.end - a.end);
};

/**
 * The character ranges of this clause that a negation governs.
 *
 * COMPUTED, NOT LOOKED UP — see NEGATION_ROOT_CHARS for why the list
 * approach is the defect rather than any particular missing entry.
 * Every negation root in the clause is offered the job of operator and
 * three tests decide whether it has it:
 *
 *   1. A root INSIDE a matched vocabulary span is part of a finding's
 *      NAME (肌营养不良, 心律不齐, 不对称), not an operator over what
 *      follows it. This is why the exclusion cannot rot: a vocabulary
 *      entry containing 不 exempts itself.
 *   2. A root that begins a lexical adjective (NEGATION_ROOT_LEXICAL)
 *      or a hedge (NEGATION_ROOT_HEDGING) is likewise not an operator.
 *   3. A root that is an operator has to REACH a finding: the first
 *      vocabulary occurrence at or after it must start within
 *      NEGATION_REACH characters, which is the length of the predicate
 *      it negates. A root with nothing but prose after it governs
 *      nothing.
 *
 * A root that passes all three governs from that first finding to the
 * end of the clause or to the next contrastive (NEGATION_SCOPE_RESETS),
 * whichever comes first. Rightward to the clause end rather than to the
 * next term, because Chinese conjoins the objects of one negated verb
 * (「没有脂肪浸润及肌肉萎缩」) far more often than it restarts polarity
 * without a contrastive, and stopping at the first object would emit
 * the second one as asserted — the inversion this whole file exists to
 * prevent.
 */
interface NegationScope {
  start: number;
  end: number;
}

const negationScopes = (clause: string, terms: readonly TermOccurrence[]): NegationScope[] => {
  const scopes: NegationScope[] = [];
  for (let i = 0; i < clause.length; i += 1) {
    if (!NEGATION_ROOT_CHARS.has(clause[i])) continue;
    if (terms.some((term) => i >= term.start && i < term.end)) continue;
    const after = clause.slice(i);
    if (NEGATION_ROOT_LEXICAL.some((word) => after.startsWith(word))) continue;
    if (NEGATION_ROOT_HEDGING.test(clause.slice(i + 1))) continue;
    const governed = terms.find((term) => term.start > i);
    if (!governed || governed.start - (i + 1) > NEGATION_REACH) continue;
    let end = clause.length;
    for (let j = governed.end; j < clause.length; j += 1) {
      if (NEGATION_SCOPE_RESETS.has(clause[j])) {
        end = j;
        break;
      }
    }
    scopes.push({ start: governed.start, end });
  }
  return scopes;
};

/**
 * Whether the clause asserts the finding AT THIS OCCURRENCE — a term
 * inside a negation's computed scope, or followed by 不明显 / 未见 /
 * 阴性 / 正常 / a resolution verb, is ruled out where it stands even
 * though its clause survived the marker filter. See NEGATION_ROOT_CHARS
 * for why the scope is computed and `negationScopes` for how.
 */
const occurrenceIsAsserted = (
  clause: string,
  at: TermOccurrence,
  scopes: readonly NegationScope[],
): boolean => {
  if (scopes.some((scope) => at.start >= scope.start && at.start < scope.end)) return false;
  const after = stripLeadingAdverbs(clause.slice(at.end));
  return !OCCURRENCE_KILL_SUFFIXES.some((suffix) => after.startsWith(suffix));
};

/** Every hedge occurrence in the clause, with its position, so
 *  `resolveHedge` can ask which findings a given hedge is in front of
 *  rather than only whether the clause contains one. */
const hedgeOccurrences = (clause: string): TermOccurrence[] => {
  const found: TermOccurrence[] = [];
  for (const marker of HEDGE_MARKERS) {
    for (let from = 0; from <= clause.length - marker.length; ) {
      const at = clause.indexOf(marker, from);
      if (at === -1) break;
      found.push({ term: marker, start: at, end: at + marker.length });
      from = at + 1;
    }
  }
  return found;
};

/** Steps over the adverbs and the severity qualifier that can sit
 *  between a finding and the hedge written behind it
 *  (「脂肪浸润明显待排」). */
const stripLeadingHedgeLead = (text: string): string => {
  let rest = text;
  for (;;) {
    let next = stripLeadingAdverbs(rest);
    const severity = SEVERITY_QUALIFIERS.find((q) => next.startsWith(q));
    if (severity) next = next.slice(severity.length);
    if (next === rest) return rest;
    rest = next;
  }
};

/**
 * The hedge governing THIS occurrence, or ''.
 *
 * A HEDGE HAS A DIRECTION, which is the whole of the fix. Chinese
 * writes it either in front of the finding it qualifies (可疑炎性改变,
 * 考虑肌营养不良改变, 不除外水肿) or immediately behind it
 * (脂肪浸润待排). So a hedge governs what FOLLOWS it in its clause, plus
 * the finding it is written directly against; a finding that precedes
 * it is not in its scope. That is what stops
 * 「双侧大腿脂肪浸润明显伴可疑炎性改变」 from downgrading the definite
 * 脂肪浸润 to 脂肪浸润（可疑）.
 *
 * BEHIND MEANS BEHIND THE PHRASE THIS FILE EMITS, NOT BEHIND THE TERM.
 * `spanEnd` is where the emitted finding actually ends, and for the
 * MEASUREMENT_NOUNS that is several characters past `at.end` — the
 * bridge and the direction word are inside the phrase. Searching from
 * `at.end` looked at 「降低待排」, found no hedge at position zero, and
 * rendered 「射血分数降低待排」 as 「影像/报告印象: 射血分数降低」: an
 * equivocal ejection fraction, byte-identical to a definite one, on the
 * three nouns whose whole content is the direction word. Callers pass
 * the end of the span they are about to print.
 *
 * WHAT THIS DOES NOT SETTLE, stated rather than implied: a hedge
 * written behind finding A is also in front of a finding B later in the
 * SAME clause, and B is hedged too. Chinese normally closes the clause
 * after 待排 and starts the next finding past the punctuation, so this
 * costs an over-cautious reading of an uncommon construction — the
 * direction this file is wrong in on purpose.
 */
const resolveHedge = (
  clause: string,
  hedges: readonly TermOccurrence[],
  at: TermOccurrence,
  spanEnd: number,
): string => {
  const behind = stripLeadingHedgeLead(clause.slice(spanEnd));
  const trailing = HEDGE_MARKERS.find((marker) => behind.startsWith(marker));
  if (trailing) return trailing;
  let nearest: TermOccurrence | null = null;
  for (const hedge of hedges) {
    if (hedge.end <= at.start && (nearest === null || hedge.end > nearest.end)) nearest = hedge;
  }
  return nearest ? nearest.term : '';
};

/**
 * Apply FINDINGS_SUMMARY_MAX ON WHOLE FINDINGS, AND SAY WHAT WAS CUT.
 *
 * This was `summary.slice(0, 120)` over the already-assembled string,
 * which cuts wherever character 120 happens to fall — including between
 * a term and the 「（待排）」 that qualifies it. A nine-finding impression
 * ending 「…股四头肌脂肪化待排」 came out as 「…、脂肪化…」: the hedge
 * sheared off the last finding, leaving it BYTE-IDENTICAL to the
 * definite form, which is precisely the failure HEDGE_MARKERS was added
 * to end. The trailing 「…」 is not a hedge and the model does not read
 * it as one. A mid-term cut is worse still — 「限制性通气功能障碍」 cut
 * at 「限制性通气」 is not a finding in any vocabulary.
 *
 * So the last WHOLE finding that fits is the last one printed, and the
 * count of the ones that did not is stated rather than implied: a
 * truncated list that admits it is truncated is something the model can
 * act on (ask, or read the report again), and a silently shortened one
 * is a report it believes it has seen all of. If even the first finding
 * exceeds the cap it is emitted whole and over-length — the cap is a
 * did-the-vocabulary-match-too-broadly sanity check, not a byte budget
 * anything downstream depends on.
 */
const capFindings = (phrases: readonly string[]): string => {
  const whole = phrases.join('、');
  if (whole.length <= FINDINGS_SUMMARY_MAX) return whole;
  const dropped = (n: number) => `（另 ${n} 项未列出）`;
  for (let take = phrases.length - 1; take >= 1; take -= 1) {
    const line = `${phrases.slice(0, take).join('、')}${dropped(phrases.length - take)}`;
    if (line.length <= FINDINGS_SUMMARY_MAX) return line;
  }
  return `${phrases[0]}${dropped(phrases.length - 1)}`;
};

/**
 * Extract the recognised clinical findings a report actually asserts.
 *
 * Deny-by-default three times over: every character of the output comes
 * from `CLINICAL_FINDING_TERMS`, `SEVERITY_QUALIFIERS`, `HEDGE_MARKERS`
 * or `MEASUREMENT_DIRECTIONS` — four lists, not the three this said
 * while `readMeasurement` was already emitting from the fourth — and
 * never from the text (so no name can pass); a
 * clause naming a negation, a third party, a past study or methylation
 * is discarded before any term is matched; and a term inside a
 * surviving clause is kept only where the occurrence itself is not
 * ruled out or resolved. See `occurrenceIsAsserted` for what the
 * occurrence test does and does not buy on top of the clause test.
 *
 * THE UNIT OF READING IS THE OCCURRENCE, NOT THE TERM AND NOT THE
 * CLAUSE. This loop used to walk `CLINICAL_FINDING_TERMS` and ask each
 * one for its first asserted position in the clause, resolving the
 * hedge once for the whole clause. Four rounds of fixes hung
 * clause-level and term-level exceptions off that shape and they kept
 * interacting: only the first of two severities of one finding survived
 * (the term was answered once), a hedge on one finding was glued to its
 * definite neighbours (the hedge was answered once per clause), and the
 * output came out in vocabulary order while the comment said reading
 * order. Enumerating the occurrences and resolving negation, hedge,
 * severity and direction from the characters around EACH one removes
 * the shape those three came out of rather than patching them
 * individually.
 *
 * Findings come out in READING ORDER, clause by clause and within each
 * clause — the order the qualifiers are bound in, and the order the
 * report itself puts them in.
 */
const buildFindingsSummary = (ocrFields: Record<string, unknown>): string | null => {
  const raw = IMPRESSION_KEYS.map((key) => ocrFields[key]).find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  if (!raw) return null;

  // Only clauses that assert something about THIS patient, in THIS
  // study, about something other than methylation, contribute terms.
  // The wrap healing runs FIRST, or a line break inside 未见明显脂肪浸润
  // splits the negation off the thing it negates.
  const assertedClauses = healWrappedClauseMarkers(raw)
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .filter((clause) => !clauseIsDisqualified(clause));

  const kept: { term: string; qualifier: string; hedge: string; phrase: string }[] = [];

  for (const clause of assertedClauses) {
    const hedges = hedgeOccurrences(clause);
    const occurrences = termOccurrences(clause);

    // What a negation in this clause governs, computed from the span
    // between the negating character and the finding rather than looked
    // up in a list of negating words. See `negationScopes`; the term
    // occurrences go in because a root inside a term's own name
    // (肌营养不良, 心律不齐, 不对称) is not an operator.
    const scopes = negationScopes(clause, occurrences);

    // Where in THIS clause an occurrence has already been read. A
    // shorter term overlapping one of these spans is not a second
    // finding, it is the same characters read again — see below.
    const claimed: { start: number; end: number }[] = [];

    for (const at of occurrences) {
      if (!occurrenceIsAsserted(clause, at, scopes)) continue;

      // ONE PHRASE IS ONE FINDING, AND THE TEST FOR THAT IS THE SPAN,
      // NOT THE QUALIFIER.
      //
      // The cross-clause dedupe below asks whether a longer entry
      // already covers this term AT THE SAME SEVERITY, and a nested term
      // starts at a different index, so its slices are different text
      // and its qualifier comes out different — usually empty. Both
      // directions of that leaked, and both emitted one phrase as two
      // findings:
      //
      //   - 「肩胛带重度肌肉萎缩」 — the ordinary Chinese word order —
      //     gave 肌肉萎缩 the qualifier 重度 off its before-slice, while
      //     the nested 萎缩 starts two characters later so ITS
      //     before-slice ends 肌肉 and its after-slice is empty. The
      //     qualifiers differed, the skip never fired, and the summary
      //     read 「重度肌肉萎缩、萎缩」: a bare 萎缩 standing next to a
      //     graded one, which is exactly the detached-severity reading
      //     SEVERITY_QUALIFIERS exists to prevent.
      //   - 「重度限制性通气功能障碍」 did the same thing to the
      //     nested 通气功能障碍.
      //
      // So the question asked is whether this occurrence shares
      // characters with a span already read in this clause. If it does
      // it is the same phrase, whatever the two qualifier reads say.
      // `termOccurrences` orders longest-first at a shared start, so the
      // compound always claims the span before its nested term is
      // offered. The span is recorded even when the cross-clause dedupe
      // below then drops this occurrence, or a second mention of one
      // compound would un-cover its own nested term.
      if (claimed.some((span) => at.start < span.end && at.end > span.start)) continue;
      claimed.push({ start: at.start, end: at.end });

      // The severity glued to THIS occurrence, on either side of it.
      const before = clause.slice(0, at.start);
      const after = clause.slice(at.end);
      const qualifier =
        SEVERITY_QUALIFIERS.find((q) => before.endsWith(q)) ??
        SEVERITY_QUALIFIERS.find((q) => after.startsWith(q)) ??
        '';

      // A measurement noun says nothing without its direction word, and
      // the qualifier belongs to the direction rather than to the noun.
      // Read FIRST, because the phrase it produces is longer than the
      // term and the hedge is resolved against the end of the PHRASE.
      let body = `${qualifier}${at.term}`;
      let spanEnd = at.end;
      let spanHedge = '';
      if (MEASUREMENT_NOUNS.has(at.term)) {
        const measured = readMeasurement(after);
        if (!measured) continue;
        body = `${at.term}${qualifier}${measured.direction}`;
        spanEnd = at.end + measured.end;
        spanHedge = measured.hedge;
      }

      // The hedge governing THIS occurrence — in front of it, written
      // inside the measurement phrase (射血分数可能降低), or written
      // directly against the back of the phrase this file is about to
      // print. See `resolveHedge`: resolved once per clause instead, a
      // hedge on one finding downgraded every definite finding beside
      // it; resolved at the TERM rather than at the span, an equivocal
      // 射血分数降低待排 printed as a definite one.
      const hedge = spanHedge || resolveHedge(clause, hedges, at, spanEnd);

      // ONE FINDING, THE LONGEST READING OF IT, WHICHEVER CLAUSE SAID IT
      // FIRST.
      //
      // This asked only whether an ALREADY-KEPT term contained the new
      // one, which made it order-dependent, and the comment stated the
      // rule unconditionally while saying nothing about the reverse
      // order — the half that leaked. A bare term in an earlier clause
      // did not stop the compound in a later one:
      // 「肌营养不良；双侧大腿肌营养不良改变」 rendered
      // 「影像/报告印象: 肌营养不良、肌营养不良改变」, one finding printed
      // twice, and the duplicate also costs a slot against
      // FINDINGS_SUMMARY_MAX so it can push a real finding into
      // 「另 N 项未列出」.
      //
      // Containment is symmetric now, and the longer reading is the one
      // that survives — the compound carries what the substring carries
      // and more. It REPLACES the shorter entry in place rather than
      // being appended, so the finding keeps the position the report
      // first gave it.
      //
      // Different severities and different hedges are different findings
      // and all of them are kept: collapsing severities is how 轻度 and
      // 重度 got swapped in the first place, and collapsing hedges is how
      // a definite finding and an equivocal one became one line.
      const sameFinding = kept.findIndex(
        (entry) =>
          entry.qualifier === qualifier &&
          entry.hedge === hedge &&
          (entry.term.includes(at.term) || at.term.includes(entry.term)),
      );
      const phrase = hedge ? `${body}（${hedge}）` : body;
      if (sameFinding === -1) {
        kept.push({ term: at.term, qualifier, hedge, phrase });
      } else if (at.term.length > kept[sameFinding].term.length) {
        kept[sameFinding] = { term: at.term, qualifier, hedge, phrase };
      }
    }
  }
  if (kept.length === 0) return null;

  return capFindings(kept.map((entry) => entry.phrase));
};

/**
 * WHEN IS THIS REPORT FROM, in one place.
 *
 * The laboratory's own date first — the bridge in
 * services/ocr/embedded-report-ocr.ts writes it as
 * `ocr_payload.fields.reportTime`, and the legacy extraction paths as
 * `report_time` — and the upload timestamp only as a fallback, flagged
 * as such so the caller can label it honestly rather than passing it
 * off as the report's date.
 *
 * ONE FUNCTION BECAUSE THERE IS ONE QUESTION. The citation chip and the
 * prompt each used to answer it, differently, in the same turn: the
 * chip read `reportTime` and the field map read `uploaded_at`. Two
 * answers about one document is worse than one wrong answer, because
 * nothing on either side says the other exists.
 */
const resolveReportDate = (row: ReportRow): { value: string | null; fromReport: boolean } => {
  const payload = row.ocr_payload as { fields?: Record<string, unknown> } | null;
  const reported = payload?.fields?.reportTime ?? payload?.fields?.report_time;
  if (typeof reported === 'string' && reported.trim()) {
    return { value: formatTimestamp(reported.trim()), fromReport: true };
  }
  return { value: formatTimestamp(row.uploaded_at), fromReport: false };
};

const buildReportFields = (row: ReportRow): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};

  if (row.classified_type) fields.classifiedType = row.classified_type;
  if (row.document_type) fields.documentType = row.document_type;
  if (row.status) fields.status = row.status;

  // `title` is a user-named field on the document upload and can
  // contain the patient's name, so it is on NEITHER allowlist and
  // reaches no prompt in either mode. Exposed raw here anyway so the
  // redactor sees it and drops it where the audit row can show that it
  // did, rather than the retriever silently never offering it.
  if (row.title) fields.title = row.title;

  // WHEN IS THIS REPORT FROM — asked once, by `resolveReportDate`, and
  // answered the same way for the prompt and for the citation chip.
  //
  // `reportDate` was `row.uploaded_at`, unconditionally, while the
  // laboratory's own date sat on the same row unused and
  // `reportDateLabel` was already reading it for the chip. So in ONE
  // turn the 依据 chip the patient taps said 「基因检测报告 · 2019-03」
  // and the assistant, reading 「报告年份: 2026」 off this projection,
  // said the genetics report was from 2026. How old a D4Z4 result is
  // decides whether a clinician re-tests it and whether a trial
  // screener will accept it, so the two answers are not
  // interchangeable and the wrong one was the one the model spoke.
  //
  // AND WHEN ONLY THE UPLOAD TIMESTAMP EXISTS, IT IS NOT CALLED THE
  // REPORT'S YEAR. It reaches the prompt as `uploadYear` / 上传年份 —
  // the true statement about the row — rather than as 报告年份, which
  // is a claim about a document this platform has no date for. Both
  // modes collapse either cell to its year: the day never leaves,
  // because the precise consent is to a clinical value and not to a
  // calendar date.
  const dated = resolveReportDate(row);
  if (dated.value) {
    if (dated.fromReport) fields.reportDate = dated.value;
    else fields.uploadDate = dated.value;
  }

  // The OCR payload itself. `projectOcrFields` runs over it in BOTH
  // modes and is deny-by-default in both: strict emits
  // `fields_clinical` with this platform's reading of each key it
  // recognises, precise emits `fields` with the raw value beside that
  // reading and only for the keys named on
  // OCR_FIELDS_SAFE_KEYS_PRECISE. Nothing passes here verbatim.
  // THE DOCUMENT'S OWN PAGE, CARRIED SO THE LABORATORY GATE CAN READ
  // IT — AND HARD-DELETED BEFORE ANYTHING ELSE SEES IT.
  //
  // `isLaboratoryGeneticReport` decides whether a repeat count off this
  // document may be read against the FSHD1 range, and it answers that
  // by looking at the document's own structure: a page showing 主诉 /
  // 现病史 / 出院小结 is a clinical narrative and is refused, whatever
  // label is on the row. This projection was the only one without the
  // page, so the gate fell through to the type the UPLOADER declared —
  // and an archived 病历摘要 whose uploader also picked 基因检测报告
  // from the menu was graded on the assistant path while the passport,
  // the share page, the referral pack and the exports all refused the
  // same document in the same request. The classifier that mislabelled
  // those rows is fixed; nothing re-runs the parse, so every one of
  // them is still on disk with the old label.
  //
  // `extractedText` IS ON `HARD_DELETE_KEYS`, so it is deleted in both
  // modes at any depth before layer 2 runs — the redactor asks the gate
  // of its INPUT, ahead of layer 1, precisely so that this cell can be
  // read and then removed. It is the OCR full-text dump: it carries the
  // patient's name, the physician's name and every identifier the page
  // printed, and no prompt may contain it.
  const page = row.ocr_payload?.extractedText ?? row.ocr_payload?.extracted_text;
  if (typeof page === 'string' && page.trim()) fields.extractedText = page;

  if (isPlainObject(row.ocr_payload?.fields)) {
    fields.fields = row.ocr_payload.fields;

    // The report's conclusion, name-scrubbed. Allowed in BOTH strict
    // and precise mode — a clinical impression is the least
    // identifying and most useful thing on the page, once the names
    // are off it.
    const summary = buildFindingsSummary(row.ocr_payload.fields);
    if (summary) fields.findings_summary = summary;
  }

  return fields;
};

const coerceSince = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || !raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const coerceDocumentType = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;

const PLACEHOLDER_CONTENT_PREFIX = '【患者报告占位';
const PLACEHOLDER_SNIPPET = '你的患者报告';

/** Generic content for a chunk. Includes the report-type label
 *  (already non-PII because it's a classification) so the orchestrator
 *  can route by kind without inspecting metadata, but never includes a
 *  title, date, or any OCR value. */
const placeholderContent = (reportType: string | null): string =>
  `${PLACEHOLDER_CONTENT_PREFIX} / ${reportType ?? 'unknown'} — 字段经 PIIRedactor 处理后由 ContextBuilder 渲染】`;

/** Leading `YYYY-MM` of an already-resolved date. */
const YEAR_MONTH = /^(\d{4})-(\d{2})/;

/**
 * `2023-12-22` → `2023-12`. Enough to tell two reports of the same
 * kind apart in a citation chip without turning the chip into a date
 * field.
 *
 * SLICE THE DIGITS, DO NOT RE-PARSE. `resolveReportDate` has already
 * resolved the answer to an ISO instant; this used to feed that string
 * back through `new Date(...)` and read it out with `getFullYear` /
 * `getMonth`, which are the SERVER's zone. A report whose OCR
 * `reportTime` says 2025-01-01 becomes UTC midnight, and on any host
 * west of Greenwich the local accessors slide it back across both the
 * month and the year boundary — the chip read 「基因检测报告 · 2024-12」
 * for a January 2025 report, a whole year wrong on the one chip whose
 * job is to tell the patient how old the result is. profile.passport.ts,
 * referral-pack.ts and passport-share.html.ts each carry a DATE_ONLY
 * short-circuit for exactly this; this call site was the one that
 * missed it.
 *
 * AND IT SAYS WHICH DATE IT IS. `resolveReportDate` returns `fromReport`
 * precisely so the caller can 「label it honestly rather than passing it
 * off as the report's date」, and this function threw the flag away and
 * joined the value onto the report-type label with no marker either way.
 * So a genetics report whose OCR carried no `reportTime` produced the
 * chip 「基因检测报告 · 2026-08」 — the month the patient happened to
 * upload the file, sitting where a patient reads the date of the result.
 * The prompt side of this same row already refuses to make that claim:
 * `uploadDate` reaches the model as 上传年份 and never as 报告年份. In
 * one turn the assistant said 上传年份 and the 依据 chip beside its
 * answer asserted a report date anyway, and how old a D4Z4 result is
 * decides whether a clinician re-tests it.
 *
 * The upload fallback is still shown — two reports of the same kind
 * otherwise give two identical chips — but marked 上传, so the bare
 * month stays what it has always looked like: the laboratory's own date.
 */
const reportDateLabel = (row: ReportRow): string => {
  const { value, fromReport } = resolveReportDate(row);
  if (!value) return '';
  const parts = YEAR_MONTH.exec(value);
  if (!parts) return '';
  const yearMonth = `${parts[1]}-${parts[2]}`;
  return fromReport ? yearMonth : `上传 ${yearMonth}`;
};

export class PatientReportsRetriever implements IRetriever {
  readonly id = 'patient_reports';
  readonly kind = 'sql' as const;

  constructor(private readonly pool: Pool) {}

  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    if (!ctx.userId) {
      return emptyResult(this.id, 'no_user_in_scope');
    }
    if (ctx.consentLevel === 'none' || ctx.consentLevel === undefined) {
      return emptyResult(this.id, 'consent_not_granted');
    }

    const requestedLimit = input.limit ?? RECENT_LIMIT_DEFAULT;
    const limit = Math.min(Math.max(1, requestedLimit), RECENT_LIMIT_MAX);

    const documentType = coerceDocumentType(input.filter?.documentType);
    const since = coerceSince(input.filter?.since);
    const documentId = coerceDocumentType(input.filter?.documentId);

    const conditions: string[] = ['pp.user_id = $1', 'pd.ocr_payload IS NOT NULL'];
    const params: unknown[] = [ctx.userId];
    // A single-document scope. The `pp.user_id = $1` clause above still
    // applies, so an id belonging to someone else returns zero rows
    // rather than their report — the scope narrows, it never widens.
    if (documentId) {
      params.push(documentId);
      conditions.push(`pd.id = $${params.length}`);
    }
    if (documentType) {
      params.push(documentType);
      // Match either column. `document_type` is what the uploader
      // picked (blood_panel, mri, genetic_report …); `classifiedType`
      // is what OCR concluded (coagulation, stool_test,
      // infection_screening …). The model naturally filters by the
      // second — it is the vocabulary the report itself uses, and the
      // one the tool's own description advertises — so filtering only
      // on the first made a perfectly ordinary question
      // (「我的凝血报告数值是多少」) return nothing, and the answer
      // became「还没有查到你的凝血报告」about a report sitting in the
      // account fully parsed.
      conditions.push(
        `(pd.document_type = $${params.length}` +
          ` OR pd.ocr_payload->'fields'->>'classifiedType' = $${params.length})`,
      );
    }
    if (since) {
      params.push(since);
      conditions.push(`pd.uploaded_at >= $${params.length}`);
    }
    params.push(limit);
    const limitParam = `$${params.length}`;

    // Readable reports rank ahead of unreadable ones, then most
    // recent.
    //
    // Ordering by arrival alone meant a failed parse — which carries
    // nothing but a type and a status — could occupy every one of the
    // five slots. And failures cluster: a batch upload queues together,
    // so when one times out several do. A patient whose last batch
    // failed got "I can't read any of your reports" about an account
    // whose genetic report had parsed correctly an hour earlier.
    const result = await this.pool.query<ReportRow>(
      `SELECT pd.id,
              pd.document_type,
              pd.title,
              pd.uploaded_at,
              pd.status,
              pd.ocr_payload,
              (pd.ocr_payload->'fields'->>'classifiedType') AS classified_type,
              (pd.ocr_payload->'fields'->>'reportTypeLabel') AS report_type_label
       FROM patient_documents pd
       JOIN patient_profiles pp ON pp.id = pd.profile_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY (pd.status = 'parsed') DESC, pd.uploaded_at DESC
       LIMIT ${limitParam}`,
      params,
    );

    if (result.rowCount === 0) {
      return emptyResult(this.id, 'no_reports_found', {
        documentType: documentType ?? null,
        since: since ?? null,
        documentId: documentId ?? null,
      });
    }

    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];

    result.rows.forEach((row, idx) => {
      const chunkId = randomUUID();
      const sourceFile = `patient_reports/${row.id}`;
      // What the「依据」chip shows the patient. `sourceFile` stays the
      // stable id — the prompt and the audit trail key off it — but a
      // uuid is not a source anyone can check, and a citation nobody
      // can read is indistinguishable from no citation at all.
      // `reportTypeLabel` is written by the OCR classifier
      // (「感染筛查报告」,「肌肉 MRI 报告」), so it is a classification
      // rather than report content, the same reasoning that already
      // lets `classifiedType` into the chunk body.
      // Two reports of the same kind produce two identical chips —
      // observed:「引用 2 条：粪便/幽门检测报告、粪便/幽门检测报告」,
      // which tells the patient no more than one chip would have. The
      // report date separates them — carrying its own origin marker, so
      // an upload month is never read as the date of the result. It is
      // the patient's own data going to their own client, not to the
      // prompt — the redactor still governs everything the model sees.
      const dateLabel = reportDateLabel(row);
      const citationLabel = [row.report_type_label?.trim() || '你上传的检查报告', dateLabel]
        .filter(Boolean)
        .join(' · ');
      const fields = buildReportFields(row);
      const reportType = row.classified_type ?? row.document_type ?? null;

      chunks.push({
        id: chunkId,
        source: this.id,
        content: placeholderContent(reportType),
        metadata: {
          documentId: row.id,
          documentType: row.document_type,
          classifiedType: row.classified_type,
          // `uploadedAt` stays in metadata for ordering / audit but
          // never reaches the prompt (the renderer reads
          // `metadata.fields` only).
          uploadedAt: formatTimestamp(row.uploaded_at),
          status: row.status,
          fields,
        },
        distance: null,
        sourceFile,
        chunkIndex: idx,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile: citationLabel,
        chunkIndex: idx,
        snippet: PLACEHOLDER_SNIPPET,
      });
    });

    return {
      retrieverId: this.id,
      chunks,
      citations,
      metadata: {
        documentCount: result.rowCount,
        documentType: documentType ?? null,
        since: since ?? null,
      },
    };
  }
}
