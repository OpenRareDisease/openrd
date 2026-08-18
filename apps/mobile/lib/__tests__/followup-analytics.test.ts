import type { PatientProfile } from '../api';
import { buildPatientVisualizationCards } from '../followup-analytics';

const emptyProfile = (): PatientProfile => ({
  id: 'profile-1',
  fullName: null,
  measurements: [],
  functionTests: [],
  symptomScores: [],
  dailyImpacts: [],
  followupEvents: [],
  activityLogs: [],
  documents: [],
  updatedAt: '2026-07-01T00:00:00.000Z',
});

/** One completed daily record: sleep score + stair test under a single
 *  submission, exactly what p-data_entry writes. */
const withDailyRecord = (
  profile: PatientProfile,
  date: string,
  submissionId: string,
  values: { at?: string; sleep?: number; stair?: number } = {},
) => {
  const at = values.at ?? `${date}T09:00:00.000Z`;
  profile.symptomScores.push({
    id: `sleep-${submissionId}`,
    symptomKey: 'sleep_quality',
    score: values.sleep ?? 7,
    scaleMin: 0,
    scaleMax: 10,
    recordedAt: at,
    submissionId,
  });
  profile.functionTests.push({
    id: `stair-${submissionId}`,
    testType: 'stair_climb',
    measuredValue: values.stair ?? 12,
    performedAt: at,
    submissionId,
  });
  return profile;
};

const cardFor = (profile: PatientProfile, key: string) => {
  const card = buildPatientVisualizationCards(profile).find((item) => item.key === key);
  if (!card) {
    throw new Error(`${key} card missing`);
  }
  return card;
};

const fallCard = (profile: PatientProfile) => cardFor(profile, 'fall_count');

/**
 * 同一天两次提交 —— 「练一次，再来正式的一次」。
 *
 * 上楼计时在门诊里就是这么做的：先试一次再测一次，AI 检索器自己的注释
 * (apps/api ai-agents/retrievers/patient-followups.ts) 写明了这一点，并且
 * 因此拒绝把同一天的两行读成趋势。这些卡片曾经把两行取平均，再在前面写
 * 「最近一次」—— 患者看到的是一个自己从来没记过的数。
 */
describe('同一天记了两次时，「最近一次」必须是真的发生过的那一次', () => {
  const twiceInOneDay = () => {
    let profile = emptyProfile();
    // 上午的练习：30 秒、睡眠 8 分。
    profile = withDailyRecord(profile, '2026-07-01', 'sub-practice', {
      at: '2026-07-01T02:00:00.000Z',
      sleep: 8,
      stair: 30,
    });
    // 下午正式的那一次：12 秒、睡眠 2 分。
    profile = withDailyRecord(profile, '2026-07-01', 'sub-real', {
      at: '2026-07-01T14:00:00.000Z',
      sleep: 2,
      stair: 12,
    });
    return profile;
  };

  it('上楼计时取当天最后一次，不是 30 和 12 的平均 21.0 秒', () => {
    const card = cardFor(twiceInOneDay(), 'stair_climb');

    expect(card.latestValue).toBe(12);
    expect(card.latestDisplay).toBe('12.0 秒');
    expect(card.summary).toContain('12.0 秒');
    expect(card.summary).not.toContain('21.0');
    expect(card.points.map((point) => point.value)).toEqual([12]);
  });

  it('睡眠评分取当天最后一次，不是 8 和 2 的平均 5 分', () => {
    const card = cardFor(twiceInOneDay(), 'sleep_quality');

    expect(card.latestValue).toBe(2);
    expect(card.latestDisplay).toBe('2/10');
    // 2 分在日常记录里是「很差」，5 分是「一般」—— 平均把它抹成了另一档。
    expect(card.summary).toContain('很差');
    expect(card.points.map((point) => point.value)).toEqual([2]);
  });

  it('「比上次」比的也是两次真实读数，中间不掺平均值', () => {
    let profile = twiceInOneDay();
    profile = withDailyRecord(profile, '2026-07-02', 'sub-next', {
      at: '2026-07-02T02:00:00.000Z',
      sleep: 6,
      stair: 20,
    });
    const stair = cardFor(profile, 'stair_climb');

    expect(stair.previousValue).toBe(12);
    expect(stair.latestValue).toBe(20);
    expect(stair.trend).toBe('worse');
    expect(stair.summary).toContain('比上次更慢');
  });
});

