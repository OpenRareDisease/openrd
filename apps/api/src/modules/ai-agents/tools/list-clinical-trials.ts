/**
 * Tool wrapper for the clinical-trials retriever.
 *
 * Always advertised: a trial registry is public information and this
 * reads nothing belonging to the patient, so there is no consent
 * minimum — same as `search_medical_kb`.
 *
 * WHAT THE TOOL CONTRACT ENFORCES, AND WHAT IT ONLY SAYS
 *
 * §A5 draws two lines the model must not cross: it must not judge
 * whether a patient is eligible, and it must not state what a trial
 * found. Those are not asks in a prompt here. The eligibility text and
 * the results section that ClinicalTrials.gov publishes are not in the
 * retriever's output, not in this tool's chunks, and not in the prompt
 * — there is no wording the model could choose that would surface
 * them. What keeps them out is in the retriever's header
 * (retrievers/clinical-trials.ts). The `display` text below still tells the
 * model both rules, for the case it tries to answer them from its own
 * priors instead; that half is a request, and it is labelled as one.
 *
 * The freshness half works the other way round. Nothing can stop a
 * model omitting a date, so the dates are made unavoidable instead:
 * every rendered record carries 「本平台读取时间」 on its own line
 * (retrievers/clinical-trials.ts), the per-source fetch outcome is
 * stated above the records, and both are stated again in the citation
 * snippet the patient can open.
 *
 * WHY NOTHING HERE THROWS
 *
 * `parseArgs` accepts whatever the model sent — including a string
 * that is not valid JSON — and reports what it did with it in
 * `display`. It is not leniency. A `ToolValidationError` leaves the
 * executor with `call.error` and no retrieval, and context-builder
 * classifies that by tool name; while `list_clinical_trials` was
 * unclassified it landed in `corpus` and the patient was told 「资料库
 * 检索没有跑成功」 about the MEDICAL KNOWLEDGE BASE, which had not
 * failed and whose chunks were sitting in the same prompt. Malformed
 * arguments are the reachable case, not a hypothetical:
 * `llm/siliconflow.ts:121` forwards the provider's `arguments`
 * unvalidated and `orchestrator/run.ts:934` concatenates streamed
 * fragments, so a `length`-truncated tool call hands a half-written
 * JSON object straight to `parseArgs`.
 *
 * Two things hold that shut and both are needed. Here: the tool has no
 * required argument, so no argument error should stop it answering —
 * anything unusable is dropped, named in `display`, and the model can
 * correct itself with the results in front of it. And in
 * `orchestrator/context-builder.ts`: `list_clinical_trials` is in its
 * TRIALS_TOOLS set, so the failures this file cannot catch — chiefly
 * the executor's wall-clock timeout around `execute`, which fires
 * OUTSIDE the retriever's own try/catch — name the trial cache
 * instead of the knowledge base. The retriever refuses to throw for
 * the same reason (see its cache_unreadable branch).
 */

import type { ITool, ToolContext, ToolExecutionResult } from './base.js';
import { isPlainObject, safeParseJson } from './base.js';
import {
  TRIAL_SOURCE_LABELS,
  trialFetchState,
  type TrialSourceStatus,
} from '../../trials/trials.service.js';
import type { RetrieveResult } from '../retrievers/base.js';
import {
  TRIALS_MAX_LIMIT,
  TRIAL_STATUS_FILTERS,
  normalizeStatus,
  type ClinicalTrialsRetriever,
  type TrialStatusFilter,
  type TrialsRetrievalMetadata,
} from '../retrievers/clinical-trials.js';

interface ListClinicalTrialsArgs {
  /** A registry status word, normalised. Any word — see the retriever's
   *  `TrialsRetrieveFilter`. */
  status?: string;
  limit?: number;
  /** What was dropped or changed on the way in, in the model's own
   *  language, to be printed above the results. Empty in the ordinary
   *  case. */
  notes: string[];
}

