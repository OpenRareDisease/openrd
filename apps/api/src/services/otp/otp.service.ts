import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { MockOtpProvider } from './mock-otp-provider.js';
import type { OtpProvider, OtpSendResult } from './otp-provider.js';
import { TencentOtpProvider } from './tencent-otp-provider.js';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { AppError } from '../../utils/app-error.js';

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

  constructor({ env, logger, pool, provider }: OtpServiceDeps) {
    this.env = env;
    this.logger = logger;
    this.pool = pool;

    if (provider) {
      this.provider = provider;
    } else if (env.OTP_PROVIDER === 'tencent') {
      this.provider = new TencentOtpProvider();
      this.logger.warn(
        { provider: env.OTP_PROVIDER },
        'OTP provider not configured, Tencent provider will throw until wired',
      );
    } else {
      this.provider = new MockOtpProvider();
    }
  }

  private generateCode(): string {
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

      const code = this.generateCode();
      const codeHash = this.hashCode(phoneNumber, code);
      const requestId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + this.env.OTP_TTL_MINUTES * 60 * 1000);

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

      if (!this.env.isProduction && result.provider === 'mock') {
        this.logger.info(
          { phoneNumber: maskPhone(phoneNumber), requestId, code },
          'Mock OTP code generated',
        );
      }

      return result;
    } catch (error) {
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
