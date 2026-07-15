import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  DeletionRequestError,
  cancelAccountDeletion,
  purgeDueAccountDeletions,
  requestAccountDeletion,
} from './account-deletion.js';
import type { AppLogger } from '../../config/logger.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as AppLogger;

const row = (overrides: Record<string, unknown> = {}) => ({
  status: 'pending',
  requested_at: new Date('2026-07-15T00:00:00Z'),
  scheduled_purge_at: new Date('2026-07-22T00:00:00Z'),
  cancelled_at: null,
  ...overrides,
});

describe('requestAccountDeletion', () => {
  it('rejects a phone number that does not match the account', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ phone_number: '+8613800000000' }] }),
    } as unknown as Pool;
    await expect(requestAccountDeletion(pool, 'u1', '+8613911111111')).rejects.toMatchObject({
      code: 'phone_mismatch',
    });
  });

  it('rejects when a pending request already exists', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ phone_number: '+8613800000000' }] })
        .mockResolvedValueOnce({ rows: [row()] }),
    } as unknown as Pool;
    await expect(requestAccountDeletion(pool, 'u1', '+8613800000000')).rejects.toMatchObject({
      code: 'already_pending',
    });
  });

  it('accepts a bare-digit retype against a +86-stored number (normalized both sides)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ phone_number: '+8613800000000' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row()] });
    const pool = { query } as unknown as Pool;
    const status = await requestAccountDeletion(pool, 'u1', '13800000000');
    expect(status.status).toBe('pending');
  });

  it('creates the request with the 7-day cooling-off and returns the schedule', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ phone_number: '+8613800000000' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row()] });
    const pool = { query } as unknown as Pool;

    const status = await requestAccountDeletion(pool, 'u1', ' +8613800000000 ');
    expect(status.status).toBe('pending');
    expect(status.scheduledPurgeAt).toBe('2026-07-22T00:00:00.000Z');
    expect(query.mock.calls[2][1]).toEqual(['u1', 7]);
  });
});

describe('cancelAccountDeletion', () => {
  it('flips pending → cancelled', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [row({ status: 'cancelled', cancelled_at: new Date('2026-07-16T00:00:00Z') })],
      }),
    } as unknown as Pool;
    const status = await cancelAccountDeletion(pool, 'u1');
    expect(status.status).toBe('cancelled');
    expect(status.cancelledAt).toBe('2026-07-16T00:00:00.000Z');
  });

  it('404-codes when nothing is pending', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) } as unknown as Pool;
    await expect(cancelAccountDeletion(pool, 'u1')).rejects.toBeInstanceOf(DeletionRequestError);
  });
});

describe('purgeDueAccountDeletions', () => {
  const buildClient = () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        if (sql.includes('SELECT d.storage_uri')) {
          return Promise.resolve({ rows: [{ storage_uri: 'local://a.pdf' }] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    return { client, statements };
  };

  it('purges due requests in one transaction and removes files after commit', async () => {
    const { client, statements } = buildClient();
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'req-1', user_id: 'u1' }] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const removeFile = vi.fn().mockResolvedValue(undefined);

    const purged = await purgeDueAccountDeletions(pool, removeFile, logger);

    expect(purged).toBe(1);
    // Legacy chat tables cleared before the user row; ledger updated
    // before the cascade; everything inside BEGIN/COMMIT.
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    const userDelete = statements.findIndex((s) => s.startsWith('DELETE FROM app_users'));
    const chatDelete = statements.findIndex((s) => s.startsWith('DELETE FROM chat_messages'));
    const ledgerUpdate = statements.findIndex((s) =>
      s.startsWith('UPDATE account_deletion_requests'),
    );
    expect(chatDelete).toBeGreaterThan(-1);
    expect(chatDelete).toBeLessThan(userDelete);
    expect(ledgerUpdate).toBeLessThan(userDelete);
    expect(removeFile).toHaveBeenCalledWith('local://a.pdf');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back a failed purge and keeps the request pending', async () => {
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('DELETE FROM app_users')) {
          return Promise.reject(new Error('fk veto'));
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'req-1', user_id: 'u1' }] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const removeFile = vi.fn();

    const purged = await purgeDueAccountDeletions(pool, removeFile, logger);

    expect(purged).toBe(0);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(removeFile).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('file-removal failure does not undo the purge (DB is authority)', async () => {
    const { client } = buildClient();
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'req-1', user_id: 'u1' }] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const removeFile = vi.fn().mockRejectedValue(new Error('minio down'));

    const purged = await purgeDueAccountDeletions(pool, removeFile, logger);
    expect(purged).toBe(1);
  });
});
