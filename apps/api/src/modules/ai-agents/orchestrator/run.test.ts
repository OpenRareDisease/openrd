import { describe, expect, it, vi } from 'vitest';

import {
  CORPUS_UNAVAILABLE_NOTICE,
  DEFAULT_SYSTEM_PROMPT,
  FINAL_TURN_DIRECTIVE,
  Orchestrator,
  PERSONAL_DATA_PARTIAL_NOTICE,
  PERSONAL_DATA_UNAVAILABLE_NOTICE,
  PRECISE_KEY_EVIDENCE,
} from './run.js';
import { OrchestratorConsentDenied, type OrchestratorEvent } from './types.js';
import type { ILLMProvider, LlmChatRequest, LlmChatResponse } from '../llm/base.js';
import type { RetrieveContext, RetrieveResult } from '../retrievers/base.js';
import { PROMPT_ALLOWLIST } from '../security/allowlist.js';
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
    expect(toolMessage?.content).toContain('error_code:retrieval_failed');
    expect(toolMessage?.content).toContain('kb_service_unreachable');
    expect(toolMessage?.content).not.toBe('（无内容）');
    // And it is told to refuse rather than fill the gap from priors.
    // The instruction this replaced said「请基于常识与上下文继续作答」.
    expect(toolMessage?.content).not.toContain('基于常识');
    expect(toolMessage?.content).toContain('不要用你自己记忆里的 FSHD 知识');
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
    // Reported on the result, not as an `error` frame: `error` is
    // terminal to both SSE consumers, so emitting one here stopped the
    // client before the `done` frame carrying this very fallback.
    expect(result.answerTruncated).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
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

  // The earlier version of this test passed for the wrong reason: its
  // third scripted response happened to carry no tool calls, so the
  // loop exited on that rather than on repeat detection. A model that
  // keeps repeating never hit the ceiling — `toolRounds` only advanced
  // when something executed, and nothing was appended to `messages`
  // when nothing did, so each iteration re-sent a byte-identical
  // prompt. This one repeats forever and asserts the loop still stops.
  it('stops when the model repeats the same call indefinitely', async () => {
    const same = { id: 'c1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' };
    const llm = mkLlm(
      Array.from({ length: 10 }, () => ({
        content: '再查一次',
        toolCalls: [{ ...same }],
        finishReason: 'tool_calls' as const,
      })),
    );
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

    // planner + the round that executes + the forced answer round.
    expect(llm.chat).toHaveBeenCalledTimes(3);
    // The tool ran once despite being asked for ten times.
    expect(result.toolCalls).toHaveLength(1);
    // And the last call had no tools, so it could not ask again.
    const last = llm.chat.mock.calls[2][0] as LlmChatRequest;
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
    expect(result.answerTruncated).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
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
          stubResult('patient_profile', 1, { gender: '男', diagnosisStage: 'confirmed' }),
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
    // system + user + assistant(toolCalls) + 2 tool messages + the
    // strict visibility notice, which follows the tool messages it
    // describes. No final-turn directive: this round can still ask for
    // more, so telling it there is no next round would be false.
    expect(round2Arg.messages).toHaveLength(6);
    expect(round2Arg.messages[2].role).toBe('assistant');
    expect(round2Arg.messages[3].role).toBe('tool');
    expect(round2Arg.messages[4].role).toBe('tool');
    expect(round2Arg.messages[5].role).toBe('system');
    expect(String(round2Arg.messages[5].content)).toContain('【当前数据可见范围】');
    expect(String(round2Arg.messages[5].content)).not.toContain(FINAL_TURN_DIRECTIVE);

    expect(result.answer).toBe('基于知识库和你的资料的最终回答');
    expect(result.toolCalls.map((c) => c.name)).toEqual(['search_medical_kb', 'get_my_profile']);
    expect(result.toolCalls.every((c) => c.status === 'ok')).toBe(true);
    expect(result.toolCalls.every((c) => typeof c.latencyMs === 'number')).toBe(true);
    expect(result.toolCalls.every((c) => c.chunkCount > 0)).toBe(true);
    expect(result.usedPersonalData).toBe(true);
    expect(result.fieldsUsed).toEqual(expect.arrayContaining(['gender', 'diagnosisStage']));
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

/**
 * `finishReason` came back from the provider on every call and was
 * dropped on the floor by `askRound`. An answer that stopped because it
 * ran out of tokens was therefore shipped as a finished answer — and on
 * a medical question the qualification is the last sentence, so the
 * fragment is not "less of the answer", it is the answer with its
 * caveats removed.
 */
describe('token-limit truncation is threaded and marked', () => {
  const cutOffRun = async (finishReason: LlmChatResponse['finishReason']) => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      {
        content: '呼吸功能建议每年查一次肺功能，如果你同时在用激素',
        toolCalls: [],
        finishReason,
      },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    return orch.run({
      userId: 'u1',
      question: '我需要注意什么',
      requestId: 'r1',
      consentLevel: 'basic',
    });
  };

  it('flags a length-capped answer and tells the patient how to continue', async () => {
    const result = await cutOffRun('length');
    expect(result.answerCutOff).toBe(true);
    // Visible to the patient regardless of what the client does with
    // the flag — a mobile release that ignores `answerCutOff` must not
    // silently show a fragment as a complete answer.
    expect(result.answer).toContain('长度上限');
    expect(result.answer).toContain('接着说');
    // Still the answer, not a replacement for it.
    expect(result.answer).toContain('呼吸功能建议每年查一次肺功能');
    // Different failure from "produced nothing usable".
    expect(result.answerTruncated).toBeUndefined();
  });

  it('leaves a normally finished answer untouched', async () => {
    const result = await cutOffRun('stop');
    expect(result.answerCutOff).toBeUndefined();
    expect(result.answer).not.toContain('接着说');
  });

  it('flags the planner direct-answer path too', async () => {
    // The planner runs at maxTokens 800 — a quarter of the answer
    // round's budget — so this is the path most likely to hit the cap,
    // and it had no check at all.
    const llm = mkLlm([
      { content: '确诊后要注意的第一点是', toolCalls: [], finishReason: 'length' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 0))),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });
    expect(result.answerCutOff).toBe(true);
    expect(result.answer).toContain('接着说');
  });

  it('does not stack the notice on the apology fallback', async () => {
    // Round 2 produced only a preamble and the retry produced nothing;
    // the patient gets the apology. Telling them to ask for "the rest"
    // of a message that does not exist would be its own small lie.
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      { content: '让我再搜索一下：', toolCalls: [], finishReason: 'length' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });
    expect(result.answerTruncated).toBe(true);
    expect(result.answerCutOff).toBeUndefined();
    expect(result.answer).not.toContain('接着说');
  });
});

