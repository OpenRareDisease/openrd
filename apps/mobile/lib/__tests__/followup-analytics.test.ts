import type { PatientFunctionTest, PatientProfile } from '../api';
import { PRODUCT_TIME_ZONE } from '../clinical-visuals';
import { buildPatientVisualizationCards, buildProgressionTimeline } from '../followup-analytics';
import { encodeProtocolField } from '../timed-test-protocols';

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

/** The `protocol` p-data_entry stamps on the daily record's stair row.
 *  Not decoration in these fixtures: it is what tells this file the
 *  submission came from the form that asks 跌倒次数. */
const DAILY_STAIR_PROTOCOL = '连续上 10 级台阶';

/** `not_applicable` is served on every function test but is not on
 *  `PatientFunctionTest` yet, so the fixtures carry it the same way the
 *  module reads it. */
type StairRow = PatientFunctionTest & { notApplicable?: boolean };

/**
 * One completed daily record, exactly what p-data_entry writes: a
 * stair-climb row under a submission, and a sleep score UNLESS the
 * patient marked 睡眠：本次未评价 (`sleep: null`), in which case the
 * form posts no sleep row at all.
 */
const withDailyRecord = (
  profile: PatientProfile,
  date: string,
  submissionId: string,
  values: { at?: string; sleep?: number | null; stair?: number | null } = {},
) => {
  const at = values.at ?? `${date}T09:00:00.000Z`;
  const sleep = values.sleep === undefined ? 7 : values.sleep;
  if (sleep !== null) {
    profile.symptomScores.push({
      id: `sleep-${submissionId}`,
      symptomKey: 'sleep_quality',
      score: sleep,
      scaleMin: 0,
      scaleMax: 10,
      recordedAt: at,
      submissionId,
    });
  }
  const stair = values.stair === undefined ? 12 : values.stair;
  const row: StairRow = {
    id: `stair-${submissionId}`,
    testType: 'stair_climb',
    measuredValue: stair,
    unit: stair === null ? null : 'sec',
    protocol: DAILY_STAIR_PROTOCOL,
    // 「今天做不了」: a record with no seconds, never a blank day.
    notApplicable: stair === null,
    performedAt: at,
    submissionId,
  };
  profile.functionTests.push(row);
  return profile;
};

/** A 四级台阶上下 record from the timed-test card. Same `testType`,
 *  different measurement. */
