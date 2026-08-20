/**
 * @jest-environment ./test-support/west-of-utc-environment.js
 */

/**
 * 我的随访计划里的年龄，按产品日历算，不跟着手机走。
 *
 * 这一页上每一个日期早就走 `formatProductDate` 了，只有听力筛查这一行
 * 例外：它把 `today` 原样交给 `ageInYears`（lib/guardian-consent），而那
 * 个函数用 `getFullYear`/`getMonth`/`getDate` 读它 —— 手机的日历。
 * surveillance-schedule.ts 里原来的注释把这条分歧写成「只有跨年那几个
 * 小时才可能不一样」，那是错的：`ageInYears` 比的不是年份，是「生日过了
 * 没有」，所以两个日历每天都会在北京时间零点到手机零点之间给出不同的
 * 那一天。
 *
 * 同一份护照、同一个时刻、同一个 2019-08-05 出生的孩子：在上海的手机上
 * 是 7 岁（这一条不适用），在洛杉矶的手机上是 6 岁（这一条对得上），整页
 * 的 matchedCount 也跟着从 4 变成 5。每年一次的听力筛查漏掉的是学语期，
 * 而家长拿到哪个答案取决于手机以为自己在哪儿。
 *
 * 为什么要 west-of-utc 环境而不是 `process.env.TZ`：见
 * test-support/west-of-utc-environment.js —— jest 的沙箱拿到的是
 * `process` 的副本，测试体跑起来的时候 V8 已经把时区缓存了。
 * 中国是 UTC+8，产品自己的时区永远看不到这半边。
 */

// 同 surveillance-birth-and-baseline.test.ts：anesthesia-card 会经 api.ts
// 拉到 session-storage，而它在 jest 下没有原生模块。
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import type { ClinicalPassportSummary, PatientProfile } from '../api';
import { buildSurveillanceSchedule } from '../surveillance-schedule';

const summary = () =>
  ({
    patientName: '张三',
    diagnosis: {
      confirmation: 'genetic',
      d4z4Repeats: '7',
      laboratoryRepeatCount: '7',
      valueOrigins: {},
    },
    monitoring: {
      items: [
        { key: 'respiratory', available: false, state: 'absent', summary: '—', latestDate: null },
        { key: 'cardiac', available: false, state: 'absent', summary: '—', latestDate: null },
      ],
    },
  }) as unknown as ClinicalPassportSummary;

const profile = (dateOfBirth: string | null) =>
  ({
    dateOfBirth,
    followupEvents: [],
    symptomScores: [],
    medications: [],
  }) as unknown as PatientProfile;

const hearingRow = (dateOfBirth: string | null, today: Date) => {
  const found = buildSurveillanceSchedule(summary(), profile(dateOfBirth), today)
    .groups.flatMap((group) => group.rows)
    .find((entry) => entry.id === 'hearing_child');
  if (!found) throw new Error('no hearing_child row');
  return found;
};

/**
 * 一个固定时刻 —— 不是本地分量。这一整个文件的意义就在于时刻是同一个而
 * 手机不是，用 `new Date(2026, 7, 5, ...)` 构造会让输入本身跟着运行机器
 * 的时区跑，那样两边永远一致，也就永远测不出这个 bug。
 *
 * 04:00Z 在上海是 8 月 5 日 12 点，在这里（洛杉矶）是 8 月 4 日 21 点。
 */
const INSTANT = new Date('2026-08-05T04:00:00.000Z');

describe('听力筛查这一行按产品日历算年龄', () => {
  it('生日当天的孩子在 UTC 以西也已经离开这一条 —— 上海已经是 8 月 5 日', () => {
    const hearing = hearingRow('2019-08-05', INSTANT);

    // 手机日历（8 月 4 日）会算成 6 岁并且判成 matched。
    expect(hearing.applicability).toBe('not_matched');
    expect(hearing.evidence).toContain('7 岁');
    expect(hearing.evidence).not.toContain('6 岁');
  });

  it('还差一天的孩子仍然对得上', () => {
    const hearing = hearingRow('2019-08-06', INSTANT);

    expect(hearing.applicability).toBe('matched');
    expect(hearing.evidence).toContain('6 岁');
  });

  /**
   * 北京时间零点两侧翻页，而这两个时刻在洛杉矶是同一天（8 月 4 日的
   * 08:59 和 09:00）—— 所以按手机日历算，两边都会是 6 岁 matched，
   * 这条断言只有在产品日历上才成立。方向和大小写错也过不去。
   */
  it('翻的是北京时间的零点，不是手机的零点', () => {
    const before = hearingRow('2019-08-05', new Date('2026-08-04T15:59:59.999Z'));
    const after = hearingRow('2019-08-05', new Date('2026-08-04T16:00:00.000Z'));

    expect(before.applicability).toBe('matched');
    expect(before.evidence).toContain('6 岁');
    expect(after.applicability).toBe('not_matched');
    expect(after.evidence).toContain('7 岁');
  });

  /** 一行判错会把整页的「其中 N 条对得上」也带偏。 */
  it('整页的 matchedCount 不跟着手机时区动', () => {
    const schedule = buildSurveillanceSchedule(summary(), profile('2019-08-05'), INSTANT);

    // 这份 fixture 里没有任何一条 matched：没有轮椅、没有睡眠评分、
    // 重复数 7 不在 1–4 内，孩子已经 7 岁。
    expect(schedule.matchedCount).toBe(0);
  });

  /** 只有出生年份的那条路本来就走产品日历，两条路不能再分开。 */
  it('只有出生年份时也是同一个日历', () => {
    const withYear = buildSurveillanceSchedule(
      summary(),
      {
        ...profile(null),
        baseline: { foundation: { birthYear: 2026 } },
      } as unknown as PatientProfile,
      INSTANT,
    )
      .groups.flatMap((group) => group.rows)
      .find((entry) => entry.id === 'hearing_child');

    expect(withYear?.evidence).toContain('2026 年');
    expect(withYear?.evidence).toContain('0 岁');
  });
});
