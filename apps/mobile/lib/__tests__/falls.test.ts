import {
  createFallDraft,
  describeFallDay,
  describeFallDetails,
  describeSaveOutcome,
  describeUnlistedFalls,
  isoDateDaysAgo,
  localDaysAgo,
  parseLocalIsoDate,
  summarizeFallsForCourse,
  toCreateFallPayload,
  toLocalIsoDate,
  validateFallDate,
  type FallRecord,
  type FallsSummary,
} from '../falls';

/**
 * The falls diary's pure half.
 *
 * Grouped by the thing that would go wrong for a patient, not by
 * function name — every describe below is a sentence this app could
 * say to someone about their own body, and each test is the version of
 * it that would be untrue.
 */

const fall = (overrides: Partial<FallRecord> = {}): FallRecord => ({
  id: 'f1',
  occurredOn: '2026-08-01',
  daysAgo: 5,
  activity: null,
  location: null,
  handsFull: null,
  gotUpUnaided: null,
  injured: null,
  ...overrides,
});

/** Just the words, for the assertions that are about the words. */
const labelsOf = (record: FallRecord): string[] =>
  describeFallDetails(record).map((chip) => chip.label);

const summary = (overrides: Partial<FallsSummary> = {}): FallsSummary => ({
  total: 0,
  atCap: false,
  quarters: [],
  oldestDaysAgo: null,
  ...overrides,
});

const quarter = (index: number, count: number) => ({
  index,
  startDaysAgo: index * 90,
  endDaysAgo: (index + 1) * 90 - 1,
  count,
});

describe('「没填」 never renders as 「没有」', () => {
  it('a date-only fall produces no chips at all', () => {
    // The whole feature depends on this: every detail column is
    // optional so the record can be saved one-handed, so a blank is
    // an unanswered question and not a negative answer.
    expect(describeFallDetails(fall())).toEqual([]);
  });

  it('false and null are different words, not the same ternary', () => {
    expect(labelsOf(fall({ injured: false }))).toEqual(['没受伤']);
    expect(labelsOf(fall({ injured: null }))).toEqual([]);
    expect(labelsOf(fall({ handsFull: false }))).toEqual(['双手是空的']);
    expect(labelsOf(fall({ gotUpUnaided: false }))).toEqual(['需要人扶才起来']);
  });

  it('answered fields read in the order the entry is scanned', () => {
    expect(
      labelsOf(
        fall({
          location: 'outdoor',
          activity: 'stairs',
          handsFull: true,
          gotUpUnaided: false,
          injured: true,
        }),
      ),
    ).toEqual(['室外', '上下楼梯时', '双手拿着东西', '需要人扶才起来', '受了伤']);
  });

  it('「记不清」 is an answer and shows up as one', () => {
    // Distinct from a blank: the patient told us something.
    expect(labelsOf(fall({ activity: 'unknown' }))).toEqual(['记不清']);
  });

  it('两个问题都答「记不清」时，两块牌子分得清是哪一个问题', () => {
    // 「记不清」 is a real answer to both 在哪里 and 跌倒发生在, and the
    // two labels are the same five characters on purpose (they mirror
    // the API's). The screen renders one View per chip, so if the only
    // thing distinguishing them is that string, the two are React
    // siblings with one key.
    const chips = describeFallDetails(fall({ location: 'unknown', activity: 'unknown' }));
    expect(chips.map((chip) => chip.label)).toEqual(['记不清', '记不清']);
    expect(new Set(chips.map((chip) => chip.field)).size).toBe(chips.length);
  });
});

describe('no records is not no falls', () => {
  it('an empty diary says the blank is a blank', () => {
    const note = summarizeFallsForCourse(summary(), 180);
    expect(note.headline).toBe('还没有跌倒记录。');
    expect(note.caveat).toContain('不代表没有跌倒过');
    // The failure this pins: 「最近 180 天 0 次跌倒」, which is the app
    // telling a patient something about their body from an empty table.
    expect(note.headline).not.toMatch(/0 次/);
  });

  it('never claims the patient did not fill something in', () => {
    const note = summarizeFallsForCourse(summary(), 180);
    for (const text of [note.headline, note.caveat ?? '']) {
      expect(text).not.toMatch(/没有填写|忘了|应该/);
    }
  });
});

