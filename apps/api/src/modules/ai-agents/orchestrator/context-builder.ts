/**
 * Context builder — turn executed tool results into LLM `tool`
 * messages, dedup citations, and report what patient fields actually
 * made it into the final prompt.
 *
 * Every retrieved chunk flows through `renderChunkForPrompt`, which
 * is the only sanctioned path that produces prompt-ready text from a
 * `RetrievedChunk`. That guarantee is what makes the field-only
 * privacy model from PR #23 enforceable: retrievers can stuff raw
 * data in `metadata.fields` and the renderer is the only place it
 * gets surfaced (after the redactor runs).
 */

import type { ExecutedToolCall } from './executor.js';
import type { AppLogger } from '../../../config/logger.js';
import { retrievalFailureReason } from '../retrievers/base.js';
import type { Citation, RetrievedChunk } from '../retrievers/base.js';
import { NO_RELEVANT_RESULTS } from '../retrievers/medical-kb.js';
import type { RedactionMode } from '../security/allowlist.js';
import { renderChunkForPrompt } from '../security/render.js';

/** Sources whose contribution counts as "personal data". When any of
 *  these appear, the orchestrator surfaces a "本回答用到了你的..."
 *  hint to the UI and the audit row carries usedPersonalData=true. */
const PERSONAL_SOURCES = new Set([
  'patient_profile',
  'patient_reports',
  // Followup trends are as personal as it gets — the answer quotes the
  // patient's own measurements back at them. Omitting this source here
  // would leave the UI's「本回答用到了你的...」hint off and, worse,
  // stamp the audit row usedPersonalData=false for an answer built
  // entirely out of their records.
  'patient_followups',
]);

/**
 * The same split, keyed by tool name.
 *
 * The failure path that matters most has no `retrieval` at all — the
 * tool threw, so `retrieverId` is unavailable and the tool name is the
 * only thing left to classify by. Keeping both maps means a failure is
 * classified the same way whether the retriever returned an empty
 * result with a reason or blew up outright.
 */
const PERSONAL_TOOLS = new Set(['get_my_profile', 'get_my_reports', 'get_my_records']);

/**
 * The trial registry cache — a third subsystem, and one whose failures
 * used to be reported as the knowledge base's.
 *
 * `list_clinical_trials` and its retriever both refuse to throw, and
 * that is not enough on its own: the executor's wall-clock timeout
 * rejects AROUND the promise the retriever's try/catch sits inside, so
 * a `readTrialSnapshot` that hangs rather than rejects escapes every
 * guard either file has and arrives here as a bare `call.error`.
 * Classified as `corpus` it printed 「资料库检索没有跑成功」 — a
 * sentence about the MEDICAL KNOWLEDGE BASE, which had not failed and
 * whose chunks were sitting in the same prompt. Reproduced with a
 * never-resolving snapshot read and a 30 ms tool timeout; pinned here
 * and at the executor seam in ../tools/list-clinical-trials.test.ts.
 */
const TRIALS_TOOLS = new Set(['list_clinical_trials']);
const TRIALS_SOURCES = new Set(['clinical_trials']);

/**
 * Which kind of source could not be reached.
 *
 * These are genuinely different events for the patient and must not be
 * collapsed into one sentence:
 *   - `corpus`   — the medical KB / platform docs could not be searched.
 *                  The honest answer is "I could not look this up", and
 *                  the one thing that must never happen is the model
 *                  filling the gap from its own priors: a rare-disease
 *                  patient cannot tell a sourced answer from a
 *                  plausible-sounding one, and this product's whole
 *                  claim is that it does not blur that line.
 *   - `personal` — the patient's own profile / reports / followups
 *                  could not be read. Nothing about FSHD is wrong here;
 *                  what is missing is *their* data, and the answer must
 *                  say so rather than guess at their numbers.
 *   - `trials`   — the cached trial registry could not be read. The
 *                  corpus is a different subsystem, usually up while
 *                  this one is down, and its chunks are in the same
 *                  prompt; and「取不到试验列表」is not「没有试验在招募」.
 *                  Saying either of those with the corpus sentence is
 *                  two false statements at once.
 */
export type RetrievalFailureKind = 'corpus' | 'personal' | 'trials';