const STATUS_DESCRIPTIONS: Record<TrialStatusFilter, string> = {
  RECRUITING: '正在招募',
  NOT_YET_RECRUITING: '已登记但还没开始招募',
  ACTIVE_NOT_RECRUITING: '在进行中，但不再招募新受试者',
  COMPLETED: '已完成',
  TERMINATED: '已提前终止',
  WITHDRAWN: '已撤回，没有入组任何受试者',
};

const PARAMETERS_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      // No `enum`. The registry uses words this platform has no Chinese
      // for — `ENROLLING_BY_INVITATION` and `UNKNOWN` are 10 of the 92
      // rows cached on 2026-08-14 — and three of those studies are
      // still taking participants. An enum of the six translated words
      // would make those rows unaskable, and the tool result names them
      // to the model every time it filters, so it must be able to ask.
      description: [
        '可选。只返回状态词等于它的试验。用户问「哪些还在招募」时传 RECRUITING。',
        '本平台有固定中文译法的状态词：',
        ...TRIAL_STATUS_FILTERS.map((s) => `- ${s}：${STATUS_DESCRIPTIONS[s]}`),
        '也可以传登记库的其它原词（例如 ENROLLING_BY_INVITATION）——工具结果里会列出缓存中实际有哪些状态词、各多少条，照着传即可。',
        '不确定就不要传：不传就是返回全部缓存记录，每条都带状态词，你可以自己读。',
      ].join('\n'),
    },
    limit: {
      type: 'integer',
      description: `最多返回多少条试验记录。默认 12，上限 ${TRIALS_MAX_LIMIT}。返回条数少于命中条数时，工具会明确告诉你还有多少条没给出。`,
      minimum: 1,
      maximum: TRIALS_MAX_LIMIT,
    },
  },
  additionalProperties: false,
} as const;

const validate = (raw: unknown): ListClinicalTrialsArgs => {
  const out: ListClinicalTrialsArgs = { notes: [] };
  if (!isPlainObject(raw)) {
    // No arguments at all is the tool's ordinary call, so arguments
    // that are not an object cost nothing to ignore — and ignoring them
    // silently is what would be wrong, hence the note.
    if (raw !== undefined && raw !== null) {
      out.notes.push('注意：这次调用的参数不是一个对象，已全部忽略，下面是不带筛选的结果。');
    }
    return out;
  }

  if (raw.status !== undefined && raw.status !== null) {
    if (typeof raw.status !== 'string' || !raw.status.trim()) {
      out.notes.push('注意：这次传的 status 不是一个状态词，已忽略，下面是不带筛选的结果。');
    } else {
      // Any word, normalised — including one the registry does not use.
      // It matches nothing and comes back as 「命中 0 条」 beside the
      // census of the words that ARE in the cache, which is a true
      // answer the model can act on. Rejecting it instead would end the
      // call in a `ToolValidationError`, and the patient would be told
      // the knowledge base failed (see the file header).
      out.status = normalizeStatus(raw.status);
    }
  }

  if (raw.limit !== undefined && raw.limit !== null) {
    if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) {
      out.notes.push('注意：这次传的 limit 不是数字，已按默认条数返回。');
    } else {
      out.limit = Math.min(TRIALS_MAX_LIMIT, Math.max(1, Math.floor(raw.limit)));
    }
  }

  return out;
};

/**
 * One line per registry, saying what its last fetch did.
 *
 * Every state gets a sentence, including the ones with nothing to
 * report. A source that has never been fetched and a source that was
 * fetched successfully an hour ago must not produce the same silence:
 * the whole reason `trial_fetch_runs` is read on the request path is
 * that 「我们没拉到」 and 「登记库里没有」 are different answers, and
 * only one of them is about the trials.
 */
