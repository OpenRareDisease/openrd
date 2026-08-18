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