/**
 * Stable machine-readable codes, so a RAG eval can grep for the case
 * without depending on the human-readable Chinese text.
 *
 * `corpus` and `personal` also travel onto
 * `OrchestratorRunResult.retrievalFailure`, where the client turns them
 * into a degraded-answer banner it does not have to pattern-match prose
 * for. `trials` does NOT, and that is a real gap rather than an
 * oversight: `BuiltContext.failures` and the client-facing state are
 * run.ts's shape, so raising a third flag is that lane's change. Today
 * a trials failure is carried by the tool message alone — the same
 * standing the retriever's own `cache_unreadable` branch has always
 * had, and the reason both of them state the failure in hard
 * requirements rather than leaving it for the model to notice.
 */
export const RETRIEVAL_FAILURE_CODES: Record<RetrievalFailureKind, string> = {
  corpus: 'retrieval_failed',
  personal: 'personal_data_unavailable',
  trials: 'trials_unavailable',
};

export interface ToolMessagePayload {
  toolCallId: string;
  toolName: string;
  /** Final rendered text to feed back to the LLM as `tool` content.
   *  Never contains a raw value that wasn't on the allowlist. */
  content: string;
}

export interface BuiltContext {
  toolMessages: ToolMessagePayload[];
  /** Ordered, deduped, and numbered — `citations[N-1]` is the source
   *  the prompt called 【片段N】. See {@link CitationIndex}. */
  citations: Citation[];
  fieldsUsed: string[];
  usedPersonalData: boolean;
  /** Which classes of retrieval could not run in this batch. Both flags
   *  false is the normal case.
   *
   *  There is deliberately no `trials` flag: a trial-cache failure is
   *  reported to the model in the tool message and nowhere else. See
   *  RETRIEVAL_FAILURE_CODES. */
  failures: { corpus: boolean; personal: boolean };
}

export interface BuildContextOptions {
  mode: RedactionMode;
  logger: AppLogger;
  /**
   * Numbering shared across every round of one run. Omit and a fresh
   * one is created, which is correct for a single-shot call (and for
   * the unit tests) but wrong for the multi-round gather — see the
   * class comment.
   */
  citationIndex?: CitationIndex;
}

/**
 * Global, run-scoped citation numbering.
 *
 * Why this exists
 * ---------------
 * The prompt labels each chunk 【片段N】 and the client parses the
 * model's `[N]` markers as 1-based indexes into the `citations` array
 * (apps/mobile/screens/p-qna/citations.ts). Those two numberings were
 * produced by different code with no shared counter: the header used
 * the chunk's position *within one tool call*, so a run that called
 * `search_medical_kb` and `get_my_reports` showed the model 片段1、片段2
 * for the KB and then 片段1、片段2 again for the reports — while the
 * citations array ran 1..4 across both. A model citing its second
 * report as `[2]` pointed the patient at a knowledge-base chunk about
 * something else entirely, and the snippet card opened and confirmed
 * it, which is worse than no citation at all.
 *
 * The rounds made it worse again: each gather round built its own
 * context and its own numbering, so round 2 restarted at 1.
 *
 * So numbering lives here, keyed by `chunkId`, assigned once per run in
 * the order citations are registered — which is the order they appear
 * in the array the client receives. `numberFor(chunkId)` is therefore
 * an index into that array by construction, not by coincidence.
 */
export class CitationIndex {
  private readonly numberByChunk = new Map<string, number>();
  private readonly ordered: Citation[] = [];

  /** Register (or look up) a citation. Idempotent per `chunkId`, so a
   *  chunk returned by two different tool calls keeps one number and
   *  one card. Returns the 1-based number. */
  register(citation: Citation): number {
    const existing = this.numberByChunk.get(citation.chunkId);
    if (existing !== undefined) return existing;
    const assigned = this.ordered.length + 1;
    this.numberByChunk.set(citation.chunkId, assigned);
    this.ordered.push(citation);
    return assigned;
  }

  /** The number this chunk was given, or null when the retriever gave
   *  us a chunk with no citation — nothing the patient can open, so
   *  nothing the model should be invited to cite. */
  numberFor(chunkId: string): number | null {
    return this.numberByChunk.get(chunkId) ?? null;
  }

  /** The authority label resolved when this chunk's citation was
   *  registered, or null. Reading it back from here rather than
   *  re-deriving it is what keeps the prompt header and the citation
   *  card showing the same grade — if they could drift, the model would
   *  be told 「指南」 about a source the patient opens and sees labelled
   *  「病友经验」. */
  authorityFor(chunkId: string): string | null {
    const number = this.numberByChunk.get(chunkId);
    if (number === undefined) return null;
    return this.ordered[number - 1]?.authorityLabel ?? null;
  }

