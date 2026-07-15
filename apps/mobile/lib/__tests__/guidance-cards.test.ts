import { buildGuidanceCards } from '../guidance-cards';
import type { PatientProfile } from '../api';

const NOW = new Date('2026-07-15T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

const baseProfile = (overrides: Partial<PatientProfile> = {}): PatientProfile =>
  ({
    id: 'p1',
    fullName: '张三',
    dateOfBirth: '1990-01-01',
    gender: 'male',
    regionProvince: '浙江省',
    documents: [],
    functionTests: [],
    symptomScores: [],
    followupEvents: [],
    ...overrides,
  }) as unknown as PatientProfile;

const doc = (status: string, aiSummary?: string) =>
  ({
    id: `doc-${status}`,
    status,
    ocrPayload: aiSummary ? { fields: { aiSummary } } : { fields: {} },
  }) as unknown as PatientProfile['documents'][number];

const test = (daysAgo: number) =>
  ({
    performedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  }) as unknown as PatientProfile['functionTests'][number];

describe('buildGuidanceCards', () => {
  it('null profile → single first-steps card', () => {
    const cards = buildGuidanceCards(null, NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe('first-steps');
  });

  it('uninterpreted parsed reports rank first and deep-link to the first one', () => {
    const profile = baseProfile({
      documents: [doc('parsed'), doc('needs_review')],
      functionTests: [test(1)],
    });
    const cards = buildGuidanceCards(profile, NOW);
    expect(cards[0].key).toBe('interpret-report');
    expect(cards[0].title).toContain('2 份');
    expect(cards[0].params?.documentId).toBe('doc-parsed');
  });

  it('reports with a summary or still processing do NOT count as uninterpreted', () => {
    const profile = baseProfile({
      documents: [doc('parsed', '已有解读'), doc('processing')],
      functionTests: [test(1)],
    });
    const cards = buildGuidanceCards(profile, NOW);
    expect(cards.find((c) => c.key === 'interpret-report')).toBeUndefined();
  });

  it('stale followups (≥7 days) nudge with the actual day count', () => {
    const profile = baseProfile({ documents: [doc('parsed', 'ok')], functionTests: [test(9)] });
    const cards = buildGuidanceCards(profile, NOW);
    const stale = cards.find((c) => c.key === 'stale-followup');
    expect(stale?.title).toContain('9 天');
  });

  it('fresh followups (<7 days) do not nudge', () => {
    const profile = baseProfile({ documents: [doc('parsed', 'ok')], functionTests: [test(3)] });
    expect(
      buildGuidanceCards(profile, NOW).find((c) => c.key === 'stale-followup'),
    ).toBeUndefined();
  });

  it('no followups at all → first-followup card', () => {
    const profile = baseProfile({ documents: [doc('parsed', 'ok')] });
    expect(buildGuidanceCards(profile, NOW)[0].key).toBe('first-followup');
  });

  it('missing profile basics list exactly the absent fields', () => {
    const profile = baseProfile({
      dateOfBirth: null as never,
      gender: null as never,
      functionTests: [test(1)],
      documents: [doc('parsed', 'ok')],
    });
    const card = buildGuidanceCards(profile, NOW).find((c) => c.key === 'complete-profile');
    expect(card?.description).toContain('出生日期');
    expect(card?.description).toContain('性别');
    expect(card?.description).not.toContain('所在地区');
  });

  it('caps at 2 cards even when everything fires', () => {
    const profile = baseProfile({
      dateOfBirth: null as never,
      gender: null as never,
      regionProvince: null as never,
      documents: [doc('parsed')],
      functionTests: [],
    });
    expect(buildGuidanceCards(profile, NOW)).toHaveLength(2);
  });

  it('fully healthy state → zero cards (guide, not nag)', () => {
    const profile = baseProfile({
      documents: [doc('parsed', 'ok')],
      functionTests: [test(2)],
    });
    expect(buildGuidanceCards(profile, NOW)).toHaveLength(0);
  });
});
