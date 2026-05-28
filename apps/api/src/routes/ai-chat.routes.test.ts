import express from 'express';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createAiChatRoutes,
  _buildAskResponseData,
  _writeWithBackpressure,
} from './ai-chat.routes.js';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import { AuditLogger } from '../modules/ai-agents/audit/index.js';
import type { ILLMProvider } from '../modules/ai-agents/llm/index.js';
import {
  Orchestrator,
  type OrchestratorRunResult,
} from '../modules/ai-agents/orchestrator/index.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as AppLogger;

const fakeEnv: AppEnv = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgres://x',
  DATABASE_SSL_ENABLED: false,
  DATABASE_SSL_REJECT_UNAUTHORIZED: true,
  JWT_SECRET: 'test-secret-1234567890',
  JWT_EXPIRES_IN: '7d',
  BCRYPT_SALT_ROUNDS: 6,
  CORS_ORIGIN: '*',
  LOG_LEVEL: 'info',
  OTP_PROVIDER: 'mock',
  OTP_CODE_LENGTH: 6,
  OTP_TTL_MINUTES: 10,
  OTP_RESEND_INTERVAL_SECONDS: 60,
  OTP_MAX_SEND_PER_DAY: 10,
  OTP_MAX_VERIFY_ATTEMPTS: 5,
  OTP_HASH_SECRET: 'test-otp-secret-1',
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  AUTH_RATE_LIMIT_MAX_REQUESTS: 100,
  OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: 60,
  OTP_SEND_RATE_LIMIT_MAX_REQUESTS: 100,
  AI_RATE_LIMIT_WINDOW_SECONDS: 60,
  AI_RATE_LIMIT_MAX_REQUESTS: 100,
  AI_PROGRESS_RATE_LIMIT_WINDOW_SECONDS: 60,
  AI_PROGRESS_RATE_LIMIT_MAX_REQUESTS: 100,
  LOGIN_MAX_FAILURES: 5,
  LOGIN_LOCK_MINUTES: 15,
  AI_API_BASE_URL: 'http://test/v1',
  AI_API_MODEL: 'mock-model',
  AI_API_TIMEOUT: 30000,
  OCR_PROVIDER: 'mock',
  OCR_PYTHON_BIN: 'python3',
  OCR_PARSER_TIMEOUT_MS: 60000,
  STORAGE_PROVIDER: 'local',
  MINIO_BUCKET_NAME: 'm',
  MINIO_USE_HTTPS: false,
  KB_SERVICE_HOST: '127.0.0.1',
  KB_SERVICE_PORT: 5010,
  CHROMA_DATABASE: 'FSHD',
  CHROMA_COLLECTION: 'fshd_knowledge_base',
  CHROMA_API_PORT: 5000,
  CHROMA_API_HOST: 'localhost',
  HEALTHCHECK_TIMEOUT_MS: 2500,
  isProduction: false,
  isTest: true,
  chromaApiUrl: 'http://localhost:5000',
  chromaApiBaseUrl: 'http://localhost:5000/api',
  kbServiceUrl: 'http://localhost:5010',
} as unknown as AppEnv;

const issueToken = (userId: string) => jwt.sign({ sub: userId, role: 'user' }, fakeEnv.JWT_SECRET);

interface FakePoolOpts {
  consentRow?: {
    ai_consent_personal: boolean;
    ai_consent_third_party: boolean;
    ai_consent_precise_values: boolean;
  } | null;
}

