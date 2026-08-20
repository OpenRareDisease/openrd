/**
 * 我的随访计划 —— 「本平台没有」这句话，说的必须是本平台真的没有。
 *
 * 这个文件补的是 lib/surveillance-schedule.ts 里同一个形状的四处缺陷：
 * 某一行只读一个栏位，读不到就告诉患者本平台手上什么都没有 —— 而那个
 * 值就存在另一个键下面，而且这个 app 在别的页面上正把它印给同一个人看。
 *
 * 为什么不并进 screens/p-surveillance/__tests__/surveillance-schedule.test.ts：
 * 那个文件归写这个屏幕的那条 lane 管（见它自己的文件头），这些断言测的是
 * lib 里的函数，所以放在 lib 的测试目录下。
 */

// 同 surveillance-schedule.test.ts：anesthesia-card 会经 api.ts 拉到
// session-storage，而它在 jest 下没有原生模块。
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import type { ClinicalPassportSummary, PatientProfile } from '../api';
import { buildSurveillanceSchedule } from '../surveillance-schedule';

/** 用本地分量构造，免得在非 UTC 的机器上把生日挪掉一天 —— 和
 *  surveillance-schedule.test.ts 的 TODAY 同一个写法、同一个时刻。 */
const TODAY = new Date(2026, 7, 5, 12, 0, 0);

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

const profile = (over: Record<string, unknown> = {}) =>
  ({
    dateOfBirth: null,
    followupEvents: [],
    symptomScores: [],
    medications: [],
    ...over,
  }) as unknown as PatientProfile;