describe('retrieval failure reaches the patient as state and as prose', () => {
  const downTool = (name: string, retrieverId: string): ITool => ({
    name,
    description: name,
    parametersSchema: { type: 'object' },
    parseArgs: () => ({}),
    execute: async () => ({
      retrieval: {
        retrieverId,
        chunks: [],
        citations: [],
        metadata: { reason: 'kb_service_unreachable' },
      },
      display: `${retrieverId}: 0 chunks`,
    }),
  });

  it('prefixes a fixed notice and reports a machine-readable code', async () => {
    // The model is instructed to refuse, and here it ignores the
    // instruction and answers from its priors anyway — which is exactly
    // the case the prompt alone cannot cover. The server-written notice
    // is what keeps the guarantee.
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      { content: 'FSHD 通常由 D4Z4 重复缩短引起。', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(downTool('search_medical_kb', 'medical_kb')),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: 'FSHD 是怎么回事',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    expect(result.retrievalFailure).toEqual({
      codes: ['retrieval_failed'],
      corpusUnavailable: true,
      personalDataUnavailable: false,
    });
    expect(result.answer.startsWith('⚠️')).toBe(true);
    expect(result.answer).toContain(CORPUS_UNAVAILABLE_NOTICE);
    expect(result.answer).toContain('FSHD 通常由 D4Z4 重复缩短引起。');
  });

  it('says something different when it is the patient own data that failed', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'get_my_reports', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      },
      { content: '这次先说通用的部分。', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(downTool('get_my_reports', 'patient_reports')),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: '我的报告怎么样',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    expect(result.retrievalFailure).toEqual({
      codes: ['personal_data_unavailable'],
      corpusUnavailable: false,
      personalDataUnavailable: true,
    });
    expect(result.answer).toContain('没能读到你的档案');
    // "we could not read it" must not be delivered as "you have none".
    expect(result.answer).toContain('这不代表你没有记录');
  });

  it('leaves a healthy run with no failure state and no banner', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' }],
        finishReason: 'tool_calls',
      },
      { content: '正常回答。', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 2))),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: 'q',
      requestId: 'r1',
      consentLevel: 'basic',
    });
    expect(result.retrievalFailure).toBeUndefined();
    expect(result.answer).toBe('正常回答。');
  });
});

describe('citation numbering across a whole run', () => {
  it('numbers a second retriever continuing from the first', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [
          { id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD"}' },
          { id: 'tc2', name: 'get_my_reports', argumentsJson: '{}' },
        ],
        finishReason: 'tool_calls',
      },
      { content: '回答 [1] [3]', toolCalls: [], finishReason: 'stop' },
    ]);
    const registry = new ToolRegistry()
      .register(mkTool('search_medical_kb', stubResult('medical_kb', 2)))
      .register(
        mkTool('get_my_reports', stubResult('patient_reports', 2, { classifiedType: '基因报告' })),
      );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: '结合知识库看我的报告',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    const round2 = llm.chat.mock.calls[1][0] as LlmChatRequest;
    const toolMessages = round2.messages.filter((m) => m.role === 'tool');
    const numbers = toolMessages
      .flatMap((m) => [...m.content.matchAll(/【片段(\d+)】/g)])
      .map((m) => Number(m[1]));
    // 1,2 for the KB and 3,4 for the reports — one sequence, not two.
    expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    // And [N] resolves to citations[N-1] on the client.
    expect(result.citations).toHaveLength(4);
    expect(result.citations[2].source).toBe('patient_reports');
    const reportMessage = toolMessages.find((m) => m.content.includes('patient_reports'));
    expect(reportMessage?.content).toMatch(/【片段3】/);
  });

  it('does not re-add round 1 citations when a second gather round runs', async () => {
    // `context.citations.push(...roundContext.citations)` meant round 2
    // re-appended round 1's list, so the same source got two cards and
    // the second card's position no longer matched its 【片段N】.
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"a"}' }],
        finishReason: 'tool_calls',
      },
      {
        content: null,
        toolCalls: [{ id: 'tc2', name: 'get_my_reports', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      },
      { content: '最终回答', toolCalls: [], finishReason: 'stop' },
    ]);
    const registry = new ToolRegistry()
      .register(mkTool('search_medical_kb', stubResult('medical_kb', 2)))
      .register(
        mkTool('get_my_reports', stubResult('patient_reports', 1, { classifiedType: '基因报告' })),
      );
    const orch = new Orchestrator(
      llm,
      registry,
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: '先查资料再看我的报告',
      requestId: 'r1',
      consentLevel: 'basic',
    });

    expect(result.citations.map((c) => c.chunkId)).toEqual([
      'c-medical_kb-0',
      'c-medical_kb-1',
      'c-patient_reports-0',
    ]);
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

  it('marks a streamed answer that the token limit cut off', async () => {
    // The streamed path is what a patient actually watches, and it
    // discarded `finishReason` from the `finish` frame entirely — once
    // the deltas stopped, a `length` stop was indistinguishable from a
    // finished answer.
    const chat = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'tc1', name: 'search_medical_kb', argumentsJson: '{"query":"x"}' }],
      finishReason: 'tool_calls',
    });
    const chatStream = vi.fn(async function* () {
      yield { type: 'text_delta' as const, text: '呼吸功能每年查一次，如果你同时在用' };
      yield { type: 'finish' as const, finishReason: 'length' as const, usage: undefined };
    });
    const llm = {
      providerName: 'mock',
      model: 'mock-model',
      supportsToolCalling: true,
      chat,
      chatStream,
    } as unknown as ILLMProvider;

    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run(
      { userId: 'u1', question: 'q', requestId: 'r1', consentLevel: 'basic' },
      undefined,
      { streamFinalAnswer: true },
    );

    expect(result.answerCutOff).toBe(true);
    expect(result.answer).toContain('接着说');
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