  /** Snapshot in assignment order. `citations[n - 1].chunkId` is the
   *  chunk numbered `n`. */
  get citations(): Citation[] {
    return [...this.ordered];
  }
}

/**
 * Sentinel pair wrapping every retrieved chunk so the LLM can tell
 * tool-returned text apart from system / user instructions. Anything
 * between BEGIN_DOC and END_DOC is reference material; embedded
 * directives like "ignore previous instructions" are part of the
 * document, not commands to follow. Paired with the system-prompt
 * note in run.ts (DEFAULT_SYSTEM_PROMPT) so the model is told this
 * contract explicitly.
 *
 * The delimiters are deliberately verbose ASCII rather than something
 * a passing attacker would type by accident, but we still strip any
 * accidental occurrences inside chunk content as belt-and-braces.
 */
const CHUNK_BEGIN = '<<<BEGIN_DOC_CHUNK>>>';
const CHUNK_END = '<<<END_DOC_CHUNK>>>';

const stripDelimiters = (content: string): string =>
  content.split(CHUNK_BEGIN).join('').split(CHUNK_END).join('');

/**
 * Longest authority label we will paste into a prompt header or a
 * citation card. A label is a grade —「临床指南」,「同行评议研究」— not a
 * sentence; capping it means a retriever that later starts writing
 * paragraphs into the field cannot quietly inflate every prompt or
 * overflow a citation chip on a phone.
 */
const MAX_AUTHORITY_CHARS = 24;

/**
 * Resolve the authority label for one citation, and normalise it.
 *
 * Two holders, one key. `Citation.authorityLabel` is where the KB
 * retriever puts it; `RetrievedChunk.authorityLabel` is the fallback for
 * a retriever that grades the chunk and builds a plainer citation. Both
 * are declared in retrievers/base.ts, so this is a documented contract
 * rather than a guess at someone else's shape.
 *
 * It used to probe three holders (adding `chunk.metadata`) × three key
 * spellings (`authority`, `sourceAuthority`) and unwrap `{label}`/
 *`{name}` objects, justified in a comment saying the field was "owned
 * by a lane landing in parallel" and might yet be renamed. Both lanes
 * landed in af72417; there is no parallel lane and no rename to absorb.
 * None of the extra shapes was ever produced — medical-kb.ts reads the
 * backend's snake_case `authority_label` out of metadata and stamps the
 * camelCase field itself (MedicalKbRetriever.searchOnce) — and none was ever
 * tested, so the breadth was defence against nothing that could happen.
 *
 * The RUNTIME check on the value stays, and is not the same thing. The
 * label is now rendered to the patient (AuthorityChip.tsx), so a
 * backend that answers `42`, three spaces, or a paragraph must produce
 * no chip rather than a nonsense one: anything not a non-empty string
 * within MAX_AUTHORITY_CHARS yields null, and the caller then deletes
 * the field outright.
 */
const readAuthorityLabel = (
  citation: Citation | undefined,
  chunk: RetrievedChunk | undefined,
): string | null => {
  for (const candidate of [citation?.authorityLabel, chunk?.authorityLabel] as unknown[]) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed.length > MAX_AUTHORITY_CHARS) continue;
    return trimmed;
  }
  return null;
};

/**
 * What the model is told when a lookup could not run.
 *
 * This replaces「请基于常识与上下文继续作答」, which was in the codebase
 * for the whole time the Python KB service was flaky. Read literally it
 * instructs the model to answer a rare-disease question from its own
 * priors and — because nothing downstream marks the answer differently —
 * to deliver that guess in the identical voice it uses for a sourced
 * answer. For a population where the median diagnostic odyssey is close
 * to a decade and most people arrive already misdiagnosed, that is the
 * single most damaging sentence the product could contain.
 *
 * Note that neither branch says "retry". The gather ends on a repeated
 * call and the last round carries no tools, so a promised retry cannot
 * happen; announcing one just spends the patient's answer on a sentence
 * about an action nobody will take (see FINAL_TURN_DIRECTIVE in run.ts).
 */