const withTimedStairTest = (
  profile: PatientProfile,
  id: string,
  at: string,
  seconds: number,
  grade: 'per_protocol' | 'partial' | 'free',
) => {
  profile.functionTests.push({
    id,
    testType: 'stair_climb',
    measuredValue: seconds,
    unit: 'sec',
    protocol: encodeProtocolField('stair_four_step', grade),
    performedAt: at,
    submissionId: `timed-${id}`,
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
const stairCard = (profile: PatientProfile) => cardFor(profile, 'stair_climb');

/**
 * 日界线 —— 这个产品的日历是 Asia/Shanghai，图表 x 轴用的就是它
 * (lib/clinical-visuals `formatDateLabel`)。分桶却按 UTC 切，等于把一天
 * 切在北京时间早上 8 点：一个北京早晨的两次提交被算成两天。
 */
describe('日界线按 Asia/Shanghai 切，不按设备时区、也不按 UTC', () => {
  it('这个文件用的偏移量和 clinical-visuals 声明的产品日历是同一个', () => {
    expect(PRODUCT_TIME_ZONE).toBe('Asia/Shanghai');
  });

  /** 北京时间 7 月 2 日 00:30（练习）和 09:00（正式）—— 一个北京日，
   *  但分属两个 UTC 日。 */
  const oneBeijingMorning = () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-02', 'sub-practice', {
      at: '2026-07-01T16:30:00.000Z',
      sleep: 8,
      stair: 30,
    });
    profile = withDailyRecord(profile, '2026-07-02', 'sub-real', {
      at: '2026-07-02T01:00:00.000Z',
      sleep: 2,
      stair: 12,
    });
    return profile;
  };

  it('早饭前后各提交一次，是同一天的一个桶，不是「比上次更慢」', () => {
    const stair = stairCard(oneBeijingMorning());

    expect(stair.points.map((point) => point.date)).toEqual(['2026-07-02']);
    expect(stair.latestValue).toBe(12);
    expect(stair.trend).toBe('new');
    expect(stair.summary).not.toContain('比上次');
  });

  it('睡眠同样只留当天最后一次读数', () => {
    const sleep = cardFor(oneBeijingMorning(), 'sleep_quality');

    expect(sleep.points.map((point) => point.date)).toEqual(['2026-07-02']);
    expect(sleep.latestValue).toBe(2);
    expect(sleep.summary).not.toContain('比上次');
  });

  it('一个北京日就是「1 天」，不会被算成连续 2 天', () => {
    const card = fallCard(oneBeijingMorning());

    expect(card.points).toHaveLength(1);
    expect(card.summary).toBe('最近一天的日常记录没有跌倒。');
  });

  it('答案和手机所在时区无关', () => {
    // 这两个时刻的 UTC 日期本来就不一样 —— 正是 `toISOString().slice(0, 10)`
    // 会把一个北京早晨劈成两天的地方。
    expect(new Date('2026-07-01T16:30:00.000Z').toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(new Date('2026-07-02T01:00:00.000Z').toISOString().slice(0, 10)).toBe('2026-07-02');

    const dates = () => stairCard(oneBeijingMorning()).points.map((point) => point.date);
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      expect(dates()).toEqual(['2026-07-02']);
      process.env.TZ = 'Pacific/Auckland';
      expect(dates()).toEqual(['2026-07-02']);
    } finally {
      process.env.TZ = original;
    }
  });

  it('深夜提交的跌倒事件跟着它那份记录走，不落到前一天', () => {
    let profile = emptyProfile();
    // 北京 7 月 2 日 00:30 提交；写入端的 occurredAt 用的是设备 UTC 日期，
    // 也就是 7 月 1 日。
    profile = withDailyRecord(profile, '2026-07-02', 'sub-late', {
      at: '2026-07-01T16:30:00.000Z',
      stair: 20,
    });
    profile.followupEvents.push({
      id: 'event-late',
      eventType: 'fall',
      occurredAt: '2026-07-01',
      description: '最近跌倒 2 次',
      submissionId: 'sub-late',
    });

    const card = fallCard(profile);

    // 一天，不是「7 月 1 日跌了 2 次 + 7 月 2 日 0 次」两天。
    expect(card.points.map((point) => [point.date, point.value])).toEqual([['2026-07-02', 2]]);
    expect(card.summary).toContain('一共跌倒 2 次');
  });

  it('独立事件表单里患者自己选的日期照原样用', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1', { at: '2026-07-01T01:00:00.000Z' });
    profile.followupEvents.push({
      id: 'event-standalone',
      eventType: 'fall',
      occurredAt: '2026-06-20',
      description: '最近跌倒 1 次',
      submissionId: 'submission-event-form',
    });

    const card = fallCard(profile);

    expect(card.points.map((point) => [point.date, point.value])).toEqual([
      ['2026-06-20', 1],
      ['2026-07-01', 0],
    ]);
  });
});

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
    const card = stairCard(twiceInOneDay());

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
    const stair = stairCard(profile);

    expect(stair.previousValue).toBe(12);
    expect(stair.latestValue).toBe(20);
    expect(stair.trend).toBe('worse');
    expect(stair.summary).toContain('比上次更慢');
  });

  it('同一天里先做不了、后来做到了，当天算做到了', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-am', {
      at: '2026-07-01T02:00:00.000Z',
      stair: null,
    });
    profile = withDailyRecord(profile, '2026-07-01', 'sub-pm', {
      at: '2026-07-01T09:00:00.000Z',
      stair: 18,
    });

    const card = stairCard(profile);

    expect(card.latestValue).toBe(18);
    expect(card.points.map((point) => point.value)).toEqual([18]);
  });

  it('同一天里先做到了、后来做不了，当天算做不了', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-am', {
      at: '2026-07-01T02:00:00.000Z',
      stair: 18,
    });
    profile = withDailyRecord(profile, '2026-07-01', 'sub-pm', {
      at: '2026-07-01T09:00:00.000Z',
      stair: null,
    });

    const card = stairCard(profile);

    expect(card.latestValue).toBeNull();
    expect(card.latestDisplay).toBe('无法完成');
    expect(card.points).toHaveLength(0);
  });
});

/**
 * 「今天做不了」是一条记录。
 *
 * 写这条记录的界面对患者说：「已记录“今天上不了 10 级台阶”。这是一条数据，
 * 不是空白——趋势里看得到。」 这张卡以前按 `measuredValue !== null` 过滤，
 * 把每一条都扔掉了。
 */
