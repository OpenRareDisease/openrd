import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService } from './profile.service.js';

/**
 * `getBaselineByUserId` used to call `getProfileByUserId`, which reads
 * eight tables, and then throw away everything but four fields. It now
 * queries directly — so these tests pin the two things that rewrite
 * could break: that it still reads the documents (the genetic report
 * fills a baseline the patient never typed), and that it does not read
 * anything else.
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

const geneticDocument = {
  id: 'doc-1',
  document_type: 'genetic_report',
  uploaded_at: new Date('2026-03-02T00:00:00Z'),
  ocr_payload: {
    fields: {
      classifiedType: 'genetic_report',
      d4z4Repeats: '6',
      haplotype4q: '4qA',
    },
  },
};

const makePool = (
  profileRows: Record<string, unknown>[],
  documentRows: Record<string, unknown>[] = [geneticDocument],
) => {
  const sqls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    sqls.push(sql);
    if (sql.includes('patient_documents')) {
      return { rowCount: documentRows.length, rows: documentRows };
    }
    return { rowCount: profileRows.length, rows: profileRows };
  });
  return { pool: { query, connect: vi.fn() } as never, sqls };
};

const profileRow = {
  id: 'profile-1',
  full_name: '测试患者',
  preferred_name: '小测',
  diagnosis_date: new Date('2024-01-05T00:00:00Z'),
  genetic_mutation: null,
  baseline_payload: { foundation: { heightCm: 170 } },
  updated_at: new Date('2026-05-05T10:00:00Z'),
};

const serviceFor = (pool: never) =>
  new PatientProfileService({ pool, logger: silentLogger as never });

describe('getBaselineByUserId', () => {
  it('returns null without touching documents when there is no profile', async () => {
    const { pool, sqls } = makePool([]);
    expect(await serviceFor(pool).getBaselineByUserId('user-1')).toBeNull();
    expect(sqls.some((sql) => sql.includes('patient_documents'))).toBe(false);
  });

  it('reads only patient_profiles and patient_documents', async () => {
    const { pool, sqls } = makePool([profileRow]);
    await serviceFor(pool).getBaselineByUserId('user-1');

    const joined = sqls.join('\n');
    for (const table of [
      'patient_measurements',
      'patient_function_tests',
      'patient_symptom_scores',
      'patient_daily_impacts',
      'patient_followup_events',
      'patient_activity_logs',
      'patient_medications',
    ]) {
      expect(joined).not.toContain(table);
    }
  });

  it('still autofills the baseline from the latest genetic report', async () => {
    const { pool } = makePool([profileRow]);
    const baseline = await serviceFor(pool).getBaselineByUserId('user-1');

    // The patient never typed these; they come off the OCR fields, and
    // dropping the documents query would silently blank them.
    const background = (baseline?.baseline as Record<string, Record<string, unknown>>)
      ?.diseaseBackground;
    expect(background?.d4z4).toBe('6');
    expect(background?.haplotype).toBe('4qA');
    // Values the patient did type must survive the merge.
    const foundation = (baseline?.baseline as Record<string, Record<string, unknown>>)?.foundation;
    expect(foundation?.heightCm).toBe(170);
  });

  it('carries the profile scalars through', async () => {
    const { pool } = makePool([profileRow]);
    const baseline = await serviceFor(pool).getBaselineByUserId('user-1');
    expect(baseline?.profileId).toBe('profile-1');
    expect(baseline?.fullName).toBe('测试患者');
    expect(baseline?.preferredName).toBe('小测');
    expect(baseline?.updatedAt).toBe('2026-05-05T10:00:00.000Z');
  });

  it('asks the database for a projected payload, not the whole blob', async () => {
    const { pool, sqls } = makePool([profileRow]);
    await serviceFor(pool).getBaselineByUserId('user-1');

    const documentSql = sqls.find((sql) => sql.includes('patient_documents')) ?? '';
    // The projection is what keeps `aiExtraction` — the largest key,
    // read by nothing here — off the wire.
    expect(documentSql).toContain('jsonb_build_object');
    expect(documentSql).toContain("'fields'");
    expect(documentSql).toContain("'extractedText'");
    expect(documentSql).not.toContain('aiExtraction');
  });
});
