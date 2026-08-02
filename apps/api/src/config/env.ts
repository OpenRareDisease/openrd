import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const booleanish = () =>
  z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return value;
  }, z.boolean());

const optionalNonEmptyString = () =>
  z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());

/**
 * Parse the comma-separated OTP_TEST_PHONE_ALLOWLIST into a clean list
 * (trimmed, empties dropped). Exported + shared so the fail-fast
 * validator (validateProductionEnv) and the runtime auth gate
 * (OtpService) reason about the EXACT same parse. A divergence here
 * would be a security event — the validator certifying "non-empty,
 * safe to boot" while the gate builds a different Set — not cosmetic.
 */
export const parseOtpAllowlist = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const envSchema = z
  .object({
    // `staging` is treated as production-shaped (see `isProductionLike`
    // below + `validateProductionEnv`). Without it the zod parse step
    // throws "Invalid enum value" for any real staging deploy and the
    // operator has to choose between dropping NODE_ENV (silently falls
    // back to `development`, skipping the placeholder rejection) or
    // setting `production` (conflates staging + prod in metrics/logs).
    // Both are wrong defaults; making `staging` a first-class value
    // closes the gap.
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgres://postgres:postgres@localhost:5432/fshd_openrd'),
    DATABASE_SSL_ENABLED: booleanish().default(false),
    DATABASE_SSL_REJECT_UNAUTHORIZED: booleanish().default(true),
    // Explicit acknowledgement that a prod DB connection WITHOUT SSL is
    // intentional (compose-internal / private-network Postgres that
    // speaks no SSL). Without this ack, prod + !DATABASE_SSL_ENABLED
    // fail-fasts — so a remote/managed DB can't silently fall back to a
    // plaintext PHI connection just because someone forgot the SSL flag.
    DATABASE_ALLOW_INSECURE: booleanish().default(false),
    /** Pool ceiling. pg-pool defaults to 10, which is fine for one
     *  instance and wrong for several behind a connection-limited
     *  Postgres — make it a deploy-time decision rather than a default
     *  nobody knows about. */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** How long a request waits for a free connection before failing.
     *  0 (pg-pool's default) means "wait forever", which turns a
     *  saturated database into requests that never answer. */
    DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
    /** How long to keep serving after SIGTERM while readiness already
     *  reports NOT ready. Must exceed the load balancer's health-check
     *  interval, or the LB never observes the failing poll and keeps
     *  routing right up to the closed listener. */
    SHUTDOWN_READINESS_DRAIN_MS: z.coerce.number().int().min(0).default(5_000),
    /** Hard deadline for the whole shutdown. An open SSE stream never
     *  closes on its own, so without this one subscriber blocks the
     *  deploy forever. Keep it below the orchestrator's own SIGKILL
     *  timeout (Kubernetes: terminationGracePeriodSeconds) so the exit
     *  is ours and lands in the logs. */
    SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).default(20_000),
    // The schema minimum stays 16 on purpose. The real policy is「≥32
    // chars, high entropy」and it is enforced in validateProductionEnv
    // (assertStrongSecret) rather than here, because this field's own
    // default — 'change-me-super-secret' — is 22 characters: raising the
    // zod minimum to 32 would make the DEFAULT fail the parse, so every
    // dev machine and every unit test would die in safeParse before the
    // production gate ever ran. Dev keeps a low bar; production gets the
    // strict one.
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET must be at least 16 characters long')
      .default('change-me-super-secret'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(6).max(14).default(10),
    CORS_ORIGIN: z.string().default('*'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    OTP_PROVIDER: z.enum(['mock', 'tencent', 'internal_test']).default('mock'),
    OTP_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
    OTP_RESEND_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
    OTP_MAX_SEND_PER_DAY: z.coerce.number().int().min(1).default(10),
    OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    // INTERNAL-TEST OTP bridge (OTP_PROVIDER=internal_test): temporary
    // until Tencent SMS is wired. Comma-separated allowlist of test
    // phone numbers allowed to log in, plus the fixed code they enter.
    // Both validated in validateProductionEnv when the provider is
    // active (allowlist non-empty, fixed code matches OTP_CODE_LENGTH).
    OTP_TEST_PHONE_ALLOWLIST: z.string().default(''),
    OTP_TEST_FIXED_CODE: z.string().default(''),
    // TENCENT SMS (OTP_PROVIDER=tencent) — real SMS delivery via the
    // Tencent Cloud SendSms API. The five string creds are required when
    // the provider is active (validated in validateProductionEnv);
    // region has a sane default. The approved template MUST have exactly
    // two variables — {1} = code, {2} = TTL minutes — see
    // TencentOtpProvider, which passes [code, String(ttlMinutes)].
    TENCENT_SECRET_ID: optionalNonEmptyString(),
    TENCENT_SECRET_KEY: optionalNonEmptyString(),
    TENCENT_SMS_SDK_APP_ID: optionalNonEmptyString(),
    TENCENT_SMS_SIGN_NAME: optionalNonEmptyString(),
    TENCENT_SMS_TEMPLATE_ID: optionalNonEmptyString(),
    TENCENT_SMS_REGION: z.string().default('ap-guangzhou'),
    OTP_HASH_SECRET: z.string().min(8).default('change-me-otp-secret'),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(20),
    OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    OTP_SEND_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(5),
    AI_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    AI_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(6),
    AI_PROGRESS_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    AI_PROGRESS_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(30),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(20).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    // optionalNonEmptyString (NOT .min(1).optional()) so an EMPTY value
    // in .env — e.g. `AI_API_KEY=` copied straight from .env.example
    // before the operator has a key — coerces to undefined instead of
    // failing zod's .min(1) with "String must contain at least 1
    // character". These two crashed prod boot on first deploy; every
    // other optional secret already uses this helper.
    OPENAI_API_KEY: optionalNonEmptyString(),
    AI_API_KEY: optionalNonEmptyString(),
    AI_API_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
    // Explicit acknowledgement that sending prompts to a NON-mainland
    // (`.cn`) LLM endpoint is intentional. Every /ai/ask prompt carries
    // the patient's free-text question plus consent-gated clinical
    // fields, so moving the base URL off `api.siliconflow.cn` — which
    // .env.example describes purely as an account/catalog match — turns
    // the deploy into a cross-border transfer of health-related personal
    // information under PIPL Art. 38-39 (CAC assessment or filed
    // standard contract, separate consent, named overseas recipient).
    // Same explicit-ack shape as DATABASE_ALLOW_INSECURE: the flag does
    // not make the transfer lawful, it makes it a decision someone had
    // to write down instead of a one-line .env edit nobody reviewed.
    AI_CROSS_BORDER_ACKNOWLEDGED: booleanish().default(false),
    AI_API_MODEL: z.string().default('deepseek-ai/DeepSeek-V3'),
    AI_API_TIMEOUT: z.coerce.number().int().positive().default(30000),
    // Ceiling on tool-executing rounds in the orchestrator. Every round
    // is a full-context LLM call plus a batch of retrievals, so this is
    // the main dial between "answers a two-step question" and "how long
    // a patient waits". Measured on the reference deploy: one round
    // lands in 14-16s, two in 21-30s.
    AI_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(6).default(3),
    // Multi-turn /ai/ask history budgets. The server is the authority
    // on how much client-replayed conversation reaches the LLM: at
    // most this many prior turns, and at most this many total chars
    // (~2.7k tokens of Chinese at 8000 — planner + final round double
    // that input cost, which stays affordable). Tune down to cut LLM
    // spend without a client release.
    AI_HISTORY_MAX_MESSAGES: z.coerce.number().int().min(0).default(12),
    AI_HISTORY_CHAR_BUDGET: z.coerce.number().int().min(0).default(8000),

    BAIDU_OCR_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    BAIDU_OCR_SECRET_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    BAIDU_OCR_GENERAL_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
    BAIDU_OCR_ACCURATE_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
    BAIDU_OCR_MEDICAL_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),

    OCR_PROVIDER: z.enum(['embedded', 'baidu', 'mock']).default('embedded'),
    OCR_PYTHON_BIN: z.string().default('python3'),
    /**
     * Wall clock for one embedded parse.
     *
     * Was 120s, which is the wrong side of the actual cost. Measured
     * on a warm cache, machine otherwise idle, one document at a time:
     * ~103s — a 14% margin. Every parse was one scheduling hiccup away
     * from being killed, and a batch upload reliably lost several.
     * The failure surfaced as「识别失败」on a document whose OCR was
     * working perfectly; running the same command by hand always
     * succeeded, which is what made it look like a parser bug.
     *
     * Most of that time is process start-up: each document spawns a
     * fresh Python that reloads five PaddleOCR models. 300s is a
     * deliberate over-provision of that constant, not an estimate of
     * the work — the real fix is a persistent worker so the models are
     * loaded once rather than per document.
     */
    OCR_PARSER_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
    OCR_DISABLE_PADDLE: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),

    STORAGE_PROVIDER: z.enum(['local', 'minio']).default('local'),
    // Explicit acknowledgement that a production deploy is keeping
    // patient scans on the container's local disk instead of object
    // storage. `local` is the default in every layer (schema,
    // .env.example, docker-compose), so without this ack an operator who
    // copies .env.example ships PDFs, MRI images and genetic reports
    // onto an unreplicated named volume with no signal anywhere — and
    // validateStorageEnv's whole minio credential block is skipped
    // because it early-returns on a non-minio provider.
    STORAGE_ALLOW_LOCAL: booleanish().default(false),
    MINIO_ENDPOINT: optionalNonEmptyString(),
    MINIO_ACCESS_KEY: optionalNonEmptyString(),
    MINIO_SECRET_KEY: optionalNonEmptyString(),
    MINIO_BUCKET_NAME: z.string().default('medical-reports'),
    MINIO_USE_HTTPS: booleanish().default(false),
    // The object-storage twin of DATABASE_ALLOW_INSECURE. A
    // compose-internal `minio:9000` is a docker-bridge hop and needs no
    // TLS; a managed / remote S3-compatible endpoint absolutely does,
    // and without this ack MINIO_USE_HTTPS=false would carry the access
    // key, the secret key and the raw bytes of every scanned hospital
    // report over the network in cleartext with no boot-time signal.
    MINIO_ALLOW_INSECURE: booleanish().default(false),

    KB_SERVICE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    KB_SERVICE_HOST: z.string().default('127.0.0.1'),
    KB_SERVICE_PORT: z.coerce.number().int().positive().default(5010),
    // Bearer token shared with the Python KB service. Forwarded as
    // `Authorization: Bearer ...` on every /multi request. Empty in
    // loopback dev; required in production (validated below).
    KB_SERVICE_TOKEN: optionalNonEmptyString(),
    // Same empty-string-safe treatment as the AI keys above — these
    // ship as placeholders in .env.example, but an operator who blanks
    // them out (no Chroma) shouldn't crash boot.
    CHROMA_API_KEY: optionalNonEmptyString(),
    CHROMA_TENANT_ID: optionalNonEmptyString(),
    CHROMA_DATABASE: z.string().default('FSHD'),
    CHROMA_COLLECTION: z.string().default('fshd_knowledge_base'),
    CHROMA_API_PORT: z.coerce.number().int().positive().default(5000),
    CHROMA_API_HOST: z.string().default('localhost'),
    HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  })
  .transform((value) => ({
    ...value,
    // `isProductionLike` is the gate for `validateProductionEnv`.
    // Staging must satisfy the same secret-rotation + CORS / OTP /
    // OCR hardening that prod does — otherwise a staging deploy
    // could ship with `change-me-super-secret`, `OCR_PROVIDER=mock`,
    // or `CORS_ORIGIN=*` and the fail-fast wouldn't fire. The name
    // deliberately says "Like" instead of `isProduction` because the
    // value covers BOTH `NODE_ENV=production` and `NODE_ENV=staging`
    // — a `isProduction` field that returned true for staging would
    // mislead anyone reading consumer code without diving back to
    // this transform. `isStaging` stays separate for any metrics /
    // logging surface that wants to distinguish the two
    // environments (Sentry environment, log-aggregator tag, etc.).
    isProductionLike: value.NODE_ENV === 'production' || value.NODE_ENV === 'staging',
    isStaging: value.NODE_ENV === 'staging',
    isTest: value.NODE_ENV === 'test',
    chromaApiUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}`,
    chromaApiBaseUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}/api`,
    kbServiceUrl:
      value.KB_SERVICE_URL || `http://${value.KB_SERVICE_HOST}:${value.KB_SERVICE_PORT}`,
  }));

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

