import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import type { LoginInput, RegisterInput } from './auth.schema.js';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import { AppError } from '../../utils/app-error.js';

interface AuthServiceDeps {
  env: AppEnv;
  logger: AppLogger;
  pool: Pool;
}

interface UserRow {
  id: string;
  phone_number: string;
  email: string | null;
  role: string;
  created_at: Date | string;
  password_hash?: string;
}

interface AuthenticatedUser {
  id: string;
  phoneNumber: string;
  email: string | null;
  role: string;
  createdAt: string;
}

interface LoginGuardRow {
  identifier: string;
  failure_count: number;
  locked_until: Date | string | null;
}

export class AuthService {
  private readonly env: AppEnv;
  private readonly logger: AppLogger;
  private readonly pool: Pool;

  constructor({ env, logger, pool }: AuthServiceDeps) {
    this.env = env;
    this.logger = logger;
    this.pool = pool;
  }

  private normalizeIdentifier(identifier: string) {
    return identifier.trim().toLowerCase();
  }

  private async getLoginGuard(identifier: string) {
    const normalized = this.normalizeIdentifier(identifier);
    const result = await this.pool.query<LoginGuardRow>(
      `SELECT identifier, failure_count, locked_until
       FROM auth_login_guards
       WHERE identifier = $1`,
      [normalized],
    );

    return result.rows[0] ?? null;
  }

  private async assertLoginAllowed(identifier: string) {
    const guard = await this.getLoginGuard(identifier);
    if (!guard?.locked_until) {
      return;
    }

    const lockedUntil = new Date(guard.locked_until);
    if (Number.isNaN(lockedUntil.getTime()) || lockedUntil.getTime() <= Date.now()) {
      return;
    }

    const retryAfterSeconds = Math.max(Math.ceil((lockedUntil.getTime() - Date.now()) / 1000), 1);
    throw new AppError('登录失败次数过多，请稍后再试', 429, {
      retryAfterSeconds,
      lockedUntil: lockedUntil.toISOString(),
    });
  }

  private async clearLoginGuards(identifiers: Array<string | null | undefined>) {
    const normalized = identifiers
      .map((value) => (value ? this.normalizeIdentifier(value) : ''))
      .filter(Boolean);

    if (normalized.length === 0) {
      return;
    }

    await this.pool.query(`DELETE FROM auth_login_guards WHERE identifier = ANY($1::citext[])`, [
      normalized,
    ]);
  }

  private async registerLoginFailure(identifier: string) {
    const normalized = this.normalizeIdentifier(identifier);
    const lockWindowMs = this.env.LOGIN_LOCK_MINUTES * 60 * 1000;
    const maxFailures = this.env.LOGIN_MAX_FAILURES;

    // Atomic increment + lock decision in a single SQL statement.
    //
    // The previous implementation read the row, computed the next
    // counter in Node, then UPSERTed it back. Two simultaneous
    // brute-force attempts could both read the same baseline (say,
    // failure_count=4 with MAX=5), both compute next=5 → lock, and
    // both write 5 — effectively counting two attempts as one. That
    // pushed the lockout one attempt later than configured and let
    // an attacker stretch the budget. Doing the math in SQL on the
    // current row (post-window-reset) makes the decision a true
    // read-modify-write under the row lock the UPSERT takes.
    await this.pool.query(
      `INSERT INTO auth_login_guards (
         identifier,
         failure_count,
         first_failed_at,
         last_failed_at,
         locked_until
       )
       VALUES (
         $1,
         1,
         NOW(),
         NOW(),
         CASE WHEN 1 >= $2 THEN NOW() + ($3 || ' milliseconds')::interval ELSE NULL END
       )
       ON CONFLICT (identifier)
       DO UPDATE SET
         failure_count = CASE
           WHEN auth_login_guards.locked_until IS NOT NULL
             AND auth_login_guards.locked_until <= NOW()
           THEN 1
           ELSE auth_login_guards.failure_count + 1
         END,
         last_failed_at = NOW(),
         first_failed_at = CASE
           WHEN auth_login_guards.locked_until IS NOT NULL
             AND auth_login_guards.locked_until <= NOW()
           THEN NOW()
           ELSE auth_login_guards.first_failed_at
         END,
         locked_until = CASE
           WHEN (CASE
                   WHEN auth_login_guards.locked_until IS NOT NULL
                     AND auth_login_guards.locked_until <= NOW()
                   THEN 1
                   ELSE auth_login_guards.failure_count + 1
                 END) >= $2
           THEN NOW() + ($3 || ' milliseconds')::interval
           ELSE NULL
         END`,
      [normalized, maxFailures, lockWindowMs],
    );
  }

