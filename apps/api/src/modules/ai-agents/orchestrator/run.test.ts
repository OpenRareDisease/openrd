import { describe, expect, it, vi } from 'vitest';

import { FINAL_TURN_DIRECTIVE, Orchestrator } from './run.js';
import { OrchestratorConsentDenied, type OrchestratorEvent } from './types.js';
import type { ILLMProvider, LlmChatRequest, LlmChatResponse } from '../llm/base.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import type { ITool, ToolExecutionResult } from '../tools/base.js';
import { ToolRegistry } from '../tools/registry.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const stubResult = (
  retrieverId: string,
  chunkCount: number,
  fields?: Record<string, unknown>,
): RetrieveResult => ({
  retrieverId,
  chunks: Array.from({ length: chunkCount }, (_, i) => ({
    id: `c-${retrieverId}-${i}`,
    source: retrieverId,
    content:
      retrieverId === 'medical_kb'
        ? `medical knowledge chunk ${i + 1} long enough to survive renderer filter`
        : 'placeholder',
    metadata: fields ? { fields } : {},
    distance: retrieverId === 'medical_kb' ? 0.1 + i * 0.01 : null,
    sourceFile: retrieverId === 'medical_kb' ? `fshd/${i}.md` : retrieverId,
  })),
  citations: Array.from({ length: chunkCount }, (_, i) => ({
    chunkId: `c-${retrieverId}-${i}`,
    source: retrieverId,
    sourceFile: retrieverId === 'medical_kb' ? `fshd/${i}.md` : retrieverId,
    chunkIndex: i,
    snippet: `snippet ${i}`,
  })),
  metadata: {},
});

const mkTool = (name: string, result: RetrieveResult): ITool => ({
  name,
  description: `${name} stub`,
  parametersSchema: { type: 'object', properties: {} },
  parseArgs: () => ({}),
  execute: async (): Promise<ToolExecutionResult> => ({
    retrieval: result,
    display: `${name}: ${result.chunks.length}`,
  }),
});

const mkLlm = (
  responses: LlmChatResponse[],
): ILLMProvider & {
  chat: ReturnType<typeof vi.fn>;
} => {
  let i = 0;
  const chat = vi.fn().mockImplementation(async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return r;
  });
  return {
    providerName: 'mock',
    model: 'mock-model',
    supportsToolCalling: true,
    chat,
    chatStream: vi.fn(),
  } as unknown as ILLMProvider & { chat: ReturnType<typeof vi.fn> };
};

