import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './base.js';
import { ListClinicalTrialsTool } from './list-clinical-trials.js';
import { ToolRegistry } from './registry.js';
import type { TrialSourceStatus } from '../../trials/trials.service.js';
import { buildContext } from '../orchestrator/context-builder.js';
import { Executor } from '../orchestrator/executor.js';
import { toLlmTool } from '../orchestrator/planner.js';
import type { RetrieveResult } from '../retrievers/base.js';
import { ClinicalTrialsRetriever } from '../retrievers/clinical-trials.js';

const snapshotMock = vi.fn();

vi.mock('../../trials/trials.service.js', async () => {
  const actual = await vi.importActual<typeof import('../../trials/trials.service.js')>(
    '../../trials/trials.service.js',
  );
  return { ...actual, readTrialSnapshot: (...args: unknown[]) => snapshotMock(...args) };
});

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as ToolContext['logger'];

const ctx: ToolContext = { userId: 'user-1', consentLevel: 'basic', logger: silentLogger };

const SOURCES: TrialSourceStatus[] = [
  {
    source: 'ctgov',
    recordCount: 92,
    fetchedAt: '2026-08-13T04:00:07Z',
    lastRun: { startedAt: '2026-08-13T04:00:00Z', finishedAt: '2026-08-13T04:00:09Z', ok: true },
    lastSuccessAt: '2026-08-13T04:00:09Z',
  },
  {
    source: 'chinadrugtrials',
    recordCount: 0,
    fetchedAt: null,
    lastRun: null,
    lastSuccessAt: null,
  },
];

/** A rendered record, as the retriever chunks one. Only `metadata.source`
 *  is read by the wrapper — it is how the mainland sentence is decided,
 *  because what the reader is holding is the rendered list and not the
 *  cache behind it. */
const chunk = (
  source: 'ctgov' | 'chinadrugtrials',
  sourceId: string,
): RetrieveResult['chunks'][0] =>
  ({
    id: sourceId,
    source: 'clinical_trials',
    content: `【临床试验登记记录】\n登记号：${sourceId}`,
    metadata: { source, sourceId },
    distance: null,
  }) as RetrieveResult['chunks'][0];

const CHINA = '药物临床试验登记与信息公示平台';

/** What production is in: the cron reached the mainland registry, the
 *  run reported success, and it brought back no rows. */
const CN_OK_ZERO: TrialSourceStatus = {
  source: 'chinadrugtrials',
  recordCount: 0,
  fetchedAt: null,
  lastRun: { startedAt: '2026-08-14T00:03:00Z', finishedAt: '2026-08-14T00:03:31Z', ok: true },
  lastSuccessAt: '2026-08-14T00:03:31Z',
};

/** The mainland registry contributing rows to the cache. Whether any of
 *  them reach a given answer is a separate question — the filter and the
 *  limit both decide it. */
const CN_WITH_ROWS: TrialSourceStatus = {
  source: 'chinadrugtrials',
  recordCount: 2,
  fetchedAt: '2026-08-14T04:00:05Z',
  lastRun: { startedAt: '2026-08-14T04:00:00Z', finishedAt: '2026-08-14T04:00:11Z', ok: true },
  lastSuccessAt: '2026-08-14T04:00:11Z',
};

/** `chunks` defaults to `returned` ClinicalTrials.gov records, so a
 *  fixture that says it rendered nothing does not arrive holding a
 *  record — the wrapper reads both the count and the list. */
const result = (
  metadata: Record<string, unknown>,
  chunks?: RetrieveResult['chunks'],
): RetrieveResult => ({
  retrieverId: 'clinical_trials',
  chunks:
    chunks ??
    Array.from({ length: Number(metadata.returned) || 0 }, (_, index) =>
      chunk('ctgov', `NCT0000000${index}`),
    ),
  citations: [],
  metadata,
});

const toolWith = (retrieval: RetrieveResult) => {
  const search = vi.fn().mockResolvedValue(retrieval);
  const tool = new ListClinicalTrialsTool({ search } as unknown as ClinicalTrialsRetriever);
  return { tool, search };
};