//: Known dev / placeholder secret values that MUST NOT appear in a
//: production env. Two families:
//:   - `change-me-*`         — the values that ship in `.env.example`
//:   - `dev-only-*-NOT-FOR-PROD` — the docker-compose fallback values
//: Mirrors the KB service's `_DEV_PLACEHOLDER_TOKEN` guard. A future
//: docker-compose default that adds a new placeholder must add itself
//: to this set or the fail-fast won't catch it. The strings are
//: deliberately verbatim — substring matching would risk false
//: positives against legitimate high-entropy secrets that happen to
//: contain "change-me".
const KNOWN_DEV_PLACEHOLDERS: ReadonlySet<string> = new Set([
  // .env.example defaults
  'change-me-super-secret',
  'change-me-otp-secret',
  // docker-compose fallbacks introduced by PR-Sec-5 / #55 follow-up
  'dev-only-local-token-NOT-FOR-PROD',
]);

const isDevPlaceholder = (value: string | undefined | null): boolean =>
  typeof value === 'string' && KNOWN_DEV_PLACEHOLDERS.has(value.trim());

/** Minimum length for a production signing / HMAC secret. Matches what
 *  the deploy runbook has always told operators to generate; until now
 *  nothing enforced it, so `JWT_SECRET=openrd-prod-2026` (17 chars,
 *  dictionary-shaped) passed both zod and the production gate. An HS256
 *  key with that little entropy is offline-recoverable from a single
 *  captured token, after which `{sub: <any user id>}` can be forged and
 *  every patient's profile, reports and D4Z4 results are readable. */