describe('Orchestrator.run', () => {
  it('refuses when consent is none', async () => {
    const orch = new Orchestrator(
      mkLlm([{ content: 'x', toolCalls: [], finishReason: 'stop' }]),
      new ToolRegistry(),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    await expect(
      orch.run({
        userId: 'u1',
        question: 'hi',
        requestId: 'r1',
        consentLevel: 'none',
      }),
    ).rejects.toBeInstanceOf(OrchestratorConsentDenied);
  });

  it('returns directly when the planner answers without calling tools', async () => {
    const llm = mkLlm([{ content: '直接回答', toolCalls: [], finishReason: 'stop' }]);
    const registry = new ToolRegistry().register(
      mkTool('search_medical_kb', stubResult('medical_kb', 0)),
    );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      {
        userId: 'u1',
        question: 'q',
        requestId: 'r1',
        consentLevel: 'basic',
      },
      (e) => events.push(e),
    );

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe('直接回答');
    expect(result.toolCalls).toEqual([]);
    expect(result.usedPersonalData).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['planning', 'plan_complete', 'done']);
  });

  // With the Python KB service down, `medical-kb.ts` returns an empty
  // result carrying `reason: 'kb_service_unreachable'`. Nothing read
  // that reason, so the audit recorded a clean success and the model
  // was handed 「（无内容）」 with no way to tell a dead service from a
  // topic the KB does not cover. Every knowledge question hit this.
  it('reports an unreachable retriever as an error, not an empty success', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      {
        content: '知识库暂时取不到资料，我先根据你已有的记录说。',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);
    const downTool: ITool = {
      name: 'search_medical_kb',
      description: 'kb',
      parametersSchema: { type: 'object' },
      parseArgs: () => ({}),
      execute: async () => ({
        retrieval: {
          retrieverId: 'medical_kb',
          chunks: [],
          citations: [],
          metadata: { reason: 'kb_service_unreachable', detail: 'fetch failed' },
        },
        display: 'medical_kb: 0 chunks',
      }),
    };
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(downTool),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const result = await orch.run({
      userId: 'u1',
      question: 'FSHD 有什么需要注意的',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    const kb = result.toolCalls.find((c) => c.name === 'search_medical_kb');
    expect(kb?.status).toBe('error');
    expect(kb?.errorDetail).toContain('kb_service_unreachable');

    // And the model is told which kind of empty this is.
    const round2Arg = llm.chat.mock.calls[1][0] as LlmChatRequest;
    const toolMessage = round2Arg.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('检索失败');
    expect(toolMessage?.content).not.toBe('（无内容）');
  });

  // The other side: an empty result that is a real answer about the
  // patient's own data must stay a success, so the model says "you have
  // no reports" rather than reporting a malfunction.
  it('keeps a genuinely-empty patient retrieval as a success', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'call-1', name: 'get_my_reports', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      },
      { content: '你还没有上传报告。', toolCalls: [], finishReason: 'stop' },
    ]);
    const emptyTool: ITool = {
      name: 'get_my_reports',
      description: 'reports',
      parametersSchema: { type: 'object' },
      parseArgs: () => ({}),
      execute: async () => ({
        retrieval: {
          retrieverId: 'patient_reports',
          chunks: [],
          citations: [],
          metadata: { reason: 'no_reports_found' },
        },
        display: 'patient_reports: 0 chunks',
      }),
    };
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(emptyTool),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const result = await orch.run({
      userId: 'u1',
      question: '我有哪些报告',
      requestId: 'r1',
      consentLevel: 'basic',
    });
    expect(result.toolCalls[0].status).toBe('ok');
    expect(result.answer).toBe('你还没有上传报告。');
  });

  // The reported failure, end to end: a patient asked「有什么需要注意的」
  // and the entire bubble read「让我再用其他关键词搜索一下：」— round 2's
  // lead-in to a search that this being the last round could never run,
  // with the call itself stripped out behind it. `hasContent` was true,
  // so no truncation was signalled and the audit row said success.
  it('does not answer with a round-2 tool-call preamble', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      {
        // Prose + a second call, exactly as observed.
        content:
          '让我再用其他关键词搜索一下：\n<minimax:tool_call>\n<invoke name="search_medical_kb">\n<parameter name="query">FSHD 注意事项</parameter>\n</invoke>\n</minimax:tool_call>',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);
    const registry = new ToolRegistry().register(
      mkTool('search_medical_kb', stubResult('medical_kb', 2)),
    );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      { userId: 'u1', question: '有什么需要注意的', requestId: 'r1', consentLevel: 'basic' },
      (e) => events.push(e),
    );

    expect(result.answer).not.toContain('搜索一下');
    expect(result.answer).not.toContain('<');
    expect(result.answer).toBe('抱歉，AI 这次没能把回答整理出来，请再问一次。');
    // And it is reported, so the audit row is not a silent success.
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  // The whole point of the refactor: 「具体解读，然后结合解读分析我的病情
  // 发展」 needs two lookups — read the report, then look up what its
  // findings mean. The model said exactly that and the old single-round
  // shape turned the sentence into the answer.
  it('runs a second lookup when the model asks for one', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'c1', name: 'get_my_reports', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      },
      {
        // Round 2, tools still on the table: it wants more.
        content: '我看到你的报告了，让我再查一下FSHD病情发展相关的医学信息。',
        toolCalls: [
          { id: 'c2', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD 进展"}' },
        ],
        finishReason: 'tool_calls',
      },
      { content: '结合你的报告和资料，你的情况是这样的……', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry()
        .register(mkTool('get_my_reports', stubResult('patient_reports', 1)))
        .register(mkTool('search_medical_kb', stubResult('medical_kb', 2))),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      {
        userId: 'u1',
        question: '具体解读，然后结合解读分析我的病情发展',
        requestId: 'r1',
        consentLevel: 'basic',
      },
      (e) => events.push(e),
    );

    // Round 1 is get_my_reports plus the companion KB search that
    // always accompanies it (companion-tools.ts); round 2 adds the
    // follow-up the model asked for — and that one is the interesting
    // difference, because its query is informed by what the report
    // actually said rather than by the original question.
    expect(result.toolCalls.map((c) => c.name)).toEqual([
      'get_my_reports',
      'search_medical_kb',
      'search_medical_kb',
    ]);
    expect(result.citations.length).toBeGreaterThanOrEqual(3);
    // The announcement is no longer the answer.
    expect(result.answer).toBe('结合你的报告和资料，你的情况是这样的……');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('stops at the ceiling and withholds tools on the last round', async () => {
    // Always asks for one more, forever.
    const greedy = (n: number) => ({
      content: `第 ${n} 轮`,
      toolCalls: [{ id: `c${n}`, name: 'search_medical_kb', argumentsJson: `{"query":"q${n}"}` }],
      finishReason: 'tool_calls' as const,
    });
    const llm = mkLlm([greedy(1), greedy(2), greedy(3), greedy(4), greedy(5)]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
      { maxToolRounds: 2 },
    );

    await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    // planner + 2 rounds = 3 calls, and no more however hard it asks.
    expect(llm.chat).toHaveBeenCalledTimes(3);
    const last = llm.chat.mock.calls[2][0] as LlmChatRequest;
    // Tools withheld — this is what makes the bound real. Asking the
    // model to stop is what failed twice.
    expect(last.tools).toBeUndefined();
    expect(last.messages[last.messages.length - 1].content).toBe(FINAL_TURN_DIRECTIVE);
  });

  it('ends the gather when the model repeats a call it already made', async () => {
    const same = { id: 'c1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' };
    const llm = mkLlm([
      { content: null, toolCalls: [same], finishReason: 'tool_calls' },
      // Byte-identical request — rerunning it returns the same chunks.
      { content: '再查一次', toolCalls: [{ ...same, id: 'c2' }], finishReason: 'tool_calls' },
      { content: '根据已有资料：……', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 2))),
      silentLogger as unknown as RetrieveContext['logger'],
      { maxToolRounds: 5 },
    );

    const result = await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    // The tool ran once, not twice, despite being asked for twice.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.answer).toBe('根据已有资料：……');
  });

  // Key order is not promised by providers, and a repeat that slips
  // through costs a whole round.
  it('treats reordered arguments as the same call', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [
          { id: 'c1', name: 'search_medical_kb', argumentsJson: '{"query":"a","limit":5}' },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: '再来',
        toolCalls: [
          { id: 'c2', name: 'search_medical_kb', argumentsJson: '{"limit":5,"query":"a"}' },
        ],
        finishReason: 'tool_calls',
      },
      { content: '答案', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
      { maxToolRounds: 5 },
    );
    const result = await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });
    expect(result.toolCalls).toHaveLength(1);
  });

  // A preamble-only round 2 is a sampling fluke — the same question
  // against the same context answered fine on a re-run — so we re-ask
  // once instead of turning it into an apology.
  it('retries once when round 2 answers with only a preamble', async () => {
    const good = '需要注意的主要是三点：定期复查呼吸功能、避免过度疲劳、跟主治医生讨论康复方案。';
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      { content: '让我再用其他关键词搜索一下：', toolCalls: [], finishReason: 'stop' },
      { content: good, toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 2))),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      { userId: 'u1', question: '有什么需要注意的', requestId: 'r1', consentLevel: 'basic' },
      (e) => events.push(e),
    );

    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(result.answer).toBe(good);
    // The retry succeeded, so this is NOT an error run.
    expect(events.some((e) => e.type === 'error')).toBe(false);
    // …and the client is told to drop what it already painted.
    expect(events.some((e) => e.type === 'answer_reset')).toBe(true);
  });

  it('gives up after exactly one retry', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      { content: '让我再搜索一下：', toolCalls: [], finishReason: 'stop' },
      { content: '我再查一下：', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 2))),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      { userId: 'u1', question: '有什么需要注意的', requestId: 'r1', consentLevel: 'basic' },
      (e) => events.push(e),
    );

    // Three calls total, never four — this is a two-round system.
    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(result.answer).toBe('抱歉，AI 这次没能把回答整理出来，请再问一次。');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  // The other half of the same guard: a real answer must survive even
  // when the model appended a stray tool call after writing it.
  it('keeps a substantive answer that happens to carry a stray tool call', async () => {
    const answer =
      '需要留意的主要是三点：呼吸功能每年查一次、体重别掉太快、肩胛固定手术要跟主治医生充分讨论后再决定。';
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      {
        content: `${answer}<tool_call><invoke name="x"></invoke></tool_call>`,
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);
    const registry = new ToolRegistry().register(
      mkTool('search_medical_kb', stubResult('medical_kb', 2)),
    );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const result = await orch.run({
      userId: 'u1',
      question: '有什么需要注意的',
      requestId: 'r1',
      consentLevel: 'basic',
    });
    expect(result.answer).toBe(answer);
  });

  it('runs tool calls, renders context, and produces a final answer', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'search_medical_kb',
            argumentsJson: '{"query":"D4Z4"}',
          },
          {
            id: 'call-2',
            name: 'get_my_profile',
            argumentsJson: '{}',
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: '基于知识库和你的资料的最终回答',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
      },
    ]);

    const registry = new ToolRegistry()
      .register(mkTool('search_medical_kb', stubResult('medical_kb', 2)))
      .register(
        mkTool(
          'get_my_profile',
          stubResult('patient_profile', 1, { gender: '男', ageGroup: '30-40' }),
        ),
      );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      {
        userId: 'u1',
        question: 'tell me about D4Z4 and my situation',
        requestId: 'r1',
        consentLevel: 'basic',
      },
      (e) => events.push(e),
    );

    // Still two calls when one round of tools is enough — the common
    // case did not get more expensive when gathering became loopable.
    expect(llm.chat).toHaveBeenCalledTimes(2);
    const round2Arg = llm.chat.mock.calls[1][0] as LlmChatRequest;
    // Round 2 carries the tools: it may answer (it does here) or ask
    // for another lookup. Withholding them is reserved for the ceiling.
    expect(round2Arg.tools?.map((t) => t.name)).toEqual(['search_medical_kb', 'get_my_profile']);
    // system + user + assistant(toolCalls) + 2 tool messages. No
    // final-turn directive: this round can still ask for more, so
    // telling it there is no next round would be false.
    expect(round2Arg.messages).toHaveLength(5);
    expect(round2Arg.messages[2].role).toBe('assistant');
    expect(round2Arg.messages[3].role).toBe('tool');
    expect(round2Arg.messages[4].role).toBe('tool');

    expect(result.answer).toBe('基于知识库和你的资料的最终回答');
    expect(result.toolCalls.map((c) => c.name)).toEqual(['search_medical_kb', 'get_my_profile']);
    expect(result.toolCalls.every((c) => c.status === 'ok')).toBe(true);
    expect(result.toolCalls.every((c) => typeof c.latencyMs === 'number')).toBe(true);
    expect(result.toolCalls.every((c) => c.chunkCount > 0)).toBe(true);
    expect(result.usedPersonalData).toBe(true);
    expect(result.fieldsUsed).toEqual(expect.arrayContaining(['gender', 'ageGroup']));
    expect(result.citations).toHaveLength(3); // 2 kb + 1 profile
    expect(result.redactionMode).toBe('strict');
    expect(result.redactedPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.promptCharLength).toBeGreaterThan(0);
    expect(result.llmUsage?.totalTokens).toBe(130);

    expect(events.map((e) => e.type)).toEqual([
      'planning',
      'plan_complete',
      'tool_start',
      'tool_start',
      'tool_complete',
      'tool_complete',
      'context_built',
      'answering',
      'done',
    ]);
  });

  it('uses precise mode when consent is precise', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'get_my_profile',
            argumentsJson: '{}',
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'done', toolCalls: [], finishReason: 'stop' },
    ]);
    const registry = new ToolRegistry().register(
      mkTool('get_my_profile', stubResult('patient_profile', 1, { d4z4: '3/22', gender: '男' })),
    );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const result = await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'precise',
    });

    expect(result.redactionMode).toBe('precise');
    expect(result.fieldsUsed).toEqual(expect.arrayContaining(['d4z4', 'gender']));
  });

  it('only advertises consent-appropriate tools to the planner', async () => {
    const llm = mkLlm([{ content: 'x', toolCalls: [], finishReason: 'stop' }]);
    const registry = new ToolRegistry()
      .register(mkTool('search_medical_kb', stubResult('medical_kb', 0)))
      .register({
        ...mkTool('get_my_profile', stubResult('patient_profile', 0)),
        minConsent: 'basic',
      });
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );

    await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    const advertised = (llm.chat.mock.calls[0][0] as LlmChatRequest).tools ?? [];
    expect(advertised.map((t) => t.name).sort()).toEqual(['get_my_profile', 'search_medical_kb']);
  });

  // Fix #2 regression: the audit hash must reflect every message sent
  // to the LLM, including the assistant turn (with its tool-call
  // arguments). Two runs that differ only in the assistant message
  // must produce different hashes.
  it('audit hash differentiates runs that differ only in the assistant tool-call payload', async () => {
    const buildRegistry = () =>
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1)));

    const runWith = async (argsJson: string) => {
      const llm = mkLlm([
        {
          content: null,
          toolCalls: [{ id: 'call-1', name: 'search_medical_kb', argumentsJson: argsJson }],
          finishReason: 'tool_calls',
        },
        { content: 'same final answer', toolCalls: [], finishReason: 'stop' },
      ]);
      const orch = new Orchestrator(
        llm,
        buildRegistry(),
        silentLogger as unknown as RetrieveContext['logger'],
      );
      return orch.run({
        userId: 'u1',
        question: 'same question',
        requestId: 'r1',
        consentLevel: 'basic',
      });
    };

    const a = await runWith('{"query":"D4Z4 mechanism"}');
    const b = await runWith('{"query":"FSHD treatment"}');

    expect(a.redactedPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.redactedPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.redactedPromptHash).not.toBe(b.redactedPromptHash);
  });
});