const describeSource = (status: TrialSourceStatus): string => {
  const name = TRIAL_SOURCE_LABELS[status.source];
  // Two different facts and the line carries both, because they are
  // facts about different things — not because they drift apart.
  // `lastSuccessAt` is when a RUN reported finishing; `fetchedAt` is
  // the instant stamped on the ROWS this answer is about to render.
  // `replaceTrialRecords` (../../trials/trials.repository.ts) re-stamps
  // every surviving row with its own run's instant inside that run's
  // transaction, so for a source that HAS rows the two are one run's
  // duration apart and no more. Measured on the dev database on
  // 2026-08-14:
  //
  //   select (select max(finished_at) from trial_fetch_runs f
  //            where f.source = r.source and f.ok) - max(r.fetched_at)
  //     from trial_records r group by r.source;
  //   -- ctgov | 00:00:00.000946
  //
  // What they are not is interchangeable. A source can have a
  // successful run and no rows at all — an empty record list DELETEs
  // the lot, which is what chinadrugtrials does on every run today —
  // and then `fetchedAt` is null, there is no read time to print, and
  // the parenthetical is omitted rather than filled in from the run.
  // Printing only the run's date would date rows by juxtaposition,
  // including in the case where there are none.
  const cached = status.fetchedAt
    ? `缓存 ${status.recordCount} 条（这些记录读取于 ${status.fetchedAt}）`
    : `缓存 ${status.recordCount} 条`;
  const previously = status.lastSuccessAt
    ? `上一次成功是 ${status.lastSuccessAt}`
    : '从来没有成功过';
  switch (trialFetchState(status)) {
    case 'ok':
      return `- ${name}：最后一次成功拉取 ${status.lastSuccessAt}，${cached}`;
    case 'failed':
      return (
        `- ${name}：最近一次拉取失败（开始于 ${status.lastRun?.startedAt}）；` +
        `${previously}，${cached}`
      );
    case 'unfinished':
      return (
        `- ${name}：最近一次拉取只有开始、没有结束（开始于 ${status.lastRun?.startedAt}）——` +
        '可能正在跑，也可能中途挂掉了，平台无法区分；' +
        `${previously}，${cached}`
      );
    case 'never_ran':
      return `- ${name}：从来没有拉取过，${cached}`;
  }
};

/** The §A5 boundaries, restated to the model every call. Neither the
 *  eligibility text nor the results section is in the chunks (see the
 *  file header), so those two lines exist only to stop the model
 *  answering from its own memory. The other three are requests. */
const BOUNDARY_RULES = [
  '硬性要求：',
  // 登记库 is on this list because `renderTrial` puts it on every
  // record, and because the mainland line `describeRetrieval` prints
  // just above these rules orders the model to say which registry a
  // row came from. A closed list of permitted facts that leaves out
  // the one another rule demands is two instructions that cannot both
  // be followed.
  '- 只能陈述上面列出的事实：登记库、登记号、状态、期别、申办方、国家、登记库最后更新日期、链接。',
  '- 提到任何一条试验时，必须同时给出它的登记号、状态、和「本平台读取时间」，并且带上链接。',
  '- 不要判断用户是否符合入组条件，不要说「你可能符合」「你应该能参加」。本工具不提供入组标准，你手上也没有。',
  '- 不要陈述任何疗效或结果结论。本工具不提供试验结果、摘要或结论，你手上同样没有。',
  '- 结尾必须写一句：是否参加临床试验，请和你的主诊医生商量。',
];

/** What to say when the platform has no cached trials to speak from.
 *  Spelled out because the alternative is the model reaching for the
 *  knowledge base's 2025 snapshot, which is the failure this whole tool
 *  exists to end.
 *
 *  It replaces BOUNDARY_RULES rather than joining them — none of the
 *  first four apply to an answer with no records in it — but §A5's
 *  closing sentence is not conditional on there being a list, and this
 *  is the branch where the model is sending the patient off to a
 *  registry unaided, so it is repeated here verbatim. */
