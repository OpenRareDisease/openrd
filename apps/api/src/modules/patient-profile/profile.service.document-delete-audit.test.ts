import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService } from './profile.service.js';

/**
 * The two audit rows the delete endpoint writes outside
 * `deleteDocumentForUser`'s transaction.
 *
 * The transaction exists so no row deletion happens without a trail,
 * but the blob cannot join it — object stores do not roll back — so
 * the file used to be destroyed with the trail still uncommitted. The
 * intent row closes that, and these tests pin the two properties it
 * only has if it is written the way `patient_document.deleted` is:
 * it must not carry report content, and it must be reachable by the
 * account-deletion tombstone, which matches on `event_payload->>'userId'`.
 */

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
};

const makeService = () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rowCount: 1, rows: [] };
  });
  const service = new PatientProfileService({
    pool: { query, connect: vi.fn() } as never,
    logger: silentLogger as never,
  });
  return { service, calls };
};

const subject = {
  userId: 'u-1',
  documentId: 'doc-1',
  documentType: 'genetic_report',
  ip: '203.0.113.47',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.44',
};

describe('recordDocumentDeletionIntent', () => {
  it('writes patient_document.delete_started into audit_logs', async () => {
    const { service, calls } = makeService();
    await service.recordDocumentDeletionIntent(subject);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT INTO audit_logs');
    expect(calls[0].params[0]).toBe('patient_document.delete_started');
  });

  it('carries userId, so the account purge can tombstone it', async () => {
    const { service, calls } = makeService();
    await service.recordDocumentDeletionIntent(subject);

    // purgeDueAccountDeletions matches on event_payload->>'userId'.
    // An intent row without it would survive the erasure it describes.
    expect(calls[0].params[1]).toMatchObject({ userId: 'u-1', documentId: 'doc-1' });
  });

  it('masks the identifiers and carries no report content', async () => {
    const { service, calls } = makeService();
    await service.recordDocumentDeletionIntent(subject);

    const payload = calls[0].params[1] as Record<string, unknown>;
    expect(payload.ip).toBe('203.0.113.0/24');
    expect(payload.userAgent).toBe('WeChat on Android');
    // Same rule as the `patient_document.deleted` payload: a patient
    // names her own uploads（「基因检测 2026」）and hospitals put names
    // and IDs in file names, so title / file_name / storage_uri are
    // report content, not evidence that a deletion was attempted.
    expect(Object.keys(payload).sort()).toEqual([
      'documentId',
      'documentType',
      'ip',
      'userAgent',
      'userId',
    ]);
  });

  it('propagates a write failure instead of swallowing it', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('sorry, too many clients already'));
    const service = new PatientProfileService({
      pool: { query: failing, connect: vi.fn() } as never,
      logger: silentLogger as never,
    });

    // The controller turns this into a 503 and touches nothing. If the
    // insert were best-effort here, the blob would be destroyed with
    // the trail missing — the exact shape this row exists to prevent.
    await expect(service.recordDocumentDeletionIntent(subject)).rejects.toThrow(
      'sorry, too many clients already',
    );
  });
});

describe('recordDocumentDeletionFailure', () => {
  it('records how the attempt ended, including whether the file survived', async () => {
    const { service, calls } = makeService();
    await service.recordDocumentDeletionFailure({
      ...subject,
      storageCleanupStatus: 'removed',
      reason: 'row_delete_failed',
    });

    expect(calls[0].params[0]).toBe('patient_document.delete_failed');
    expect(calls[0].params[1]).toMatchObject({
      userId: 'u-1',
      documentId: 'doc-1',
      documentType: 'genetic_report',
      storageCleanupStatus: 'removed',
      reason: 'row_delete_failed',
    });
  });

  it('still carries no report content on the failure path', async () => {
    const { service, calls } = makeService();
    await service.recordDocumentDeletionFailure({
      ...subject,
      storageCleanupStatus: 'kept',
      reason: 'storage_remove_failed',
    });

    const payload = calls[0].params[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'documentId',
      'documentType',
      'ip',
      'reason',
      'storageCleanupStatus',
      'userAgent',
      'userId',
    ]);
  });
});