describe('Orchestrator.run with streamFinalAnswer=true', () => {
  /** Convenience: build an LLM where round 1 returns one tool call and
   *  round 2's `chatStream` yields the given text deltas + a finish
   *  frame. The first arg is the round-1 (non-streaming) response. */
  const mkStreamingLlm = (
    round1: LlmChatResponse,
    deltas: string[],
  ): ILLMProvider & {
    chat: ReturnType<typeof vi.fn>;
    chatStream: ReturnType<typeof vi.fn>;
  } => {
    const chat = vi.fn().mockResolvedValue(round1);

    // Async generator that re-creates a fresh iterator on every call
    // (some callers reuse the LLM across multiple run() invocations).
    const chatStream = vi.fn(async function* () {
      for (const text of deltas) {
        yield { type: 'text_delta' as const, text };
      }
      yield {
        type: 'finish' as const,
        finishReason: 'stop' as const,
        usage: {
          promptTokens: 10,
          completionTokens: deltas.length,
          totalTokens: 10 + deltas.length,
        },
      };
    });

    return {
      providerName: 'mock',
      model: 'mock-model',
      supportsToolCalling: true,
      chat,
      chatStream,
    } as unknown as ILLMProvider & {
      chat: ReturnType<typeof vi.fn>;
      chatStream: ReturnType<typeof vi.fn>;
    };
  };

  it('emits answer_delta events in order and assembles the final answer', async () => {
    // Round 1: planner picks one tool. Round 2: streamed answer.
    const llm = mkStreamingLlm(
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"D4Z4"}' }],
        finishReason: 'tool_calls',
      },
      ['D4Z4', ' 是', ' 一种'],
    );
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 2))),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      { userId: 'u1', question: 'q', requestId: 'r1', consentLevel: 'basic' },
      (e) => events.push(e),
      { streamFinalAnswer: true },
    );

    // Streaming-specific assertion: the deltas arrived in the right
    // order and concatenate to the final answer the orchestrator
    // returned.
    const deltas = events.filter((e) => e.type === 'answer_delta') as Array<
      Extract<OrchestratorEvent, { type: 'answer_delta' }>
    >;
    expect(deltas.map((d) => d.text)).toEqual(['D4Z4', ' 是', ' 一种']);
    expect(result.answer).toBe('D4Z4 是 一种');

    // The non-streaming round 1 `chat` was called exactly once
    // (planner), and the streaming `chatStream` was called exactly
    // once (final answer).
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(llm.chatStream).toHaveBeenCalledTimes(1);

    // Stage events surround the deltas: `answering` fires before the
    // first delta, `done` after the last.
    const types = events.map((e) => e.type);
    const answeringIdx = types.indexOf('answering');
    const firstDeltaIdx = types.indexOf('answer_delta');
    const doneIdx = types.indexOf('done');
    expect(answeringIdx).toBeLessThan(firstDeltaIdx);
    expect(firstDeltaIdx).toBeLessThan(doneIdx);
  });

  it('falls back to the placeholder answer when the stream yields no text', async () => {
    // Provider answered with zero text deltas — same surface as the
    // non-streaming branch's `finalResponse.content === null` case.
    const llm = mkStreamingLlm(
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"x"}' }],
        finishReason: 'tool_calls',
      },
      [],
    );
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const events: OrchestratorEvent[] = [];
    const result = await orch.run(
      { userId: 'u1', question: 'q', requestId: 'r1', consentLevel: 'basic' },
      (e) => events.push(e),
      { streamFinalAnswer: true },
    );

    expect(events.filter((e) => e.type === 'answer_delta')).toHaveLength(0);
    // The wording changed when the tool-call scrubber landed: an empty
    // round-2 answer is now usually *because* the whole output was
    // provider tool-call markup that got stripped, so the copy invites
    // a retry rather than reporting the assistant as unavailable.
    expect(result.answer).toMatch(/没能把回答整理出来/);
  });
});

