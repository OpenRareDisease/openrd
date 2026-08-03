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
 * records and the plan reads none of them, the report lookup is added.
 * Gated on there being prior turns, because without them there is no
 * antecedent for 这些 to refer to and the phrase is just a topic.
 *
 * Only ever *adds*. It cannot remove or rewrite what the model asked
 * for, so the worst case is one extra retrieval — and neither companion
 * can widen what a given patient's consent already allows:
 * `search_medical_kb` has no consent minimum, and `get_my_reports` is
 * only added when the registry already advertised it for this consent
 * level, which is the same gate the planner itself passed through.
 */

import type { LlmToolCall } from '../llm/base.js';

const KB_TOOL = 'search_medical_kb';

/** Tools that read the patient's own clinical documents. Reading any of
 *  these is what triggers the companion KB lookup. */
const REPORT_TOOLS: ReadonlySet<string> = new Set(['get_my_reports']);

/** Cap on the query text handed to the KB. The retriever embeds it, and
 *  a whole multi-turn question dilutes the embedding. */
const QUERY_MAX = 120;

const REPORTS_TOOL = 'get_my_reports';

/** Tools that read anything belonging to the patient. If the plan has
 *  none of these, the answer cannot be about their data — except by
 *  carrying it forward from the conversation, which is the case below. */
const PERSONAL_TOOLS: ReadonlySet<string> = new Set([
  'get_my_reports',
  'get_my_profile',
  'get_my_records',
]);

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
  const readsReports = [...REPORT_TOOLS].some((tool) => names.has(tool));
  if (readsReports && !names.has(KB_TOOL) && available.has(KB_TOOL)) {
    toolCalls.push({
      id: 'server-companion-kb',
      name: KB_TOOL,
      argumentsJson: JSON.stringify({ query }),
    });
    added.push(KB_TOOL);
  }

  const readsPersonal = [...PERSONAL_TOOLS].some((tool) => names.has(tool));
  if (
    !readsPersonal &&
    available.has(REPORTS_TOOL) &&
    refersToOwnRecords(question, Boolean(opts.hasHistory))
  ) {
    toolCalls.push({
      id: 'server-companion-reports',
      name: REPORTS_TOOL,
      argumentsJson: '{}',
    });
    added.push(REPORTS_TOOL);
  }

  // The same array back when nothing was added — callers rely on the
  // identity to tell "untouched" from "rewritten" without a deep
  // compare, and this function's whole contract is that it only ever
  // appends.
  return added.length > 0 ? { toolCalls, added } : { toolCalls: planned, added: [] };
};