  private createToken(user: AuthenticatedUser) {
    const expiresIn = this.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'];
    return jwt.sign(
      {
        sub: user.id,
        role: user.role,
      },
      this.env.JWT_SECRET,
      { expiresIn },
    );
  }

  private serializeUser(row: UserRow): AuthenticatedUser {
    const createdAt =
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString();

    return {
      id: row.id,
      phoneNumber: row.phone_number,
      email: row.email,
      role: row.role,
      createdAt,
    };
  }

  private async logAudit(eventType: string, payload: Record<string, unknown>) {
    await this.pool.query(
      `INSERT INTO audit_logs (event_type, event_payload)
       VALUES ($1, $2)`,
      [eventType, payload],
    );
  }

  async register(payload: RegisterInput, meta?: { ip?: string; userAgent?: string }) {
    const client = await this.pool.connect();
    // `txOpen` mirrors the pattern used by OtpService.sendCode: any
    // failure after BEGIN and before COMMIT — the existence SELECT
    // throwing, bcrypt.hash rejecting, a non-23505 INSERT error, or
    // COMMIT itself failing — must run ROLLBACK before client.release
    // returns the connection. Without this the borrower of the
    // connection inherits an open / aborted transaction, holding
    // locks open and undercutting the very race fix this transaction
    // exists to provide.
    let txOpen = false;

    try {
      // Wrap the check + insert in a transaction so two concurrent
      // registrations with the same phone or email can't both clear
      // the existence probe and then race to INSERT — that previously
      // surfaced as a 500 (unique-violation) instead of the friendly
      // 409 the API contract documents. We still catch unique_violation
      // explicitly because a serializable retry is not worth setting
      // up for a single duplicate-account error.
      await client.query('BEGIN');
      txOpen = true;

      const existing = await client.query(
        'SELECT id FROM app_users WHERE phone_number = $1 OR (email IS NOT NULL AND email = $2)',
        [payload.phoneNumber, payload.email ?? null],
      );

      if (existing.rowCount) {
        await client.query('ROLLBACK');
        txOpen = false;
        await this.logAudit('auth.register_failed', {
          phoneNumber: payload.phoneNumber,
          email: payload.email ?? null,
          reason: 'exists',
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        });
        throw new AppError('User already exists with the provided credentials', 409);
      }

      const passwordHash = await bcrypt.hash(payload.password, this.env.BCRYPT_SALT_ROUNDS);
      let inserted;
      try {
        inserted = await client.query<UserRow>(
          `INSERT INTO app_users (phone_number, email, password_hash, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, phone_number, email, role, created_at`,
          [payload.phoneNumber, payload.email ?? null, passwordHash, payload.role],
        );
      } catch (insertError) {
        await client.query('ROLLBACK');
        txOpen = false;
        // 23505 = unique_violation. Two concurrent registrations
        // raced past the SELECT above; the second one's INSERT loses.
        const code =
          typeof insertError === 'object' && insertError !== null
            ? (insertError as { code?: string }).code
            : undefined;
        if (code === '23505') {
          await this.logAudit('auth.register_failed', {
            phoneNumber: payload.phoneNumber,
            email: payload.email ?? null,
            reason: 'exists_concurrent',
            ip: meta?.ip ?? null,
            userAgent: meta?.userAgent ?? null,
          });
          throw new AppError('User already exists with the provided credentials', 409);
        }
        throw insertError;
      }

      await client.query('COMMIT');
      txOpen = false;

      const user = this.serializeUser(inserted.rows[0]);
      const token = this.createToken(user);
      this.logger.info({ userId: user.id }, 'User registered successfully');
      await this.logAudit('auth.register_success', {
        userId: user.id,
        phoneNumber: user.phoneNumber,
        role: user.role,
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      });

      return { user, token };
    } catch (error) {
      if (txOpen) {
        // Best-effort ROLLBACK on any post-BEGIN failure that didn't
        // already roll back. Swallow ROLLBACK errors — we're already
        // on the failure path and the original error is what the
        // caller cares about.
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          this.logger.warn({ rollbackError }, 'register: ROLLBACK after error failed');
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Issue a session for a phone number whose OTP the CONTROLLER has
   * already verified (scene 'login'). The consumed one-time code is
   * the credential, so no password/guard checks apply here — but we
   * still clear any password-login lockout: proving phone ownership
   * via OTP is strictly stronger evidence than the failed password
   * attempts that created the lock.
   */
  async loginWithOtp(phoneNumber: string, meta?: { ip?: string; userAgent?: string }) {
    const result = await this.pool.query<UserRow>(
      `SELECT id, phone_number, email, role, created_at
       FROM app_users
       WHERE phone_number = $1`,
      [phoneNumber],
    );

    if (!result.rowCount) {
      await this.logAudit('auth.login_failed', {
        identifier: phoneNumber,
        reason: 'otp_login_no_account',
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      });
      throw new AppError('该手机号尚未注册，请先注册', 404);
    }

    const user = this.serializeUser(result.rows[0]);
    await this.clearLoginGuards([user.phoneNumber, user.email]);
    const token = this.createToken(user);
    this.logger.info({ userId: user.id }, 'User logged in via OTP');
    await this.logAudit('auth.login_success', {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      method: 'otp',
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    });

    return { user, token };
  }

  /**
   * Replace the password for a phone number whose OTP the CONTROLLER
   * has already verified (scene 'reset'). Also clears the login
   * guard: the user just proved phone ownership, and keeping them
   * locked out of their brand-new password helps nobody.
   */
  async resetPassword(
    phoneNumber: string,
    newPassword: string,
    meta?: { ip?: string; userAgent?: string },
  ) {
    const passwordHash = await bcrypt.hash(newPassword, this.env.BCRYPT_SALT_ROUNDS);
    const result = await this.pool.query<UserRow>(
      `UPDATE app_users
       SET password_hash = $1
       WHERE phone_number = $2
       RETURNING id, phone_number, email, role, created_at`,
      [passwordHash, phoneNumber],
    );

    if (!result.rowCount) {
      await this.logAudit('auth.password_reset_failed', {
        identifier: phoneNumber,
        reason: 'no_account',
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      });
      throw new AppError('该手机号尚未注册，请先注册', 404);
    }

    const user = this.serializeUser(result.rows[0]);
    await this.clearLoginGuards([user.phoneNumber, user.email]);
    this.logger.info({ userId: user.id }, 'Password reset via OTP');
    await this.logAudit('auth.password_reset_success', {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    });
  }

  async login(payload: LoginInput, meta?: { ip?: string; userAgent?: string }) {
    const identifier = payload.phoneNumber ?? payload.email;
    const normalizedIdentifier = this.normalizeIdentifier(identifier ?? '');

    await this.assertLoginAllowed(normalizedIdentifier);

    const result = await this.pool.query<UserRow>(
      `SELECT id, phone_number, email, role, password_hash, created_at
       FROM app_users
       WHERE ${payload.phoneNumber ? 'phone_number = $1' : 'email = $1'}`,
      [identifier],
    );

    if (!result.rowCount) {
      await this.registerLoginFailure(normalizedIdentifier);
      await this.logAudit('auth.login_failed', {
        identifier,
        reason: 'not_found',
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      });
      throw new AppError('Invalid credentials', 401);
    }

    const userRow = result.rows[0];
    const passwordHash = userRow.password_hash;

    if (!passwordHash) {
      await this.registerLoginFailure(normalizedIdentifier);
      await this.logAudit('auth.login_failed', {
        identifier,
        reason: 'no_password',
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      });
      throw new AppError('Invalid credentials', 401);
    }

    const isValid = await bcrypt.compare(payload.password, passwordHash);

    if (!isValid) {
      await this.registerLoginFailure(normalizedIdentifier);
      await this.logAudit('auth.login_failed', {
        identifier,
        reason: 'invalid_password',
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      });
      throw new AppError('Invalid credentials', 401);
    }

    const user = this.serializeUser(userRow);
    await this.clearLoginGuards([normalizedIdentifier, user.phoneNumber, user.email]);
    const token = this.createToken(user);
    this.logger.info({ userId: user.id }, 'User logged in');
    await this.logAudit('auth.login_success', {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    });

    return { user, token };
  }
}
