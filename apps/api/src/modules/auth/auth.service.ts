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
    const current = await this.getLoginGuard(normalized);
    const nextFailureCount =
      current?.locked_until && new Date(current.locked_until).getTime() <= Date.now()
        ? 1
        : (current?.failure_count ?? 0) + 1;
    const shouldLock = nextFailureCount >= this.env.LOGIN_MAX_FAILURES;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60 * 1000)
      : null;

    await this.pool.query(
      `INSERT INTO auth_login_guards (
         identifier,
         failure_count,
         first_failed_at,
         last_failed_at,
         locked_until
       )
       VALUES ($1, $2, NOW(), NOW(), $3)
       ON CONFLICT (identifier)
       DO UPDATE SET
         failure_count = EXCLUDED.failure_count,
         last_failed_at = NOW(),
         locked_until = EXCLUDED.locked_until,
         first_failed_at = CASE
           WHEN auth_login_guards.locked_until IS NOT NULL
             AND auth_login_guards.locked_until <= NOW()
           THEN NOW()
           ELSE auth_login_guards.first_failed_at
         END`,
      [normalized, nextFailureCount, lockedUntil],
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

    try {
      const existing = await client.query(
        'SELECT id FROM app_users WHERE phone_number = $1 OR (email IS NOT NULL AND email = $2)',
        [payload.phoneNumber, payload.email ?? null],
      );

      if (existing.rowCount) {
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
      const inserted = await client.query<UserRow>(
        `INSERT INTO app_users (phone_number, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, phone_number, email, role, created_at`,
        [payload.phoneNumber, payload.email ?? null, passwordHash, payload.role],
      );

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
    } finally {
      client.release();
    }
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
