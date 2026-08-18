import { describe, expect, it, vi } from 'vitest';

import { buildContext, CitationIndex } from './context-builder.js';
import type { ExecutedToolCall } from './executor.js';
import type { RetrieveContext, RetrievedChunk } from '../retrievers/base.js';
import type { RedactionMode } from '../security/allowlist.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as RetrieveContext['logger'];

const kbChunk = (id: string, content: string): RetrievedChunk => ({
  id,
  source: 'medical_kb',
  content,
  metadata: {},
  distance: 0.1,
  sourceFile: 'fshd/x.md',
});

const profileChunk = (fields: Record<string, unknown>): RetrievedChunk => ({
  id: 'p1',
  source: 'patient_profile',
  content: 'placeholder',
  metadata: { fields },
  distance: null,
  sourceFile: 'patient_profile',
});

const ok = (
  toolCallId: string,
  toolName: string,
  chunks: RetrievedChunk[],
  options: { retrieverId?: string; citationsCount?: number } = {},
): ExecutedToolCall => {
  const retrieverId = options.retrieverId ?? chunks[0]?.source ?? toolName;
  const citationsCount = options.citationsCount ?? chunks.length;
  return {
    toolCallId,
    toolName,
    retrieval: {
      retrieverId,
      chunks,
      citations: chunks.slice(0, citationsCount).map((c) => ({
        chunkId: c.id,
        source: c.source,
        sourceFile: c.sourceFile ?? null,
        chunkIndex: 0,
        snippet: c.content.slice(0, 40),
      })),
      metadata: {},
    },
    display: `${toolName}: ${chunks.length}`,
    latencyMs: 10,
  };
};

describe('buildContext', () => {
  it('renders medical_kb chunks through the renderer and tags non-personal', () => {
    const executed = [
      ok('tc1', 'search_medical_kb', [
        kbChunk('a', 'DUX4 是位于 4q35 的双同源框基因，正常成人组织表达受抑制。'),
        kbChunk('b', 'D4Z4 重复序列拷贝数减少与 DUX4 失抑制相关。'),
      ]),
    ];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.toolMessages).toHaveLength(1);
    expect(built.toolMessages[0].toolCallId).toBe('tc1');
    expect(built.toolMessages[0].content).toMatch(/【片段1】/);
    expect(built.toolMessages[0].content).toMatch(/DUX4/);
    expect(built.citations).toHaveLength(2);
    expect(built.fieldsUsed).toEqual([]);
    expect(built.usedPersonalData).toBe(false);
  });

  it('flags usedPersonalData and aggregates fieldsUsed for patient sources', () => {
    const executed = [
      ok('tc1', 'get_my_profile', [
        profileChunk({
          gender: '男',
          diagnosisStage: 'stage 2',
          d4z4_clinical: 'short',
        }),
      ]),
    ];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.usedPersonalData).toBe(true);
    expect(built.fieldsUsed).toEqual(
      expect.arrayContaining(['gender', 'diagnosisStage', 'd4z4_clinical']),
    );
    expect(built.toolMessages[0].content).toMatch(/【患者基础档案】/);
    expect(built.toolMessages[0].content).toMatch(/性别: 男/);
  });

  it('dedupes citations by chunkId across tool calls', () => {
    const shared = kbChunk('dup', 'shared content with enough length to survive junk filter');
    const executed = [ok('tc1', 'a', [shared]), ok('tc2', 'b', [shared])];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.citations).toHaveLength(1);
    expect(built.citations[0].chunkId).toBe('dup');
  });

  it('emits a redacted error tool message when an executed call has an error', () => {
    const executed: ExecutedToolCall[] = [
      {
        toolCallId: 'tc1',
        toolName: 'a',
        display: 'a: invalid args',
        // The raw error contains data that came back from the
        // retriever (column names, parameters, sometimes user
        // strings). The orchestrator must not echo it back into the
        // LLM context — the model could surface it in the user-facing
        // answer.
        error: 'pg error 22P02: invalid input syntax for integer: "13800001234"',
        latencyMs: 0,
      },
    ];

    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });

    expect(built.toolMessages).toHaveLength(1);
    expect(built.toolMessages[0].content).toContain('tc1');
    // Stable structured marker the eval pipeline can grep on.
    expect(built.toolMessages[0].content).toContain('error_code:retrieval_failed');
    // The raw error must NOT make it into the prompt.
    expect(built.toolMessages[0].content).not.toContain('13800001234');
    expect(built.toolMessages[0].content).not.toContain('pg error');
    expect(built.usedPersonalData).toBe(false);
  });

  it('does not flag usedPersonalData when a patient retriever returned zero chunks', () => {
    const executed = [ok('tc1', 'get_my_profile', [])];
    const built = buildContext(executed, {
      mode: 'strict',
      logger: silentLogger as unknown as RetrieveContext['logger'],
    });
    expect(built.usedPersonalData).toBe(false);
  });
});

