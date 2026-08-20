/**
 * Tool calls the server adds to the planner's plan.
 *
 * The problem
 * -----------
 * A patient asked「结合 fshd 知识库分析我的报告」— a question naming both
 * halves explicitly — and the planner called exactly one tool. The
 * answer footer read「本次回答仅基于公共 FSHD 知识资料，未读取你的个人
 * 数据」about a question whose subject was 我的报告.
 *
 * The system prompt already says to call `search_medical_kb` for
 * anything about FSHD and `get_my_reports` for anything about the
 * patient's own reports. It said so before this request and the model
 * still picked one. Prompting is the wrong layer for a guarantee: the
 * planner is a single sampled completion, and "call both tools" is a
 * property we can simply enforce.
 *
 * The rule
 * --------
 * **A question about the patient's own reports is always also a
 * question about what those reports mean.** A row of analyte names and
 * figures is not an answer;「CK 偏高说明什么」「FVC 78% 对 FSHD 患者算
 * 什么水平」is, and that lives in the knowledge base. So whenever the
 * plan reads the patient's reports without also consulting the KB, the
 * KB call is added.
 *
 * The mirror rule
 * ---------------
 * The same failure runs the other way on a follow-up. A patient asked
 *「这些报告的具体数值呢」and the planner called only the KB, because
 * 「这些」 is anaphora — the question never names 我的报告, the previous
 * turn did. The model then had public FSHD material and no patient
 * data, so it asked the patient to send their report images. It already
 * had those reports one turn earlier. Being asked to re-supply what you
 * just supplied is the app forgetting you.
 *
 * So: when the conversation is demonstrably about the patient's own
 * records and the plan reads NO REPORT, the report lookup is added.
 * Gated on there being prior turns, because without them there is no
 * antecedent for 这些 to refer to and the phrase is just a topic.
 *
 * 「reads no report」 and not 「reads nothing personal」 — the difference
 * is what `REPORT_TOOLS` is about, and it decided whether a patient
 * asking about their own genetics ever got their report opened.
 *
 * The trials rule
 * ---------------
 * **A question about clinical trials must reach the live registry
 * cache.** The knowledge base answers trial questions today out of one
 * saved ClinicalTrials.gov results page from 2025-03-31, whose status
 * words are machine-translated (「招聘」 for Recruiting) and which shows
 * ten of the twenty-four studies that were listed that day. The
 * retriever now stamps that page with its date wherever it is quoted
 * (retrievers/medical-kb.ts), but a dated wrong answer is still a wrong
 * answer; the right one lives in `trial_records`, which the refresh
 * keeps current and `list_clinical_trials` reads.
 *
 * So a trial-shaped question adds that call. Unlike the two rules above
 * this one does not require the plan to contain anything first — it
 * fires on an EMPTY plan too, and that is the case it exists for: a
 * model that answers 「哪些试验在招募」 without calling a tool is
 * answering it from its training data, and its training data has NCT
 * numbers in it. Adding the call turns that into a tool round, so the
 * answer is composed from rows with fetch dates on them instead.
 *
 * Only ever *adds*. It cannot remove or rewrite what the model asked
 * for, so the worst case is one extra retrieval — and none of the three
 * companions can widen what a given patient's consent already allows:
 * `search_medical_kb` and `list_clinical_trials` have no consent
 * minimum (neither reads anything belonging to a patient), and
 * `get_my_reports` is only added when the registry already advertised
 * it for this consent level, which is the same gate the planner itself
 * passed through.
 */

import type { LlmToolCall } from '../llm/base.js';

const KB_TOOL = 'search_medical_kb';

