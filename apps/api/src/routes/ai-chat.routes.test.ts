import express from 'express';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createAiChatRoutes } from './ai-chat.routes.js';
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
  toolsCalled: ['search_medical_kb'],
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
        toolsCalled: ['search_medical_kb', 'get_my_profile'],
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
    expect(res.body.data.toolsCalled).toEqual(['search_medical_kb', 'get_my_profile']);
    expect(res.body.data.usedPersonalData).toBe(true);
    expect(res.body.data.consentLevel).toBe('basic');
    expect(res.body.data.auditId).toBe('audit-1');
    expect(res.body.data.progressId).toMatch(/^ai-/);

    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].status).toBe('success');
    expect(auditRecords[0].toolsCalled).toEqual(['search_medical_kb', 'get_my_profile']);
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
    toolsCalled: ['search_medical_kb'],
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
