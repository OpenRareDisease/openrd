import { buildDataAssetOverview, collectProfileGaps } from '../data-asset';
import type { PatientProfile } from '../api';

const NOW = new Date('2026-07-15T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const baseProfile = (overrides: Partial<PatientProfile> = {}): PatientProfile =>
  ({
    id: 'p1',
    fullName: '张三',
    dateOfBirth: '1990-01-01',
    gender: 'male',
    regionProvince: '浙江省',
    diagnosisDate: '2020-05-01',
    geneticMutation: 'D4Z4 缩短',
    baseline: null,
    documents: [],
    functionTests: [],
    activityLogs: [],
    followupEvents: [],
    symptomScores: [],
    updatedAt: iso(10),
    ...overrides,
  }) as unknown as PatientProfile;

const doc = (daysAgo: number) =>
  ({
    id: `doc-${daysAgo}`,
    uploadedAt: iso(daysAgo),
  }) as unknown as PatientProfile['documents'][number];

const test = (daysAgo: number) =>
  ({ performedAt: iso(daysAgo) }) as unknown as PatientProfile['functionTests'][number];

describe('collectProfileGaps', () => {
  it('a filled profile with data has zero gaps', () => {
    const profile = baseProfile({ documents: [doc(30)], functionTests: [test(3)] });
    expect(collectProfileGaps(profile)).toEqual([]);
  });

  it('flags basic demographics as kind=basic (shared with the home card)', () => {
    const profile = baseProfile({ dateOfBirth: null, gender: null, regionProvince: null });
    const basics = collectProfileGaps(profile).filter((g) => g.kind === 'basic');
    expect(basics.map((g) => g.label)).toEqual(['出生日期', '性别', '所在地区']);
    expect(basics.every((g) => g.route === '/p-register_profile')).toBe(true);
  });

  it('diagnosis/genetics fall back to baseline payload fields', () => {
    const viaBaseline = baseProfile({
      diagnosisDate: null,
      geneticMutation: null,
      baseline: {
        diseaseBackground: { diagnosisType: 'FSHD1', d4z4: '4 units' },
      } as PatientProfile['baseline'],
    });
    const keys = collectProfileGaps(viaBaseline).map((g) => g.key);
    expect(keys).not.toContain('diagnosis');
    expect(keys).not.toContain('genetics');
  });

  it('missing reports and records point at data entry', () => {
    const gaps = collectProfileGaps(baseProfile());
    const byKey = Object.fromEntries(gaps.map((g) => [g.key, g]));
    expect(byKey.firstReport.route).toBe('/p-data_entry');
    expect(byKey.firstRecord.route).toBe('/p-data_entry');
  });
});

describe('buildDataAssetOverview', () => {
  it('computes completeness from the 7-item checklist', () => {
    const empty = baseProfile({
      dateOfBirth: null,
      gender: null,
      regionProvince: null,
      diagnosisDate: null,
      geneticMutation: null,
    });
    expect(buildDataAssetOverview(empty, NOW).completenessPercent).toBe(0);

    const full = baseProfile({ documents: [doc(30)], functionTests: [test(3)] });
    expect(buildDataAssetOverview(full, NOW).completenessPercent).toBe(100);

    const partial = baseProfile({ documents: [doc(30)] }); // only firstRecord missing
    expect(buildDataAssetOverview(partial, NOW).completenessPercent).toBe(86);
  });

  it('coverage: recent report → ok; old report → warn with age; none → warn invite', () => {
    const recent = buildDataAssetOverview(baseProfile({ documents: [doc(30)] }), NOW);
    expect(recent.coverage.tone).toBe('ok');
    expect(recent.coverage.label).toContain('1 份报告');

    const old = buildDataAssetOverview(baseProfile({ documents: [doc(300)] }), NOW);
    expect(old.coverage.tone).toBe('warn');
    expect(old.coverage.label).toContain('10 个月前');

    const none = buildDataAssetOverview(baseProfile(), NOW);
    expect(none.coverage.tone).toBe('warn');
    expect(none.coverage.label).toContain('还没有检查报告');
  });

  it('continuity counts distinct weeks with records in the last 8 weeks', () => {
    const spread = baseProfile({
      functionTests: [test(1), test(2), test(15), test(30)], // weeks 0,0,2,4 → 3 weeks
      activityLogs: [],
      followupEvents: [],
    });
    const result = buildDataAssetOverview(spread, NOW).continuity;
    expect(result.label).toContain('3 周有记录');
    expect(result.tone).toBe('warn'); // 3 < 4

    const dense = baseProfile({
      functionTests: [test(1), test(8), test(15), test(22)], // 4 distinct weeks
    });
    expect(buildDataAssetOverview(dense, NOW).continuity.tone).toBe('ok');
  });

  it('continuity: records exist but all outside the window → explicit break warning', () => {
    const stale = baseProfile({ functionTests: [test(90)] });
    const result = buildDataAssetOverview(stale, NOW).continuity;
    expect(result.tone).toBe('warn');
    expect(result.label).toContain('趋势正在断档');
  });

  it('continuity merges activity logs and followup events as records', () => {
    const viaLogs = baseProfile({
      activityLogs: [{ logDate: iso(2) } as unknown as PatientProfile['activityLogs'][number]],
      followupEvents: [
        { occurredAt: iso(10) } as unknown as PatientProfile['followupEvents'][number],
      ],
    });
    const result = buildDataAssetOverview(viaLogs, NOW).continuity;
    expect(result.label).toContain('2 周有记录');
  });

  it('freshness warns after 12 months without profile updates', () => {
    const fresh = buildDataAssetOverview(baseProfile({ updatedAt: iso(100) }), NOW);
    expect(fresh.freshness.tone).toBe('ok');

    const stale = buildDataAssetOverview(baseProfile({ updatedAt: iso(400) }), NOW);
    expect(stale.freshness.tone).toBe('warn');
    expect(stale.freshness.label).toContain('13 个月未更新');
  });
});