// ---------------------------------------------------------------------
// The strict-mode visibility notice.
//
// Two defects lived here at once, and both were of the same kind: a
// sentence in the prompt asserting something about this turn that this
// turn did not support.
//
//   - The notice was concatenated onto the SYSTEM PROMPT before
//     planning, so round 1 was told 「本轮工具消息里你已经拿到的字段：…」
//     over a conversation with zero tool messages — and the list was
//     read off the ALLOWLIST rather than the retrieval, so it stayed
//     false in round 2 for any patient missing those fields.
//   - The 「what precise consent adds」 half was a set difference over
//     KEY NAMES, and `methylation` is on both profile lists, so it never
//     landed there. The two modes put different things under that name:
//     strict emits `methylation_withheld` (甲基化数值: value_withheld)
//     and drops the number; precise emits `methylation: 12%` under
//     甲基化值. The notice therefore told the model 甲基化值 was already
//     in hand over a tool message with no such row.
// ---------------------------------------------------------------------

const PROFILE_WITH_GENETICS = {
  gender: '女',
  diagnosisStage: 'confirmed',
  diagnosisDate: '2019-03-11',
  diagnosisType: 'FSHD1',
  diagnosisTypeFromLaboratoryReport: true,
  d4z4: '6',
  d4z4FromLaboratoryReport: true,
  haplotype: '4qA',
  haplotypeFromLaboratoryReport: true,
  methylation: '12%',
  methylationFromLaboratoryReport: true,
  onsetRegion: '面部',
};

const gatherThenAnswer = (): LlmChatResponse[] => [
  {
    content: null,
    toolCalls: [{ id: 'p1', name: 'get_my_profile', argumentsJson: '{}' }],
    finishReason: 'tool_calls',
  },
  { content: '最终回答。', toolCalls: [], finishReason: 'stop' },
];

const profileOrchestrator = (
  llm: ILLMProvider,
  fields: Record<string, unknown> | null,
): Orchestrator =>
  new Orchestrator(
    llm,
    new ToolRegistry().register(
      mkTool('get_my_profile', stubResult('patient_profile', fields ? 1 : 0, fields ?? undefined)),
    ),
    silentLogger as unknown as RetrieveContext['logger'],
  );

/** Every message the given LLM round received, flattened. */
const roundText = (llm: { chat: ReturnType<typeof vi.fn> }, index: number): string =>
  (llm.chat.mock.calls[index][0] as LlmChatRequest).messages
    .map((m) => `${m.role}:${m.content ?? ''}`)
    .join('\n');

/** Only the tool messages of the given round — what the model was
 *  actually handed, as opposed to what it was told it was handed. */
const roundToolText = (llm: { chat: ReturnType<typeof vi.fn> }, index: number): string =>
  (llm.chat.mock.calls[index][0] as LlmChatRequest).messages
    .filter((m) => m.role === 'tool')
    .map((m) => m.content ?? '')
    .join('\n');

/** The visibility notice out of one round's messages, or '' when the
 *  round carries none. */
const noticeOf = (llm: { chat: ReturnType<typeof vi.fn> }, index: number): string =>
  ((llm.chat.mock.calls[index][0] as LlmChatRequest).messages.find(
    (m) => m.role === 'system' && String(m.content).includes('【当前数据可见范围】'),
  )?.content as string | undefined) ?? '';

/** The field labels of one of the notice's per-scope inventory blocks,
 *  flattened across scopes. */
const labelsAfter = (notice: string, heading: string): string[] =>
  (notice.split(`${heading}\n`)[1] ?? '')
    .split('\n\n')[0]
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .flatMap((line) => line.replace(/^- [^：]+：/, '').split('、'));

/** The field labels the notice claims the model already has. */
const inventoryOf = (notice: string): string[] =>
  labelsAfter(notice, '本轮工具消息里你已经拿到的字段：');

/** The field labels the notice says 「精确数值」 consent would add. */
const preciseOnlyOf = (notice: string): string[] =>
  labelsAfter(notice, '本轮开启「精确数值」授权后才会多出来的字段，只有这些：');