describe('Orchestrator.run — multi-turn history', () => {
  it('replays history between system and the current question, and covers it in the audit hash', async () => {
    const llm = mkLlm([{ content: '带上下文的回答', toolCalls: [], finishReason: 'stop' }]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry(),
      silentLogger as unknown as RetrieveContext['logger'],
    );

    const history = [
      { role: 'user' as const, content: '我上次肌酸激酶 800，说明什么？' },
      { role: 'assistant' as const, content: '通常提示肌肉损伤……' },
    ];

    const result = await orch.run({
      userId: 'u1',
      question: '那我需要复查吗？',
      requestId: 'r-mt',
      consentLevel: 'basic',
      history,
    });

    // 1) Message order into the LLM: system, then history verbatim,
    //    then the current question last.
    const request = llm.chat.mock.calls[0][0] as LlmChatRequest;
    const roles = request.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(request.messages[1].content).toBe(history[0].content);
    expect(request.messages[2].content).toBe(history[1].content);
    expect(String(request.messages[3].content)).toContain('那我需要复查吗');

    // 2) finalPrompt.user must be the CURRENT question, not the
    //    oldest replayed turn.
    expect(result.finalPrompt.user).toContain('那我需要复查吗');
    expect(result.finalPrompt.user).not.toBe(history[0].content);

    // 3) Accounting for the audit row.
    expect(result.historyMessageCount).toBe(2);
    expect(result.historyCharLength).toBe(history[0].content.length + history[1].content.length);

    // 4) The audit hash source walks every message — the same run
    //    WITHOUT history must produce a different hash.
    const llm2 = mkLlm([{ content: '带上下文的回答', toolCalls: [], finishReason: 'stop' }]);
    const orch2 = new Orchestrator(
      llm2,
      new ToolRegistry(),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const single = await orch2.run({
      userId: 'u1',
      question: '那我需要复查吗？',
      requestId: 'r-st',
      consentLevel: 'basic',
    });
    expect(single.historyMessageCount).toBe(0);
    expect(single.redactedPromptHash).not.toBe(result.redactedPromptHash);
  });
});
