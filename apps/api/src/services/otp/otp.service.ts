import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { InternalTestOtpProvider } from './internal-test-otp-provider.js';
import { MockOtpProvider } from './mock-otp-provider.js';
import type { OtpProvider, OtpSendResult } from './otp-provider.js';
import { TencentOtpProvider } from './tencent-otp-provider.js';
import { parseOtpAllowlist, type AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { AppError } from '../../utils/app-error.js';
import { normalizePhone } from '../../utils/phone.js';

interface OtpServiceDeps {
  env: AppEnv;
  logger: AppLogger;
  pool: Pool;
  provider?: OtpProvider;
}

type OtpScene = 'register' | 'login' | 'reset';

interface SendOtpInput {
  phoneNumber: string;
  scene?: OtpScene;
  ip?: string;
  userAgent?: string;
}

interface VerifyOtpInput {
  phoneNumber: string;
  code: string;
  scene?: OtpScene;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

const maskPhone = (phone: string) => {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
};

export class OtpService {
  private readonly env: AppEnv;
  private readonly logger: AppLogger;
  private readonly pool: Pool;
  private readonly provider: OtpProvider;
  private readonly testPhoneAllowlist: ReadonlySet<string>;

  constructor({ env, logger, pool, provider }: OtpServiceDeps) {
    this.env = env;
    this.logger = logger;
    this.pool = pool;
    // Normalize every allowlist entry to the canonical +86 form so an
    // operator can list a bare `13922220001` and still match the
    // `+8613922220001` the mobile client actually sends (see
    // normalizePhone). Without this, the strict Set.has() comparisons
    // below — and in InternalTestOtpProvider — never match a real login.
    this.testPhoneAllowlist = new Set(
      parseOtpAllowlist(env.OTP_TEST_PHONE_ALLOWLIST).map(normalizePhone),
    );

    if (provider) {
      this.provider = provider;
    } else if (env.OTP_PROVIDER === 'tencent') {
      // Credentials are guaranteed present by validateProductionEnv when
      // the env is prod-shaped; the `?? ''` only satisfies the type for a
      // (misused) dev run, where SendSms would then fail at call time.
      this.provider = new TencentOtpProvider(
        {
          secretId: env.TENCENT_SECRET_ID ?? '',
          secretKey: env.TENCENT_SECRET_KEY ?? '',
          sdkAppId: env.TENCENT_SMS_SDK_APP_ID ?? '',
          signName: env.TENCENT_SMS_SIGN_NAME ?? '',
          templateId: env.TENCENT_SMS_TEMPLATE_ID ?? '',
          region: env.TENCENT_SMS_REGION,
        },
        this.logger,
      );
      this.logger.info({ provider: env.OTP_PROVIDER }, 'Tencent SMS OTP provider active');
    } else if (env.OTP_PROVIDER === 'internal_test') {
      this.provider = new InternalTestOtpProvider(this.testPhoneAllowlist);
      this.logger.warn(
        { provider: env.OTP_PROVIDER, allowlistSize: this.testPhoneAllowlist.size },
        'INTERNAL-TEST OTP provider active — only allowlisted test phones can ' +
          'log in with a fixed code. Switch to tencent before real launch.',
      );
    } else {
      this.provider = new MockOtpProvider();
    }
  }

  /** Exposed so the auth controller can tell clients how long to wait
   *  before offering a resend (drives the mobile countdown). */
  get resendIntervalSeconds(): number {
    return this.env.OTP_RESEND_INTERVAL_SECONDS;
  }

  private generateCode(phoneNumber: string): string {
    // INTERNAL-TEST bridge: allowlisted test phones get the fixed,
    // pre-shared code (validated to match OTP_CODE_LENGTH in
    // validateProductionEnv) so testers can log in without real SMS.
    // Every other number — and every number under mock / tencent —
    // gets a fresh random code as usual.
    if (
      this.env.OTP_PROVIDER === 'internal_test' &&
      this.testPhoneAllowlist.has(normalizePhone(phoneNumber))
    ) {
      return this.env.OTP_TEST_FIXED_CODE;
    }
    const length = this.env.OTP_CODE_LENGTH;
    const min = 10 ** (length - 1);
    const max = 10 ** length - 1;
    return String(crypto.randomInt(min, max + 1));
  }

  private hashCode(phoneNumber: string, code: string): string {
    return crypto
      .createHmac('sha256', this.env.OTP_HASH_SECRET)
      .update(`${phoneNumber}:${code}`)
      .digest('hex');
  }

  private async logAudit(client: PoolClient, eventType: string, payload: Record<string, unknown>) {
    await client.query(
      `INSERT INTO audit_logs (event_type, event_payload)
       VALUES ($1, $2)`,
      [eventType, payload],
    );
  }

  async sendCode(input: SendOtpInput): Promise<OtpSendResult> {
    const phoneNumber = input.phoneNumber.trim();
    const scene: OtpScene = input.scene ?? 'register';

    const client = await this.pool.connect();
    let txOpen = false;

    try {
      const resendCheck = await client.query<{ sent_at: Date }>(
        `SELECT sent_at
         FROM otp_verification_codes
         WHERE phone_number = $1 AND scene = $2
         ORDER BY sent_at DESC
         LIMIT 1`,
        [phoneNumber, scene],
      );

      if (resendCheck.rowCount) {
        const lastSentAt = resendCheck.rows[0].sent_at;
        const secondsSinceLast = (Date.now() - new Date(lastSentAt).getTime()) / 1000;
        if (secondsSinceLast < this.env.OTP_RESEND_INTERVAL_SECONDS) {
          throw new AppError('OTP resend too frequent', 429, {
            waitSeconds: Math.ceil(this.env.OTP_RESEND_INTERVAL_SECONDS - secondsSinceLast),
          });
        }
      }

      const dayCountResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM otp_verification_codes
         WHERE phone_number = $1
           AND sent_at >= date_trunc('day', NOW())`,
        [phoneNumber],
      );
      const dayCount = Number(dayCountResult.rows[0]?.count ?? 0);
      if (dayCount >= this.env.OTP_MAX_SEND_PER_DAY) {
        throw new AppError('OTP send limit reached', 429);
      }

      const code = this.generateCode(phoneNumber);
      const codeHash = this.hashCode(phoneNumber, code);
      const requestId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + this.env.OTP_TTL_MINUTES * 60 * 1000);

      // Transaction: hold the INSERT until we know the SMS provider
      // accepted the message. Without this, a Tencent / mock failure
      // leaves a "ghost code" in the DB that still counts against the
      // per-day cap and the resend interval — locking the user out of
      // ever getting a real code through.
      await client.query('BEGIN');
      txOpen = true;

      await client.query(
        `INSERT INTO otp_verification_codes (
          phone_number, scene, code_hash, request_id, expires_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [phoneNumber, scene, codeHash, requestId, expiresAt],
      );

      const result = await this.provider.sendCode({
        phoneNumber,
        code,
        ttlMinutes: this.env.OTP_TTL_MINUTES,
        requestId,
      });

      await this.logAudit(client, 'otp.send', {
        phoneNumber: maskPhone(phoneNumber),
        scene,
        requestId,
        provider: result.provider,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });

      await client.query('COMMIT');
      txOpen = false;

      if (!this.env.isProductionLike && result.provider === 'mock') {
        this.logger.info(
          { phoneNumber: maskPhone(phoneNumber), requestId, code },
          'Mock OTP code generated',
        );
      }

      return result;
    } catch (error) {
      if (txOpen) {
        // Rollback so the unsent code doesn't sit in the DB
        // contributing to rate limits. Swallow ROLLBACK errors —
        // we're already on the failure path.
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          this.logger.warn(
            { rollbackError, phoneNumber: maskPhone(phoneNumber), scene },
            'OTP send rollback failed',
          );
        }
      }
      this.logger.error({ error, phoneNumber: maskPhone(phoneNumber), scene }, 'OTP send failed');
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyCode(input: VerifyOtpInput): Promise<{ requestId: string }> {
    const phoneNumber = input.phoneNumber.trim();
    const scene: OtpScene = input.scene ?? 'register';
    const code = input.code.trim();

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const rows = await client.query<{
        id: string;
        request_id: string;
        code_hash: string;
        expires_at: Date;
        attempt_count: number;
      }>(
        `SELECT id, request_id, code_hash, expires_at, attempt_count
         FROM otp_verification_codes
         WHERE phone_number = $1
           AND scene = $2
           AND consumed_at IS NULL
           AND expires_at > NOW()
           ${input.requestId ? 'AND request_id = $3' : ''}
         ORDER BY sent_at DESC
         LIMIT 1
         FOR UPDATE`,
        input.requestId ? [phoneNumber, scene, input.requestId] : [phoneNumber, scene],
      );

      if (!rows.rowCount) {
        throw new AppError('OTP code not found or expired', 400);
      }

      const record = rows.rows[0];
      if (record.attempt_count >= this.env.OTP_MAX_VERIFY_ATTEMPTS) {
        throw new AppError('OTP attempts exceeded', 429);
      }

      const incomingHash = this.hashCode(phoneNumber, code);
      if (incomingHash !== record.code_hash) {
        const newAttempts = record.attempt_count + 1;
        await client.query(
          `UPDATE otp_verification_codes
           SET attempt_count = $1, consumed_at = CASE WHEN $1 >= $2 THEN NOW() ELSE consumed_at END
           WHERE id = $3`,
          [newAttempts, this.env.OTP_MAX_VERIFY_ATTEMPTS, record.id],
        );
        await this.logAudit(client, 'otp.verify_failed', {
          phoneNumber: maskPhone(phoneNumber),
          scene,
          requestId: record.request_id,
          attempts: newAttempts,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        });
        throw new AppError('OTP code invalid', 400);
      }

      await client.query(
        `UPDATE otp_verification_codes
         SET consumed_at = NOW()
         WHERE id = $1`,
        [record.id],
      );

      await this.logAudit(client, 'otp.verify_success', {
        phoneNumber: maskPhone(phoneNumber),
        scene,
        requestId: record.request_id,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });

      await client.query('COMMIT');

      return { requestId: record.request_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
