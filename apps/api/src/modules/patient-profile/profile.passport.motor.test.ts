import { describe, expect, it } from 'vitest';

import { buildClinicalPassportExport, buildClinicalPassportSummary } from './profile.passport.js';
import type { PatientProfileDTO } from './profile.service.js';

/**
 * 平均肌力 — the number, not the cells it is averaged from.
 *
 * `parseScore` reads an MMT cell OCR'd off an uploaded 体格检查 /
 * 肌力评估 report, and the resulting average is printed as this
 * patient's 平均肌力 on the passport tile, in the markdown export's
 * 运动功能 section, on the share page and in the referral pack's motor
 * row. A clinician reads it as a measurement.
 *
 * IT READ A RANGE AS A COUNT. The parser took the first number in the
 * cell and any following 「+」/「-」 as the MRC modifier, so an examiner's
 * 「三角肌4-5级」 — a refusal to choose between 4 and 5 — came out 3.7,
 * and 「3-4级」 came out 2.7: BELOW both bounds of the interval it was
 * read off. That is the same defect `parseD4Z4Reading` carries its bound
 * class for, one cell type over, and in the same direction — a number
 * nobody measured, printed as a measurement, and biased toward more
 * weakness than the examiner recorded.
 *
 * The cell itself is still printed verbatim in `motor.summary`. What a
 * range loses is its vote in the average.
 */

const base = (over: Partial<PatientProfileDTO> = {}): PatientProfileDTO =>
  ({
    id: 'p1',
    userId: 'u1',
    fullName: '测试',
    preferredName: null,
    dateOfBirth: '1990-01-01',
    gender: 'male',
    patientCode: 'P0001',
    diagnosisStage: null,
    diagnosisDate: null,
    geneticMutation: null,
    heightCm: null,
    weightKg: null,
    bloodType: null,
    contactPhone: null,
    contactEmail: null,
    primaryPhysician: null,
    regionProvince: null,
    regionCity: null,
    regionDistrict: null,
    baseline: null,
    notes: null,
    measurements: [],
    functionTests: [],
    symptomScores: [],
    dailyImpacts: [],
    followupEvents: [],
    activityLogs: [],
    documents: [],
    medications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as unknown as PatientProfileDTO;

const exam = (fields: Record<string, string>) => ({
  id: 'd-exam',
  documentType: 'physical_exam',
  title: null,
  fileName: 'exam.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  storageUri: 'local://exam',
  status: 'parsed',
  uploadedAt: '2026-02-01T00:00:00.000Z',
  checksum: null,
  submissionId: null,
  ocrPayload: { fields: { classifiedType: 'physical_exam', ...fields } },
});

const averageFor = (cell: string) =>
  buildClinicalPassportSummary(base({ documents: [exam({ deltoidStrength: cell })] } as never))
    .motor.average;

describe('MMT 单元格：区间不是计数', () => {
  it.each([
    ['4-5级', '连字符区间'],
    ['3-4级', '连字符区间，读出来比两端都低'],
    ['2~3级', '波浪区间'],
    ['2～3级', '全角波浪区间'],
    ['4 至 5 级', '中文区间'],
    ['3到4级', '中文区间'],
  ])('%s（%s）不产生平均值', (cell) => {
    expect(averageFor(cell)).toBe('—');
  });

  it('区间照常原样印在摘要里 —— 丢掉的是它在平均值里的一票', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [exam({ deltoidStrength: '4-5级' })] } as never),
    );
    expect(summary.motor.summary).toContain('4-5级');
    expect(summary.motor.average).toBe('—');
    // 有报告可看，这一栏就不是空的。
    expect(summary.motor.ready).toBe(true);
  });

  it('导出里也不出现那个没人测过的数', () => {
    const { markdown } = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({ documents: [exam({ deltoidStrength: '3-4级' })] } as never),
      ),
    );
    expect(markdown).toContain('- 平均肌力：— 级');
    expect(markdown).not.toContain('2.7');
  });
});