const failureInstruction = (kind: RetrievalFailureKind, reason: string): string => {
  const code = RETRIEVAL_FAILURE_CODES[kind];
  if (kind === 'trials') {
    // Deliberately not a variant of the corpus text. The sentences it
    // has to keep apart are 「平台取不到试验列表」 and 「没有试验在招
    // 募」 — and what the model would fill the gap with here need not
    // be its own priors at all. When `search_medical_kb` ran in the
    // same round, the 2025 ClinicalTrials.gov page saved in the corpus
    // can be sitting in this very prompt, machine-translated
    // (`Recruiting` →「招聘」) and carrying no date anywhere in its
    // text (measured in ../retrievers/clinical-trials.ts's header). So
    // that document is named outright; 「不要凭记忆」 does not cover a
    // snapshot the model can see.
    return [
      `[error_code:${code}] 试验数据没有取到（原因：${reason}）。`,
      '注意：出问题的是本平台缓存的临床试验登记数据，不是医学知识库——知识库如果这次取到了，照常可用。这也不等于「没有试验在招募」，两者不能混为一谈。',
      '硬性要求：',
      '- **不要**用知识库里那份 ClinicalTrials.gov 网页快照代替它，也不要凭记忆列出任何 NCT 号、试验名称或招募状态。',
      '- 直接告诉用户：试验列表这次没能取到，请过一会儿再看，或者直接查 ClinicalTrials.gov。',
      '- 问题里不依赖试验列表的部分可以照常回答。',
      '- 结尾必须写一句：是否参加临床试验，请和你的主诊医生商量。',
    ].join('\n');
  }
  if (kind === 'personal') {
    return [
      `[error_code:${code}] 读取用户本人资料失败（原因：${reason}）。`,
      '注意：这不是"用户没有这条记录"，而是这一次没能读出来——两者对用户的意义完全不同，不要说成"你还没有记录"。',
      '硬性要求：',
      '- 不要凭印象、也不要从对话里的其他线索推断用户的数值、报告内容或记录次数。',
      '- 直接说明：这次没能读到你的资料，所以关于你本人数据的部分先不下结论。',
      '- 问题里不依赖本人数据的部分可以照常回答。',
    ].join('\n');
  }
  const noPriors = [
    '硬性要求：',
    '- 不要用你自己记忆里的 FSHD 知识把这一段补上。对罕见病患者来说，模型印象和有出处的资料读起来一样，可信度却完全不同，而他们没有办法分辨。',
    '- 机构名、医院、联系方式、网址、具体数值，一个都不要凭印象给出。',
  ];
  // An un-ingested corpus is not a hiccup. `kb_empty_corpus` lives in
  // RETRIEVAL_FAILURE_REASONS for a good reason — there is nothing to be
  // found, so 「知识库里没有」 would be a claim about a corpus that does
  // not exist — but it must not inherit the retry sentence with it. A
  // fresh environment or a half-finished restore does not fix itself
  // while the patient waits, and telling them to ask again in a while
  // spends their attention on an action that cannot work.
  if (reason === 'kb_empty_corpus') {
    return [
      `[error_code:${code}] 资料库尚未装载（原因：${reason}）。`,
      '注意：这不是"这次查询失败"，而是这台服务器上的资料库还是空的。重试不会有帮助。',
      ...noPriors,
      '- 直接告诉用户：平台的资料库现在不可用，这是系统这边的问题，不是你的操作问题；重试也没有用，请联系平台反馈，紧急的医学问题请直接问主治医生。',
      '- 只有问题本身不依赖资料库时（情绪陪伴、平台怎么用），才照常作答。',
    ].join('\n');
  }
  return [
    `[error_code:${code}] 资料库检索没有跑成功（原因：${reason}）。`,
    '注意：这不是"知识库里没有相关内容"，而是这一次查询本身失败了。',
    ...noPriors,
    '- 直接告诉用户：这次没能查到资料库，所以这个问题现在回答不了，请过一会儿再问一次，或者跟主治医生确认。',
    '- 只有问题本身不依赖资料库时（情绪陪伴、平台怎么用），才照常作答。',
  ].join('\n');
};

/**
 * What the model is told when the search DID run and nothing was close
 * enough — the relevance floor took every candidate.
 *
 * This is the other half of the floor, and without it the floor makes
 * the product worse rather than better. Before the floor, a question
 * about DMD or 针灸 returned the nearest FSHD chunks and the model wrote
 * a confident answer from material about a different disease. With the
 * floor and without this instruction, the same question returns zero
 * chunks rendered as 「（无内容）」 — which reads to the model exactly
 * like a corpus with no opinion, and it improvises from priors instead.
 *
 * Deliberately NOT a RETRIEVAL_FAILURE_REASON: 「查了，没有」 is not
 * 「没查成」, and conflating them would have the product apologise for a
 * malfunction every time someone asks something off-topic.
 */
