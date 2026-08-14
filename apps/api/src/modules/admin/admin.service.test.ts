import { describe, expect, it, vi } from 'vitest';

import {
  AdminService,
  escapeLikePattern,
  maskDisplayName,
  type AdminExportRow,
} from './admin.service.js';

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

/** A pool that answers on the shape of the SQL and records everything
 *  it was asked. Every `answer` predicate is matched in order. */
const fakePool = (answers: Array<{ when: RegExp; rows: Record<string, unknown>[] }>) => {
  const calls: RecordedQuery[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values: values ?? [] });
    const answer = answers.find((entry) => entry.when.test(sql));
    if (!answer) throw new Error(`unexpected query: ${sql}`);
    return { rows: answer.rows, rowCount: answer.rows.length };
  });
  return { calls, service: new AdminService({ pool: { query } as never }) };
};

const sqlMatching = (calls: RecordedQuery[], pattern: RegExp) =>
  calls.find((call) => pattern.test(call.sql));

describe('maskDisplayName', () => {
  it('keeps the first character and masks the rest, one 〇 per character', () => {
    expect(maskDisplayName('张三')).toBe('张〇');
    expect(maskDisplayName('欧阳修')).toBe('欧〇〇');
  });

  it('handles a single-character name', () => {
    expect(maskDisplayName('张')).toBe('张');
  });

  it('caps the mask so a pathological name cannot blow up a table cell', () => {
    expect(maskDisplayName('张'.repeat(120))).toBe(`张${'〇'.repeat(8)}`);
  });

  it('counts by code point, so an astral character is not half-masked', () => {
    // A name containing a supplementary-plane character would be two
    // UTF-16 units; splitting on units would emit a lone surrogate.
    expect(maskDisplayName('𠮷田')).toBe('𠮷〇');
  });

  it('returns null for an absent or blank name', () => {
    expect(maskDisplayName(null)).toBeNull();
    expect(maskDisplayName('   ')).toBeNull();
  });
});