const gatherThenAnswerWith = (toolName: string): LlmChatResponse[] => [
  {
    content: null,
    toolCalls: [{ id: 'g1', name: toolName, argumentsJson: '{}' }],
    finishReason: 'tool_calls',
  },
  { content: '最终回答。', toolCalls: [], finishReason: 'stop' },
];

const oneRetrieverOrchestrator = (
  llm: ILLMProvider,
  toolName: string,
  retrieverId: string,
  fields: Record<string, unknown>,
): Orchestrator =>
  new Orchestrator(
    llm,
    new ToolRegistry().register(mkTool(toolName, stubResult(retrieverId, 1, fields))),
    silentLogger as unknown as RetrieveContext['logger'],
  );

const reportsOrchestrator = (llm: ILLMProvider, fields: Record<string, unknown>): Orchestrator =>
  oneRetrieverOrchestrator(llm, 'get_my_reports', 'patient_reports', fields);

const followupsOrchestrator = (llm: ILLMProvider, fields: Record<string, unknown>): Orchestrator =>
  oneRetrieverOrchestrator(llm, 'get_my_records', 'patient_followups', fields);

describe('Orchestrator.run — strict visibility notice', () => {
  it('says nothing about what the model "already has" before any tool has run', async () => {
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, PROFILE_WITH_GENETICS).run({
      userId: 'u1',
      question: '我的 D4Z4 在不在 FSHD1 范围内？',
      requestId: 'r-notice-1',
      consentLevel: 'basic',
    });

    // Round 1 is the planner. There are no tool messages in it at all,
    // so nothing may claim there are.
    const planning = llm.chat.mock.calls[0][0] as LlmChatRequest;
    expect(planning.messages.some((m) => m.role === 'tool')).toBe(false);
    expect(roundText(llm, 0)).not.toContain('【当前数据可见范围】');
    expect(roundText(llm, 0)).not.toContain('本轮工具消息里你已经拿到的字段');

    // Round 2 has the tool message, and the notice arrives with it.
    expect(noticeOf(llm, 1)).toContain('本轮工具消息里你已经拿到的字段');
  });

  it('names only fields the tool message actually carries', async () => {
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, PROFILE_WITH_GENETICS).run({
      userId: 'u1',
      question: '我的 D4Z4 在不在 FSHD1 范围内？',
      requestId: 'r-notice-2',
      consentLevel: 'basic',
    });

    const notice = noticeOf(llm, 1);
    const tools = roundToolText(llm, 1);

    // The inventory line, label by label, against the rendered chunk.
    const inventory = notice
      .split('本轮工具消息里你已经拿到的字段：\n')[1]
      .split('\n\n')[0]
      .split('\n')
      .flatMap((line) => line.replace(/^- [^：]+：/, '').split('、'));
    expect(inventory.length).toBeGreaterThan(3);
    for (const label of inventory) {
      expect(tools, `notice claims 「${label}」 but no tool message prints it`).toContain(label);
    }

    // The specific pair the old derivation got backwards: strict prints
    // 甲基化数值 (value_withheld) and never 甲基化值.
    expect(tools).toContain('甲基化数值: value_withheld');
    expect(tools).not.toContain('甲基化值');
    expect(inventory).toContain('甲基化数值');
    expect(inventory).not.toContain('甲基化值');
  });

  it('lists the methylation number as something precise consent would add', async () => {
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, PROFILE_WITH_GENETICS).run({
      userId: 'u1',
      question: '我的甲基化是多少？',
      requestId: 'r-notice-3',
      consentLevel: 'basic',
    });

    const preciseOnly = noticeOf(llm, 1)
      .split('才会多出来的字段，只有这些：\n')[1]
      .split('\n\n')[0];
    expect(preciseOnly).toContain('甲基化值');
    expect(preciseOnly).toContain('D4Z4 重复数');
    expect(preciseOnly).toContain('单倍型');

    // And precise mode really does print it, so the promise is good.
    const preciseLlm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(preciseLlm, PROFILE_WITH_GENETICS).run({
      userId: 'u1',
      question: '我的甲基化是多少？',
      requestId: 'r-notice-3p',
      consentLevel: 'precise',
    });
    expect(roundToolText(preciseLlm, 1)).toContain('甲基化值: 12%');
  });

  it('promises nothing for a cell the patient does not have', async () => {
    // No d4z4, no haplotype, no methylation. Turning the switch on
    // would produce none of them, so none of them may be named.
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, {
      gender: '女',
      onsetRegion: '面部',
      familyHistory: '无',
    }).run({
      userId: 'u1',
      question: '我的情况？',
      requestId: 'r-notice-4',
      consentLevel: 'basic',
    });

    const notice = noticeOf(llm, 1);
    expect(notice).toContain('也不会再多给你任何字段');
    expect(notice).not.toContain('才会多出来的字段');
    expect(notice).not.toContain('D4Z4 重复数');
    expect(notice).not.toContain('单倍型');
  });

  it('is absent entirely when the projection emitted no patient field', async () => {
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, null).run({
      userId: 'u1',
      question: '我的情况？',
      requestId: 'r-notice-5',
      consentLevel: 'basic',
    });
    expect(roundText(llm, 0)).not.toContain('【当前数据可见范围】');
    expect(roundText(llm, 1)).not.toContain('【当前数据可见范围】');
  });

  it('is absent under precise consent, where nothing is withheld for consent', async () => {
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, PROFILE_WITH_GENETICS).run({
      userId: 'u1',
      question: '我的情况？',
      requestId: 'r-notice-6',
      consentLevel: 'precise',
    });
    expect(roundText(llm, 1)).not.toContain('【当前数据可见范围】');
  });

  it('is rebuilt from the fields of the round it is attached to, not accumulated', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'g1', name: 'get_my_records', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      },
      {
        content: '我看到你的记录了，再查一下档案。',
        toolCalls: [{ id: 'g2', name: 'get_my_profile', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      },
      { content: '最终回答。', toolCalls: [], finishReason: 'stop' },
    ]);
    const orch = new Orchestrator(
      llm,
      new ToolRegistry()
        .register(
          mkTool(
            'get_my_records',
            stubResult('patient_followups', 1, {
              metricKey: 'six_min_walk',
              metricLabel: '6分钟步行',
              count: 5,
              spanDays: 120,
              changeDirection: 'down',
              latestBand: '略有下降',
              unit: '米',
              latestValue: 320,
              series: '350米(120天前)、320米(0天前)',
            }),
          ),
        )
        .register(
          mkTool('get_my_profile', stubResult('patient_profile', 1, PROFILE_WITH_GENETICS)),
        ),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    await orch.run({
      userId: 'u1',
      question: '我最近怎么样？',
      requestId: 'r-notice-7',
      consentLevel: 'basic',
    });

    // Round 2 saw only the follow-up chunk.
    const second = noticeOf(llm, 1);
    expect(second).toContain('患者随访记录');
    expect(second).not.toContain('患者基础档案');
    // ...and follow-ups DO have raw values behind the switch.
    expect(second).toContain('最近数值');
    // `unit` is deliberately never promised: nothing in the strict
    // projection says whether the series' points agree on one.
    expect(second).not.toContain('单位');

    // Round 3 saw both, and carries exactly one notice.
    const third = llm.chat.mock.calls[2][0] as LlmChatRequest;
    expect(
      third.messages.filter(
        (m) => m.role === 'system' && String(m.content).includes('【当前数据可见范围】'),
      ),
    ).toHaveLength(1);
    expect(noticeOf(llm, 2)).toContain('患者基础档案');
    expect(noticeOf(llm, 2)).toContain('患者随访记录');
  });

  it('explains 「本平台判读」 only when such a field is in the emission', async () => {
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, { gender: '女', onsetRegion: '面部' }).run({
      userId: 'u1',
      question: '我的情况？',
      requestId: 'r-notice-8',
      consentLevel: 'basic',
    });
    const notice = noticeOf(llm, 1);
    expect(notice).toContain('本轮工具消息里你已经拿到的字段');
    expect(notice).not.toContain('本平台判读');
    expect(notice).not.toContain('numericValuesWithheld');
  });

  // ------------------------------------------------------------------
  // A KEY THAT EXISTS IS NOT A VALUE THAT EXISTS.
  //
  // `redactFields` writes `fields_clinical` for any report row carrying
  // an OCR object at all — an empty projection included — and
  // `renderFieldsByScope` then prints nothing for it. The notice read
  // the key and offered precise consent for report cells that are not
  // there. The same shape reached three other claims: the inventory
  // named `处理状态` / `上传年份` for null columns, the
  // numericValuesWithheld sentence explained a row that was written
  // only when the counter is above zero, and the 判读 paragraph fired on
  // the container rather than on a reading.
  // ------------------------------------------------------------------

  it('offers no consent switch for a report whose OCR projection came out empty', async () => {
    const row = {
      classifiedType: 'genetic',
      status: null,
      uploadYear: null,
      // Everything in here is dropped by `projectOcrFields`, so the
      // blob projects to {} while the key still reaches `fieldsUsed`.
      fields: { patientName: '张三', 送检医院: '某某医院' },
    };
    const llm = mkLlm(gatherThenAnswerWith('get_my_reports'));
    await reportsOrchestrator(llm, row).run({
      userId: 'u1',
      question: '我的报告说了什么？',
      requestId: 'r-notice-empty-ocr',
      consentLevel: 'basic',
    });

    const tools = roundToolText(llm, 1);
    const notice = noticeOf(llm, 1);

    // The tool message carries no OCR row of any kind...
    expect(tools).not.toContain('OCR 字段');
    // ...so nothing may claim one is there, or that consent unlocks it.
    expect(notice).not.toContain('OCR 字段');
    expect(notice).not.toContain('才会多出来的字段');
    expect(notice).toContain('也不会再多给你任何字段');
    expect(notice).not.toContain('numericValuesWithheld');
    // The null columns are the same defect one row up.
    expect(inventoryOf(notice)).toEqual(['报告类型']);

    // And the switch really would produce nothing, so the promise
    // withheld above is the true one.
    const precise = mkLlm(gatherThenAnswerWith('get_my_reports'));
    await reportsOrchestrator(precise, row).run({
      userId: 'u1',
      question: '我的报告说了什么？',
      requestId: 'r-notice-empty-ocr-p',
      consentLevel: 'precise',
    });
    expect(roundToolText(precise, 1)).not.toContain('  - ');
  });

  it('offers no consent switch for a metric whose every record is 「做不到」', async () => {
    // The unable-only branch of the follow-up retriever ships
    // `count: 0` and no series at all, and `count` was this table's
    // evidence for 最近数值 / 历次记录 — so a patient who had recorded
    // nothing but 做不到 was told the switch would produce numbers.
    const llm = mkLlm(gatherThenAnswerWith('get_my_records'));
    await followupsOrchestrator(llm, {
      metricKey: 'grip',
      metricLabel: '握力',
      count: 0,
      unableSummary: '本期共 6 次记录为「做不到」（这些次没有数值），最近一次 2 天前',
    }).run({
      userId: 'u1',
      question: '我的握力怎么样？',
      requestId: 'r-notice-unable-only',
      consentLevel: 'basic',
    });

    const notice = noticeOf(llm, 1);
    expect(notice).toContain('记录次数');
    expect(notice).not.toContain('才会多出来的字段');
    expect(notice).not.toContain('最近数值');
    expect(notice).not.toContain('历次记录');
  });

  it('names no field the tool message did not print a row for', async () => {
    // null, '' and an empty array all survive the redactor into
    // `fieldsUsed` and are all skipped — or printed as a bare label —
    // by the renderer.
    const llm = mkLlm(gatherThenAnswer());
    await profileOrchestrator(llm, {
      gender: '女',
      onsetRegion: null,
      familyHistory: '',
      assistiveDevices: [],
    }).run({
      userId: 'u1',
      question: '我的情况？',
      requestId: 'r-notice-empty-cells',
      consentLevel: 'basic',
    });
    expect(inventoryOf(noticeOf(llm, 1))).toEqual(['性别']);
  });
});