/**
 * 「4或5」 —— 检查者拒绝在两个等级之间选一个，只是没写破折号。
 *
 * 解析器上一轮已经学会了这一类：`_ALTERNATION_WORDS` 把 或/或者/、/和/与
 * 和区间分隔符并成 `_MRC_INDETERMINATE_JOIN`，「肌力4级或5级」 发布成
 * `mrc_score: "4或5"` 且 `mrc_numeric: None` / `normalized_value: None`,
 * 理由写得很清楚：不能被平均。
 *
 * 而这边照样平均了。桥只把印出来的那个字符串折到 `deltoid_strength`
 * 上（`formatAggregateStrength` 读的是 `item.mrc_score`），被拒绝的
 * 归一值挂在 observation 上、根本不过来；`parseScore` 在 「4或5」 里找不到
 * 分隔符，就读了头一个数字，把一个确定的 4.0 投进了 平均肌力 ——
 * 护照卡片、分享页、转诊资料、markdown 导出，四处都是。
 * 生产者拒绝掉的东西，被消费者又还原了回来。
 *
 * 下面这些单元格全是合成的，也正是 Python 侧
 * `AnAlternationIsAlsoARefusalToChooseTest` 覆盖的那几种写法。
 */
describe('MMT 单元格：并列也是一种「选不出来」', () => {
  it.each([
    // 解析器实际发布的形态：`_mrc_grade_cell` 会把 级 和空白全部去掉。
    ['4或5', '解析器发布的原样'],
    ['4或者5', '或者'],
    ['4、5', '顿号并列'],
    ['4和5', '和'],
    ['4与5', '与'],
    // 归档的、或者人工录入的单元格不受那道 strip 的约束，所以带 级 的
    // 写法也要认。
    ['4级或5级', '两个 级 都在'],
    ['4 或 5 级', '带空格'],
  ])('%s（%s）不产生平均值', (cell) => {
    expect(averageFor(cell)).toBe('—');
  });

  it('并列照常原样印在摘要里 —— 丢掉的还是那一票', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [exam({ deltoidStrength: '4或5' })] } as never),
    );
    expect(summary.motor.summary).toContain('4或5');
    expect(summary.motor.average).toBe('—');
    expect(summary.motor.ready).toBe(true);
  });

  it('导出里不出现被拒绝掉的那个数', () => {
    const { markdown } = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({ documents: [exam({ deltoidStrength: '4或5' })] } as never),
      ),
    );
    expect(markdown).toContain('- 平均肌力：— 级');
    expect(markdown).not.toContain('- 平均肌力：4.0 级');
  });

  it('一侧并列时，只丢掉它自己那一票', () => {
    // 跟区间那一侧同一条规则：另一侧那个没人有异议的等级照样计票。
    expect(averageFor('L4或5 / R3')).toBe('3.0');
    expect(averageFor('L4或5 / R3、4')).toBe('—');
  });

  /**
   * 和 / 与 先是「并且」，然后才是「或者」。
   *
   * 这正是 Python 侧 `_MRC_SECOND_GRADE` 存在的理由，规则也照抄过来：
   * 第二个数字后面跟的是不是 级，决定这一格到底是「选不出来」还是
   * 「一个等级挨着另一个量」。少了这一条，为了认下 和，就会把一个检查者
   * 明明写了的等级悄悄弄丢 —— 拿一个错的数换一个缺的数。
   */
  it.each([
    ['4级和5年前相比无变化', '4.0', '5 后面跟的是「年」，是病程不是等级'],
    ['4级、5岁起病', '4.0', '5 后面跟的是「岁」'],
    ['4级与5个月前一致', '4.0', '5 后面跟的是「个」'],
  ])('%s → %s（%s）', (cell, expected) => {
    expect(averageFor(cell)).toBe(expected);
  });
});

describe('MMT 单元格：MRC 的 ± 仍然是 ±', () => {
  it.each([
    ['4级', '4.0'],
    ['4+', '4.3'],
    ['4-', '3.7'],
    ['5-', '4.7'],
    ['0级', '0.0'],
    // 4 out of 5 —— 分数线不是区间号，这是最常见的单个等级写法。
    ['4/5', '4.0'],
  ])('%s → %s', (cell, expected) => {
    expect(averageFor(cell)).toBe(expected);
  });

  it('全角的 ＋ 和半角的 + 是同一个记号 —— 体检单是全角输入法打的', () => {
    expect(averageFor('4＋')).toBe(averageFor('4+'));
    expect(averageFor('4－')).toBe(averageFor('4-'));
  });
});