describe('「今天做不了」必须出现在上楼计时卡上', () => {
  const threeUnableRecords = () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-10', 'sub-1', { stair: 12 });
    profile = withDailyRecord(profile, '2026-06-28', 'sub-2', { stair: null });
    profile = withDailyRecord(profile, '2026-06-29', 'sub-3', { stair: null });
    profile = withDailyRecord(profile, '2026-06-30', 'sub-4', { stair: null });
    return profile;
  };

  it('连续三次做不了之后，卡上不会还挂着三周前的 12.0 秒', () => {
    const card = stairCard(threeUnableRecords());

    expect(card.latestDisplay).toBe('无法完成');
    expect(card.latestValue).toBeNull();
    expect(card.summary).toContain('最近连续 3 天的记录都是「上不了 10 级台阶」');
    expect(card.summary).not.toContain('整体尚可');
    // 12.0 秒仍然说得出来 —— 但只作为「在这之前」的那一次。
    expect(card.summary).toContain('在这之前，最近一次有秒数的记录是 12.0 秒。');
    expect(card.trend).not.toBe('new');
  });

  it('第一次从能做变成做不了，是「加重」，不是「平稳」', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-10', 'sub-1', { stair: 12 });
    profile = withDailyRecord(profile, '2026-06-11', 'sub-2', { stair: null });

    const card = stairCard(profile);

    expect(card.trend).toBe('worse');
    expect(card.summary).toBe(
      '最近一次记录是「上不了 10 级台阶」，这是一条记录，不是空白。在这之前，最近一次有秒数的记录是 12.0 秒。',
    );
  });

  it('做不了之后又做到了，是「改善」，并且说得出上一次是做不了', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-10', 'sub-1', { stair: null });
    profile = withDailyRecord(profile, '2026-06-11', 'sub-2', { stair: 22 });

    const card = stairCard(profile);

    expect(card.trend).toBe('better');
    expect(card.summary).toContain('上一个有记录的日子是「上不了 10 级台阶」，这次做到了。');
  });

  it('从来没有过秒数时不会编一个出来', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-10', 'sub-1', { stair: null });

    const card = stairCard(profile);

    expect(card.summary).toContain('目前还没有过带秒数的记录。');
    expect(card.trend).toBe('new');
  });

  it('做不了的那天不会被画成 0 秒 —— 曲线上只有真的量出来的秒数', () => {
    const card = stairCard(threeUnableRecords());

    expect(card.points.map((point) => point.value)).toEqual([12]);
    expect(card.points.map((point) => point.value)).not.toContain(0);
  });

  it('做不了的记录在时间轴里读得出来，不是一句「已记录」', () => {
    const items = buildProgressionTimeline(threeUnableRecords());
    const unable = items.filter(
      (item) => item.tag === '功能测试' && item.timestamp >= '2026-06-28',
    );

    expect(unable).toHaveLength(3);
    unable.forEach((item) => {
      expect(item.description).toBe('本次记录为「做不了」');
    });
  });
});

/**
 * 上楼计时这张卡说的是「连续上 10 级台阶」，而 `stair_climb` 这个
 * testType 下面躺着两种测量：日常记录的 10 级台阶，和计时测试卡里的
 * 「四级台阶上下」（上四级再下来）。把两者画在一条线上，等于拿两把不同
 * 的尺子相减。
 */