describe('citation numbering is global, not per-retriever', () => {
  const reportChunk = (id: string): RetrievedChunk => ({
    id,
    source: 'patient_reports',
    content: 'placeholder',
    metadata: { fields: { classifiedType: '基因检测报告', status: 'parsed' } },
    distance: null,
    sourceFile: `patient_reports/${id}`,
  });

  /**
   * The defect: the prompt header used the chunk's index WITHIN one
   * tool call while the client indexes `citations` globally. A model
   * citing its second report as [2] sent the patient to a knowledge-base
   * chunk about something else — and the snippet card opened and
   * confirmed it.
   */
  it('numbers the second retriever continuing from the first', () => {
    const built = buildContext(
      [
        ok('tc1', 'search_medical_kb', [
          kbChunk('kb-a', 'DUX4 是位于 4q35 的双同源框基因，正常成人组织表达受抑制。'),
          kbChunk('kb-b', 'D4Z4 重复序列拷贝数减少与 DUX4 失抑制相关。'),
        ]),
        ok('tc2', 'get_my_reports', [reportChunk('rep-a'), reportChunk('rep-b')]),
      ],
      { mode: 'precise', logger: silentLogger },
    );

    const kbMessage = built.toolMessages[0].content;
    const reportMessage = built.toolMessages[1].content;
    expect(kbMessage).toMatch(/【片段1】/);
    expect(kbMessage).toMatch(/【片段2】/);
    // Continues at 3 rather than restarting at 1.
    expect(reportMessage).toMatch(/【片段3】/);
    expect(reportMessage).toMatch(/【片段4】/);
    expect(reportMessage).not.toMatch(/【片段1】/);

    // And the number is an index into the array the client receives.
    expect(built.citations.map((c) => c.chunkId)).toEqual(['kb-a', 'kb-b', 'rep-a', 'rep-b']);
    expect(built.citations[2].chunkId).toBe('rep-a');
  });

  it('keeps numbering across gather rounds when the index is shared', () => {
    const citationIndex = new CitationIndex();
    const round1 = buildContext([ok('tc1', 'get_my_reports', [reportChunk('rep-a')])], {
      mode: 'precise',
      logger: silentLogger,
      citationIndex,
    });
    const round2 = buildContext(
      [ok('tc2', 'search_medical_kb', [kbChunk('kb-a', 'DUX4 表达受抑制，长度足够通过过滤器。')])],
      { mode: 'precise', logger: silentLogger, citationIndex },
    );

    expect(round1.toolMessages[0].content).toMatch(/【片段1】/);
    // Round 2 used to restart at 1, so 【片段1】 meant two different
    // documents inside one conversation.
    expect(round2.toolMessages[0].content).toMatch(/【片段2】/);
    // Cumulative and deduped — the index owns the list.
    expect(round2.citations.map((c) => c.chunkId)).toEqual(['rep-a', 'kb-a']);
  });

  it('gives a chunk with no citation no number at all', () => {
    // Nothing for the patient to open, so nothing the model should be
    // invited to cite. Handing it a number would point at somebody
    // else's source.
    const built = buildContext(
      [
        ok('tc1', 'search_medical_kb', [kbChunk('kb-a', 'DUX4 表达受抑制，长度足够通过过滤器。')], {
          citationsCount: 0,
        }),
      ],
      { mode: 'precise', logger: silentLogger },
    );
    expect(built.toolMessages[0].content).toContain('【参考资料·无法引用】');
    expect(built.toolMessages[0].content).not.toMatch(/【片段\d+】/);
    expect(built.citations).toEqual([]);
  });
});