describe('fall count card', () => {
  it('says 未记录 only when no daily record exists', () => {
    const card = fallCard(emptyProfile());

    expect(card.latestValue).toBeNull();
    expect(card.latestDisplay).toBe('未记录');
    expect(card.points).toHaveLength(0);
  });

  it('reads followups with no fall event as a real zero, not missing data', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-05-01', 'sub-1');
    profile = withDailyRecord(profile, '2026-06-01', 'sub-2');
    profile = withDailyRecord(profile, '2026-07-01', 'sub-3');

    const card = fallCard(profile);

    expect(card.latestValue).toBe(0);
    expect(card.latestDisplay).toBe('0 次');
    // 天，不是「次记录」：一个桶就是一天，同一天填两份也还是一个桶。
    expect(card.summary).toContain('连续 3 天');
    expect(card.points.map((point) => point.value)).toEqual([0, 0, 0]);
  });

  it('同一天填两份日常记录，说的是「天」而不是「次记录」', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-01', 'sub-1', {
      at: '2026-06-01T02:00:00.000Z',
    });
    profile = withDailyRecord(profile, '2026-06-01', 'sub-2', {
      at: '2026-06-01T14:00:00.000Z',
    });
    profile = withDailyRecord(profile, '2026-07-01', 'sub-3');

    const card = fallCard(profile);

    // 三份记录、两天。旧文案会说「连续 2 次日常记录」，而记录有三份。
    expect(card.points).toHaveLength(2);
    expect(card.summary).toContain('连续 2 天');
    expect(card.summary).not.toContain('次日常记录');
  });

  it('一天里的跌倒是当天合计，不冒充某一份记录上的数字', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1', {
      at: '2026-07-01T02:00:00.000Z',
    });
    profile = withDailyRecord(profile, '2026-07-01', 'sub-2', {
      at: '2026-07-01T14:00:00.000Z',
    });
    // 表单会拿上一条事件预填跌倒次数，所以同一天的第二份常常重复上报同
    // 一个答案。两份都写「最近跌倒 2 次」，桶里就是 4。
    profile.followupEvents.push(
      {
        id: 'event-1',
        eventType: 'fall',
        occurredAt: '2026-07-01T02:00:00.000Z',
        description: '最近跌倒 2 次',
        submissionId: 'sub-1',
      },
      {
        id: 'event-2',
        eventType: 'fall',
        occurredAt: '2026-07-01T14:00:00.000Z',
        description: '最近跌倒 2 次',
        submissionId: 'sub-2',
      },
    );

    const card = fallCard(profile);

    expect(card.latestValue).toBe(4);
    // 没有任何一份记录写着 4。文案只说这是「最近一天的记录里一共」。
    expect(card.summary).toContain('最近一天的记录里一共跌倒 4 次');
    expect(card.summary).not.toContain('最近一次记录');
  });

  it('counts a fall on top of the day it was recorded and calls the return to zero an improvement', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-01', 'sub-1');
    profile = withDailyRecord(profile, '2026-07-01', 'sub-2');
    profile.followupEvents.push({
      id: 'event-1',
      eventType: 'fall',
      occurredAt: '2026-06-01T09:00:00.000Z',
      description: '最近跌倒 2 次',
      submissionId: 'sub-1',
    });

    const card = fallCard(profile);

    expect(card.points.map((point) => point.value)).toEqual([2, 0]);
    expect(card.latestValue).toBe(0);
    expect(card.trend).toBe('better');
    // 「上次」在这张卡上是上一个有记录的日子，不是上一份记录 —— 桶按天分。
    expect(card.summary).toContain('比上一个有记录的日子更少');
  });

  it('does not invent a zero from a stair test that came without the daily record it belongs to', () => {
    const profile = emptyProfile();
    // Clinic-side entry: a stair test with no paired sleep score means
    // nobody was ever asked about falls that day.
    profile.functionTests.push({
      id: 'stair-orphan',
      testType: 'stair_climb',
      measuredValue: 14,
      performedAt: '2026-07-01T09:00:00.000Z',
      submissionId: 'sub-clinic',
    });

    const card = fallCard(profile);

    expect(card.latestValue).toBeNull();
    expect(card.latestDisplay).toBe('未记录');
  });
});