const MIN_PRODUCTION_SECRET_LENGTH = 32;

/** Distinct-character floor, deliberately NOT a character-class rule.
 *  The obvious "must contain upper + lower + digit + symbol" check
 *  rejects the exact secrets we want people to use: `openssl rand -hex
 *  32` — the command .env.example itself recommends — is lowercase and
 *  digits only, i.e. two classes, while carrying 128 bits of entropy.
 *  Counting distinct characters instead accepts hex/base64 output and
 *  still rejects the failure this guard is for: a short passphrase
 *  padded to length by repetition ('openrd-prod-openrd-prod-...'). */
const MIN_PRODUCTION_SECRET_DISTINCT_CHARS = 10;

const assertStrongSecret = (name: string, value: string, errors: string[]) => {
  if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    errors.push(
      `${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production ` +
        '(generate one with 「openssl rand -hex 32」)',
    );
    return;
  }
  if (new Set(value).size < MIN_PRODUCTION_SECRET_DISTINCT_CHARS) {
    errors.push(
      `${name} looks low-entropy (fewer than ${MIN_PRODUCTION_SECRET_DISTINCT_CHARS} distinct ` +
        'characters) — use a random value, not a repeated passphrase ' +
        '(「openssl rand -hex 32」)',
    );
  }
};