/**
 * Tools that read the patient's own clinical documents.
 *
 * Reading any of these is what triggers the companion KB lookup, AND it
 * is the whole of what suppresses the companion report lookup. One set,
 * because both rules are about the same fact: whether this plan reaches
 * the patient's reports.
 *
 * THE SUPPRESSION USED TO BE A WIDER SET and that was the defect. It
 * was `PERSONAL_TOOLS` — `get_my_reports`, `get_my_profile`,
 * `get_my_records` — on the reasoning that a plan touching any of the
 * patient's own data is already about the patient. True, and not the
 * question. What the mirror rule adds is the REPORTS, and the two extra
 * members do not carry any:
 *
 *   - `get_my_profile` returns the registration archive. It carries the
 *     genetics cells the read-time autofill tops up out of a report
 *     (retrievers/patient-profile.ts) and NOTHING ELSE off one — no
 *     analyte, no impression, no report date, no document at all. So a
 *     patient asking 「我的基因报告怎么说」 whose planner called
 *     `get_my_profile` got four archived cells and their report was
 *     never opened, which is the exact shape of the failure the mirror
 *     rule was written to end: the app holding the document and asking
 *     the patient to describe it.
 *   - `get_my_records` returns measurement and symptom SERIES. There is
 *     no document on that path either.
 *
 * `get_my_reports` is the one tool whose presence makes the companion
 * redundant, so it is the one tool that suppresses it. Nothing about
 * consent moves: the call is still gated on `available.has`, which is
 * the registry's answer for this patient's consent level.
 */
const REPORT_TOOLS: ReadonlySet<string> = new Set(['get_my_reports']);

/** Cap on the query text handed to the KB. The retriever embeds it, and
 *  a whole multi-turn question dilutes the embedding. */
const QUERY_MAX = 120;

const REPORTS_TOOL = 'get_my_reports';

/**
 * Does this question point back at the patient's own material?
 *
 * Two shapes. The first is explicit —「我的报告」— which the planner
 * usually catches on its own. The second is anaphoric —「这些报告」,
 *「上面那几项」— where the referent lives in the previous turn, and that
 * is the one it misses.
 *
 * Requires a demonstrative *and* a noun for the thing: 「这些注意事项」
 * refers back to advice, not to records, and pulling reports for it
 * would be a retrieval nobody asked for.
 */
const DEMONSTRATIVE = /(这|那|上面|前面|刚才|之前)[些个几]?/;
const OWN_RECORD_NOUN = /(报告|检查|化验|数值|指标|结果|记录|片子|影像)/;

const TRIALS_TOOL = 'list_clinical_trials';

/**
 * Is this a question about clinical trials?
 *
 * Two ways in. The first is a term that can only mean a trial —
 * 临床试验, 临床研究, an NCT number, the English. The second is the
 * shape the canonical question actually takes, 「哪些试验在招募」: a word
 * for the thing plus a word for joining it. Requiring both halves in
 * that branch is what keeps 试验 out of the way of 实验室检查 and keeps
 * 招募 out of the way of the platform's own 甲基化筛查项目招募 — one
 * without the other is not a trial question.
 *
 * Deliberately generous inside those two shapes, because the cost of a
 * false positive is one indexed read of a 92-row table (026's header)
 * whose result the tool describes honestly whatever it contains, and
 * the cost of a false negative is a patient being told which trials are
 * recruiting from a 2025 web page.
 */
const TRIAL_TERM = /(临床试验|临床研究|药物试验|试验登记|clinical\s+trials?|NCT\s*\d)/i;
const TRIAL_THING = /(试验|临床研究)/;
const TRIAL_JOIN = /(招募|在招|入组|报名|参加|加入|符合条件)/;

export const refersToClinicalTrials = (question: string): boolean => {
  const q = question.trim();
  if (!q) return false;
  if (TRIAL_TERM.test(q)) return true;
  return TRIAL_THING.test(q) && TRIAL_JOIN.test(q);
};

export const refersToOwnRecords = (question: string, hasHistory: boolean): boolean => {
  const q = question.trim();
  if (!q) return false;
  if (/我的|我目前|我之前|我这些|本人/.test(q) && OWN_RECORD_NOUN.test(q)) return true;
  return hasHistory && DEMONSTRATIVE.test(q) && OWN_RECORD_NOUN.test(q);
};