const snapshotMeta = (over: Record<string, unknown> = {}) => ({
  sources: SOURCES,
  cachedTotal: 92,
  matched: 92,
  returned: 12,
  statusFilter: null,
  statusCounts: [],
  ...over,
});

describe('ListClinicalTrialsTool.parseArgs', () => {
  it('accepts an omitted filter', () => {
    const { tool } = toolWith(result(snapshotMeta()));
    expect(tool.parseArgs('')).toEqual({ notes: [] });
    expect(tool.parseArgs('{}')).toEqual({ notes: [] });
  });

  it('canonicalises a status the model spelled loosely', () => {
    const { tool } = toolWith(result(snapshotMeta()));
    expect(tool.parseArgs('{"status":"recruiting"}')).toEqual({
      status: 'RECRUITING',
      notes: [],
    });
    expect(tool.parseArgs('{"status":"Active, not recruiting"}')).toEqual({
      status: 'ACTIVE_NOT_RECRUITING',
      notes: [],
    });
  });

  it('passes a status word we have no translation for straight through', () => {
    // Three ENROLLING_BY_INVITATION studies sit in the cache and they
    // are still taking participants. Rejecting the word would end the
    // call in a ToolValidationError, which the patient reads as 「资料库
    // 检索没有跑成功」 — a sentence about the knowledge base.
    const { tool } = toolWith(result(snapshotMeta()));
    expect(tool.parseArgs('{"status":"Enrolling by invitation"}')).toEqual({
      status: 'ENROLLING_BY_INVITATION',
      notes: [],
    });
  });

  it('never throws, whatever the model sent', () => {
    const { tool } = toolWith(result(snapshotMeta()));
    // Every one of these used to be a ToolValidationError, and every
    // one of them ended with the patient being told the medical
    // knowledge base had failed. The tool has no required argument, so
    // there is nothing here that should stop it answering.
    expect(tool.parseArgs('[]').notes[0]).toContain('参数不是一个对象');
    expect(tool.parseArgs('{"status":42}').notes[0]).toContain('不是一个状态词');
    expect(tool.parseArgs('{"limit":"twelve"}').notes[0]).toContain('limit 不是数字');
    expect(tool.parseArgs('{"status":42}').status).toBeUndefined();
    // …including a string that is not JSON at all. `safeParseJson`
    // throws on this one, and a truncated tool call is how it arrives:
    // siliconflow.ts forwards the provider's `arguments` unvalidated
    // and run.ts concatenates streamed fragments, so a `length` stop
    // delivers a half-written object here.
    expect(tool.parseArgs('{"status":"RECRUITING"').notes[0]).toContain('不是合法的 JSON');
    expect(tool.parseArgs('{"status":"RECRUITING"').status).toBeUndefined();
    expect(tool.parseArgs('not json at all').notes[0]).toContain('不是合法的 JSON');
  });

  it('clamps limit into range', () => {
    const { tool } = toolWith(result(snapshotMeta()));
    expect(tool.parseArgs('{"limit":9999}')).toEqual({ limit: 40, notes: [] });
    expect(tool.parseArgs('{"limit":0}')).toEqual({ limit: 1, notes: [] });
  });
});