describe('a truncated list cannot be counted or compared', () => {
  it('atCap turns the total into a floor and drops the quarter number', () => {
    const note = summarizeFallsForCourse(
      summary({ total: 400, atCap: true, quarters: [quarter(0, 120), quarter(1, 280)] }),
      180,
    );
    expect(note.headline).toContain('至少记录到 400 次');
    expect(note.caveat).toContain('实际次数可能更多');
    // The oldest falls are the ones the server never read, so every
    // per-quarter number is biased toward「更频繁了」.
    expect(note.headline).not.toContain('120');
  });
});

describe('the count is one number, never a trend', () => {
  it('reports the most recent quarter and the window total, and no second bucket', () => {
    const note = summarizeFallsForCourse(
      summary({ total: 5, quarters: [quarter(0, 2), quarter(1, 3)], oldestDaysAgo: 140 }),
      180,
    );
    expect(note.headline).toBe('最近 90 天记录到 2 次跌倒，180 天内一共 5 次。');
    // A patient opening 病程 must not be shown 「2 次、3 次」 —— that is
    // a progression alert wearing a statistic.
    expect(note.headline).not.toContain('3 次');
  });

  it('says where the record starts rather than implying the quiet part was fall-free', () => {
    const note = summarizeFallsForCourse(
      summary({ total: 2, quarters: [quarter(0, 2)], oldestDaysAgo: 40 }),
      180,
    );
    expect(note.caveat).toBe('最早的一条记录在 40 天前，更早的时段没有记录，不能当作没有跌倒。');
  });

  it('drops the second clause when the whole window is one quarter', () => {
    const note = summarizeFallsForCourse(
      summary({ total: 2, quarters: [quarter(0, 2)], oldestDaysAgo: 12 }),
      180,
    );
    expect(note.headline).toBe('最近 90 天记录到 2 次跌倒。');
  });

  it('an empty recent quarter is stated as「没有新的记录」, not as a zero count', () => {
    const note = summarizeFallsForCourse(
      summary({ total: 3, quarters: [quarter(0, 0), quarter(1, 3)], oldestDaysAgo: 150 }),
      180,
    );
    expect(note.headline).toBe('最近 90 天没有新的跌倒记录；再往前，180 天内记录到 3 次。');
    expect(note.headline).not.toContain('记录到 0 次');
  });

  it('derives the quarter length from the server bucket, not from a local constant', () => {
    // If the API ever re-cuts its buckets, the sentence follows rather
    // than printing a 90 the count was not computed over.
    const note = summarizeFallsForCourse(
      summary({
        total: 1,
        quarters: [{ index: 0, startDaysAgo: 0, endDaysAgo: 29, count: 1 }],
        oldestDaysAgo: 4,
      }),
      180,
    );
    expect(note.headline).toContain('最近 30 天');
  });
});

describe('falls the list cannot show', () => {
  it('says how many exist beyond the diary entries', () => {
    // summary.total counts falls logged through the old followup-event
    // route too. Showing the shorter list as everything would tell a
    // patient their earlier falls are gone.
    expect(describeUnlistedFalls(summary({ total: 7 }), 4)).toBe(
      '还有 3 次跌倒是以前用别的方式记下的，只有日期，所以不在下面的列表里。',
    );
  });

  it('says nothing when the list is complete', () => {
    expect(describeUnlistedFalls(summary({ total: 4 }), 4)).toBeNull();
    expect(describeUnlistedFalls(summary({ total: 0 }), 0)).toBeNull();
  });

  it('a capped read is「或更多」, not an exact remainder', () => {
    expect(describeUnlistedFalls(summary({ total: 400, atCap: true }), 400)).toBeNull();
    expect(describeUnlistedFalls(summary({ total: 400, atCap: true }), 380)).toContain('或更多');
  });
});