describe('escapeLikePattern', () => {
  it('escapes the LIKE metacharacters, so a pasted % does not match every account', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('leaves an ordinary search term untouched', () => {
    expect(escapeLikePattern('13900000001')).toBe('13900000001');
  });
});

const listRow = (overrides: Record<string, unknown> = {}) => ({
  user_id: '99999999-8888-7777-6666-555555555555',
  phone_number: '13912340001',
  role: 'patient',
  is_active: true,
  registered_at: new Date('2026-01-02T03:04:05.000Z'),
  profile_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  patient_code: 'FSHD-0001',
  full_name: '张三丰',
  preferred_name: null,
  profile_updated_at: new Date('2026-02-02T03:04:05.000Z'),
  ...overrides,
});

describe('AdminService.listPatients', () => {
  const listAnswers = (rows: Record<string, unknown>[], total = rows.length) => [
    { when: /COUNT\(\*\)::text AS total\s+FROM app_users/, rows: [{ total: String(total) }] },
    { when: /FROM app_users/, rows },
  ];

  it('never returns a name or a phone number in the clear', async () => {
    const { service } = fakePool(listAnswers([listRow()]));
    const result = await service.listPatients({ page: 1, pageSize: 20 });

    expect(result.items[0].maskedName).toBe('张〇〇');
    expect(result.items[0].maskedPhone).toBe('139****0001');
    // The whole point of the list. Serialising the row would put a
    // roster of Chinese FSHD patients on one screen.
    expect(JSON.stringify(result)).not.toContain('张三丰');
    expect(JSON.stringify(result)).not.toContain('13912340001');
  });

  it('shows the preferred name over the full name, since that is what the patient answers to', async () => {
    const { service } = fakePool(listAnswers([listRow({ preferred_name: '小张' })]));
    const result = await service.listPatients({ page: 1, pageSize: 20 });
    expect(result.items[0].maskedName).toBe('小〇');
  });

  it('carries an account that has never opened the baseline form', async () => {
    const { service } = fakePool(
      listAnswers([
        listRow({
          profile_id: null,
          patient_code: null,
          full_name: null,
          profile_updated_at: null,
        }),
      ]),
    );
    const result = await service.listPatients({ page: 1, pageSize: 20 });

    // An inner join would answer「查无此人」for exactly the caller who
    // rings up because they registered and could not fill anything in.
    expect(result.items[0].hasProfile).toBe(false);
    expect(result.items[0].maskedName).toBeNull();
    expect(result.items[0].profileUpdatedAt).toBeNull();
  });

  it('shows no clinical field at all', async () => {
    const { service } = fakePool(listAnswers([listRow()]));
    const result = await service.listPatients({ page: 1, pageSize: 20 });

    for (const forbidden of [
      'dateOfBirth',
      'gender',
      'region',
      'diagnosis',
      'genetic',
      'baseline',
    ]) {
      expect(Object.keys(result.items[0])).not.toContain(forbidden);
    }
  });

  it('passes a null search term when there is no query, so the filter is skipped', async () => {
    const { calls, service } = fakePool(listAnswers([]));
    await service.listPatients({ page: 2, pageSize: 25 });

    const rowsQuery = sqlMatching(calls, /LIMIT \$2 OFFSET \$3/);
    expect(rowsQuery?.values).toEqual([null, 25, 25]);
  });

  it('wraps and escapes the search term', async () => {
    const { calls, service } = fakePool(listAnswers([]));
    await service.listPatients({ q: ' 100%_ ', page: 1, pageSize: 20 });

    const rowsQuery = sqlMatching(calls, /LIMIT \$2 OFFSET \$3/);
    expect(rowsQuery?.values[0]).toBe('%100\\%\\_%');
  });

  it('searches the name columns it refuses to return', async () => {
    const { calls, service } = fakePool(listAnswers([]));
    await service.listPatients({ q: '张', page: 1, pageSize: 20 });

    const rowsQuery = sqlMatching(calls, /LIMIT \$2 OFFSET \$3/);
    expect(rowsQuery?.sql).toContain('p.full_name ILIKE $1');
    expect(rowsQuery?.sql).toContain('u.phone_number ILIKE $1');
    expect(rowsQuery?.sql).toContain('p.patient_code ILIKE $1');
  });

  it('orders by a tiebroken key, so a row cannot hide between two pages', async () => {
    const { calls, service } = fakePool(listAnswers([]));
    await service.listPatients({ page: 1, pageSize: 20 });
    expect(sqlMatching(calls, /LIMIT \$2 OFFSET \$3/)?.sql).toContain(
      'ORDER BY u.created_at DESC, u.id',
    );
  });

  it('reports the unpaged total from the same filter', async () => {
    const { service } = fakePool(listAnswers([listRow()], 137));
    const result = await service.listPatients({ page: 1, pageSize: 20 });
    expect(result.total).toBe(137);
  });
});

describe('AdminService.getAccount', () => {
  it('returns null for a user id that belongs to nobody', async () => {
    const { service } = fakePool([{ when: /FROM app_users/, rows: [] }]);
    expect(await service.getAccount('99999999-8888-7777-6666-555555555555')).toBeNull();
  });
});

describe('AdminService.listExportRows', () => {
  const exportAnswers = (
    rows: Record<string, unknown>[],
    counts: Record<string, unknown>[] = [],
  ) => [
    { when: /UNION ALL/, rows: counts },
    { when: /FROM patient_profiles p/, rows },
  ];

  const profileRow = (overrides: Record<string, unknown> = {}) => ({
    user_id: '99999999-8888-7777-6666-555555555555',
    phone_number: '+8613900000001',
    email: null,
    account_role: 'patient',
    account_is_active: true,
    account_created_at: new Date('2026-01-02T03:04:05.000Z'),
    profile_id: 'profile-1',
    patient_code: 'FSHD-0001',
    full_name: '张三',
    preferred_name: null,
    date_of_birth: null,
    gender: null,
    height_cm: null,
    weight_kg: null,
    blood_type: null,
    contact_phone: null,
    contact_email: null,
    primary_physician: null,
    region_province: null,
    region_city: null,
    region_district: null,
    diagnosis_stage: null,
    diagnosis_date: null,
    genetic_mutation: null,
    notes: null,
    baseline_payload: null,
    ai_consent_personal: false,
    ai_consent_third_party: false,
    ai_consent_precise_values: false,
    clinical_trial_consent: false,
    data_donation_consent: false,
    hospital_sync_consent: false,
    community_share_consent: false,
    profile_created_at: new Date('2026-01-02T03:04:05.000Z'),
    profile_updated_at: new Date('2026-02-02T03:04:05.000Z'),
    ...overrides,
  });

  it('keys the counts by profile and zero-fills a patient with no records', async () => {
    const { service } = fakePool(
      exportAnswers(
        [profileRow(), profileRow({ profile_id: 'profile-2' })],
        [
          { kind: 'measurements', profile_id: 'profile-1', n: '12' },
          { kind: 'falls', profile_id: 'profile-1', n: '3' },
        ],
      ),
    );

    const rows: AdminExportRow[] = await service.listExportRows(100);
    expect(rows[0].counts.measurements).toBe(12);
    expect(rows[0].counts.falls).toBe(3);
    expect(rows[0].counts.documents).toBe(0);
    // A profile with no rows in any of the ten tables must still get a
    // full set of zeros, not an undefined that renders as an empty
    // cell and reads as「不知道」.
    expect(rows[1].counts.measurements).toBe(0);
    expect(rows[1].counts.instrument_administrations).toBe(0);
  });

  it('excludes retracted records from the counts, matching what the record view shows', async () => {
    const { calls, service } = fakePool(exportAnswers([profileRow()]));
    await service.listExportRows(100);

    const countsSql = sqlMatching(calls, /UNION ALL/)?.sql ?? '';
    for (const table of [
      'patient_function_tests',
      'patient_symptom_scores',
      'patient_followup_events',
      'patient_falls',
    ]) {
      const clause = countsSql.slice(countsSql.indexOf(table));
      expect(clause.slice(0, 60)).toContain('deleted_at IS NULL');
    }
  });

  it('bounds the row read with the caller-supplied limit', async () => {
    const { calls, service } = fakePool(exportAnswers([]));
    await service.listExportRows(20_000);
    expect(sqlMatching(calls, /FROM patient_profiles p/)?.values).toEqual([20_000]);
  });
});

describe('AdminService.recordFullExportAudit', () => {
  it('writes a row a query can single out from a single-patient export', async () => {
    const { calls, service } = fakePool([{ when: /INSERT INTO audit_logs/, rows: [] }]);
    await service.recordFullExportAudit({
      adminUserId: '11111111-2222-3333-4444-555555555555',
      path: '/api/admin/exports/patients.csv',
      method: 'POST',
      patientCount: 36,
      fileName: 'openrd-patients-20260813T041107Z-by-x.csv',
    });

    const insert = sqlMatching(calls, /INSERT INTO audit_logs/);
    expect(insert?.values[0]).toBe('admin.export');
    const payload = JSON.parse(insert?.values[1] as string);
    // `scope` is the discriminator, because ADMIN_AUDIT_EVENTS has no
    // `admin.export_all` member and the path alone changes whenever
    // the route is renamed.
    expect(payload.scope).toBe('all_patients');
    expect(payload.patientCount).toBe(36);
    expect(payload.targetUserId).toBeNull();
    expect(payload.fileName).toBe('openrd-patients-20260813T041107Z-by-x.csv');
    // Exactly these keys. A phone number, an email or an IP arriving
    // here later would have to go through maskAuditPayload from
    // services/audit/identity-masking.ts first, and this assertion is
    // what makes adding one a decision rather than a slip.
    expect(Object.keys(payload).sort()).toEqual([
      'adminUserId',
      'fileName',
      'method',
      'path',
      'patientCount',
      'scope',
      'targetUserId',
    ]);
  });
});

describe('AdminService.getAiUsage', () => {
  const usage = (rows: Record<string, unknown>[]) =>
    fakePool([{ when: /FROM ai_prompt_audit/, rows }]);

  it('keeps consent refusals out of both halves of the failure rate', async () => {
    const { service } = usage([
      { status: 'success', calls: '90', avg_latency_ms: '1200.4' },
      { status: 'error', calls: '10', avg_latency_ms: '300' },
      { status: 'consent_denied', calls: '400', avg_latency_ms: null },
    ]);
    const result = await service.getAiUsage(7);

    // 10/(90+10). A consent refusal is the privacy gate working; in
    // the denominator it would make 400 correct refusals read as a 2%
    // failure rate and hide the real one.
    expect(result.failureRate).toBeCloseTo(0.1, 10);
    expect(result.totalCalls).toBe(500);
    expect(result.byStatus.find((entry) => entry.status === 'success')?.avgLatencyMs).toBe(1200);
    expect(
      result.byStatus.find((entry) => entry.status === 'consent_denied')?.avgLatencyMs,
    ).toBeNull();
  });

  it('counts a status this build has never heard of as a failure', async () => {
    // `ai_prompt_audit.status` has no CHECK constraint and `AuditStatus`
    // is closed at three TODAY. A fourth one added later — `timeout`,
    // `rate_limited` — used to land in `byStatus` and in neither half
    // of the rate, so the dashboard kept reporting 10% while a quarter
    // of the calls were failing. Only `consent_denied` is excluded, and
    // it is excluded by name.
    const { service } = usage([
      { status: 'success', calls: '90', avg_latency_ms: '1200' },
      { status: 'error', calls: '10', avg_latency_ms: '300' },
      { status: 'timeout', calls: '100', avg_latency_ms: '30000' },
    ]);
    const result = await service.getAiUsage(7);

    expect(result.failureRate).toBeCloseTo(110 / 200, 10);
    expect(result.byStatus.find((entry) => entry.status === 'timeout')?.calls).toBe(100);
  });

  it('reports a null failure rate rather than 0% when nothing was attempted', async () => {
    const { service } = usage([{ status: 'consent_denied', calls: '3', avg_latency_ms: null }]);
    expect((await service.getAiUsage(7)).failureRate).toBeNull();
  });

  it('says how far back the data can possibly go', async () => {
    const { service } = usage([]);
    const result = await service.getAiUsage(30);
    expect(result.windowDays).toBe(30);
    expect(result.retentionDays).toBe(180);
  });
});

describe('AdminService.getParseFailureQueue', () => {
  it('includes a processing row that is older than the stuck threshold', async () => {
    const { calls, service } = fakePool([{ when: /FROM patient_documents d/, rows: [] }]);
    await service.getParseFailureQueue({ limit: 50, stuckAfterMinutes: 10 });

    const sql = sqlMatching(calls, /FROM patient_documents d/)?.sql ?? '';
    expect(sql).toContain("d.status IN ('parse_failed', 'failed')");
    // The sweep in profile.routes.ts skips its tick while this process
    // has OCR jobs in flight, so a stranded row can sit unlabelled for
    // hours. The queue has to show it anyway.
    expect(sql).toContain("d.status = 'processing'");
    expect(sqlMatching(calls, /FROM patient_documents d/)?.values).toEqual(['10', 50]);
  });

  it('never selects the patient-typed title or file name', async () => {
    const { calls, service } = fakePool([{ when: /FROM patient_documents d/, rows: [] }]);
    await service.getParseFailureQueue({ limit: 50, stuckAfterMinutes: 10 });

    const sql = sqlMatching(calls, /FROM patient_documents d/)?.sql ?? '';
    expect(sql).not.toContain('d.title');
    expect(sql).not.toContain('file_name');
  });

  it('says when the queue was cut off, instead of looking complete', async () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({
      document_id: `doc-${index}`,
      user_id: 'user-1',
      document_type: 'genetic_report',
      status: 'parse_failed',
      uploaded_at: new Date('2026-08-01T00:00:00.000Z'),
    }));
    const { service } = fakePool([{ when: /FROM patient_documents d/, rows }]);

    expect((await service.getParseFailureQueue({ limit: 2, stuckAfterMinutes: 10 })).atCap).toBe(
      true,
    );
    expect((await service.getParseFailureQueue({ limit: 5, stuckAfterMinutes: 10 })).atCap).toBe(
      false,
    );
  });
});