describe('authority label (the grade the patient is shown, and what it refuses to show)', () => {
  /** `on` picks which side of the result carries the label — the two
   *  holders retrievers/base.ts declares: `Citation.authorityLabel`,
   *  where medical-kb stamps it, and `RetrievedChunk.authorityLabel`,
   *  for a retriever that grades the chunk and builds a plainer
   *  citation. */
  const withAuthority = (value: unknown, on: 'citation' | 'chunk'): ExecutedToolCall =>
    ({
      toolCallId: 'tc1',
      toolName: 'search_medical_kb',
      display: 'medical_kb: 1',
      latencyMs: 3,
      retrieval: {
        retrieverId: 'medical_kb',
        chunks: [
          {
            id: 'kb-a',
            source: 'medical_kb',
            content: 'DUX4 表达受抑制，这段内容长度足够通过渲染器。',
            metadata: {},
            distance: 0.1,
            sourceFile: 'fshd/x.md',
            ...(on === 'chunk' ? { authorityLabel: value } : {}),
          },
        ],
        citations: [
          {
            chunkId: 'kb-a',
            source: 'medical_kb',
            sourceFile: 'fshd/x.md',
            chunkIndex: 0,
            snippet: 'DUX4',
            ...(on === 'citation' ? { authorityLabel: value } : {}),
          },
        ],
        metadata: {},
      },
    }) as unknown as ExecutedToolCall;

  it('renders the citation label in the prompt header', () => {
    const built = buildContext([withAuthority('指南/共识', 'citation')], {
      mode: 'precise',
      logger: silentLogger,
    });
    // The model needs to know a claim came from a guideline rather than
    // a forum post; the patient sees the same grade on the chip.
    expect(built.toolMessages[0].content).toContain('来源等级：指南/共识');
    expect(built.citations[0]).toMatchObject({ chunkId: 'kb-a', authorityLabel: '指南/共识' });
  });

  it('copies a chunk-only label onto the citation the patient opens', () => {
    const built = buildContext([withAuthority('病友经验', 'chunk')], {
      mode: 'precise',
      logger: silentLogger,
    });
    expect(built.toolMessages[0].content).toContain('来源等级：病友经验');
    expect(built.citations[0]).toMatchObject({ authorityLabel: '病友经验' });
  });

  it('changes nothing when the field is absent, null, empty, mistyped or oversized', () => {
    for (const value of [undefined, null, '', '   ', 42, { nope: true }, 'x'.repeat(200)]) {
      // Nothing goes into the prompt header either way.
      for (const on of ['citation', 'chunk'] as const) {
        const built = buildContext([withAuthority(value, on)], {
          mode: 'precise',
          logger: silentLogger,
        });
        expect(built.toolMessages[0].content).not.toContain('来源等级');
      }
      // And the citation the patient's chip is built from carries no
      // label at all — not `42`, not three spaces. Whichever side the
      // unusable value came in on.
      for (const on of ['citation', 'chunk'] as const) {
        const citation = buildContext([withAuthority(value, on)], {
          mode: 'precise',
          logger: silentLogger,
        }).citations[0];
        expect(citation).not.toHaveProperty('authorityLabel');
      }
    }
  });
});