/**
 * Does this connection string still carry the `postgres:postgres`
 * credential pair that ships in docker-compose.yml and db/init_db.sql?
 *
 * This replaces an equality test against the single literal
 * `postgres://postgres:postgres@localhost:5432/fshd_openrd`. That test
 * was a permanent no-op on the deployment shape most likely to reach
 * production: the compose api service hardcodes the same credentials
 * against host `postgres`, not `localhost`, so the guard never saw the
 * one string it existed to reject.
 *
 * The rule is about the CREDENTIAL PAIR, never the hostname. A
 * compose-internal Postgres reachable as `postgres:5432` over a private
 * bridge network is a legitimate production topology (that is what
 * DATABASE_ALLOW_INSECURE exists to acknowledge), and rejecting the
 * hostname would break it. What must never reach production is the
 * username/password that is published in this repository — the API
 * holds superuser on the PHI database with it.
 */
const usesDefaultPostgresCredentials = (connectionString: string): boolean => {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Not URL-shaped (a libpq keyword/value DSN, say). This helper only
    // answers「is this the shipped default credential」and an
    // unparseable string is definitively not it; let the pg driver be
    // the one to complain about the format.
    return false;
  }
  // decode because a password may legitimately be percent-encoded; the
  // shipped literal is not, but comparing the decoded form costs
  // nothing and avoids a false negative on `postgres%3Apostgres`-style
  // rewrites.
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return user === 'postgres' && password === 'postgres';
};