const EMPTY_CACHE_RULES = [
  '硬性要求：',
  '- 平台现在没有可用的试验数据，这是平台这边的问题，不是「没有试验在招募」。两者不能混为一谈。',
  '- 直接告诉用户：试验列表现在取不到，请过一会儿再看，或者直接查 ClinicalTrials.gov。',
  '- **不要**用知识库里那份 ClinicalTrials.gov 网页快照代替它，也不要凭记忆列出任何 NCT 号、试验名称或招募状态。',
  '- 结尾必须写一句：是否参加临床试验，请和你的主诊医生商量。',
];

/**
 * What each `emptyResult` reason means, in the language the model is
 * answering in.
 *
 * The point of naming them is that this tool's failure must not read
 * like the knowledge base's. The KB is a different subsystem, it is
 * usually up while this one is down, and its chunks are sitting in the
 * same prompt — so every line here says which half is missing.
 */
const REASON_ZH: Record<string, string> = {
  cache_unreadable:
    '读取本平台的试验缓存失败了，这是平台这边的问题，和医学知识库无关（知识库的内容如果有，照常可用）。',
  aborted: '这次请求在读取试验数据之前就中断了。',
};

const describeRetrieval = (retrieval: RetrieveResult, notes: string[] = []): string => {
  const meta = retrieval.metadata as unknown as TrialsRetrievalMetadata;
  const lines: string[] = [...notes];

  // The retriever returned an `emptyResult` rather than a snapshot: the
  // caller hung up, or the cache could not be read. Fall through to the
  // same instruction an empty cache gets — whatever went wrong, the one
  // thing that must not happen is the model filling the gap from the
  // 2025 snapshot or from memory. Read as「is this the snapshot
  // shape?」rather than「is the reason one I know?」, so a reason added
  // later cannot silently take the happy path with `sources` undefined.
  if (!Array.isArray(meta?.sources)) {
    const reason =
      typeof retrieval.metadata?.reason === 'string' ? retrieval.metadata.reason : 'unknown';
    return [
      ...lines,
      `clinical_trials: 没有取到试验数据（${reason}）`,
      ...(REASON_ZH[reason] ? [REASON_ZH[reason]] : []),
      ...EMPTY_CACHE_RULES,
    ].join('\n');
  }

  const header =
    meta.statusFilter === null
      ? `clinical_trials: 返回 ${meta.returned} 条（缓存共 ${meta.cachedTotal} 条）`
      : `clinical_trials: 返回 ${meta.returned} 条（筛选 ${meta.statusFilter} 命中 ${meta.matched} 条，缓存共 ${meta.cachedTotal} 条）`;
  lines.push(header);
  lines.push('数据来源：本平台缓存的登记库记录，不是实时查询——下面每条记录都带了读取时间。');
  lines.push(...meta.sources.map(describeSource));

  if (meta.returned < meta.matched) {
    lines.push(
      `注意：命中 ${meta.matched} 条，这里只给出了前 ${meta.returned} 条（按「还在招募的排前面、登记库更新日期新的排前面」排序）。不要说成一共只有 ${meta.returned} 条。`,
    );
  }

  // The cache is not a source of truth about which registries exist; it
  // is a source of truth about what we managed to read. So the mainland
  // half is stated in the answer rather than left as an absence, and
  // what §A5 is holding up is that a patient must never read this list
  // as complete for China. Both branches carry that — one says no
  // mainland record came back and where to go instead, the other says
  // which platform the mainland rows came from and that scraping a site
  // with no public API cannot be assumed complete.
  //
  // NEITHER BRANCH SAYS 「不含只在国内登记的试验」 ANY MORE. That is a
  // claim about this platform's scope, and this platform fetches
  // chinadrugtrials.org.cn — the source is in TRIAL_SOURCES, the cron
  // runs it, and on the day this was written its run came back
  // successful with zero rows. Printed over that state it told the
  // patient the mainland registry was outside our reach when what had
  // happened is that we looked and found nothing. The screen deleted
  // that sentence rather than qualifying it (apps/mobile/lib/trials.ts,
  // `describeChinaCoverage`); here it was the worse copy of the two,
  // because this text is an instruction to a model that will obey it.
  // What replaces it is the same fact the screen states — no mainland
  // record is in front of the reader, which is not the registry's
  // answer about whether any exist.
  //
  // BRANCHED ON THE RENDERED ROWS, not on the cache's row count. A
  // status filter, or the limit, can leave a list with no mainland row
  // in it while the cache holds several, and 「这份名单里国内登记的那部
  // 分」 over that list names a part of it that is not there.
  // `describeChinaCoverage` branches on the records that reached the
  // screen for the same reason, and the two surfaces must keep saying
  // the same thing.
  const chinaRendered = retrieval.chunks.some(
    (chunk) => chunk.metadata?.source === 'chinadrugtrials',
  );
  if (chinaRendered) {
    lines.push(
      `- 必须说明：这份名单里国内登记的那部分来自${TRIAL_SOURCE_LABELS.chinadrugtrials}；该平台没有公开接口，只能按页面抓取，可能不完整，国内的请以 chinadrugtrials.org.cn 上的原始记录为准。`,
    );
  } else {
    // The middle clause describes the list, so it is withheld where
    // there is no list — a filter that matched nothing and an empty
    // cache both reach this line, and the second of them goes on to
    // print EMPTY_CACHE_RULES. Same gate as the screen's
    // `shownListFetchedOn`.
    lines.push(
      `- 必须说明：这次返回的记录里没有一条来自${TRIAL_SOURCE_LABELS.chinadrugtrials}` +
        `${retrieval.chunks.length > 0 ? `，下面这份名单目前只有 ${TRIAL_SOURCE_LABELS.ctgov} 的记录` : ''}。` +
        '这不等于国内就没有相关的试验，国内登记的试验请直接查 chinadrugtrials.org.cn。',
    );
  }

  const counts = Array.isArray(meta.statusCounts) ? meta.statusCounts : [];
  const census = counts.map((c) => `「${c.status}」${c.count} 条`).join('、');

  if (meta.statusFilter !== null && meta.matched === 0 && census) {
    // A filter that matched nothing is a true answer about this cache,
    // and the census is what turns it into one the model can act on
    // instead of guessing at spellings.
    lines.push(
      `注意：缓存里没有状态词等于 ${meta.statusFilter} 的记录。缓存里实际有的状态词是：${census}。` +
        '需要的话用其中一个原词再查一次；不要因为这次是 0 条就说「没有试验」。',
    );
  } else if (meta.statusFilter !== null) {
    // The words outside the six the schema lists are still rows a
    // patient can ask about — a study still taking participants is
    // among them — so they are named with the spelling that fetches
    // them, not left as an absence. The current filter is excluded:
    // saying a word is missing from the results of a filter on that
    // same word would be false.
    //
    // WHAT THE SENTENCE MAY CLAIM ABOUT THEM IS ALMOST NOTHING, and
    // that is the fix. It used to say they had no Chinese rendering
    // and did not mean the same thing as the filter, then instruct the
    // model to pass that on. Against a cache holding mainland rows —
    // 药物临床试验登记与信息公示平台 writes its 试验状态 in Chinese, and
    // the refresh stores that word verbatim — both are false: 已完成
    // reaches this line as an untranslated word while being the very
    // Chinese ../../trials/status-map.ts fixes for COMPLETED, and a
    // filter on COMPLETED then told the model that 已完成 does not mean
    // COMPLETED. What is true is only why they are absent: the filter
    // compares the registry's word verbatim, and these are other words.
    const others = counts.filter(
      (c) => !c.translated && normalizeStatus(c.status) !== meta.statusFilter,
    );
    if (others.length > 0) {
      const listed = others.map((c) => `「${c.status}」${c.count} 条`).join('、');
      lines.push(
        `注意：缓存里还有${listed}。筛选是按状态词原样匹配的，这些词和 ${meta.statusFilter} 不是同一个词，所以不在这次结果里；` +
          '两个登记库各写各的状态词，写法不一样不代表说的不是同一件事。' +
          '如果用户问的范围可能包含它们，说明一下，或者直接用原词再查一次。',
      );
    }
  }

  lines.push(...(meta.cachedTotal === 0 ? EMPTY_CACHE_RULES : BOUNDARY_RULES));
  return lines.join('\n');
};