describe('dates are the patient’s, not UTC’s', () => {
  it('today is the local calendar day even at 01:00 in UTC+8', () => {
    // `new Date().toISOString().slice(0,10)` returns the PREVIOUS day
    // for the first eight hours of every day in China, so a patient
    // tapping 今天 would file the fall as 昨天.
    const earlyMorning = new Date(2026, 7, 6, 1, 30);
    expect(toLocalIsoDate(earlyMorning)).toBe('2026-08-06');
    expect(createFallDraft(earlyMorning).occurredOn).toBe('2026-08-06');
  });

  it('昨天 and 前天 walk the local calendar, including across a month', () => {
    const firstOfMonth = new Date(2026, 7, 1, 9, 0);
    expect(isoDateDaysAgo(1, firstOfMonth)).toBe('2026-07-31');
    expect(isoDateDaysAgo(2, firstOfMonth)).toBe('2026-07-30');
  });

  it('refuses a day the calendar does not have', () => {
    // Date.parse rolls 2026-02-31 to March 3rd, which would file a
    // fall in the wrong month.
    expect(parseLocalIsoDate('2026-02-31')).toBeNull();
    expect(validateFallDate('2026-02-31', new Date(2026, 7, 6))).toContain('日历上没有这一天');
  });

  it('refuses a future date outright, which the server cannot', () => {
    // The API tolerates one day past its own clock because the
    // server's clock is not the patient's. Here we ARE the patient's
    // clock, and the failure this guard is for is a mistyped year.
    const now = new Date(2026, 7, 6, 12, 0);
    expect(validateFallDate('2026-08-07', now)).toContain('还没到');
    expect(validateFallDate('2028-08-06', now)).toContain('还没到');
    expect(validateFallDate('2026-08-06', now)).toBeNull();
    expect(validateFallDate('2020-01-01', now)).toBeNull();
  });

  it('names the format instead of just refusing', () => {
    expect(validateFallDate('8/6', new Date())).toContain('年-月-日');
    expect(validateFallDate('   ', new Date())).toContain('哪一天');
  });

  it('labels the day relative to the device, and falls back to the date', () => {
    const now = new Date(2026, 7, 6, 20, 0);
    expect(describeFallDay('2026-08-06', now)).toBe('今天');
    expect(describeFallDay('2026-08-05', now)).toBe('昨天');
    expect(describeFallDay('2026-08-04', now)).toBe('前天');
    expect(describeFallDay('2026-08-02', now)).toBe('4 天前');
    expect(describeFallDay('2026-06-01', now)).toBe('2026-06-01');
    expect(localDaysAgo('2026-08-04', now)).toBe(2);
  });
});

describe('a save that lands outside the window still says where it went', () => {
  it('warns when the entry is older than the diary looks back', () => {
    const now = new Date(2026, 7, 6);
    const outcome = describeSaveOutcome(fall({ occurredOn: '2024-01-01' }), 180, now);
    // Without this the patient types a date from two years ago, sees
    // 「已保存」, and then sees nothing in the list.
    expect(outcome).toContain('不会出现在里面');
    expect(outcome).toContain('病程时间线');
  });

  it('says only that it saved when the entry is inside the window', () => {
    const now = new Date(2026, 7, 6);
    expect(describeSaveOutcome(fall({ occurredOn: '2026-08-05' }), 180, now)).toBe(
      '已经记下 2026-08-05 这一次。',
    );
  });
});

describe('the request body', () => {
  it('carries the date alone when nothing else was answered', () => {
    // One tap has to be a valid save, and the body should say what
    // happened: the questions were not answered, so the keys are not
    // there.
    expect(toCreateFallPayload(createFallDraft(new Date(2026, 7, 6)))).toEqual({
      occurredOn: '2026-08-06',
    });
  });

  it('sends false — which is an answer — and omits null, which is not', () => {
    const draft = { ...createFallDraft(new Date(2026, 7, 6)), injured: false, handsFull: null };
    const payload = toCreateFallPayload(draft);
    expect(payload.injured).toBe(false);
    expect('handsFull' in payload).toBe(false);
  });
});