/**
 * 「L4 / R2」 —— 一格里两次测量。
 *
 * 这个字符串不是检查者写的记号，是本平台自己拼的：Python 侧的
 * `_format_strength` 和 TS 桥的 `formatAggregateStrength` 都把体格检查
 * 抽取器逐侧产出的 `mrc_score` 折成 `f"L{left} / R{right}"`，落到
 * `deltoid_strength` 和它的四个兄弟键上。
 *
 * `parseScore` 只取一格里第一个像等级的数，于是这一对塌成了左侧那一个
 * —— 右侧被无声丢掉，左侧被当成这块肌肉的肌力投进 平均肌力。FSHD 本来
 * 就是不对称的，两侧之间的差就是所见本身。
 */
describe('MMT 单元格：一格写了两侧时，两侧都要算', () => {
  it.each([
    ['L4 / R2', '3.0'],
    ['L2 / R4', '3.0'],
    ['L4+ / R3-', '3.5'],
    // 单侧照旧，一格一票。
    ['R2', '2.0'],
    ['L4', '4.0'],
  ])('%s → %s', (cell, expected) => {
    expect(averageFor(cell)).toBe(expected);
  });

  it('读错的方向由排版决定 —— 一位读得比实际强，下一位读得比实际弱', () => {
    // 同一个缺陷，两个患者，方向相反：塌成左侧之后 L4/R2 读作 4.0，
    // L2/R4 读作 2.0，而两者真实的平均都是 3.0。
    expect(averageFor('L4 / R2')).toBe(averageFor('L2 / R4'));
  });

  it('一侧是区间时，只丢掉它自己那一票，不连累另一侧', () => {
    // 区间检测原本扫的是整格，于是「L4-5 / R3」整格作废 —— 右侧那个没
    // 人有异议的 3 级也一起没了。
    expect(averageFor('L4-5 / R3')).toBe('3.0');
    // 两侧都是区间时，才真的没有数。
    expect(averageFor('L4-5 / R3-4')).toBe('—');
  });

  it('「4/5」不是两侧 —— 没有 L/R 就不拆', () => {
    // 4 out of 5，MMT 单个等级最常见的写法。斜杠本身不是侧别标记。
    expect(averageFor('4/5')).toBe('4.0');
  });

  it('多块肌肉时，一票一次测量 —— 跟 App 内录入用同一条规则', () => {
    // `buildClinicalPassportSummary` 对 App 内录入的评分是按 (肌群, 侧)
    // 平均的：左三角肌 2 和右三角肌 5 平均成 3.5，谁都不消失。报告读出
    // 来的等级是同一种东西，现在按同一种方式计票。
    const summary = buildClinicalPassportSummary(
      base({
        documents: [exam({ deltoidStrength: 'L4 / R2', bicepsStrength: 'L3 / R3' })],
      } as never),
    );
    expect(summary.motor.average).toBe('3.0');
  });

  it('两侧照常原样印在摘要里，分隔符也照原样', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [exam({ deltoidStrength: 'L4 / R2' })] } as never),
    );
    expect(summary.motor.summary).toContain('三角肌L4 / R2');
  });

  it('导出里印的是两侧算出来的那个数', () => {
    const { markdown } = buildClinicalPassportExport(
      buildClinicalPassportSummary(
        base({ documents: [exam({ deltoidStrength: 'L4 / R2' })] } as never),
      ),
    );
    expect(markdown).toContain('- 平均肌力：3.0 级');
    // 左侧那个数不再作为这块肌肉的肌力出现在这一行上。
    expect(markdown).not.toContain('- 平均肌力：4.0 级');
  });
});

describe('App 内录入的肌力不受影响', () => {
  const measurement = (score: number, muscleGroup: string) => ({
    id: `m-${muscleGroup}`,
    muscleGroup,
    metricKey: null,
    bodyRegion: null,
    side: 'left',
    strengthScore: score,
    method: null,
    entryMode: 'manual',
    deviceUsed: null,
    notes: null,
    recordedAt: '2026-03-01T00:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    submissionId: null,
  });

  it('结构化评分照常平均', () => {
    const summary = buildClinicalPassportSummary(
      base({ measurements: [measurement(2, 'deltoid'), measurement(5, 'biceps')] } as never),
    );
    expect(summary.motor.average).toBe('3.5');
  });
});