describe('retrieval failure is a refusal, not a licence to improvise', () => {
  const failing = (
    toolCallId: string,
    toolName: string,
    retrieverId: string,
    reason: string,
  ): ExecutedToolCall =>
    ({
      toolCallId,
      toolName,
      display: `${retrieverId}: 0 chunks`,
      latencyMs: 1,
      retrieval: { retrieverId, chunks: [], citations: [], metadata: { reason } },
    }) as unknown as ExecutedToolCall;

  // The instruction this replaced told the model to「基于常识继续作答」.
  // For a rare disease that means model priors delivered in the exact
  // voice used for sourced answers, to a reader who cannot tell them
  // apart.
  it('never tells the model to answer from its own knowledge', () => {
    const built = buildContext(
      [failing('tc1', 'search_medical_kb', 'medical_kb', 'kb_service_unreachable')],
      { mode: 'precise', logger: silentLogger },
    );
    const content = built.toolMessages[0].content;
    expect(content).not.toContain('基于常识');
    expect(content).toContain('不要用你自己记忆里的 FSHD 知识');
    expect(content).toContain('[error_code:retrieval_failed]');
    expect(built.failures).toEqual({ corpus: true, personal: false });
  });

  it('reads differently for a personal-data failure than for a corpus failure', () => {
    const corpus = buildContext(
      [failing('tc1', 'search_medical_kb', 'medical_kb', 'kb_service_unreachable')],
      { mode: 'precise', logger: silentLogger },
    ).toolMessages[0].content;
    const personal = buildContext(
      [
        {
          toolCallId: 'tc2',
          toolName: 'get_my_records',
          display: 'get_my_records: error',
          error: 'pg error 22P02: invalid input syntax for integer: "13800001234"',
          latencyMs: 2,
        },
      ],
      { mode: 'precise', logger: silentLogger },
    );

    const personalContent = personal.toolMessages[0].content;
    expect(personalContent).not.toBe(corpus);
    expect(personalContent).toContain('[error_code:personal_data_unavailable]');
    expect(personalContent).toContain('读取用户本人资料失败');
    // "we could not read it" is not "you have no records" — the second
    // is a claim about the patient and it would be false.
    expect(personalContent).toContain('不是"用户没有这条记录"');
    expect(personalContent).not.toContain('基于常识');
    expect(personal.failures).toEqual({ corpus: false, personal: true });
    // And the thrown error still never reaches the prompt.
    expect(personalContent).not.toContain('13800001234');
  });

  it('does not report a trial-cache failure as a knowledge-base failure', () => {
    // `list_clinical_trials` and its retriever both refuse to throw,
    // but two failures escape them anyway: a ToolValidationError out of
    // parseArgs, and the executor's wall-clock timeout, which rejects
    // around the promise the retriever's own try/catch sits inside.
    // Both land here as a bare `call.error`. Classified as `corpus`
    // they printed 「资料库检索没有跑成功」 about a medical knowledge
    // base that had not failed and whose chunks were in this same
    // prompt.
    const built = buildContext(
      [
        {
          toolCallId: 'tc3',
          toolName: 'list_clinical_trials',
          display: 'list_clinical_trials: error',
          error: 'Tool list_clinical_trials timed out after 30000ms',
          latencyMs: 30_000,
        },
      ],
      { mode: 'precise', logger: silentLogger },
    );
    const content = built.toolMessages[0].content;
    expect(content).not.toContain('资料库检索没有跑成功');
    expect(content).toContain('[error_code:trials_unavailable]');
    expect(content).toContain('不是医学知识库');
    // 「取不到试验列表」 and 「没有试验在招募」 are different sentences
    // and only one of them is true.
    expect(content).toContain('不等于「没有试验在招募」');
    // No corpus flag either: it drives a server-written banner over the
    // whole answer saying the knowledge base could not be reached.
    expect(built.failures).toEqual({ corpus: false, personal: false });
  });

  it('classifies the trials retriever the same way when it returns a reason instead of throwing', () => {
    // The tool-name map and the retriever-id map have to agree, or the
    // same subsystem gets two different sentences depending on how it
    // failed. `clinical_trials` has no reason in
    // RETRIEVAL_FAILURE_REASONS today — `cache_unreadable` is kept out
    // of that set precisely because membership routes back onto
    // `corpus` — so this pins the branch that keeps a reason added
    // later from silently reprinting the knowledge-base sentence.
    const built = buildContext(
      [failing('tc4', 'list_clinical_trials', 'clinical_trials', 'not_implemented')],
      { mode: 'precise', logger: silentLogger },
    );
    const content = built.toolMessages[0].content;
    expect(content).not.toContain('资料库检索没有跑成功');
    expect(content).toContain('[error_code:trials_unavailable]');
    expect(built.failures).toEqual({ corpus: false, personal: false });
  });
});

describe('personal-data flagging', () => {
  it('counts followup trends as personal data', () => {
    // The audit row and the UI hint both key off this. An answer built
    // from the patient's own stair-climb series must not be recorded
    // as having used no personal data.
    const result = buildContext(
      [
        {
          toolCallId: 'c1',
          toolName: 'get_my_records',
          display: 'patient_followups: 1 chunks',
          latencyMs: 5,
          retrieval: {
            retrieverId: 'patient_followups',
            chunks: [
              {
                id: 'chunk-1',
                source: 'patient_followups',
                content: '',
                metadata: { fields: { metricKey: 'stair_climb', count: 3 } },
                distance: null,
                sourceFile: 'patient_followups/stair_climb',
              },
            ],
            citations: [],
            metadata: {},
          },
        } as unknown as ExecutedToolCall,
      ],
      { mode: 'precise', logger: silentLogger },
    );

    expect(result.usedPersonalData).toBe(true);
  });
});