export class ListClinicalTrialsTool implements ITool {
  readonly name = 'list_clinical_trials';
  /**
   * A tool description is an instruction, so it may not name a registry
   * the cache is not limited to.
   *
   * It opened with 「（来自 ClinicalTrials.gov）」 and promised an NCT
   * number on every record, from when that was the only source. The
   * cache is keyed on TRIAL_SOURCES, `readTrialSnapshot` returns rows
   * for all of them, `renderTrial` stamps each one with its own 登记库,
   * and the mainland registry's id is a CTR number. A model reading
   * this sentence over a mixed list has been told to file every row
   * under one registry — and the same run's `display` tells it to say
   * which rows came from the other one.
   *
   * What replaces it is what is true of every record whatever fetched
   * it: each one says where it came from. The 2025 snapshot sentence
   * further down keeps ClinicalTrials.gov by name, because that one is
   * about a specific page in the knowledge base and not about the
   * cache.
   */
  readonly description =
    '查询本平台缓存的 FSHD 临床试验登记记录，每条都写明来自哪个登记库，并带登记号、状态、期别、申办方、国家、登记库最后更新日期、本平台读取时间和链接。' +
    '凡是问到临床试验——哪些在招募、有没有新的试验、某个 NCT 是什么情况、试验进展——都必须调用这个工具。' +
    '知识库里那份 ClinicalTrials.gov 列表是 2025 年的网页快照、而且状态词是机器翻译的，不能用来回答「现在还在不在招募」。' +
    '本工具不提供入组标准，也不提供试验结果或疗效结论。';
  readonly parametersSchema: Record<string, unknown> = PARAMETERS_SCHEMA;
  // `minConsent` is deliberately not declared: public registry data,
  // nothing patient-scoped, so the registry advertises it at every
  // consent level the orchestrator will run at. Same as
  // `search_medical_kb`.