export interface CompanionResult {
  toolCalls: LlmToolCall[];
  /** Names actually added, for the log line + the audit trail. */
  added: string[];
}

/**
 * @param question the patient's question, used as the KB query
 * @param available names the registry advertised for this consent level
 */
export const withCompanionToolCalls = (
  planned: LlmToolCall[],
  question: string,
  available: ReadonlySet<string>,
  opts: { hasHistory?: boolean } = {},
): CompanionResult => {
  const names = new Set(planned.map((call) => call.name));
  const query = question.trim().slice(0, QUERY_MAX);
  if (!query) return { toolCalls: planned, added: [] };

  const toolCalls = [...planned];
  const added: string[] = [];

  // Ids are prefixed so they are distinguishable in the audit trail from
  // a call the model actually made — the trail is shown to the patient
  // as「AI 思考过程」and it should not claim the model decided something
  // the server decided.
  const readsReports = () => [...REPORT_TOOLS].some((tool) => names.has(tool));

  // THE MIRROR RULE RUNS FIRST, AND ITS RESULT IS PART OF THE PLAN THE
  // KB RULE THEN READS.
  //
  // The order is load-bearing now and was not before. The two rules
  // used to be mutually exclusive — the KB rule fired only when the
  // PLAN already read reports, and the report rule's gate was a
  // superset of that — so a server-added report lookup could never be
  // seen by the KB rule, and it never had to be. Narrowing the gate
  // below to `REPORT_TOOLS` makes them overlap: a plan of
  // `get_my_profile` on 「我的基因报告怎么说」 now gains the report
  // lookup, and left in the old order that is a plan reading the
  // patient's reports with no knowledge base beside it — the exact
  // state the first rule in this file exists to prevent, reached by
  // the fix for the second. So `names` gains the added call and the KB
  // rule asks again.
  //
  // GATED ON THE REPORTS THEMSELVES, NOT ON 「ANY PERSONAL SCOPE」. This
  // asked whether the plan read ANY tool belonging to the patient —
  // `get_my_profile` and `get_my_records` were in the set with
  // `get_my_reports` — and the two extra members suppress the one
  // companion this rule adds. See the block above `REPORT_TOOLS`.
  if (
    !readsReports() &&
    available.has(REPORTS_TOOL) &&
    refersToOwnRecords(question, Boolean(opts.hasHistory))
  ) {
    toolCalls.push({
      id: 'server-companion-reports',
      name: REPORTS_TOOL,
      argumentsJson: '{}',
    });
    added.push(REPORTS_TOOL);
    names.add(REPORTS_TOOL);
  }

  if (readsReports() && !names.has(KB_TOOL) && available.has(KB_TOOL)) {
    toolCalls.push({
      id: 'server-companion-kb',
      name: KB_TOOL,
      argumentsJson: JSON.stringify({ query }),
    });
    added.push(KB_TOOL);
  }

  // No gate on what the plan already contains: see the trials rule in
  // the header for why an empty plan is the case this exists for.
  if (!names.has(TRIALS_TOOL) && available.has(TRIALS_TOOL) && refersToClinicalTrials(question)) {
    toolCalls.push({
      id: 'server-companion-trials',
      name: TRIALS_TOOL,
      // No arguments. A status filter would be the server guessing at
      // which statuses the patient meant, and the tool's own default
      // returns every cached trial with its status word on it — which
      // is the thing the model needs in order to answer either
      //「哪些在招募」or「这个还在做吗」.
      argumentsJson: '{}',
    });
    added.push(TRIALS_TOOL);
  }

  // The same array back when nothing was added — callers rely on the
  // identity to tell "untouched" from "rewritten" without a deep
  // compare, and this function's whole contract is that it only ever
  // appends.
  return added.length > 0 ? { toolCalls, added } : { toolCalls: planned, added: [] };
};
