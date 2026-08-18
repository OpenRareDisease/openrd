/**
 * @jest-environment ./test-support/west-of-utc-environment.js
 */

/**
 * 一行记录，两台手机，必须是同一个答案。
 *
 * 「开始使用轮椅」/「开始无创通气」的 `occurred_at` 是 TIMESTAMPTZ：随访
 * 表单发上去的是患者自己敲的 「YYYY-MM-DD」，API 按 UTC 解析、存下、再用
 * `toISOString` 发回来，所以到了手机上它是一个「穿着时刻外衣的日历日」。
 * 用 `getFullYear`/`getMonth`/`getDate` 读它，格林尼治以西的机器会整体退
 * 一天：
 *
 *   - 只知道年份的 2019 年（存成 2019 年的第一毫秒）印成 2018-12-31
 *     —— 一个患者从没给过的日子，而且年份是错的；
 *   - 真的记到 2019-06-14 的那一条印成 2019-06-13。
 *
 * 中国是 UTC+8，产品自己的时区永远照不出这一类问题，所以这个文件跑在
 * UTC 以西（见 test-support/west-of-utc-environment.js）。断言的字符串和
 * surveillance-schedule.test.ts 里那一组一模一样：两边都过，才说明这一行
 * 的答案不取决于患者人在哪个时区。
 */

// The anesthesia card reads `readPassportValueOrigins` out of api.ts,
// which pulls in AsyncStorage through session-storage, and that has no
// native module under jest. Same stub the sibling suites use.
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import { buildSurveillanceSchedule } from '../../../lib/surveillance-schedule';
import type { ClinicalPassportSummary, PatientProfile } from '../../../lib/api';

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
    monitoring: { items: [] },
  }) as unknown as ClinicalPassportSummary;

const evidenceFor = (rowId: string, eventType: string, occurredAt: string) => {
  const profile = {
    dateOfBirth: '1990-04-01',
    followupEvents: [{ id: 'e1', eventType, occurredAt }],
    symptomScores: [],
    medications: [],
  } as unknown as PatientProfile;
  const found = buildSurveillanceSchedule(summary(), profile, TODAY)
    .groups.flatMap((group) => group.rows)
    .find((row) => row.id === rowId);
  if (!found) throw new Error(`no row ${rowId}`);
  return found.evidence;
};

describe('里程碑日期在 UTC 以西的手机上不能整体退一天', () => {
  // 环境要是哪天没生效，下面每一条断言都会退化成什么也没证明。
  it('这些用例确实跑在 UTC 以西', () => {
    expect(new Date('2019-01-01T00:00:00.000Z').getFullYear()).toBe(2018);
  });

  it('只知道年份的轮椅记录印「2019 年」，不是 2018-12-31', () => {
    const evidence = evidenceFor(
      'pulmonary_repeat',
      'started_wheelchair',
      '2019-01-01T00:00:00.000Z',
    );
    expect(evidence).toContain('（2019 年）');
    expect(evidence).not.toContain('2018');
    expect(evidence).not.toContain('12-31');
  });

  it('只知道年份的无创通气记录印「2021 年」，不是 2020-12-31', () => {
    const evidence = evidenceFor('sleep_referral', 'started_niv', '2021-01-01T00:00:00.000Z');
    expect(evidence).toContain('（2021 年）');
    expect(evidence).not.toContain('2020');
  });

  it('记到某一天的那一条，印的是患者填的那一天', () => {
    const evidence = evidenceFor(
      'pulmonary_repeat',
      'started_wheelchair',
      '2019-06-14T00:00:00.000Z',
    );
    expect(evidence).toContain('（2019-06-14）');
    expect(evidence).not.toContain('2019-06-13');
  });
});