describe('visibility-notice derivation fences', () => {
  // `BuiltContext.fieldsUsed` is scope-blind, so the notice recovers a
  // key's scope from the allowlist. That only works while the three
  // scopes' key sets are disjoint; the day they overlap, a field
  // retrieved for one scope would be printed under two headings and one
  // of the two would be a claim about a field the model never received.
  it('keeps the three scopes key-disjoint', () => {
    const scopes = ['profile', 'reports', 'followups'] as const;
    for (const a of scopes) {
      for (const b of scopes) {
        if (a === b) continue;
        const other = new Set([...PROMPT_ALLOWLIST[b].strict, ...PROMPT_ALLOWLIST[b].precise]);
        const shared = [...PROMPT_ALLOWLIST[a].strict, ...PROMPT_ALLOWLIST[a].precise].filter((k) =>
          other.has(k),
        );
        expect(shared, `${a} and ${b} share allowlist keys: ${shared.join(', ')}`).toEqual([]);
      }
    }
  });

  // A raw-value key added to a `precise` list with no evidence entry
  // would silently never be advertised — the patient would be left
  // unable to learn the switch exists for it.
  it('gives every precise-only allowlist key an evidence entry', () => {
    for (const scope of ['profile', 'reports', 'followups'] as const) {
      const strict = new Set<string>(PROMPT_ALLOWLIST[scope].strict);
      const preciseOnly = PROMPT_ALLOWLIST[scope].precise.filter((k) => !strict.has(k));
      const evidence = PRECISE_KEY_EVIDENCE[scope];
      for (const key of preciseOnly) {
        expect(Object.keys(evidence), `${scope}.${key} has no evidence entry`).toContain(key);
      }
      // ...and nothing in the table is a key the mode cannot carry.
      for (const key of Object.keys(evidence)) {
        expect(PROMPT_ALLOWLIST[scope].precise, `${scope}.${key}`).toContain(key);
      }
    }
  });

  // THE FENCE THAT IS NOT A CLAIM ABOUT KEY NAMES.
  //
  // Every row below is run through the real retriever→redactor→renderer
  // path TWICE, once under each consent level, and the question asked is
  // the patient's own: does flipping the switch change the bytes the
  // model receives? The notice may promise exactly when it does. Two
  // rows here promise nothing while carrying a full 「fields」 key —
  // the empty projection and the qualitative-only blob, whose strict and
  // precise OCR blocks are byte-identical.
  //
  // It doubles as the drift fence on `renderFieldsByScope`: the notice
  // reads the rendered rows by their printed shape, so a format change
  // in render.ts surfaces here rather than quietly emptying the notice.
  const shapes: Array<{
    name: string;
    tool: string;
    retriever: string;
    fields: Record<string, unknown>;
  }> = [
    {
      name: 'report, OCR blob projects to nothing',
      tool: 'get_my_reports',
      retriever: 'patient_reports',
      fields: { classifiedType: 'genetic', status: null, fields: { patientName: '张三' } },
    },
    {
      name: 'report, qualitative results only',
      tool: 'get_my_reports',
      retriever: 'patient_reports',
      fields: { classifiedType: 'lab', status: 'completed', fields: { trustAb: '阴性(-)' } },
    },
    {
      name: 'report, measurements withheld',
      tool: 'get_my_reports',
      retriever: 'patient_reports',
      fields: {
        classifiedType: 'lab',
        status: 'completed',
        fields: { alt: '35 U/L', ck: '1200 U/L' },
      },
    },
    {
      name: 'report, genetics cells',
      tool: 'get_my_reports',
      retriever: 'patient_reports',
      fields: {
        classifiedType: 'genetic',
        documentType: '基因检测报告',
        status: 'completed',
        fields: { d4z4Repeats: '7', haplotype: '4qA', methylation: '35%' },
      },
    },
    {
      name: 'report, genetics cell this platform refuses to read',
      tool: 'get_my_reports',
      retriever: 'patient_reports',
      fields: {
        classifiedType: 'genetic',
        status: 'completed',
        fields: { d4z4Repeats: '姓名:张三 住院号:R000000 D4Z4:7' },
      },
    },
    {
      name: 'follow-ups, every record 做不到',
      tool: 'get_my_records',
      retriever: 'patient_followups',
      fields: {
        metricKey: 'grip',
        metricLabel: '握力',
        count: 0,
        unableSummary: '本期共 6 次记录为「做不到」，最近一次 2 天前',
      },
    },
    {
      name: 'follow-ups, a real series',
      tool: 'get_my_records',
      retriever: 'patient_followups',
      fields: {
        metricKey: 'grip',
        metricLabel: '握力',
        count: 3,
        countAtCap: false,
        spanDays: 40,
        changeDirection: 'down',
        latestBand: '较前降低',
        unit: 'kg',
        latestValue: 18,
        series: '22kg(40天前)、18kg(0天前)',
      },
    },
    {
      name: 'follow-ups, events only',
      tool: 'get_my_records',
      retriever: 'patient_followups',
      fields: { eventSummary: '跌倒（轻）×2，最近 3 天前', eventCount: 2 },
    },
    {
      name: 'profile, no genetics cell at all',
      tool: 'get_my_profile',
      retriever: 'patient_profile',
      fields: { gender: '女', onsetRegion: '面部', familyHistory: '无' },
    },
    {
      name: 'profile, genetics cells on file',
      tool: 'get_my_profile',
      retriever: 'patient_profile',
      fields: { gender: '女', d4z4: '6', haplotype: '4qA', methylation: '12%' },
    },
    {
      name: 'profile, genetics cell this platform refuses to read',
      tool: 'get_my_profile',
      retriever: 'patient_profile',
      fields: { gender: '女', d4z4: '4q单倍型:4qB 姓名:张三 住院号:R000000' },
    },
  ];

  it.each(shapes)(
    'promises the consent switch exactly when it changes the prompt — $name',
    async ({ tool, retriever, fields }) => {
      const run = async (consentLevel: 'basic' | 'precise') => {
        const llm = mkLlm(gatherThenAnswerWith(tool));
        await oneRetrieverOrchestrator(llm, tool, retriever, fields).run({
          userId: 'u1',
          question: '我的情况？',
          requestId: `r-switch-${retriever}-${consentLevel}`,
          consentLevel,
        });
        return { notice: noticeOf(llm, 1), tools: roundToolText(llm, 1) };
      };

      const strict = await run('basic');
      const precise = await run('precise');

      const strictLines = strict.tools.split('\n');
      const added = precise.tools
        .split('\n')
        // The two modes head the OCR block with different words —
        // 「OCR 字段（临床化）:」 vs 「OCR 字段:」 — so the heading line
        // always differs even when every row under it is identical.
        // It is a name for the block, not a cell the switch unlocks.
        // (render.ts prints the precise heading even for a blob that
        // projected to nothing, which is why it can be the ONLY
        // difference.)
        .filter((line) => !strictLines.includes(line) && !/^OCR 字段(（临床化）)?:$/.test(line));
      const promised = strict.notice.includes('才会多出来的字段');

      expect(promised, `precise adds ${JSON.stringify(added)}`).toBe(added.length > 0);

      // ...and every field it names by label is one of the added rows,
      // so the promise is not merely non-empty but true field by field.
      if (!promised) return;
      for (const label of preciseOnlyOf(strict.notice)) {
        const row = label === 'OCR 字段（原始值）' ? '  - ' : `${label}: `;
        expect(
          added.some((line) => line.startsWith(row)),
          `notice promises 「${label}」 but precise adds no such row`,
        ).toBe(true);
      }
    },
  );
});