describe('两种上楼测量不能画在同一条线上', () => {
  it('四级台阶的秒数不会冒充 10 级台阶的最近一次', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1', {
      at: '2026-07-01T01:00:00.000Z',
      stair: 12,
    });
    profile = withTimedStairTest(profile, 'tt-1', '2026-07-05T01:00:00.000Z', 25, 'free');

    const card = stairCard(profile);

    expect(card.latestValue).toBe(12);
    expect(card.summary).toContain('最近一次连续上 10 级台阶用时 12.0 秒');
    expect(card.summary).not.toContain('25.0');
    expect(card.points.map((point) => point.value)).toEqual([12]);
  });

  it('卡上会说四级台阶去哪了，而不是让它凭空消失', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1', { stair: 12 });
    profile = withTimedStairTest(profile, 'tt-1', '2026-07-05T01:00:00.000Z', 8.2, 'per_protocol');

    expect(stairCard(profile).helperText).toContain('「四级台阶上下」是另一项测试');
  });

  it('只做计时测试的患者也有趋势线，且只有「按方案完成」进线', () => {
    let profile = emptyProfile();
    profile = withTimedStairTest(profile, 'tt-1', '2026-07-01T01:00:00.000Z', 9.4, 'per_protocol');
    profile = withTimedStairTest(profile, 'tt-2', '2026-07-06T01:00:00.000Z', 11.8, 'per_protocol');
    // 条件不完整的这次最新，但画不进趋势线 —— 这正是评级选择器上的承诺。
    profile = withTimedStairTest(profile, 'tt-3', '2026-07-08T01:00:00.000Z', 40, 'partial');

    const card = stairCard(profile);

    expect(card.points.map((point) => point.value)).toEqual([9.4, 11.8]);
    expect(card.latestValue).toBe(11.8);
    expect(card.summary).toContain('最近一次四级台阶上下用时 11.8 秒');
    // 10 级台阶的档位（较轻松/尚可/偏慢/较慢）是给 10 级台阶定的，
    // 四级台阶上下是另一段距离，套上去就是编出来的阈值。
    expect(card.summary).not.toContain('整体');
    expect(card.helperText).toContain('按方案完成');
  });

  it('自由记录 / 条件不完整仍然「存下来、显示得出来」，在时间轴上带着评级', () => {
    let profile = emptyProfile();
    profile = withTimedStairTest(profile, 'tt-3', '2026-07-08T01:00:00.000Z', 40, 'partial');

    const item = buildProgressionTimeline(profile).find((entry) => entry.id === 'tt-3');

    expect(item?.title).toBe('四级台阶上下');
    expect(item?.description).toBe('40 sec（条件不完整，不进趋势线）');
  });

  it('日常记录的 10 级台阶在时间轴上不会被叫成四级台阶', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1', { stair: 12 });

    expect(buildProgressionTimeline(profile).find((item) => item.id === 'stair-sub-1')?.title).toBe(
      '上楼测试',
    );
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
    profile = withDailyRecord(profile, '2026-06-29', 'sub-1');
    profile = withDailyRecord(profile, '2026-06-30', 'sub-2');
    profile = withDailyRecord(profile, '2026-07-01', 'sub-3');

    const card = fallCard(profile);

    expect(card.latestValue).toBe(0);
    expect(card.latestDisplay).toBe('0 次');
    // 天，不是「次记录」：一个桶就是一天，同一天填两份也还是一个桶。
    // 这三天真的挨着，所以「连续」这个词是可以说的 —— 隔着的情况见下一条。
    expect(card.summary).toContain('连续 3 天');
    expect(card.points.map((point) => point.value)).toEqual([0, 0, 0]);
  });

  /**
   * 「连续 N 天」在中文里断言的是 N 个挨着的日历日，而桶只存在于患者
   * 记录过的那些天。这位患者去年 12 月、今年 3 月、今年 7 月各填了一次，
   * 卡片说的是「最近连续 3 天有日常记录，都没有跌倒」—— 和真的连着填了
   * 三天的患者一字不差。
   */
  it('隔了几个月的三次记录不是「连续 3 天」', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2025-12-01', 'sub-1');
    profile = withDailyRecord(profile, '2026-03-14', 'sub-2');
    profile = withDailyRecord(profile, '2026-07-02', 'sub-3');

    const card = fallCard(profile);

    expect(card.summary).not.toContain('连续');
    // 天数没有被丢掉 —— 三天就是三天，只是不连着。
    expect(card.summary).toBe('最近有日常记录的 3 天都没有跌倒 —— 这几天不是连着的。');
  });

  it('日历相邻的判断跨月、跨年、跨闰日都成立', () => {
    const runOf = (dates: string[]) => {
      let profile = emptyProfile();
      dates.forEach((date, index) => {
        profile = withDailyRecord(profile, date, `sub-${index}`);
      });
      return fallCard(profile).summary;
    };

    expect(runOf(['2026-02-28', '2026-03-01'])).toContain('连续 2 天');
    expect(runOf(['2024-02-28', '2024-02-29', '2024-03-01'])).toContain('连续 3 天');
    expect(runOf(['2025-12-31', '2026-01-01'])).toContain('连续 2 天');
    // 差一天就断
    expect(runOf(['2026-07-01', '2026-07-03'])).not.toContain('连续');
  });

  /** 连续段只算到断点为止，前面那条不进「连续」的计数，但也不会让
   *  「连续」这个词消失。 */
  it('只有末尾真正连着的那一段算「连续」', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2025-11-02', 'sub-0');
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1');
    profile = withDailyRecord(profile, '2026-07-02', 'sub-2');

    expect(fallCard(profile).summary).toBe('最近连续 2 天有日常记录，都没有跌倒。');
  });

  /**
   * 睡眠可以不评价，跌倒问题照样问了。
   *
   * 表单在患者选「睡眠：本次未评价」时不写 sleep_quality 行 —— 0-10 的量表
   * 没有「未评价」这个值，写一个没人选过的 6 分比不写更糟。这张卡以前拿
   * 「同一次提交里既有睡眠又有上楼」当作「今天问过跌倒」的证据，于是这位
   * 患者刚填完记录，卡上却说他还没有记录。
   */
  it('counts a daily record whose patient declined to rate sleep', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1', { sleep: null, stair: 14 });

    const card = fallCard(profile);

    expect(card.latestValue).toBe(0);
    expect(card.latestDisplay).toBe('0 次');
    expect(card.summary).toBe('最近一天的日常记录没有跌倒。');
  });

  it('counts a daily record whose stair answer was 今天做不了', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-01', 'sub-1', { sleep: null, stair: null });

    expect(fallCard(profile).latestValue).toBe(0);
  });

  it('同一天填两份日常记录，说的是「天」而不是「次记录」', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-30', 'sub-1', {
      at: '2026-06-30T02:00:00.000Z',
    });
    profile = withDailyRecord(profile, '2026-06-30', 'sub-2', {
      at: '2026-06-30T14:00:00.000Z',
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
    // Clinic-side entry: a stair row with no daily-record protocol on it
    // means nobody was ever asked about falls that day.
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

  it('does not invent a zero from a timed 四级台阶 test, which never asks about falls', () => {
    let profile = emptyProfile();
    profile = withTimedStairTest(profile, 'tt-1', '2026-07-01T01:00:00.000Z', 9.4, 'per_protocol');

    expect(fallCard(profile).latestValue).toBeNull();
  });
});