describe('what the model is told this tool holds', () => {
  /** The description as it reaches the provider: `toLlmTool` is what
   *  the planner sends, so this is the sentence the model obeys. */
  const described = () => toLlmTool(toolWith(result(snapshotMeta())).tool).description;

  it('does not name one registry as the contents of the cache', () => {
    // The cache is keyed on TRIAL_SOURCES and the reader stamps every
    // record with its own 登记库 line. A description saying the records
    // come from ClinicalTrials.gov is an instruction, not a caption: a
    // model holding a 药物临床试验登记与信息公示平台 record and a
    // sentence telling it the cache is ClinicalTrials.gov has been set
    // up to attribute that record to the wrong registry.
    expect(described()).not.toContain('（来自 ClinicalTrials.gov）');
    // Nor is every id an NCT number — the mainland registry's is a CTR
    // number (trials.service.ts, `TrialRecord.sourceId`).
    expect(described()).not.toContain('登记号(NCT)');
    expect(described()).toContain('登记库');
  });

  it('still refuses the knowledge base’s 2025 snapshot by name', () => {
    // That sentence IS about ClinicalTrials.gov specifically — it is
    // the corpus page this tool exists to stop the model quoting — so
    // removing the registry's name from the first sentence must not
    // take it out of the third.
    expect(described()).toContain('知识库里那份 ClinicalTrials.gov 列表是 2025 年的网页快照');
  });

  it('lets the model state the registry it is elsewhere required to name', async () => {
    // The closed list and the mainland line printed above it are two
    // rules about the same answer: 必须说明…来自 that registry. With
    // 登记库 missing from the list they contradicted each other on
    // exactly the answer that has rows from both registries in it.
    const { tool } = toolWith(
      result(snapshotMeta({ sources: [SOURCES[0], CN_WITH_ROWS] }), [
        chunk('ctgov', 'NCT00000001'),
        chunk('chinadrugtrials', 'CTR20250001'),
      ]),
    );
    const { display } = await tool.execute({ notes: [] }, ctx);
    expect(display).toContain('关于某一条试验，只能陈述记录里写明的这几项：登记库、登记号');
    expect(display).toContain(`这份名单里国内登记的那部分来自${CHINA}`);
  });
});

/**
 * The closed list against the record it is a list of.
 *
 * Written this way round because the failure is silent from either
 * side: a field added to `renderTrial` is a fact the model is shown and
 * forbidden to repeat, and a fact demanded by a rule but missing from
 * the list is a contradiction the model resolves by dropping one of
 * them. Nothing in the build links the two files, so this renders a
 * real record through the real retriever and reads the labels off it.
 */
describe('the closed list is the record’s own field list', () => {
  const REAL_TRIAL = {
    source: 'ctgov' as const,
    sourceId: 'NCT04635891',
    title: 'Validation of Motor Outcome Assessments in FSHD',
    statusRaw: 'RECRUITING',
    statusZh: '招募中',
    phase: 'N/A',
    sponsor: 'University of Kansas Medical Center',
    countries: ['United States'],
    url: 'https://clinicaltrials.gov/study/NCT04635891',
    sourceUpdatedAt: '2025-06-01',
    fetchedAt: '2026-08-13T04:00:07Z',
  };

  /** Every 「标签：」 the renderer puts at the head of a line, with the
   *  parenthetical off 「状态（登记库原词）」 — the rule names the fact,
   *  not each spelling of it. */
  const labelsOn = (content: string): string[] => [
    ...new Set(
      content
        .split('\n')
        .map((line) => /^([^：]+)：/.exec(line)?.[1])
        .filter((label): label is string => label !== undefined)
        .map((label) => label.replace(/（.*?）/g, '')),
    ),
  ];

  it('names every fact a rendered record states, and no other', async () => {
    snapshotMock.mockReset();
    snapshotMock.mockResolvedValue({ trials: [REAL_TRIAL], sources: SOURCES });
    const tool = new ListClinicalTrialsTool(new ClinicalTrialsRetriever({} as Pool));
    const { retrieval, display } = await tool.execute({ notes: [] }, ctx);

    const labels = labelsOn(retrieval.chunks[0].content);
    // The renderer prints something. A record that rendered no labels
    // at all would satisfy a set comparison against an empty list.
    expect(labels).toContain('本平台读取时间');
    expect(labels).toContain('标题');

    const rule = display.split('\n').find((line) => line.startsWith('- 关于某一条试验'));
    expect(rule).toBeDefined();
    // The list is what stands between the colon and the full stop.
    const listed = (rule ?? '').split('：')[1].split('。')[0].split('、');
    expect(new Set(listed)).toEqual(new Set(labels));
  });
});