const noRelevantResultsInstruction = (): string =>
  [
    '[error_code:no_relevant_results] 资料库查过了，但没有足够相关的内容。',
    '注意：检索本身是成功的——这个问题落在本平台资料库的范围之外，不是系统故障，不要说成"查询失败"，也不要让用户重试。',
    '硬性要求：',
    '- 不要用你自己记忆里的知识把这一段补上。本平台的资料库只覆盖 FSHD 相关内容；用户问到别的病、别的疗法、或者具体某家医院能不能做某项检查时，这里就是空的。',
    '- 直接说明：这个问题在平台的资料库里没有找到相关资料。',
    '- 如果问题看起来和 FSHD 有关但换个说法可能查得到，可以建议用户换个问法；如果明显超出范围（其他疾病、就医推荐、药品购买），直接说这不在资料库范围内，建议问主治医生。',
    '- 只有问题本身不依赖资料库时（情绪陪伴、平台怎么用），才照常作答。',
  ].join('\n');

const renderChunks = (
  chunks: RetrievedChunk[],
  opts: BuildContextOptions & { citationIndex: CitationIndex },
  failure: { kind: RetrievalFailureKind; reason: string } | null,
  /** The search ran and the relevance floor took every candidate. */
  searchedNothingRelevant = false,
): { text: string; fieldsUsed: string[] } => {
  if (chunks.length === 0) {
    // 「（无内容）」 was all the model ever saw, for all three of "the
    // search could not run", "the search ran and nothing was close
    // enough", and "there was genuinely nothing". With the KB service
    // down it read the first as the last, kept being told by its system
    // prompt to consult the KB, and answered by announcing another
    // search. Each outcome now names itself.
    if (failure) {
      return { text: failureInstruction(failure.kind, failure.reason), fieldsUsed: [] };
    }
    if (searchedNothingRelevant) {
      return { text: noRelevantResultsInstruction(), fieldsUsed: [] };
    }
    return { text: '（无内容）', fieldsUsed: [] };
  }
  const sections: string[] = [];
  const fieldsUsedSet = new Set<string>();
  chunks.forEach((chunk) => {
    const rendered = renderChunkForPrompt(chunk, opts);
    if (!rendered.content) return;
    // Run-global, matching the client's citation array. NOT the chunk's
    // index within this tool call — see CitationIndex.
    const number = opts.citationIndex.numberFor(chunk.id);
    const provenance = chunk.sourceFile
      ? `(${chunk.source} / ${chunk.sourceFile})`
      : `(${chunk.source})`;
    const authorityLabel = opts.citationIndex.authorityFor(chunk.id);
    const header =
      number === null
        ? // No citation card exists for this chunk, so there is no [N]
          // the patient could open. Say so rather than hand out a number
          // that resolves to somebody else's source.
          `【参考资料·无法引用】${provenance}`
        : `【片段${number}】${provenance}`;
    const suffix = authorityLabel ? `｜来源等级：${authorityLabel}` : '';
    const safeContent = stripDelimiters(rendered.content);
    sections.push(`${header}${suffix}\n${CHUNK_BEGIN}\n${safeContent}\n${CHUNK_END}`);
    rendered.fieldsUsed.forEach((f) => fieldsUsedSet.add(f));
  });
  return {
    text: sections.length > 0 ? sections.join('\n\n') : '（无可用内容）',
    fieldsUsed: [...fieldsUsedSet],
  };
};