/**
 * 跌倒次数只能来自「写下来的次数」。
 *
 * 日常记录写的是一个模板 —— p-data_entry 的 `handleFollowupSubmit` 用
 * 「最近跌倒次数」那个计数器拼出 `最近跌倒 N 次`。独立的「事件」表单不
 * 一样：它把患者在「发生了什么」里敲的原话原样发上来，而「跌倒」正是它
 * 的事件类型之一。旧代码取描述里出现的第一个数字，取不到就拿 severity
 * 当次数 —— 于是时间、日期、台阶序号、受伤处数都成了跌倒次数。
 */
describe('跌倒次数不从自由文本里抠数字', () => {
  const withFallEvent = (description: string | null, severity: 'mild' | 'moderate' | 'severe') => {
    const profile = emptyProfile();
    profile.followupEvents.push({
      id: `fall-${description ?? 'null'}`,
      eventType: 'fall',
      severity,
      occurredAt: '2026-06-10',
      description,
    });
    return fallCard(profile);
  };

  it.each([
    ['早上 7 点在浴室滑倒', '一个时间'],
    ['2026年5月3日在楼梯上摔了', '一个日期'],
    ['下楼时第 3 级台阶踩空', '一个台阶序号'],
    ['摔了一下，膝盖擦伤 1 处', '一处伤'],
    ['0 点多起夜的时候摔了', '一个 0 —— 最危险的那个'],
  ])('「%s」里的数字不是次数（%s）', (description) => {
    const card = withFallEvent(description, 'moderate');

    // 这条事件记录的是一次跌倒，就按一次算。
    expect(card.latestValue).toBe(1);
    expect(card.summary).toContain('一共跌倒 1 次');
  });

  /**
   * 「0 点多起夜的时候摔了」以前被读成 0 次，于是这一天混进了「都没有跌
   * 倒」的连续段 —— 患者刚报告了一次跌倒，卡片却告诉他这段时间没摔过。
   */
  it('描述里的 0 不会把报告了跌倒的那天变成「没有跌倒」', () => {
    const card = withFallEvent('0 点多起夜的时候摔了', 'mild');

    expect(card.latestValue).not.toBe(0);
    expect(card.summary).not.toContain('没有跌倒');
  });

  /** severity 说的是这一跤有多重，不是摔了几次。旧代码在描述里找不到
   *  数字时就拿它当次数：severe→3、moderate→2、mild→1。 */
  it.each(['severe' as const, 'moderate' as const, 'mild' as const])(
    'severity=%s 不再被当成次数',
    (severity) => {
      expect(withFallEvent('这周没有摔，只是差点', severity).latestValue).toBe(1);
      expect(withFallEvent(null, severity).latestValue).toBe(1);
    },
  );

  it('日常记录写的模板照样读得出来', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-02', 'sub-1');
    profile.followupEvents.push({
      id: 'fall-1',
      eventType: 'fall',
      severity: 'moderate',
      occurredAt: '2026-07-02',
      submissionId: 'sub-1',
      description: '最近跌倒 2 次',
    });

    expect(fallCard(profile).latestValue).toBe(2);
  });

  /** 中文实验室/表单文本不带空格，模板两种写法都要认。 */
  it('模板里的空格可有可无', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-07-02', 'sub-1');
    profile.followupEvents.push({
      id: 'fall-1',
      eventType: 'fall',
      severity: 'mild',
      occurredAt: '2026-07-02',
      submissionId: 'sub-1',
      description: '最近跌倒2次',
    });

    expect(fallCard(profile).latestValue).toBe(2);
  });

  /** 模板必须是整条描述。患者在事件表单里顺手写下这几个字不算模板，
   *  但也不会因此被丢掉 —— 它仍然是一次跌倒。 */
  it('模板前后多了别的话就不再是模板', () => {
    expect(withFallEvent('昨天最近跌倒 5 次，今天好些了', 'mild').latestValue).toBe(1);
  });
});