const buildFakePool = (opts: FakePoolOpts = {}): Pool & { query: ReturnType<typeof vi.fn> } => {
  const query = vi.fn(async (text: string) => {
    if (typeof text === 'string' && /FROM patient_profiles/i.test(text)) {
      const row = opts.consentRow;
      return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  return { query } as unknown as Pool & { query: ReturnType<typeof vi.fn> };
};

const buildFakeLlm = (): ILLMProvider =>
  ({
    providerName: 'mock-llm',
    model: 'mock-model',
    supportsToolCalling: true,
    chat: vi.fn(),
    chatStream: vi.fn(),
  }) as unknown as ILLMProvider;

const buildFakeOrchestrator = (result: OrchestratorRunResult | Error): Orchestrator => {
  const run = vi.fn().mockImplementation(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { run } as unknown as Orchestrator;
};

const buildFakeAuditLogger = (
  records: Array<Record<string, unknown>>,
  listResult: Array<Record<string, unknown>> | Error = [],
): AuditLogger => {
  const record = vi.fn(async (entry: Record<string, unknown>) => {
    records.push(entry);
    return `audit-${records.length}`;
  });
  const listByUser = vi.fn(async () => {
    if (listResult instanceof Error) throw listResult;
    return listResult;
  });
  return { record, listByUser } as unknown as AuditLogger;
};

const buildApp = (overrides: {
  pool?: Pool;
  orchestrator?: Orchestrator | null;
  llmProvider?: ILLMProvider | null;
  auditLogger?: AuditLogger;
}) => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/ai',
    createAiChatRoutes(
      { env: fakeEnv, logger: silentLogger },
      {
        pool: overrides.pool,
        llmProvider: overrides.llmProvider,
        orchestrator: overrides.orchestrator,
        auditLogger: overrides.auditLogger,
      },
    ),
  );
  // Minimal error handler so AppError thrown by requireAuth produces a
  // JSON response. Express identifies an error handler by arity = 4,
  // so the unused `next` can't be dropped — disable the lint check.
  const errorHandler: express.ErrorRequestHandler = (
    err,
    _req,
    res,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next,
  ) => {
    const e = err as Error & { statusCode?: number };
    res.status(e.statusCode ?? 500).json({ success: false, message: e.message });
  };
  app.use(errorHandler);
  return app;
};

const successResult = (overrides: Partial<OrchestratorRunResult> = {}): OrchestratorRunResult => ({
  answer: '这里是 AI 回答',
  citations: [
    {
      chunkId: 'c1',
      source: 'medical_kb',
      sourceFile: 'fshd/a.md',
      chunkIndex: 0,
      snippet: 'snippet',
    },
  ],
  toolCalls: [
    {
      name: 'search_medical_kb',
      toolCallId: 'call-1',
      status: 'ok' as const,
      chunkCount: 2,
      latencyMs: 80,
    },
  ],
  fieldsUsed: [],
  usedPersonalData: false,
  redactionMode: 'strict',
  consentLevel: 'basic',
  finalPrompt: { system: 's', user: 'u' },
  redactedPromptHash: 'a'.repeat(64),
  promptCharLength: 123,
  llmUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  latencyMs: 42,
  ...overrides,
});

describe('POST /api/ai/ask', () => {
  it('400 when question is missing', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      llmProvider: buildFakeLlm(),
      orchestrator: buildFakeOrchestrator(successResult()),
      auditLogger: buildFakeAuditLogger([]),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask')
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/问题不能为空/);
  });

  it('401 without an auth header', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      llmProvider: buildFakeLlm(),
      orchestrator: buildFakeOrchestrator(successResult()),
      auditLogger: buildFakeAuditLogger([]),
    });
    const res = await request(app).post('/api/ai/ask').send({ question: 'hi' });
    expect(res.status).toBe(401);
  });

  it('503 when LLM provider is not configured', async () => {
    const app = buildApp({
      pool: buildFakePool({
        consentRow: {
          ai_consent_personal: true,
          ai_consent_third_party: true,
          ai_consent_precise_values: false,
        },
      }),
      llmProvider: null,
      orchestrator: null,
      auditLogger: buildFakeAuditLogger([]),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask')
      .set('authorization', `Bearer ${token}`)
      .send({ question: 'hi' });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/AI_API_KEY/);
  });

  it('403 + audit row on consent_denied', async () => {
    const auditRecords: Array<Record<string, unknown>> = [];
    const app = buildApp({
      pool: buildFakePool({ consentRow: null }),
      llmProvider: buildFakeLlm(),
      orchestrator: buildFakeOrchestrator(successResult()),
      auditLogger: buildFakeAuditLogger(auditRecords),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask')
      .set('authorization', `Bearer ${token}`)
      .send({ question: '你好' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('consent_required');
    expect(res.body.consent.level).toBe('none');
    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].status).toBe('consent_denied');
    expect(auditRecords[0].userId).toBe('u-1');
  });

  it('200 + audit row on success', async () => {
    const auditRecords: Array<Record<string, unknown>> = [];
    const orchestrator = buildFakeOrchestrator(
      successResult({
        toolCalls: [
          {
            name: 'search_medical_kb',
            toolCallId: 'call-1',
            status: 'ok',
            chunkCount: 3,
            latencyMs: 110,
          },
          {
            name: 'get_my_profile',
            toolCallId: 'call-2',
            status: 'ok',
            chunkCount: 1,
            latencyMs: 18,
          },
        ],
        fieldsUsed: ['gender', 'ageGroup'],
        usedPersonalData: true,
        consentLevel: 'basic',
      }),
    );
    const app = buildApp({
      pool: buildFakePool({
        consentRow: {
          ai_consent_personal: true,
          ai_consent_third_party: true,
          ai_consent_precise_values: false,
        },
      }),
      llmProvider: buildFakeLlm(),
      orchestrator,
      auditLogger: buildFakeAuditLogger(auditRecords),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask')
      .set('authorization', `Bearer ${token}`)
      .send({ question: 'D4Z4 是什么' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toBe('这里是 AI 回答');
    expect(res.body.data.toolCalls).toHaveLength(2);
    expect(res.body.data.toolCalls.map((c: { name: string }) => c.name)).toEqual([
      'search_medical_kb',
      'get_my_profile',
    ]);
    expect(res.body.data.toolCalls.every((c: { status: string }) => c.status === 'ok')).toBe(true);
    expect(res.body.data.usedPersonalData).toBe(true);
    expect(res.body.data.consentLevel).toBe('basic');
    expect(res.body.data.auditId).toBe('audit-1');
    expect(res.body.data.progressId).toMatch(/^ai-/);

    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].status).toBe('success');
    // audit row now stores the richer ToolCallSummary[]; check the
    // names array slice so we don't pin every latency value.
    expect((auditRecords[0].toolsCalled as { name: string }[]).map((c) => c.name)).toEqual([
      'search_medical_kb',
      'get_my_profile',
    ]);
    expect(auditRecords[0].llmProvider).toBe('mock-llm');
    expect(auditRecords[0].llmModel).toBe('mock-model');

    // orchestrator was actually invoked with the right shape
    const runMock = (orchestrator as unknown as { run: ReturnType<typeof vi.fn> }).run;
    const call = runMock.mock.calls[0][0];
    expect(call.userId).toBe('u-1');
    expect(call.question).toBe('D4Z4 是什么');
    expect(call.consentLevel).toBe('basic');
  });

  it('500 + audit error row when orchestrator throws', async () => {
    const auditRecords: Array<Record<string, unknown>> = [];
    const orchestrator = buildFakeOrchestrator(new Error('LLM down'));
    const app = buildApp({
      pool: buildFakePool({
        consentRow: {
          ai_consent_personal: true,
          ai_consent_third_party: true,
          ai_consent_precise_values: false,
        },
      }),
      llmProvider: buildFakeLlm(),
      orchestrator,
      auditLogger: buildFakeAuditLogger(auditRecords),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask')
      .set('authorization', `Bearer ${token}`)
      .send({ question: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('ai_error');
    expect(res.body.detail).toBe('LLM down');
    expect(auditRecords[0].status).toBe('error');
    expect(auditRecords[0].errorDetail).toBe('LLM down');
  });

  it('uses a caller-provided progressId when present', async () => {
    const app = buildApp({
      pool: buildFakePool({
        consentRow: {
          ai_consent_personal: true,
          ai_consent_third_party: true,
          ai_consent_precise_values: true,
        },
      }),
      llmProvider: buildFakeLlm(),
      orchestrator: buildFakeOrchestrator(successResult({ consentLevel: 'precise' })),
      auditLogger: buildFakeAuditLogger([]),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask')
      .set('authorization', `Bearer ${token}`)
      .send({ question: 'q', progressId: 'caller-abc' });

    expect(res.status).toBe(200);
    expect(res.body.data.progressId).toBe('caller-abc');
  });
});

describe('POST /api/ai/ask/stream', () => {
  /** Stub orchestrator that drives the runStream adapter through a
   *  scripted sequence of events instead of running the real planner /
   *  executor. The orchestrator's contract is "call onEvent for each
   *  stage, finally emit `done` or `error`" — that's what we mimic. */
  const buildStreamingOrchestrator = (
    events: Array<Parameters<NonNullable<Parameters<Orchestrator['run']>[1]>>[0]>,
  ): Orchestrator => {
    const run = vi.fn(async (_input, onEvent) => {
      for (const e of events) {
        if (onEvent) onEvent(e);
      }
      // Return the last `done` event's result if there is one; the
      // SSE route only reads `lastResult` from the event stream, but
      // run()'s Promise type still requires a return value.
      const last = events[events.length - 1];
      if (last?.type === 'done') return last.result;
      throw new Error('stream test ended without done event');
    });
    return { run } as unknown as Orchestrator;
  };

  const successDoneEvent = {
    type: 'done' as const,
    result: successResult({}),
  };

  it('400 when question is missing', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      llmProvider: buildFakeLlm(),
      orchestrator: buildStreamingOrchestrator([]),
      auditLogger: buildFakeAuditLogger([]),
    });
    const token = issueToken('u-1');
    const res = await request(app)
      .post('/api/ai/ask/stream')
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('403 + audit row when consent is none (no SSE body)', async () => {
    const records: Array<Record<string, unknown>> = [];
    const app = buildApp({
      pool: buildFakePool({ consentRow: null }),
      llmProvider: buildFakeLlm(),
      orchestrator: buildStreamingOrchestrator([]),
      auditLogger: buildFakeAuditLogger(records),
    });
    const token = issueToken('u-1');
    const res = await request(app)
      .post('/api/ai/ask/stream')
      .set('authorization', `Bearer ${token}`)
      .send({ question: '你好' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('consent_required');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('consent_denied');
  });

  it('streams events as SSE frames and writes a success audit row', async () => {
    const records: Array<Record<string, unknown>> = [];
    const app = buildApp({
      pool: buildFakePool({
        consentRow: {
          ai_consent_personal: true,
          ai_consent_third_party: true,
          ai_consent_precise_values: false,
        },
      }),
      llmProvider: buildFakeLlm(),
      orchestrator: buildStreamingOrchestrator([
        { type: 'planning' },
        { type: 'plan_complete', toolsPlanned: ['search_medical_kb'] },
        { type: 'answering' },
        { type: 'answer_delta', text: '你好' },
        { type: 'answer_delta', text: '，' },
        { type: 'answer_delta', text: '世界' },
        successDoneEvent,
      ]),
      auditLogger: buildFakeAuditLogger(records),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask/stream')
      .set('authorization', `Bearer ${token}`)
      .send({ question: 'D4Z4 是什么' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);

    // Parse the SSE body — each frame is `event: <type>\ndata: <json>\n\n`.
    // We just need to confirm the event types arrived in order and the
    // answer_delta data round-trips.
    const body = res.text;
    const eventLines = body.split('\n').filter((l) => l.startsWith('event: '));
    const types = eventLines.map((l) => l.replace('event: ', ''));
    expect(types).toEqual([
      'planning',
      'plan_complete',
      'answering',
      'answer_delta',
      'answer_delta',
      'answer_delta',
      'done',
    ]);

    // Extract the answer_delta data frames and check the text values.
    const deltaTexts = body
      .split('\n\n')
      .filter((frame) => frame.includes('event: answer_delta'))
      .map((frame) => {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: ')) ?? '';
        return (JSON.parse(dataLine.slice('data: '.length)) as { text: string }).text;
      });
    expect(deltaTexts).toEqual(['你好', '，', '世界']);

    // The `done` frame's payload should be the narrowed
    // `buildAskResponseData` shape, NOT the full
    // `OrchestratorRunResult`. Audit-internal fields
    // (`finalPrompt`, `redactedPromptHash`, `promptCharLength`) must
    // never leave the server.
    const doneFrame = body.split('\n\n').find((frame) => frame.includes('event: done'));
    expect(doneFrame).toBeDefined();
    const doneDataLine = doneFrame!.split('\n').find((l) => l.startsWith('data: ')) ?? '';
    const doneData = JSON.parse(doneDataLine.slice('data: '.length)) as {
      type: string;
      data: Record<string, unknown>;
    };
    expect(doneData.type).toBe('done');
    // Public fields are present
    expect(doneData.data).toMatchObject({
      question: 'D4Z4 是什么',
      answer: '这里是 AI 回答',
      consentLevel: 'basic',
      redactionMode: 'strict',
    });
    expect(doneData.data.progressId).toMatch(/^ai-/);
    expect(doneData.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Audit-internal fields are NOT leaked
    expect(doneData.data).not.toHaveProperty('finalPrompt');
    expect(doneData.data).not.toHaveProperty('redactedPromptHash');
    expect(doneData.data).not.toHaveProperty('promptCharLength');

    // Audit row reflects the final result, not the deltas.
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('success');
    expect(records[0].userId).toBe('u-1');
  });

  it('writes an error audit row when run() throws mid-stream', async () => {
    // The real orchestrator never emits its own `error` event — the
    // event type only fires when the runStream adapter catches a
    // thrown error from run(). Mirror that here: emit a few normal
    // stage events, then throw. The route should still finish
    // cleanly (SSE headers already flushed) and write an error
    // audit row carrying the thrown message.
    const records: Array<Record<string, unknown>> = [];
    const throwingOrchestrator: Orchestrator = {
      run: vi.fn(async (_input, onEvent) => {
        if (onEvent) {
          onEvent({ type: 'planning' });
          onEvent({ type: 'plan_complete', toolsPlanned: [] });
        }
        throw new Error('upstream LLM blew up');
      }),
    } as unknown as Orchestrator;
    const app = buildApp({
      pool: buildFakePool({
        consentRow: {
          ai_consent_personal: true,
          ai_consent_third_party: true,
          ai_consent_precise_values: false,
        },
      }),
      llmProvider: buildFakeLlm(),
      orchestrator: throwingOrchestrator,
      auditLogger: buildFakeAuditLogger(records),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .post('/api/ai/ask/stream')
      .set('authorization', `Bearer ${token}`)
      .send({ question: 'q' });

    expect(res.status).toBe(200); // headers already sent before the error
    expect(res.text).toMatch(/event: error/);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('error');
    expect(records[0].errorDetail).toMatch(/upstream LLM blew up/);
  });
});

describe('GET /api/ai/audit', () => {
  const fakeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'aud-1',
    userId: 'u-1',
    requestId: 'req-1',
    llmProvider: 'mock-llm',
    llmModel: 'mock-model',
    consentLevel: 'basic',
    redactionMode: 'strict',
    redactedPromptHash: 'a'.repeat(64),
    promptCharLength: 100,
    usedPersonalData: false,
    fieldsUsed: [],
    toolsCalled: [
      {
        name: 'search_medical_kb',
        toolCallId: 'call-1',
        status: 'ok' as const,
        chunkCount: 2,
        latencyMs: 80,
      },
    ],
    latencyMs: 1234,
    status: 'success',
    errorDetail: null,
    createdAt: '2026-05-28T01:00:00.000Z',
    ...overrides,
  });

  it('401 without auth', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: buildFakeAuditLogger([], [fakeRow()]),
    });
    const res = await request(app).get('/api/ai/audit');
    expect(res.status).toBe(401);
  });

  it('returns items + hasMore + count', async () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      fakeRow({ id: `aud-${i}`, requestId: `req-${i}` }),
    );
    const audit = buildFakeAuditLogger([], rows);
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: audit,
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .get('/api/ai/audit?limit=50')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(50);
    expect(res.body.data.hasMore).toBe(true); // exactly limit returned
    expect(res.body.data.items).toHaveLength(50);
    expect(res.body.data.items[0].id).toBe('aud-0');
    // listByUser should have been invoked with the right opts
    const opts = (audit.listByUser as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts).toMatchObject({ limit: 50 });
  });

  it('hasMore=false when fewer than the limit came back', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: buildFakeAuditLogger([], [fakeRow({ id: 'aud-1' }), fakeRow({ id: 'aud-2' })]),
    });
    const token = issueToken('u-1');

    const res = await request(app).get('/api/ai/audit').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.hasMore).toBe(false);
  });

  it('forwards status filter to listByUser', async () => {
    const audit = buildFakeAuditLogger([], [fakeRow({ status: 'consent_denied' })]);
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: audit,
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .get('/api/ai/audit?status=consent_denied')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const opts = (audit.listByUser as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts).toMatchObject({ status: 'consent_denied' });
  });

  it('400 on bad limit', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: buildFakeAuditLogger([], []),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .get('/api/ai/audit?limit=oops')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/limit/);
  });

  it('400 on fractional limit / offset (message says 整数)', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: buildFakeAuditLogger([], []),
    });
    const token = issueToken('u-1');

    const limitRes = await request(app)
      .get('/api/ai/audit?limit=1.5')
      .set('authorization', `Bearer ${token}`);
    expect(limitRes.status).toBe(400);
    expect(limitRes.body.message).toMatch(/limit/);

    const offsetRes = await request(app)
      .get('/api/ai/audit?offset=0.5')
      .set('authorization', `Bearer ${token}`);
    expect(offsetRes.status).toBe(400);
    expect(offsetRes.body.message).toMatch(/offset/);
  });

  it('400 on bad status', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: buildFakeAuditLogger([], []),
    });
    const token = issueToken('u-1');

    const res = await request(app)
      .get('/api/ai/audit?status=cool')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/status/);
  });

  it('500 when the listByUser query throws', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      auditLogger: buildFakeAuditLogger([], new Error('db down')),
    });
    const token = issueToken('u-1');

    const res = await request(app).get('/api/ai/audit').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/ai/health', () => {
  it('reports active when orchestrator is wired', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      llmProvider: buildFakeLlm(),
      orchestrator: buildFakeOrchestrator(successResult()),
      auditLogger: buildFakeAuditLogger([]),
    });
    const token = issueToken('u-1');

    const res = await request(app).get('/api/ai/health').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.llmConfigured).toBe(true);
  });

  it('reports disabled when LLM is missing', async () => {
    const app = buildApp({
      pool: buildFakePool(),
      llmProvider: null,
      orchestrator: null,
      auditLogger: buildFakeAuditLogger([]),
    });
    const token = issueToken('u-1');

    const res = await request(app).get('/api/ai/health').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disabled');
    expect(res.body.llmConfigured).toBe(false);
  });
});