describe('ListClinicalTrialsTool display', () => {
  it('states each registry, its outcome and its date', async () => {
    const { tool } = toolWith(result(snapshotMeta()));
    const { display } = await tool.execute({ notes: [] }, ctx);

    expect(display).toContain('最后一次成功拉取 2026-08-13T04:00:09Z');
    // When the RUN finished and when the ROWS were read are two dates,
    // and the line carries both: a successful run that upserted nothing
    // moves only the first, so dating the rows from it would be dating
    // them by juxtaposition.
    expect(display).toContain('缓存 92 条（这些记录读取于 2026-08-13T04:00:07Z）');
    // A registry that has never been fetched must not read the same as
    // one that was fetched and had nothing.
    expect(display).toContain('从来没有拉取过');
    // …and it has no rows, so there is no read time to invent for it.
    expect(display).toContain('从来没有拉取过，缓存 0 条');
  });

  it('reports a failed fetch as a failure, with the last good date beside it', async () => {
    const { tool } = toolWith(
      result(
        snapshotMeta({
          sources: [
            SOURCES[0],
            {
              source: 'chinadrugtrials' as const,
              recordCount: 3,
              fetchedAt: '2026-08-01T04:00:05Z',
              lastRun: {
                startedAt: '2026-08-13T05:00:00Z',
                finishedAt: '2026-08-13T05:00:30Z',
                ok: false,
              },
              lastSuccessAt: '2026-08-01T04:00:11Z',
            },
          ],
        }),
      ),
    );
    const { display } = await tool.execute({ notes: [] }, ctx);
    expect(display).toContain('最近一次拉取失败（开始于 2026-08-13T05:00:00Z）');
    expect(display).toContain('上一次成功是 2026-08-01T04:00:11Z');
  });

  it('does not report a run that never came back as a success or a failure', async () => {
    const { tool } = toolWith(
      result(
        snapshotMeta({
          sources: [
            {
              ...SOURCES[0],
              lastRun: { startedAt: '2026-08-13T06:00:00Z', finishedAt: null, ok: false },
            },
            SOURCES[1],
          ],
        }),
      ),
    );
    const { display } = await tool.execute({ notes: [] }, ctx);
    // 026's write protocol makes 「started and never came back」 visible;
    // collapsing it into 「失败」 would claim we know something we do not.
    expect(display).toContain('只有开始、没有结束（开始于 2026-08-13T06:00:00Z）');
    expect(display).toContain('平台无法区分');
  });

  it('does not print our own scope over the 国内 registry’s own answer', async () => {
    // Production's shape: the cron fetched chinadrugtrials, the run
    // came back ok, and it brought back nothing. 「不含只在国内登记的试
    // 验」 over that state tells the patient we do not reach that
    // registry on the morning we reached it — and this text is an
    // instruction to a model, so it is said. The screen deleted the
    // same sentence; this is the copy that would have been obeyed.
    const { tool } = toolWith(result(snapshotMeta({ sources: [SOURCES[0], CN_OK_ZERO] })));
    const { display } = await tool.execute({ notes: [] }, ctx);
    expect(display).not.toContain('不含只在国内登记的试验');
    expect(display).toContain(`这次返回的记录里没有一条来自${CHINA}`);
    expect(display).toContain('下面这份名单目前只有 ClinicalTrials.gov 的记录');
    // …and it refuses the conclusion out loud rather than leaving the
    // model to draw it from an empty half.
    expect(display).toContain('这不等于国内就没有相关的试验');
    expect(display).toContain('chinadrugtrials.org.cn');
  });

  it('does not describe a list as having a 国内 part when it has none', async () => {
    // The cache holds mainland rows and the filter left every one of
    // them out. 「这份名单里国内登记的那部分」 names a part of the list
    // that is not in front of the reader, so the branch is decided by
    // the rendered records rather than by the cache's count — the same
    // thing `describeChinaCoverage` branches on.
    const { tool } = toolWith(
      result(snapshotMeta({ sources: [SOURCES[0], CN_WITH_ROWS], statusFilter: 'RECRUITING' })),
    );
    const { display } = await tool.execute({ status: 'RECRUITING', notes: [] }, ctx);
    expect(display).not.toContain('这份名单里国内登记的那部分');
    expect(display).toContain(`这次返回的记录里没有一条来自${CHINA}`);
  });

  it('says the 国内 half may be incomplete once it does contribute rows', async () => {
    // What must not vary is that the patient is never left reading this
    // list as complete for China — so the branch that has mainland rows
    // in hand has to say something stronger, not nothing.
    const { tool } = toolWith(
      result(snapshotMeta({ sources: [SOURCES[0], CN_WITH_ROWS] }), [
        chunk('ctgov', 'NCT00000001'),
        chunk('chinadrugtrials', 'CTR20250001'),
      ]),
    );
    const { display } = await tool.execute({ notes: [] }, ctx);
    expect(display).not.toContain('不含只在国内登记的试验');
    expect(display).toContain('这份名单里国内登记的那部分');
    expect(display).toContain('没有公开接口');
    expect(display).toContain('可能不完整');
    expect(display).toContain('chinadrugtrials.org.cn');
  });

  it('claims nothing about a list when no record was returned', async () => {
    const { tool } = toolWith(result(snapshotMeta({ cachedTotal: 0, matched: 0, returned: 0 })));
    const { display } = await tool.execute({ notes: [] }, ctx);
    expect(display).toContain(`这次返回的记录里没有一条来自${CHINA}`);
    expect(display).not.toContain('下面这份名单');
  });

  it('carries the §A5 boundaries the model must not cross', async () => {
    const { tool } = toolWith(result(snapshotMeta()));
    const { display } = await tool.execute({ notes: [] }, ctx);
    expect(display).toContain('不要判断用户是否符合入组条件');
    expect(display).toContain('不要陈述任何疗效或结果结论');
    expect(display).toContain('和你的主诊医生商量');
    expect(display).toContain('本平台读取时间');
  });

  it('says how many matches the limit left out', async () => {
    const { tool } = toolWith(
      result(snapshotMeta({ matched: 24, returned: 12, statusFilter: 'RECRUITING' })),
    );
    const { display } = await tool.execute({ status: 'RECRUITING', notes: [] }, ctx);
    expect(display).toContain('命中 24 条，这里只给出了前 12 条');
    expect(display).toContain('不要说成一共只有 12 条');
  });

  it('names the untranslated statuses, with the spelling that fetches them', async () => {
    const { tool } = toolWith(
      result(
        snapshotMeta({
          statusFilter: 'RECRUITING',
          matched: 3,
          returned: 3,
          statusCounts: [
            { status: 'RECRUITING', count: 3, translated: true },
            { status: 'Enrolling by invitation', count: 2, translated: false },
          ],
        }),
      ),
    );
    const { display } = await tool.execute({ status: 'RECRUITING', notes: [] }, ctx);
    expect(display).toContain('「Enrolling by invitation」2 条');
    expect(display).toContain('不在这次结果里');
    expect(display).toContain('直接用原词再查一次');
  });

  it('does not tell the model a 国内 status word is untranslated or means something else', async () => {
    // 药物临床试验登记与信息公示平台 writes its status in Chinese and the
    // refresh stores that word verbatim, so 已完成 arrives here outside
    // the six the schema lists. Both things this line used to say about
    // such a word are false — it is the very Chinese status-map.ts fixes
    // for COMPLETED — and the model is instructed to pass them on.
    const { tool } = toolWith(
      result(
        snapshotMeta({
          statusFilter: 'COMPLETED',
          matched: 45,
          returned: 12,
          statusCounts: [
            { status: 'COMPLETED', count: 45, translated: true },
            { status: '已完成', count: 4, translated: false },
            { status: '进行中 招募中', count: 1, translated: false },
          ],
        }),
      ),
    );
    const { display } = await tool.execute({ status: 'COMPLETED', notes: [] }, ctx);
    expect(display).toContain('「已完成」4 条');
    expect(display).toContain('「进行中 招募中」1 条');
    expect(display).not.toContain('没有中文译法');
    expect(display).not.toContain('也不等于 COMPLETED');
    // What is left is the only reason they are absent, and the warning
    // that follows from it.
    expect(display).toContain('和 COMPLETED 不是同一个词');
    expect(display).toContain('写法不一样不代表说的不是同一件事');
  });

  it('does not tell the model a word is missing from a filter on that word', async () => {
    const { tool } = toolWith(
      result(
        snapshotMeta({
          statusFilter: 'ENROLLING_BY_INVITATION',
          matched: 2,
          returned: 2,
          statusCounts: [{ status: 'Enrolling by invitation', count: 2, translated: false }],
        }),
      ),
    );
    const { display } = await tool.execute({ status: 'ENROLLING_BY_INVITATION', notes: [] }, ctx);
    expect(display).not.toContain('不在这次结果里');
  });

  it('answers a filter that matched nothing with the census, not with silence', async () => {
    const { tool } = toolWith(
      result(
        snapshotMeta({
          statusFilter: 'ONGOING',
          matched: 0,
          returned: 0,
          statusCounts: [
            { status: 'COMPLETED', count: 45, translated: true },
            { status: 'RECRUITING', count: 21, translated: true },
          ],
        }),
      ),
    );
    const { display } = await tool.execute({ status: 'ONGOING', notes: [] }, ctx);
    expect(display).toContain('缓存里没有状态词等于 ONGOING 的记录');
    expect(display).toContain('「RECRUITING」21 条');
    expect(display).toContain('不要因为这次是 0 条就说「没有试验」');
  });

  it('prints what it did with an argument it could not use', async () => {
    const { tool } = toolWith(result(snapshotMeta()));
    const { display } = await tool.execute(tool.parseArgs('{"limit":"twelve"}'), ctx);
    expect(display).toContain('limit 不是数字');
    // And it still answered.
    expect(display).toContain('缓存共 92 条');
  });

  it('refuses the stale snapshot as a fallback when the cache is empty', async () => {
    const { tool } = toolWith(
      result(
        snapshotMeta({
          cachedTotal: 0,
          matched: 0,
          returned: 0,
          sources: SOURCES.map((s) => ({ ...s, lastRun: null, recordCount: 0 })),
        }),
      ),
    );
    const { display } = await tool.execute({ notes: [] }, ctx);

    // 「平台取不到」 and 「没有试验在招募」 are different sentences and
    // only one of them is true. And the 2025 snapshot in the knowledge
    // base is exactly what the model would otherwise reach for.
    expect(display).toContain('这是平台这边的问题，不是「没有试验在招募」');
    expect(display).toContain('不要**用知识库里那份 ClinicalTrials.gov 网页快照代替它');
    expect(display).not.toContain('不要判断用户是否符合入组条件');
    // §A5's closing sentence is not conditional on there being a list,
    // and this is the branch that sends the patient off to a registry
    // on their own.
    expect(display).toContain('是否参加临床试验，请和你的主诊医生商量');
  });

  it('survives a retrieval that returned no snapshot at all', async () => {
    const { tool } = toolWith(result({ reason: 'aborted' }));
    const { display } = await tool.execute({ notes: [] }, ctx);
    expect(display).toContain('没有取到试验数据（aborted）');
    expect(display).toContain('不要凭记忆列出任何 NCT 号');
  });

  it('forwards the status filter and limit to the retriever', async () => {
    const { tool, search } = toolWith(result(snapshotMeta()));
    await tool.execute({ status: 'RECRUITING', limit: 5, notes: [] }, ctx);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { status: 'RECRUITING' }, limit: 5 }),
      expect.objectContaining({ userId: 'user-1' }),
    );
  });
});