export const buildContext = (
  executed: ExecutedToolCall[],
  opts: BuildContextOptions,
): BuiltContext => {
  const citationIndex = opts.citationIndex ?? new CitationIndex();
  const renderOpts = { ...opts, citationIndex };
  const toolMessages: ToolMessagePayload[] = [];
  const allFieldsUsed = new Set<string>();
  let usedPersonalData = false;
  const failures = { corpus: false, personal: false };

  for (const call of executed) {
    if (call.error || !call.retrieval) {
      // The raw `call.error` can contain DB column names, parameter
      // values, even fragments of patient data (the executor wraps
      // whatever the retriever throws). Reflecting that back into the
      // LLM prompt risks the model echoing it into the user-visible
      // answer. Use a generic message + the toolCallId as the
      // correlation handle; the real detail is in the logs.
      if (call.error) {
        opts.logger.warn(
          { toolCallId: call.toolCallId, tool: call.toolName, error: call.error },
          'tool execution failed; redacted message will be sent to LLM',
        );
      }
      const kind: RetrievalFailureKind = TRIALS_TOOLS.has(call.toolName)
        ? 'trials'
        : PERSONAL_TOOLS.has(call.toolName)
          ? 'personal'
          : 'corpus';
      // No flag for `trials`: the tool message below is the whole of
      // what is reported. Raising `corpus` here instead would put a
      // server-written banner about the medical knowledge base over an
      // answer whose knowledge-base chunks are in the same prompt.
      if (kind !== 'trials') failures[kind] = true;
      toolMessages.push({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        // Chinese, to match the system prompt + UI tone: models
        // routinely paste tool-message text into the answer when
        // uncertain, and an English string here would break the tone
        // contract the rest of the orchestrator enforces. The reason is
        // deliberately generic — `tool_error` rather than the thrown
        // message — because the thrown message is exactly the
        // `DETAIL: Key (col)=(value)` shape the audit scrubber exists
        // to defuse.
        content: `工具调用失败 (id=${call.toolCallId})。\n${failureInstruction(kind, 'tool_error')}`,
      });
      continue;
    }

    // Register before rendering: the chunk headers below are numbered
    // out of this index, so every citation for this call has to be in
    // it first.
    const chunkById = new Map(call.retrieval.chunks.map((chunk) => [chunk.id, chunk]));
    for (const citation of call.retrieval.citations) {
      // The retriever normally stamps the label on the citation itself.
      // When only the chunk carries it, copy it across — the citation is
      // what the patient's snippet card is built from, and a card that
      // silently drops the grade is the failure this is here to avoid.
      const label = readAuthorityLabel(citation, chunkById.get(citation.chunkId));
      const normalized: Citation = { ...citation };
      // Normalised rather than passed through. `authorityLabel` is the
      // retrieval lane's field, but this is the object the patient's
      // snippet chip is built from, and a chip rendering `42` or three
      // spaces because a backend hiccuped is our failure, not theirs.
      // Setting it here also makes `authorityFor` correct by
      // construction: prompt header and chip read the same value.
      if (label) normalized.authorityLabel = label;
      else delete normalized.authorityLabel;
      citationIndex.register(normalized);
    }

    const reason = retrievalFailureReason(call.retrieval);
    // Classified by retriever id here and by tool name above, on
    // purpose: the same subsystem must get the same sentence whether it
    // returned a reasoned empty result or threw. `clinical_trials` has
    // no reason in RETRIEVAL_FAILURE_REASONS today — `cache_unreadable`
    // is deliberately kept out of that set, because membership routes
    // straight back onto `corpus` — so this branch is what keeps a
    // reason added later from silently reprinting the KB sentence.
    const kind: RetrievalFailureKind = TRIALS_SOURCES.has(call.retrieval.retrieverId)
      ? 'trials'
      : PERSONAL_SOURCES.has(call.retrieval.retrieverId)
        ? 'personal'
        : 'corpus';
    if (reason && kind !== 'trials') failures[kind] = true;

    // Read the RAW metadata reason, not the failure-filtered one:
    // `no_relevant_results` is deliberately excluded from
    // RETRIEVAL_FAILURE_REASONS (see medical-kb.ts), so asking
    // `retrievalFailureReason` about it always answers null.
    const rawReason = call.retrieval.metadata?.reason;
    const { text, fieldsUsed } = renderChunks(
      call.retrieval.chunks,
      renderOpts,
      reason ? { kind, reason } : null,
      rawReason === NO_RELEVANT_RESULTS,
    );
    fieldsUsed.forEach((f) => allFieldsUsed.add(f));
    if (PERSONAL_SOURCES.has(call.retrieval.retrieverId) && call.retrieval.chunks.length > 0) {
      usedPersonalData = true;
    }

    toolMessages.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      content: `${call.display}\n\n${text}`,
    });
  }

  return {
    toolMessages,
    citations: citationIndex.citations,
    fieldsUsed: [...allFieldsUsed],
    usedPersonalData,
    failures,
  };
};