const row = (id: string, patient: PatientProfile | null) => {
  const found = buildSurveillanceSchedule(summary(), patient, TODAY)
    .groups.flatMap((group) => group.rows)
    .find((entry) => entry.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

/**
 * 出生年份是这个平台真正握着的东西：注册表单把它写进
 * `baseline.foundation.birthYear`，管理员在 p-admin 的「出生年份」栏里也能
 * 写它，而「档案」页 (p-archive `formatAgeLabel`) 优先用它印「N 岁左右」。
 * 这一行以前只读 `profile.dateOfBirth`，于是同一个 app 上一屏刚把患者的
 * 年龄印给他看，下一屏就说「档案里没有可用的出生日期」。
 */
describe('听力筛查这一行读得到平台真正握着的出生年份', () => {
  const withBirthYear = (birthYear: number) =>
    row('hearing_child', profile({ baseline: { foundation: { birthYear } } }));

  it('只有年份也能判定「不适用」—— 1988 年生的今年 37 或 38 岁，两种算法都过了线', () => {
    const hearing = withBirthYear(1988);

    expect(hearing.applicability).toBe('not_matched');
    expect(hearing.evidence).toContain('1988 年');
    expect(hearing.evidence).not.toContain('没有可用的出生日期');
  });

  it('只有年份也能判定「对得上」—— 2020 年生的今年 5 或 6 岁，两种算法都在线内', () => {
    const hearing = withBirthYear(2020);

    expect(hearing.applicability).toBe('matched');
    expect(hearing.evidence).toContain('5 岁或 6 岁');
    // 指南的界线是「直到上学」，这句在能判定的时候必须还在。
    expect(hearing.evidence).toContain('上学');
  });

  /**
   * 只有年份不够用的那一年，说的是「年份不够」，不是「没有日期」。
   * 2019 年生的今年是 6 岁还是 7 岁，取决于生日过没过 —— 而 7 周岁正是
   * 这一行的界线。
   */
  it('年份正好跨在界线上时说明为什么判断不了，而不是否认这条记录', () => {
    const hearing = withBirthYear(2019);

    expect(hearing.applicability).toBe('unknown');
    expect(hearing.evidence).toContain('2019 年');
    expect(hearing.evidence).toContain('6 岁或 7 岁');
    expect(hearing.evidence).not.toContain('没有可用的出生日期');
  });

  it('出生日期优先于出生年份', () => {
    const hearing = row(
      'hearing_child',
      profile({ dateOfBirth: '2019-12-01', baseline: { foundation: { birthYear: 2019 } } }),
    );

    // 有具体日期就不再是「跨在界线上」——12 月生日今年还没过，6 岁。
    expect(hearing.applicability).toBe('matched');
    expect(hearing.evidence).toContain('按档案里的出生日期');
  });

  it('当年出生的孩子只有一个岁数，不会写成「-1 岁或 0 岁」', () => {
    const hearing = withBirthYear(2026);

    expect(hearing.applicability).toBe('matched');
    expect(hearing.evidence).toContain('0 岁');
    expect(hearing.evidence).not.toContain('-1');
  });

  it.each([2030, 1200, 0])('不能用来算年龄的年份 %i 走「判断不了」', (birthYear) => {
    expect(withBirthYear(birthYear).applicability).toBe('unknown');
  });

  /** 两个栏位都空的时候，这句话说的是「没有能用来算年龄的」——
   *  未来日期这种「填了但用不了」的情况也落在这里，所以不能断言栏位是空的。 */
  it('两个栏位都没有可用值时才说判断不了，而且不宣称栏位是空的', () => {
    const nothing = row('hearing_child', profile({}));
    expect(nothing.applicability).toBe('unknown');
    expect(nothing.evidence).toContain('没有能用来算年龄的');

    const futureDob = row('hearing_child', profile({ dateOfBirth: '2031-04-01' }));
    expect(futureDob.applicability).toBe('unknown');
    expect(futureDob.evidence).not.toContain('档案里既没有出生日期');
  });

  it('每一条不覆盖读者的分支都仍然告诉他家里的小孩适用', () => {
    [withBirthYear(1988), withBirthYear(2019), row('hearing_child', profile({}))].forEach(
      (hearing) => {
        expect(hearing.evidence).toContain('小孩');
      },
    );
  });
});

/**
 * 轮椅：随访事件是一个栏位，基础问卷的「辅具」是另一个。
 * 「轮椅」是 ASSISTIVE_DEVICE_OPTIONS 里的一项，患者勾了它，这个 app 就在
 * 「疾病背景」卡的「辅具」一栏把它印回给他看。
 */
describe('肺功能复查这一行两个轮椅栏位都读', () => {
  it('辅具里填了轮椅就算对得上，并且说出是从哪一栏读到的', () => {
    const repeat = row(
      'pulmonary_repeat',
      profile({ baseline: { currentStatus: { assistiveDevices: ['AFO', '轮椅'] } } }),
    );

    expect(repeat.applicability).toBe('matched');
    expect(repeat.evidence).toContain('辅具');
    expect(repeat.evidence).toContain('轮椅');
    // 「依赖」是医生的判断，这一行不替他下。
    expect(repeat.evidence).toContain('要医生看过才算');
  });

  /** 列表是 wire 上的自由字符串，「电动轮椅」也是轮椅。 */
  it('「电动轮椅」照样读得出来，并且按患者自己写的字引用', () => {
    const repeat = row(
      'pulmonary_repeat',
      profile({ baseline: { currentStatus: { assistiveDevices: ['电动轮椅'] } } }),
    );

    expect(repeat.applicability).toBe('matched');
    expect(repeat.evidence).toContain('电动轮椅');
  });

  it('两个栏位都没有轮椅时，判断不了的那句话把两个栏位都点名', () => {
    const repeat = row(
      'pulmonary_repeat',
      profile({ baseline: { currentStatus: { assistiveDevices: ['AFO'] } } }),
    );

    expect(repeat.applicability).toBe('unknown');
    expect(repeat.evidence).toContain('随访事件');
    expect(repeat.evidence).toContain('辅具');
  });
});

/**
 * 疼痛：随访评分是一个栏位，基础问卷的 currentChallenges.pain（0–5）是另一个
 * —— 这个 app 在「疾病背景」卡上把它印成「疼痛 4/5」。
 */
describe('疼痛这一行不否认基础档案里的那个数', () => {
  it('基础档案填过疼痛时不再说「本平台没有你的疼痛记录」', () => {
    const pain = row('pain_management', profile({ baseline: { currentChallenges: { pain: 4 } } }));

    expect(pain.evidence).toContain('4/5');
    expect(pain.evidence).not.toContain('本平台没有你的疼痛记录');
    // 但它是建档时填的一次性答案，不拿来给这一行打分。
    expect(pain.applicability).toBe('everyone');
  });

  it('填 0 也是填过 —— 一样要说出来', () => {
    expect(
      row('pain_management', profile({ baseline: { currentChallenges: { pain: 0 } } })).evidence,
    ).toContain('0/5');
  });

  it('两个栏位都没有时才说本平台没有疼痛记录', () => {
    expect(row('pain_management', profile({})).evidence).toContain('本平台没有你的疼痛记录');
  });
});

/**
 * 夜间通气：这一行的兜底句以前以「白天特别困、早上起来头痛、夜里反复醒
 * —— 这些只有你自己知道」收尾，说给一个在本平台答过「有气短或睡眠呼吸
 * 问题」、并且在「疾病背景」卡上看得到自己这个答案的患者听。
 */
describe('夜间通气这一行读得到基础档案里的呼吸回答', () => {
  it('答过「有」就算对得上，并且说清那是建档时的回答', () => {
    const referral = row(
      'sleep_referral',
      profile({ baseline: { currentStatus: { breathingSymptoms: true } } }),
    );

    expect(referral.applicability).toBe('matched');
    expect(referral.evidence).toContain('气短或睡眠呼吸问题');
    expect(referral.evidence).toContain('建档时');
    expect(referral.evidence).not.toContain('只有你自己知道');
  });

  /** 建档时答「没有」不是对今晚的判断，也不能被读成「你没事」。 */
  it('答过「没有」不算对得上，也不会被写成一句安慰', () => {
    const referral = row(
      'sleep_referral',
      profile({ baseline: { currentStatus: { breathingSymptoms: false } } }),
    );

    expect(referral.applicability).toBe('unknown');
    expect(referral.evidence).not.toContain('没有呼吸问题');
  });
});

/**
 * 同一个形状的第五处：肺功能复查这一行判断不了的时候，最后一句是
 * 「也就是说，这一栏的「对不上」只代表这里没有数据」—— 说给一个上传过
 * 肺功能报告、而且在这一页往上数两条就看得到自己 FVC 的患者听。
 *
 * 「基线结果异常」是这条指南列出的第一个条件，这个平台手上正好有那份
 * 结果；它判断不了的是那个数够不够指南说的那条线，那是医生读报告的事，
 * 不是「这里没有数据」。
 */
describe('肺功能复查这一行不否认档案里的肺功能结果', () => {
  const withRespiratory = (state: 'present' | 'absent') =>
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
          state === 'present'
            ? {
                key: 'respiratory',
                available: true,
                state: 'present',
                summary: 'FVC 58%',
                latestDate: '2026-03-02',
              }
            : {
                key: 'respiratory',
                available: false,
                state: 'absent',
                summary: '—',
                latestDate: null,
              },
          { key: 'cardiac', available: false, state: 'absent', summary: '—', latestDate: null },
        ],
      },
    }) as unknown as ClinicalPassportSummary;

  const repeatRow = (state: 'present' | 'absent') => {
    const found = buildSurveillanceSchedule(withRespiratory(state), profile({}), TODAY)
      .groups.flatMap((group) => group.rows)
      .find((entry) => entry.id === 'pulmonary_repeat');
    if (!found) throw new Error('no pulmonary_repeat row');
    return found;
  };

  it('有可读的肺功能结果时不说「只代表这里没有数据」', () => {
    const repeat = repeatRow('present');

    expect(repeat.applicability).toBe('unknown');
    expect(repeat.evidence).not.toContain('只代表这里没有数据');
    expect(repeat.evidence).toContain('肺功能结果本平台是有的');
    // 判不判得上那条线仍然是医生的事，这一页不替他读那个数。
    expect(repeat.evidence).toContain('报告原件');
  });

  it('真的没有肺功能结果时那句话还在，两个轮椅栏位也照样点名', () => {
    const repeat = repeatRow('absent');

    expect(repeat.applicability).toBe('unknown');
    expect(repeat.evidence).toContain('只代表这里没有数据');
    expect(repeat.evidence).toContain('随访事件');
    expect(repeat.evidence).toContain('辅具');
    expect(repeat.evidence).toContain('脊柱侧弯');
  });
});