/**
 * The relevance floor's other half.
 *
 * The floor stops an out-of-corpus question (DMD, 针灸, 「某某医院能不能
 * 做基因检测」) from retrieving the nearest FSHD chunks. But zero chunks
 * rendered as 「（无内容）」 reads to the model exactly like a corpus with
 * no opinion, and it fills the gap from its priors — which is the same
 * failure the floor was built to prevent, one layer up.
 *
 * These three outcomes must each name themselves:
 *   - the search could not run       → failure instruction, retry ok
 *   - the corpus is not ingested     → failure instruction, retry useless
 *   - the search ran, nothing close  → not a failure at all
 */
const emptyWithReason = (toolCallId: string, retrieverId: string, reason: string) =>
  ({
    toolCallId,
    toolName: 'search_medical_kb',
    retrieval: { retrieverId, chunks: [], citations: [], metadata: { reason } },
    display: 'search_medical_kb: 0',
    latencyMs: 5,
  }) as unknown as ExecutedToolCall;

/**
 * Both modes the server can actually be in, and every case below is run
 * against each.
 *
 * This helper hardcoded `mode: 'full'`, which is not a `RedactionMode` —
 * the type is `'strict' | 'precise'` (../security/allowlist.ts) and there
 * has never been a third. vitest transpiles with esbuild and checks no
 * types, so the whole describe read green while driving a mode the server
 * never selects, and `npm run typecheck` was the only thing that saw it.
 *
 * Parameterising rather than picking one: which of the three zero-result
 * outcomes the model is told about is a property of the retrieval, not of
 * the consent level the patient granted. A change that named the outcomes
 * correctly under `strict` and fell back to 「（无内容）」 under `precise`
 * would be a bug in exactly the branch these tests exist to hold, and a
 * single-mode helper could not see it.
 */
const REDACTION_MODES: readonly RedactionMode[] = ['strict', 'precise'];

const contentOf = (call: ExecutedToolCall, mode: RedactionMode) =>
  buildContext([call], { mode, logger: silentLogger, citationIndex: new CitationIndex() })
    .toolMessages[0].content;

describe.each(REDACTION_MODES)('零结果的三种成因必须各自说清楚（%s）', (mode) => {
  it('查过了、没有足够相关的 → 不是故障，也不叫用户重试', () => {
    const text = contentOf(emptyWithReason('t1', 'medical_kb', 'no_relevant_results'), mode);
    expect(text).not.toContain('（无内容）');
    expect(text).toContain('no_relevant_results');
    expect(text).toContain('资料库查过了');
    // Assert the absent CLAIM, not the absent word: the instruction
    // itself contains 「不要说成"查询失败"」.
    expect(text).not.toContain('资料库检索没有跑成功');
    expect(text).not.toContain('过一会儿再问一次');
    expect(text).toContain('不是系统故障');
  });

  it('查过了、没有相关的 → 仍然禁止用模型自己的印象补上', () => {
    // The whole point. This is the branch a patient hits when they ask
    // about another disease, and model priors on someone else's disease
    // read exactly like sourced FSHD content to them.
    const text = contentOf(emptyWithReason('t1', 'medical_kb', 'no_relevant_results'), mode);
    expect(text).toContain('不要用你自己记忆里的知识');
  });

  it('语料库是空的 → 不说「过一会儿再问一次」，因为它不会自己好', () => {
    const text = contentOf(emptyWithReason('t2', 'medical_kb', 'kb_empty_corpus'), mode);
    expect(text).toContain('retrieval_failed');
    expect(text).not.toContain('过一会儿再问一次');
    expect(text).toContain('重试');
    expect(text).toContain('不要用你自己记忆里的 FSHD 知识');
  });

  it('检索确实挂了 → 保留重试话术', () => {
    const text = contentOf(emptyWithReason('t3', 'medical_kb', 'kb_service_unreachable'), mode);
    expect(text).toContain('过一会儿再问一次');
  });

  it('没有任何 reason 的空结果仍然是「（无内容）」', () => {
    const text = contentOf(emptyWithReason('t4', 'medical_kb', ''), mode);
    expect(text).toContain('（无内容）');
  });
});