/**
 * 「连续 N 天」在上楼计时这张卡上尤其要命：它的全部意义就是「能做 →
 * 做不了」这个转折，而桶只存在于患者记录过的日子。相隔七个月的两次
 * 「做不了」被读成连续两天，等于把一个慢性过程画成一次急性丧失。
 */
describe('上楼计时的「连续 N 天」也要按日历算', () => {
  it('相隔七个月的两次做不了不是「连续 2 天」', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2025-12-05', 'sub-1', { stair: 14 });
    profile = withDailyRecord(profile, '2026-01-20', 'sub-2', { stair: null });
    profile = withDailyRecord(profile, '2026-07-02', 'sub-3', { stair: null });

    const card = stairCard(profile);

    expect(card.summary).not.toContain('连续');
    expect(card.summary).toBe(
      '最近有记录的 2 天都是「上不了 10 级台阶」 —— 这几天不是连着的。在这之前，最近一次有秒数的记录是 14.0 秒。',
    );
  });

  it('真的连着两天做不了，才说得上「连续 2 天」', () => {
    let profile = emptyProfile();
    profile = withDailyRecord(profile, '2026-06-30', 'sub-1', { stair: 14 });
    profile = withDailyRecord(profile, '2026-07-01', 'sub-2', { stair: null });
    profile = withDailyRecord(profile, '2026-07-02', 'sub-3', { stair: null });

    expect(stairCard(profile).summary).toContain('最近连续 2 天的记录都是「上不了 10 级台阶」');
  });
});

/**
 * 「待量化」这个状态存在的意义，就是「本平台已经知道你上楼有困难，只是
 * 还没有秒数」。它以前只看 `dailyImpacts`，而基础问卷把同一件事写进
 * `baseline.currentChallenges.stairs` —— 这个文件自己在「疾病背景」卡上
 * 把它印成「上下楼 4/5」。
 */
describe('上楼困难填在哪个栏位都算数', () => {
  const stairsBaseline = (stairs: number) => {
    const profile = emptyProfile();
    profile.baseline = { currentChallenges: { stairs } };
    return stairCard(profile);
  };

  it('基础档案里的「上下楼 4/5」让卡片说「待量化」而不是「未记录」', () => {
    const card = stairsBaseline(4);

    expect(card.latestDisplay).toBe('待量化');
    expect(card.summary).toBe('已记录上楼变化，但还没有“连续上 10 级台阶”的标准化秒数。');
  });

  it('填 0 是「没困难」，不是「已记录上楼变化」', () => {
    expect(stairsBaseline(0).latestDisplay).toBe('未记录');
  });

  it('日常记录里的 0 也一样不算', () => {
    const profile = emptyProfile();
    profile.dailyImpacts.push({
      id: 'impact-0',
      adlKey: 'stairs',
      difficultyLevel: 0,
      recordedAt: '2026-06-01T00:00:00.000Z',
    });

    expect(stairCard(profile).latestDisplay).toBe('未记录');
  });
});