describe('AdminService.getCorpusStatus', () => {
  it('counts the chunks nothing can ever retrieve', async () => {
    const { service } = fakePool([
      {
        when: /GROUP BY embed_model/,
        rows: [
          { embed_model: 'BAAI/bge-m3', chunk_count: '10000' },
          { embed_model: 'BAAI/bge-large-zh', chunk_count: '241' },
        ],
      },
      {
        when: /FROM kb_chunks/,
        rows: [
          {
            chunk_count: '10241',
            source_file_count: '87',
            unembedded_chunk_count: '12',
            oldest_updated_at: new Date('2026-01-01T00:00:00.000Z'),
            newest_updated_at: new Date('2026-08-01T00:00:00.000Z'),
          },
        ],
      },
    ]);

    const result = await service.getCorpusStatus();
    // A NULL embedding is a chunk in the corpus that no similarity
    // search returns — invisible to the KB service's own readiness
    // probe, which only reports an entirely empty table.
    expect(result.unembeddedChunkCount).toBe(12);
    expect(result.chunkCount).toBe(10241);
    // Two models in one corpus is a half-finished re-ingest.
    expect(result.embedModels).toHaveLength(2);
    expect(result.newestUpdatedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('answers zeros on an empty corpus rather than NaN', async () => {
    const { service } = fakePool([
      { when: /GROUP BY embed_model/, rows: [] },
      {
        when: /FROM kb_chunks/,
        rows: [
          {
            chunk_count: '0',
            source_file_count: '0',
            unembedded_chunk_count: '0',
            oldest_updated_at: null,
            newest_updated_at: null,
          },
        ],
      },
    ]);

    const result = await service.getCorpusStatus();
    expect(result.chunkCount).toBe(0);
    expect(result.newestUpdatedAt).toBeNull();
  });
});