  constructor(private readonly retriever: ClinicalTrialsRetriever) {}

  parseArgs(rawJson: string): ListClinicalTrialsArgs {
    let raw: unknown;
    try {
      raw = safeParseJson(rawJson);
    } catch {
      // `safeParseJson` throws `ToolValidationError` on a string that
      // does not parse, and the executor turns that into `call.error`.
      // Nothing about a malformed argument string means the trials
      // cannot be listed: there is no required argument, so the whole
      // of the correct response is「ignore it and answer unfiltered」,
      // said out loud rather than swallowed. See the file header for
      // how a truncated tool call reaches this line.
      return {
        notes: ['注意：这次调用的参数不是合法的 JSON，已全部忽略，下面是不带筛选的结果。'],
      };
    }
    return validate(raw);
  }

  async execute(args: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    const parsed = args as ListClinicalTrialsArgs;
    const retrieval = await this.retriever.search(
      {
        question: '',
        filter: parsed.status ? { status: parsed.status } : undefined,
        limit: parsed.limit,
      },
      {
        userId: ctx.userId,
        consentLevel: ctx.consentLevel,
        requestId: ctx.requestId,
        logger: ctx.logger,
        signal: ctx.signal,
      },
    );
    return { retrieval, display: describeRetrieval(retrieval, parsed.notes ?? []) };
  }
}