describe('Orchestrator.run — sentences about the state of this turn', () => {
  // `failures.personal` is raised by ANY of the three personal
  // retrievers. 「所以下面的回答没有用到你本人的数据」 is only true when
  // none of them got through — a patient whose profile read timed out
  // while their reports came back was shown that banner directly above
  // an answer quoting their own report.
  it('does not tell a patient their data was unused when part of it was', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [
          { id: 'a1', name: 'get_my_profile', argumentsJson: '{}' },
          { id: 'a2', name: 'get_my_reports', argumentsJson: '{}' },
        ],
        finishReason: 'tool_calls',
      },
      { content: '你的报告显示……', toolCalls: [], finishReason: 'stop' },
    ]);
    const throwingProfile: ITool = {
      name: 'get_my_profile',
      description: 'p',
      parametersSchema: { type: 'object' },
      parseArgs: () => ({}),
      execute: async () => {
        throw new Error('pg: connection terminated');
      },
    };
    const orch = new Orchestrator(
      llm,
      new ToolRegistry()
        .register(throwingProfile)
        .register(
          mkTool(
            'get_my_reports',
            stubResult('patient_reports', 1, { classifiedType: 'genetic', status: 'parsed' }),
          ),
        ),
      silentLogger as unknown as RetrieveContext['logger'],
    );
    const result = await orch.run({
      userId: 'u1',
      question: '我的报告？',
      requestId: 'r-partial',
      consentLevel: 'basic',
    });

    expect(result.usedPersonalData).toBe(true);
    expect(result.retrievalFailure?.personalDataUnavailable).toBe(true);
    expect(result.answer).toContain(PERSONAL_DATA_PARTIAL_NOTICE);
    expect(result.answer).not.toContain(PERSONAL_DATA_UNAVAILABLE_NOTICE);
  });

  it('still says nothing got through when nothing did', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'b1', name: 'get_my_profile', argumentsJson: '{}' }],
        finishReason: 'tool_calls',
      },
      { content: '我这边没读到你的资料。', toolCalls: [], finishReason: 'stop' },
    ]);
    const throwingProfile: ITool = {
      name: 'get_my_profile',
      description: 'p',
      parametersSchema: { type: 'object' },
      parseArgs: () => ({}),
      execute: async () => {
        throw new Error('pg: connection terminated');
      },
    };
    const result = await new Orchestrator(
      llm,
      new ToolRegistry().register(throwingProfile),
      silentLogger as unknown as RetrieveContext['logger'],
    ).run({
      userId: 'u1',
      question: '我的档案？',
      requestId: 'r-total',
      consentLevel: 'basic',
    });

    expect(result.usedPersonalData).toBe(false);
    expect(result.answer).toContain(PERSONAL_DATA_UNAVAILABLE_NOTICE);
    expect(result.answer).not.toContain(PERSONAL_DATA_PARTIAL_NOTICE);
  });

  // `failures.corpus` is sticky across gather rounds, so a turn whose
  // first knowledge-base lookup failed and whose second succeeded raises
  // it with citations in hand — and the banner used to say
  // 「下面的内容没有资料出处」 directly above an answer ending in [1].
  it('does not deny sources exist while shipping a source card', async () => {
    let kbCall = 0;
    const flakyKb: ITool = {
      name: 'search_medical_kb',
      description: 'kb',
      parametersSchema: { type: 'object' },
      parseArgs: () => ({}),
      execute: async () => {
        kbCall += 1;
        if (kbCall === 1) {
          return {
            retrieval: {
              retrieverId: 'medical_kb',
              chunks: [],
              citations: [],
              metadata: { reason: 'kb_service_unreachable', detail: 'fetch failed' },
            },
            display: 'medical_kb: 0 chunks',
          };
        }
        return { retrieval: stubResult('medical_kb', 1), display: 'medical_kb: 1 chunk' };
      },
    };
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'k1', name: 'search_medical_kb', argumentsJson: '{"query":"FSHD1"}' }],
        finishReason: 'tool_calls',
      },
      {
        content: '知识库这次没查到，我换个说法再查一次。',
        toolCalls: [{ id: 'k2', name: 'search_medical_kb', argumentsJson: '{"query":"D4Z4"}' }],
        finishReason: 'tool_calls',
      },
      { content: 'FSHD1 由 D4Z4 收缩引起 [1]。', toolCalls: [], finishReason: 'stop' },
    ]);
    const result = await new Orchestrator(
      llm,
      new ToolRegistry().register(flakyKb),
      silentLogger as unknown as RetrieveContext['logger'],
    ).run({
      userId: 'u1',
      question: 'FSHD1 是什么？',
      requestId: 'r-corpus',
      consentLevel: 'basic',
    });

    expect(result.retrievalFailure?.corpusUnavailable).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    // The banner is present and scoped to the uncited sentences; it must
    // not assert that the answer has no sources when a card is attached.
    expect(result.answer).toContain(CORPUS_UNAVAILABLE_NOTICE);
    expect(result.answer).not.toContain('下面的内容没有资料出处');
    expect(CORPUS_UNAVAILABLE_NOTICE).toContain('没有标出处编号');
  });

  // `isPreambleOnly('')` is false, so a round that produced no text at
  // all also reaches the retry — and it was told 「它只是宣布要再检索
  // 一次」 about a turn the very next line recorded as `(empty)`.
  it('does not describe an empty round as an announcement of another search', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'c1', name: 'search_medical_kb', argumentsJson: '{"query":"x"}' }],
        finishReason: 'tool_calls',
      },
      { content: '', toolCalls: [], finishReason: 'stop' },
      { content: '这是补上的完整回答。', toolCalls: [], finishReason: 'stop' },
    ]);
    await new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
    ).run({ userId: 'u1', question: 'q', requestId: 'r-empty', consentLevel: 'basic' });

    const retry = roundText(llm, 2);
    expect(retry).toContain('上一条回复是空的');
    expect(retry).not.toContain('它只是宣布要再检索一次');
  });

  it('keeps the preamble wording when there really was a preamble', async () => {
    const llm = mkLlm([
      {
        content: null,
        toolCalls: [{ id: 'd1', name: 'search_medical_kb', argumentsJson: '{"query":"x"}' }],
        finishReason: 'tool_calls',
      },
      { content: '让我再用其他关键词搜索一下：', toolCalls: [], finishReason: 'stop' },
      { content: '这是补上的完整回答。', toolCalls: [], finishReason: 'stop' },
    ]);
    await new Orchestrator(
      llm,
      new ToolRegistry().register(mkTool('search_medical_kb', stubResult('medical_kb', 1))),
      silentLogger as unknown as RetrieveContext['logger'],
    ).run({ userId: 'u1', question: 'q', requestId: 'r-preamble', consentLevel: 'basic' });

    expect(roundText(llm, 2)).toContain('它只是宣布要再检索一次');
  });

  // `finalPrompt.system` is documented as the final round's system
  // prompt, and it recorded only the FIRST system message — so the
  // final-turn directive, the visibility notice and the retry's
  // corrective instruction were all part of what the model was told and
  // none of them reached the audit row.
  it('records every system message the final round received', async () => {
    const llm = mkLlm(gatherThenAnswer());
    // maxToolRounds: 1, so the answer round is at the ceiling and
    // carries the final-turn directive as well as the notice.
    const orch = new Orchestrator(
      llm,
      new ToolRegistry().register(
        mkTool('get_my_profile', stubResult('patient_profile', 1, PROFILE_WITH_GENETICS)),
      ),
      silentLogger as unknown as RetrieveContext['logger'],
      { maxToolRounds: 1 },
    );
    const result = await orch.run({
      userId: 'u1',
      question: '我的情况？',
      requestId: 'r-audit-system',
      consentLevel: 'basic',
    });
    expect(result.finalPrompt.system).toContain(DEFAULT_SYSTEM_PROMPT);
    expect(result.finalPrompt.system).toContain('【当前数据可见范围】');
    expect(result.finalPrompt.system).toContain(FINAL_TURN_DIRECTIVE);
  });
});