const validateProductionEnv = (env: AppEnv) => {
  const errors: string[] = [];

  if (!env.isProductionLike) {
    return errors;
  }

  if (env.JWT_SECRET === 'change-me-super-secret' || isDevPlaceholder(env.JWT_SECRET)) {
    errors.push(
      'JWT_SECRET must be replaced in production (no `change-me-*` / `dev-only-*` value)',
    );
  } else {
    // Only when it is not a known placeholder — otherwise one forgotten
    // secret produces two errors saying the same thing.
    assertStrongSecret('JWT_SECRET', env.JWT_SECRET, errors);
  }
  if (env.OTP_HASH_SECRET === 'change-me-otp-secret' || isDevPlaceholder(env.OTP_HASH_SECRET)) {
    errors.push(
      'OTP_HASH_SECRET must be replaced in production (no `change-me-*` / `dev-only-*` value)',
    );
  } else {
    // Same bar as JWT_SECRET: this is the HMAC key that makes stored OTP
    // hashes non-enumerable. OTP codes are six digits, so a recovered
    // key reduces the stored hash to a 10^6 lookup table.
    assertStrongSecret('OTP_HASH_SECRET', env.OTP_HASH_SECRET, errors);
  }
  if (usesDefaultPostgresCredentials(env.DATABASE_URL)) {
    errors.push(
      'DATABASE_URL still uses the shipped postgres:postgres credential pair. ' +
        'Create a dedicated role with its own password (see db/init_db.sql ' +
        'openrd_app) — the compose default is published in this repository and ' +
        'is a Postgres superuser.',
    );
  }
  if (!env.DATABASE_SSL_ENABLED && !env.DATABASE_ALLOW_INSECURE) {
    // DB transport encryption is the one prod-security invariant that
    // could otherwise silently degrade to plaintext (PHI over the
    // wire) with zero signal. Force an explicit choice: SSL on, or a
    // deliberate ack that this is a compose-internal / private-network
    // DB that needs none. Mirrors the DEV_GRANT_CONSENT_FORCE /
    // MINIO_PUBLISH_HOST explicit-ack pattern used elsewhere.
    errors.push(
      'Production DB has SSL disabled. Set DATABASE_SSL_ENABLED=true for a ' +
        'remote/managed DB, OR DATABASE_ALLOW_INSECURE=true to acknowledge a ' +
        'compose-internal / private-network Postgres that needs no transport ' +
        'encryption.',
    );
  }
  if (env.OTP_PROVIDER === 'mock') {
    errors.push('OTP_PROVIDER=mock is not allowed in production');
  }
  if (env.OTP_PROVIDER === 'internal_test') {
    // internal_test is an allowed prod-shaped provider (temporary
    // bridge until Tencent SMS lands), but ONLY with both guard rails
    // set, so a misconfig can't degrade into "anyone logs in" (an
    // empty allowlist would otherwise be meaningless) or ship an
    // absent / wrong-length fixed code.
    const allowlist = parseOtpAllowlist(env.OTP_TEST_PHONE_ALLOWLIST);
    if (allowlist.length === 0) {
      errors.push('OTP_PROVIDER=internal_test requires a non-empty OTP_TEST_PHONE_ALLOWLIST');
    }
    if (!new RegExp(`^\\d{${env.OTP_CODE_LENGTH}}$`).test(env.OTP_TEST_FIXED_CODE)) {
      errors.push(
        `OTP_TEST_FIXED_CODE must be exactly ${env.OTP_CODE_LENGTH} digits ` +
          'when OTP_PROVIDER=internal_test',
      );
    }
  }
  if (env.OTP_PROVIDER === 'tencent') {
    // Real SMS provider: every credential must be present. Without this
    // fail-fast a credential-misconfigured prod boots fine, but then
    // EVERY login runs INSERT → SendSms-fail → ROLLBACK: OtpService holds
    // the code INSERT in a transaction until the provider accepts (see
    // otp.service.ts), so the failed send is rolled back — the user
    // simply never receives a code, silently, per request, forever.
    // Failing fast at boot surfaces the misconfig loudly instead.
    const missing = (
      [
        ['TENCENT_SECRET_ID', env.TENCENT_SECRET_ID],
        ['TENCENT_SECRET_KEY', env.TENCENT_SECRET_KEY],
        ['TENCENT_SMS_SDK_APP_ID', env.TENCENT_SMS_SDK_APP_ID],
        ['TENCENT_SMS_SIGN_NAME', env.TENCENT_SMS_SIGN_NAME],
        ['TENCENT_SMS_TEMPLATE_ID', env.TENCENT_SMS_TEMPLATE_ID],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      errors.push(`OTP_PROVIDER=tencent requires: ${missing.join(', ')}`);
    }
  }
  if (env.CORS_ORIGIN.trim() === '*' || !env.CORS_ORIGIN.trim()) {
    errors.push('CORS_ORIGIN must be explicitly configured in production');
  }
  if (env.OCR_PROVIDER === 'mock') {
    errors.push('OCR_PROVIDER=mock is not allowed in production');
  }
  if (env.OCR_PROVIDER === 'baidu') {
    // Symmetric with the tencent branch above, and for the same reason:
    // profile.routes.ts silently falls through to the embedded parser
    // when either Baidu credential is missing, so a typo'd key does not
    // fail — it quietly changes which OCR engine every patient document
    // is parsed by, which only shows up as a drop in extraction quality
    // nobody can trace back to a config change.
    const missingBaidu = (
      [
        ['BAIDU_OCR_API_KEY', env.BAIDU_OCR_API_KEY],
        ['BAIDU_OCR_SECRET_KEY', env.BAIDU_OCR_SECRET_KEY],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missingBaidu.length > 0) {
      errors.push(`OCR_PROVIDER=baidu requires: ${missingBaidu.join(', ')}`);
    }
  }
  if (!env.AI_API_KEY && !env.OPENAI_API_KEY) {
    // Without a key the LLM factory returns null after a single
    // logger.warn, and readiness never consults it: the container boots
    // clean, answers 200 on /healthz/ready, is placed in rotation — and
    // every patient question comes back 「AI 服务未配置」 while
    // /me/documents/:id/summary 500s. The headline feature of the
    // release is dead with no signal at any point an operator looks
    // during a deploy, and the first-hour watchlist reads it as low
    // usage rather than a misconfiguration.
    errors.push('AI_API_KEY (or OPENAI_API_KEY) is required in production');
  }
  if (!env.AI_CROSS_BORDER_ACKNOWLEDGED) {
    // Health-related personal information leaving mainland China is a
    // PIPL Art. 38 event, and the only thing standing between this
    // deploy and one is which hostname sits in AI_API_BASE_URL —
    // documented in .env.example as an account/catalog match, with no
    // hint that the legal posture changes with it.
    let aiHost = '';
    try {
      aiHost = new URL(env.AI_API_BASE_URL).hostname;
    } catch {
      // unreachable: zod already validated .url() above.
    }
    if (aiHost && !aiHost.endsWith('.cn')) {
      errors.push(
        `AI_API_BASE_URL points at ${aiHost}, outside mainland China. Every prompt ` +
          'carries the patient question plus consent-gated clinical fields, so this is ' +
          'a cross-border transfer of health data (PIPL Art. 38-39: CAC assessment or ' +
          'filed standard contract, separate consent, named overseas recipient). Set ' +
          'AI_CROSS_BORDER_ACKNOWLEDGED=true once that is in place, or use the .cn ' +
          'endpoint.',
      );
    }
  }
  if (!env.KB_SERVICE_TOKEN || isDevPlaceholder(env.KB_SERVICE_TOKEN)) {
    errors.push(
      'KB_SERVICE_TOKEN is required in production so the KB service ' +
        'cannot be reached anonymously, and must not be the docker-compose ' +
        'dev placeholder',
    );
  }

  return errors;
};

const validateStorageEnv = (env: AppEnv) => {
  const errors: string[] = [];

  if (env.STORAGE_PROVIDER !== 'minio') {
    if (env.isProductionLike && !env.STORAGE_ALLOW_LOCAL) {
      // Everything below this early return — including the
      // isProductionLike rejection of the minioadmin demo credentials —
      // is skipped for a `local` provider, so before this check a
      // production deploy on local disk was the one storage
      // configuration that got no validation at all. `local` is also the
      // default in the schema, in .env.example and in docker-compose, so
      // it is what an operator who never touched the setting ends up
      // with: patient PDFs, MRI images and genetic reports on a single
      // unreplicated container volume that no backup job knows about.
      errors.push(
        'STORAGE_PROVIDER=' +
          env.STORAGE_PROVIDER +
          ' in production. Set STORAGE_PROVIDER=minio (and start the minio ' +
          'profile), or set STORAGE_ALLOW_LOCAL=true to acknowledge that patient ' +
          'files live on the container volume and are covered by your own backup ' +
          'procedure.',
      );
    }
    return errors;
  }

  if (!env.MINIO_ENDPOINT) {
    errors.push('MINIO_ENDPOINT must be configured when STORAGE_PROVIDER=minio');
  }
  if (!env.MINIO_ACCESS_KEY) {
    errors.push('MINIO_ACCESS_KEY must be configured when STORAGE_PROVIDER=minio');
  }
  if (!env.MINIO_SECRET_KEY) {
    errors.push('MINIO_SECRET_KEY must be configured when STORAGE_PROVIDER=minio');
  }
  if (!env.MINIO_BUCKET_NAME?.trim()) {
    errors.push('MINIO_BUCKET_NAME must be configured when STORAGE_PROVIDER=minio');
  }

  if (env.isProductionLike) {
    if (env.MINIO_ACCESS_KEY === 'minioadmin') {
      errors.push('MINIO_ACCESS_KEY must be replaced in production');
    }
    if (env.MINIO_SECRET_KEY === 'minioadmin12345678') {
      errors.push('MINIO_SECRET_KEY must be replaced in production');
    }
    if (!env.MINIO_USE_HTTPS && !env.MINIO_ALLOW_INSECURE) {
      // Object storage gets the same explicit-ack treatment the DB
      // connection got, for the same reason: a v1 upgrader who keeps
      // STORAGE_PROVIDER=minio against their existing host — the path
      // docs/cloud-tencent-docker.md recommends — would otherwise put
      // the access key, the secret key and the raw bytes of every
      // scanned hospital report on the wire in cleartext, with nothing
      // in the boot log saying so.
      errors.push(
        'Production object storage has TLS disabled. Set MINIO_USE_HTTPS=true for ' +
          'a remote / managed S3-compatible endpoint, OR MINIO_ALLOW_INSECURE=true ' +
          'to acknowledge a compose-internal MinIO reached over the private bridge ' +
          'network.',
      );
    }
  }

  return errors;
};

export const loadAppEnv = (overrides?: NodeJS.ProcessEnv): AppEnv => {
  if (!cachedEnv) {
    loadEnv();
    const rawEnv = {
      ...process.env,
      ...overrides,
    };
    const parsed = envSchema.safeParse({
      ...rawEnv,
    });

    if (!parsed.success) {
      const message = parsed.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      throw new Error(`Failed to parse environment variables: ${message}`);
    }

    const productionErrors = validateProductionEnv(parsed.data);
    const storageErrors = validateStorageEnv(parsed.data);
    const allErrors = [...productionErrors, ...storageErrors];
    if (allErrors.length > 0) {
      throw new Error(`Invalid environment configuration: ${allErrors.join(', ')}`);
    }

    cachedEnv = parsed.data;
  }

  return cachedEnv;
};

export const resetAppEnvCache = () => {
  cachedEnv = undefined;
};

export const validateEnvForKnowledgeBase = (env: AppEnv): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!env.CHROMA_API_KEY || env.CHROMA_API_KEY.length < 10) {
    errors.push('CHROMA_API_KEY is invalid or too short');
  }

  if (!env.CHROMA_TENANT_ID || env.CHROMA_TENANT_ID.length < 10) {
    errors.push('CHROMA_TENANT_ID is invalid or too short');
  }

  if (env.CHROMA_API_KEY && !env.CHROMA_API_KEY.startsWith('ck-')) {
    errors.push('CHROMA_API_KEY should start with "ck-"');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export const getEnvSummary = (env: AppEnv) => {
  return {
    environment: env.NODE_ENV,
    ports: {
      node: env.PORT,
      chroma: env.CHROMA_API_PORT,
    },
    services: {
      database: 'PostgreSQL',
      vectorDatabase: 'ChromaDB Cloud',
      aiModel: env.AI_API_MODEL,
      reportOcrProvider: env.OCR_PROVIDER,
      storageProvider: env.STORAGE_PROVIDER,
    },
    knowledgeBase: {
      database: env.CHROMA_DATABASE,
      tenantId: `${env.CHROMA_TENANT_ID?.substring(0, 8) || 'unknown'}...`,
      apiKeyConfigured: !!env.CHROMA_API_KEY,
      apiUrl: env.chromaApiBaseUrl,
    },
  };
};