/**
 * The seam this tool actually fails through.
 *
 * A tool that throws reaches `context-builder` as a bare `call.error`,
 * which classifies by tool name: `clinical_trials` is not in its
 * PERSONAL_TOOLS set, so it lands in `corpus` and the model — and then
 * the patient — is told 「资料库检索没有跑成功」. That is a statement
 * about the MEDICAL KNOWLEDGE BASE, which in a real run is up and whose
 * chunks are sitting in the same prompt. So these assertions are on the
 * text that reaches the model, not on the tool's return value: the tool
 * being careful is worth nothing if the failure path bypasses it.
 */
describe('what the model is told when the trial cache fails', () => {
  const registryWith = () => {
    const registry = new ToolRegistry();
    registry.register(new ListClinicalTrialsTool(new ClinicalTrialsRetriever({} as Pool)));
    return registry;
  };

  const messageFor = async (argumentsJson: string, timeoutMs?: number) => {
    const executed = await new Executor(registryWith()).executeAll(
      [{ id: 't1', name: 'list_clinical_trials', argumentsJson }],
      ctx,
      timeoutMs === undefined ? {} : { timeoutMs },
    );
    const built = buildContext(executed, { mode: 'strict', logger: silentLogger });
    return { text: built.toolMessages[0].content, failures: built.failures };
  };

  it('names the trial cache, not the knowledge base, when the database is down', async () => {
    snapshotMock.mockReset();
    snapshotMock.mockRejectedValue(new Error('pool.connect: ECONNREFUSED'));
    const { text, failures } = await messageFor('{}');

    expect(text).not.toContain('资料库检索没有跑成功');
    expect(text).toContain('和医学知识库无关');
    expect(text).toContain('试验列表现在取不到');
    // The corpus flag drives a server-written banner over the whole
    // answer saying the knowledge base could not be reached. Raising it
    // here would be the same false sentence in a second place.
    expect(failures.corpus).toBe(false);
  });

  it('answers a status word it does not know instead of failing the call', async () => {
    // The model was told by this tool's own display that the cache
    // holds ENROLLING_BY_INVITATION rows. Asking about them used to be
    // a ToolValidationError, and the patient read that as a broken
    // knowledge base.
    snapshotMock.mockReset();
    snapshotMock.mockResolvedValue({
      trials: [
        {
          source: 'ctgov',
          sourceId: 'NCT-INV',
          title: 'A Study Enrolling by Invitation',
          statusRaw: 'ENROLLING_BY_INVITATION',
          statusZh: null,
          phase: 'PHASE2',
          sponsor: 'Somebody',
          countries: ['United States'],
          url: 'https://clinicaltrials.gov/study/NCT-INV',
          sourceUpdatedAt: '2026-06-01',
          fetchedAt: '2026-08-13T04:00:07Z',
        },
      ],
      sources: SOURCES,
    });
    const { text, failures } = await messageFor('{"status":"ENROLLING_BY_INVITATION"}');

    expect(text).not.toContain('资料库检索没有跑成功');
    expect(text).toContain('NCT-INV');
    expect(failures.corpus).toBe(false);
  });

  it('answers a truncated tool call instead of reporting a broken knowledge base', async () => {
    // A `length`-stopped tool call delivers a half-written JSON object
    // (siliconflow.ts:121 forwards `arguments` unvalidated,
    // run.ts:934 concatenates the streamed fragments). That used to
    // throw out of `parseArgs` and reach the patient as
    // 「资料库检索没有跑成功」.
    snapshotMock.mockReset();
    snapshotMock.mockResolvedValue({ trials: [], sources: SOURCES });
    const { text, failures } = await messageFor('{"status":"RECRUITING"');

    expect(text).not.toContain('资料库检索没有跑成功');
    expect(text).toContain('不是合法的 JSON');
    // And it answered, unfiltered, rather than ending the call.
    expect(text).toContain('clinical_trials: 返回 0 条');
    expect(failures.corpus).toBe(false);
  });

  it('names the trial cache when the read hangs past the tool timeout', async () => {
    // The retriever's try/catch is INSIDE the promise `withTimeout`
    // rejects around (executor.ts), so a `readTrialSnapshot` that hangs
    // rather than rejects escapes every guard this tool has. It reaches
    // context-builder as a bare `call.error`, which is why the
    // classification there — not the tool's carefulness — is what keeps
    // the knowledge-base sentence off the page.
    snapshotMock.mockReset();
    snapshotMock.mockImplementation(() => new Promise(() => {}));
    const { text, failures } = await messageFor('{}', 30);

    expect(text).not.toContain('资料库检索没有跑成功');
    expect(text).toContain('[error_code:trials_unavailable]');
    expect(text).toContain('不是医学知识库');
    expect(text).toContain('不等于「没有试验在招募」');
    // The 2025 snapshot in the corpus is in the same prompt and is what
    // the model would otherwise reach for.
    expect(text).toContain('不要**用知识库里那份 ClinicalTrials.gov 网页快照代替它');
    expect(failures.corpus).toBe(false);
  });
});
