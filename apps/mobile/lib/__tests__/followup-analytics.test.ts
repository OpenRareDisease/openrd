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
const withDailyRecord = (profile: PatientProfile, date: string, submissionId: string) => {
  const at = `${date}T09:00:00.000Z`;
  profile.symptomScores.push({
    id: `sleep-${submissionId}`,
    symptomKey: 'sleep_quality',
    score: 7,
    scaleMin: 0,
    scaleMax: 10,
    recordedAt: at,
    submissionId,
  });
  profile.functionTests.push({
    id: `stair-${submissionId}`,
    testType: 'stair_climb',
    measuredValue: 12,
    performedAt: at,
    submissionId,
  });
  return profile;
};

const fallCard = (profile: PatientProfile) => {
  const card = buildPatientVisualizationCards(profile).find((item) => item.key === 'fall_count');
  if (!card) {
    throw new Error('fall_count card missing');
  }
  return card;
};

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
    expect(card.summary).toContain('连续 3 次');
    expect(card.points.map((point) => point.value)).toEqual([0, 0, 0]);
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
    expect(card.summary).toContain('比上次更少');
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
