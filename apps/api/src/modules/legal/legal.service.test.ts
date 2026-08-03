import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  CONDITIONAL_DOCUMENTS,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_IP_MAX_LENGTH,
  LEGAL_USER_AGENT_MAX_LENGTH,
  REGISTRATION_DOCUMENTS,
  SENSITIVE_DATA_DOCUMENT,
} from './legal.constants.js';
import {
  getAcceptanceSummary,
  hasAcceptedDocument,
  recordAcceptance,
  withdrawAcceptance,
} from './legal.service.js';

type QueryFn = ReturnType<typeof vi.fn>;

/** A pool whose `query` returns each queued result in turn, so a test
 *  can script the INSERT → SELECT sequence the upsert makes. */
const scriptedPool = (results: Array<{ rows: unknown[]; rowCount?: number }>) => {
  const query = vi.fn();
  for (const result of results) {
    query.mockResolvedValueOnce({
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    } as unknown as QueryResult);
  }
  return { pool: { query } as unknown as Pool, query: query as QueryFn };
};

const row = (document: string, version: string, acceptedAt: string) => ({
  document,
  version,
  accepted_at: acceptedAt,
});

describe('legal document constants', () => {
  // The same three identifiers exist in apps/mobile/lib/legal-content.ts
  // and in migration 019's CHECK constraint. Renaming one on a single
  // side silently turns 「同意过」 into 「没同意过」 for every existing
  // user, so pin the set here — a rename now fails a test instead of a
  // patient's upload.
  it('pins the document identifier set', () => {
    expect([...LEGAL_DOCUMENT_IDS]).toEqual([
      'user_agreement',
      'privacy_policy',
      'sensitive_data_consent',
      'guardian_consent',
    ]);
  });

  it('keeps the sensitive-PI consent out of the registration bundle', () => {
    // PIPL Art. 29: 单独同意. If this ever contains the sensitive
    // document, the registration checkbox has silently become a bundled
    // consent for health and genetic data.
    expect([...REGISTRATION_DOCUMENTS]).toEqual(['user_agreement', 'privacy_policy']);
    expect(REGISTRATION_DOCUMENTS).not.toContain(SENSITIVE_DATA_DOCUMENT);
  });

  it('has a current version for every known document', () => {
    for (const document of LEGAL_DOCUMENT_IDS) {
      expect(LEGAL_DOCUMENT_VERSIONS[document]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('recordAcceptance', () => {
  it('returns the inserted row on a first acceptance', async () => {
    const { pool, query } = scriptedPool([
      { rows: [row('privacy_policy', '2026-08-02', '2026-08-02T09:00:00Z')] },
    ]);

    const result = await recordAcceptance(pool, {
      userId: 'user-1',
      document: LEGAL_DOCUMENTS.privacyPolicy,
      version: '2026-08-02',
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });

    expect(result).toEqual({
      document: 'privacy_policy',
      version: '2026-08-02',
      acceptedAt: '2026-08-02T09:00:00.000Z',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([
      'user-1',
      'privacy_policy',
      '2026-08-02',
      '203.0.113.5',
      'Mozilla/5.0',
    ]);
  });

  it('is idempotent: a repeat accept re-reads the ORIGINAL timestamp', async () => {
    // The double tap this covers is the realistic one — a patient with
    // reduced fine motor control firing the confirm button twice. The
    // ledger must keep the first timestamp, because that is the moment
    // consent was actually given.
    const { pool, query } = scriptedPool([
      { rows: [], rowCount: 0 },
      { rows: [row('user_agreement', '2026-08-02', '2026-08-02T08:00:00Z')] },
    ]);

    const result = await recordAcceptance(pool, {
      userId: 'user-1',
      document: LEGAL_DOCUMENTS.userAgreement,
      version: '2026-08-02',
    });

    expect(result.acceptedAt).toBe('2026-08-02T08:00:00.000Z');
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0][0])).toContain('ON CONFLICT');
  });

  it('throws when the row vanishes between the upsert and the re-read', async () => {
    // Only reachable if the account was purged mid-request. Returning a
    // fabricated timestamp for a record that does not exist would put a
    // lie in the compliance ledger.
    const { pool } = scriptedPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);

    await expect(
      recordAcceptance(pool, {
        userId: 'ghost',
        document: LEGAL_DOCUMENTS.userAgreement,
        version: '2026-08-02',
      }),
    ).rejects.toThrow(/no row after upsert/);
  });

  it('clamps an over-long user-agent and IP instead of failing the write', async () => {
    // Both columns carry a CHECK. Letting Postgres reject the row would
    // mean a browser with a chatty User-Agent cannot register at all.
    const { pool, query } = scriptedPool([
      { rows: [row('user_agreement', '2026-08-02', '2026-08-02T08:00:00Z')] },
    ]);

    await recordAcceptance(pool, {
      userId: 'user-1',
      document: LEGAL_DOCUMENTS.userAgreement,
      version: '2026-08-02',
      ip: 'x'.repeat(200),
      userAgent: 'y'.repeat(2000),
    });

    const [, , , ip, userAgent] = query.mock.calls[0][1] as string[];
    expect(ip).toHaveLength(LEGAL_IP_MAX_LENGTH);
    expect(userAgent).toHaveLength(LEGAL_USER_AGENT_MAX_LENGTH);
  });

  it('stores NULL rather than an empty string for a missing IP / UA', async () => {
    const { pool, query } = scriptedPool([
      { rows: [row('user_agreement', '2026-08-02', '2026-08-02T08:00:00Z')] },
    ]);

    await recordAcceptance(pool, {
      userId: 'user-1',
      document: LEGAL_DOCUMENTS.userAgreement,
      version: '2026-08-02',
      ip: '   ',
      userAgent: undefined,
    });

    const values = query.mock.calls[0][1] as unknown[];
    expect(values[3]).toBeNull();
    expect(values[4]).toBeNull();
  });
});

describe('getAcceptanceSummary', () => {
  it('reports every document as outstanding for a user who accepted nothing', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    const summary = await getAcceptanceSummary(pool, 'user-1');
    expect(summary.acceptances).toEqual([]);
    // Every REQUIRED document. guardian_consent is conditional — it
    // applies to under-14 patients only, and an adult owing it forever
    // would make this list useless as a prompt.
    expect(summary.outstanding).toEqual(
      LEGAL_DOCUMENT_IDS.filter((id) => !CONDITIONAL_DOCUMENTS.includes(id)),
    );
  });

  it('clears a document from outstanding once the CURRENT version is accepted', async () => {
    const { pool } = scriptedPool([
      {
        rows: [
          row('privacy_policy', LEGAL_DOCUMENT_VERSIONS.privacy_policy, '2026-08-02T09:00:00Z'),
          row('user_agreement', LEGAL_DOCUMENT_VERSIONS.user_agreement, '2026-08-02T08:00:00Z'),
        ],
      },
    ]);

    const summary = await getAcceptanceSummary(pool, 'user-1');

    expect(summary.outstanding).toEqual(['sensitive_data_consent']);
    // Newest first, so a UI can show 「最近一次同意」 without re-sorting.
    expect(summary.acceptances.map((item) => item.document)).toEqual([
      'privacy_policy',
      'user_agreement',
    ]);
  });

  it('re-raises a document whose text has been revised since acceptance', async () => {
    // The whole point of versioning the ledger: an acceptance of an
    // older privacy policy must not be read as acceptance of the
    // current one.
    const { pool } = scriptedPool([
      { rows: [row('privacy_policy', '2020-01-01', '2020-01-01T00:00:00Z')] },
    ]);

    const summary = await getAcceptanceSummary(pool, 'user-1');
    expect(summary.outstanding).toContain('privacy_policy');
    expect(summary.current.privacy_policy).toBe(LEGAL_DOCUMENT_VERSIONS.privacy_policy);
  });
});

describe('hasAcceptedDocument', () => {
  it('is true for an acceptance at ANY version', async () => {
    // Version-insensitive on purpose: an outdated sensitive-PI consent
    // should prompt a re-confirmation, not make the API behave as if
    // the user never consented to reports they already uploaded.
    const { pool } = scriptedPool([{ rows: [{ '?column?': 1 }] }]);
    expect(await hasAcceptedDocument(pool, 'user-1', SENSITIVE_DATA_DOCUMENT)).toBe(true);
  });

  it('is false when the user has never accepted it', async () => {
    const { pool } = scriptedPool([{ rows: [], rowCount: 0 }]);
    expect(await hasAcceptedDocument(pool, 'user-1', SENSITIVE_DATA_DOCUMENT)).toBe(false);
  });
});

describe('conditional documents', () => {
  // guardian_consent applies only to under-14 patients. Listing it as
  // outstanding for everyone would tell an adult they owe a consent
  // they cannot legitimately give, and would make `outstanding`
  // useless as the prompt it exists to be.
  it('never reports guardian consent as owed by a user who has not needed it', async () => {
    const { pool } = scriptedPool([{ rows: [] }]);
    const summary = await getAcceptanceSummary(pool, 'adult-1');
    expect(summary.outstanding).not.toContain('guardian_consent');
    expect(summary.outstanding).toContain('user_agreement');
  });

  it('does re-ask a guardian whose accepted version has since been revised', async () => {
    const { pool } = scriptedPool([
      { rows: [row('guardian_consent', '1999-01-01', '2026-01-01T00:00:00Z')] },
    ]);
    const summary = await getAcceptanceSummary(pool, 'child-1');
    expect(summary.outstanding).toContain('guardian_consent');
  });
});

describe('withdrawAcceptance', () => {
  // The consent documents promise 「同意后可随时在「隐私设置」中撤回」.
  // Before migration 020 the ledger was append-only, so the sentence
  // was unkeepable — and the test that "covered" it asserted the
  // sentence rather than the capability.
  it('marks live rows withdrawn without deleting them', async () => {
    const { pool, query } = scriptedPool([{ rows: [], rowCount: 1 }]);
    const count = await withdrawAcceptance(pool, 'user-1', LEGAL_DOCUMENTS.sensitiveData);
    expect(count).toBe(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE legal_document_acceptances');
    expect(sql).toContain('withdrawn_at = NOW()');
    // Evidence that the processing done BEFORE the withdrawal was
    // lawful has to survive it — that is what the document promises.
    expect(sql).not.toContain('DELETE');
  });

  it('only touches rows that are still live, so withdrawing twice is a no-op', async () => {
    const { pool, query } = scriptedPool([{ rows: [], rowCount: 0 }]);
    const count = await withdrawAcceptance(pool, 'user-1', LEGAL_DOCUMENTS.sensitiveData);
    expect(count).toBe(0);
    expect(query.mock.calls[0][0]).toContain('withdrawn_at IS NULL');
  });
});

describe('hasAcceptedDocument', () => {
  it('does not count a withdrawn acceptance', async () => {
    // This is the query the Art. 29 gate runs in front of every write
    // that stores health data. A withdrawn consent that still passed it
    // would make the withdraw button decorative.
    const { pool, query } = scriptedPool([{ rows: [], rowCount: 0 }]);
    expect(await hasAcceptedDocument(pool, 'user-1', LEGAL_DOCUMENTS.sensitiveData)).toBe(false);
    expect(query.mock.calls[0][0]).toContain('withdrawn_at IS NULL');
  });
});

describe('getAcceptanceSummary and withdrawal', () => {
  /**
   * These two queries answer the same question about the same table and
   * must agree. When migration 020 added `withdrawn_at`, only
   * hasAcceptedDocument was updated — and this one is what the mobile
   * consent gate reads to decide whether to show the document, so a
   * withdrawn user got no modal and a 403 with nothing to re-open it.
   */
  it('does not list a withdrawn acceptance', async () => {
    const { pool, query } = scriptedPool([{ rows: [] }]);
    const summary = await getAcceptanceSummary(pool, 'user-1');
    expect(query.mock.calls[0][0]).toContain('withdrawn_at IS NULL');
    expect(summary.acceptances).toEqual([]);
  });

  it('puts a withdrawn required document back into outstanding', async () => {
    // The row exists but is withdrawn, so the query returns nothing and
    // the document is owed again — which is what makes re-consent
    // reachable instead of a dead end.
    const { pool } = scriptedPool([{ rows: [] }]);
    const summary = await getAcceptanceSummary(pool, 'user-1');
    expect(summary.outstanding).toContain('sensitive_data_consent');
  });

  it('asks the same question as hasAcceptedDocument', async () => {
    // Pinned as a pair: if one grows a predicate the other lacks, the
    // client and the server disagree about whether consent exists, and
    // that disagreement is invisible until a patient cannot save data.
    const a = scriptedPool([{ rows: [] }]);
    await getAcceptanceSummary(a.pool, 'user-1');
    const b = scriptedPool([{ rows: [], rowCount: 0 }]);
    await hasAcceptedDocument(b.pool, 'user-1', LEGAL_DOCUMENTS.sensitiveData);
    const predicate = /withdrawn_at IS NULL/;
    expect(a.query.mock.calls[0][0]).toMatch(predicate);
    expect(b.query.mock.calls[0][0]).toMatch(predicate);
  });
});
