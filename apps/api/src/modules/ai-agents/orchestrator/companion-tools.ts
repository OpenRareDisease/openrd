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
 * Only ever *adds*. It cannot remove or rewrite what the model asked
 * for, so the worst case is one extra retrieval — and `search_medical_kb`
 * has no consent minimum, so adding it can never widen what a given
 * patient's consent already allows.
 */

import type { LlmToolCall } from '../llm/base.js';

const KB_TOOL = 'search_medical_kb';

/** Tools that read the patient's own clinical documents. Reading any of
 *  these is what triggers the companion KB lookup. */
const REPORT_TOOLS: ReadonlySet<string> = new Set(['get_my_reports']);

/** Cap on the query text handed to the KB. The retriever embeds it, and
 *  a whole multi-turn question dilutes the embedding. */
const QUERY_MAX = 120;

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
): CompanionResult => {
  const names = new Set(planned.map((call) => call.name));

  const readsReports = [...REPORT_TOOLS].some((tool) => names.has(tool));
  if (!readsReports || names.has(KB_TOOL) || !available.has(KB_TOOL)) {
    return { toolCalls: planned, added: [] };
  }

  const query = question.trim().slice(0, QUERY_MAX);
  if (!query) return { toolCalls: planned, added: [] };

  return {
    toolCalls: [
      ...planned,
      {
        // Prefixed so it is distinguishable in the audit trail from a
        // call the model actually made — the trail is shown to the
        // patient as「AI 思考过程」and it should not claim the model
        // decided something the server decided.
        id: 'server-companion-kb',
        name: KB_TOOL,
        argumentsJson: JSON.stringify({ query }),
      },
    ],
    added: [KB_TOOL],
  };
};