describe('buildAskResponseData (response narrowing)', () => {
  /** Pin the public response shape so a future addition to
   *  `OrchestratorRunResult` doesn't accidentally widen what either
   *  route ships back to the client. The narrowing is the whole
   *  point of the helper — its job is to deny by default. */
  it('emits only the documented public fields', () => {
    const result = {
      answer: 'A',
      citations: [
        {
          chunkId: 'c1',
          source: 's',
          sourceFile: 'f',
          chunkIndex: 0,
          snippet: 'sn',
        },
      ],
      toolCalls: [
        {
          name: 't',
          toolCallId: 'tc1',
          status: 'ok' as const,
          chunkCount: 1,
          latencyMs: 5,
        },
      ],
      fieldsUsed: ['g'],
      usedPersonalData: true,
      consentLevel: 'basic' as const,
      redactionMode: 'strict' as const,
      llmUsage: { totalTokens: 10 },
      latencyMs: 50,
      // Audit-internal — MUST be stripped.
      finalPrompt: { system: 'SECRET system prompt', user: 'SECRET user prompt' },
      redactedPromptHash: 'a'.repeat(64),
      promptCharLength: 999,
    } as unknown as Parameters<typeof _buildAskResponseData>[1];

    const out = _buildAskResponseData('the question', result, 'audit-9', 'prog-9');

    expect(Object.keys(out).sort()).toEqual(
      [
        'answer',
        'auditId',
        'citations',
        'consentLevel',
        'fieldsUsed',
        'latencyMs',
        'llmUsage',
        'progressId',
        'question',
        'redactionMode',
        'timestamp',
        'toolCalls',
        'usedPersonalData',
      ].sort(),
    );
    // Defensive double-check: the audit-internal field names are
    // absent regardless of whether someone adds them above.
    expect(out).not.toHaveProperty('finalPrompt');
    expect(out).not.toHaveProperty('redactedPromptHash');
    expect(out).not.toHaveProperty('promptCharLength');
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
});

describe('writeWithBackpressure', () => {
  // We don't need a real socket — `Response` is duck-typed by the
  // helper to `.write()` + `.once('drain' | 'close')` + flags.
  type FakeRes = {
    writableEnded: boolean;
    destroyed: boolean;
    write: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    _listeners: Map<string, Array<() => void>>;
    _fire: (event: 'drain' | 'close') => void;
  };

  const makeFakeRes = (writeReturn: boolean): FakeRes => {
    const listeners = new Map<string, Array<() => void>>();
    const res: FakeRes = {
      writableEnded: false,
      destroyed: false,
      _listeners: listeners,
      _fire: (event) => {
        // Snapshot listeners before firing so the off() in handlers
        // can't mutate what we're iterating.
        const handlers = [...(listeners.get(event) ?? [])];
        for (const h of handlers) h();
      },
      write: vi.fn(() => writeReturn),
      once: vi.fn((event: string, handler: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(handler);
        listeners.set(event, list);
        return res;
      }),
      off: vi.fn((event: string, handler: () => void) => {
        const list = listeners.get(event) ?? [];
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
        return res;
      }),
    };
    return res;
  };

  it('resolves true synchronously when write returned true', async () => {
    const res = makeFakeRes(true);
    const ok = await _writeWithBackpressure(
      res as unknown as Parameters<typeof _writeWithBackpressure>[0],
      'payload',
    );
    expect(ok).toBe(true);
    expect(res.write).toHaveBeenCalledWith('payload');
    // No drain / close listener should have been attached on the
    // happy path.
    expect(res.once).not.toHaveBeenCalled();
  });

  it('waits for drain when write returned false', async () => {
    const res = makeFakeRes(false);
    const p = _writeWithBackpressure(
      res as unknown as Parameters<typeof _writeWithBackpressure>[0],
      'big payload',
    );
    expect(res.once).toHaveBeenCalledWith('drain', expect.any(Function));
    expect(res.once).toHaveBeenCalledWith('close', expect.any(Function));
    // Simulate the socket flushing.
    res._fire('drain');
    await expect(p).resolves.toBe(true);
    // The close listener should have been cleared so we don't leak.
    expect(res.off).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('resolves false when the client disconnects mid-wait', async () => {
    const res = makeFakeRes(false);
    const p = _writeWithBackpressure(
      res as unknown as Parameters<typeof _writeWithBackpressure>[0],
      'big payload',
    );
    res._fire('close');
    await expect(p).resolves.toBe(false);
    // And the drain listener should have been cleared.
    expect(res.off).toHaveBeenCalledWith('drain', expect.any(Function));
  });

  it('short-circuits to false when the response is already ended / destroyed', async () => {
    const ended = makeFakeRes(true);
    ended.writableEnded = true;
    await expect(
      _writeWithBackpressure(ended as unknown as Parameters<typeof _writeWithBackpressure>[0], 'x'),
    ).resolves.toBe(false);
    expect(ended.write).not.toHaveBeenCalled();

    const destroyed = makeFakeRes(true);
    destroyed.destroyed = true;
    await expect(
      _writeWithBackpressure(
        destroyed as unknown as Parameters<typeof _writeWithBackpressure>[0],
        'x',
      ),
    ).resolves.toBe(false);
    expect(destroyed.write).not.toHaveBeenCalled();
  });
});
