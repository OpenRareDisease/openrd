import { describe, expect, it, vi } from 'vitest';

import { normaliseSource } from './export/export-source.js';
import { buildFhirExport } from './export/fhir-r4.js';
import { buildTreatNmdExport } from './export/treat-nmd.js';
import { PatientProfileService } from './profile.service.js';
import { buildReferralPack } from './referral-pack.js';

/**
 * 「今天做不了」 has to survive the trip from the row to the page.
 *
 * The existing coverage in export/ and referral-pack.test.ts starts
 * from a hand-written `PatientProfileDTO` that sets `notApplicable`
 * itself. That is exactly the field production dropped: for months
 * `getProfileByUserId` neither SELECTed `not_applicable` nor mapped
 * it, so every attempted-and-failed test arrived at the serialisers as
 * `undefined`. The referral pack filtered the row out entirely (no
 * heading, no 「这几项我最近做不了了」 question), FHIR labelled it
 * 「未记录测量值」, and every suite stayed green because every suite
 * supplied the missing field by hand.
 *
 * So this file starts one layer earlier, at the query. The fake client
 * projects `patient_function_tests` rows down to the columns the SQL
 * actually names, the way Postgres does — which is what makes a
 * dropped column visible here instead of at a neurologist's desk.
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

const profileRow = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  full_name: '张小雨',
  preferred_name: '小雨',
  date_of_birth: null,
  gender: 'female',
  patient_code: 'FSHD-0001',
  diagnosis_stage: 'confirmed',
  diagnosis_date: null,
  genetic_mutation: null,
  height_cm: null,
  weight_kg: null,
  blood_type: null,
  contact_phone: null,
  contact_email: null,
  primary_physician: null,
  region_province: null,
  region_city: null,
  region_district: null,
  baseline_payload: null,
  notes: null,
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2026-06-01T00:00:00Z'),
};

/** The row a patient creates by tapping 「今天做不了」 on the stair
 *  climb. Migration 017's CHECK guarantees the NULL measured_value. */
const unableRow = {
  id: '44444444-4444-4444-8444-444444444442',
  profile_id: profileRow.id,
  submission_id: null,
  test_type: 'stair_climb',
  measured_value: null,
  side: null,
  protocol: null,
  unit: null,
  device_used: null,
  assistance_required: null,
  notes: null,
  not_applicable: true,
  performed_at: new Date('2026-06-01T03:10:00Z'),
  created_at: new Date('2026-06-01T03:12:00Z'),
};

/**
 * Postgres returns the columns the SELECT names and nothing else.
 * A test double that hands back the whole row regardless is the reason
 * this defect survived: it silently repairs the very projection the
 * code under test got wrong. Applied only to the function-test query,
 * whose column list is a plain one — the documents query carries a
 * `jsonb_build_object` expression that a comma split would mangle.
 */
const projectFunctionTestRow = (sql: string, row: Record<string, unknown>) => {
  const columns = /SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(sql)?.[1] ?? '';
  const selected = new Set(
    columns
      .split(',')
      .map((part) => part.trim().split(/\s+/).pop() ?? '')
      .filter(Boolean),
  );
  return Object.fromEntries(Object.entries(row).filter(([column]) => selected.has(column)));
};

const serviceWithUnableTest = () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM patient_profiles')) {
      return { rowCount: 1, rows: [profileRow] };
    }
    if (sql.includes('FROM patient_function_tests')) {
      return { rowCount: 1, rows: [projectFunctionTestRow(sql, unableRow)] };
    }
    return { rowCount: 0, rows: [] };
  });
  const client = { query, release: vi.fn() };
  return new PatientProfileService({
    pool: { connect: async () => client, query } as never,
    logger: silentLogger as never,
  });
};

const profile = async () => {
  const dto = await serviceWithUnableTest().getProfileByUserId('user-1');
  if (!dto) throw new Error('fixture profile missing');
  return dto;
};

describe('「今天做不了」 survives getProfileByUserId', () => {
  it('is on the DTO the exports and the referral pack are built from', async () => {
    const dto = await profile();
    expect(dto.functionTests).toHaveLength(1);
    expect(dto.functionTests[0].notApplicable).toBe(true);
    expect(dto.functionTests[0].measuredValue).toBeNull();
  });

  it('reaches the referral pack as a printed row, not as an absence', async () => {
    const pack = buildReferralPack(await profile(), new Date('2026-06-10T12:00:00Z'));
    const series = pack.functionTests.find((entry) => entry.testType === 'stair_climb');
    expect(series?.points.map((point) => point.outcome)).toEqual(['unable']);
    expect(series?.hasUnableEntries).toBe(true);
    // The whole section collapsed to this line when the row was
    // filtered out — a patient's only function-test record read as
    // 「没做过」 to the neurologist reading the page.
    expect(pack.markdown).not.toContain('本平台没有功能测试记录');
    expect(pack.markdown).toContain('上楼梯计时');
  });

  it('raises the 「这几项我最近做不了了」 question', async () => {
    const pack = buildReferralPack(await profile(), new Date('2026-06-10T12:00:00Z'));
    expect(pack.questions.map((question) => question.id)).toContain('unable-tests');
  });

  it('is a dataAbsentReason in FHIR, not 「未记录测量值」', async () => {
    const bundle = buildFhirExport(
      normaliseSource(await profile(), {
        includeLocalOnly: false,
        generatedAt: '2026-06-10T12:00:00.000Z',
      }),
    );
    const observation = bundle.document.entry
      .map((entry) => entry.resource)
      .find((resource) => resource.resourceType === 'Observation');
    expect((observation?.dataAbsentReason as { text: string }).text).toContain('不是未测');
    expect(JSON.stringify(observation)).not.toContain('未记录测量值');
  });

  it('is what TREAT-NMD promises when it says notApplicable is preserved', async () => {
    const document = buildTreatNmdExport(
      normaliseSource(await profile(), {
        includeLocalOnly: false,
        generatedAt: '2026-06-10T12:00:00.000Z',
      }),
    ).document;
    const motor = document.sections.find((section) => section.key === 'motorFunction');
    const tests = motor?.items.find((item) => item.key === 'motor.functionTests')?.value;
    expect((tests as Array<{ notApplicable: boolean }>)[0].notApplicable).toBe(true);
  });
});
