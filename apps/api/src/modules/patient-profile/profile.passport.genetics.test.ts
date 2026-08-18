import { describe, expect, it } from 'vitest';

import { buildPassportSharePage } from './passport-share.html.js';
import {
  buildClinicalPassportExport,
  buildClinicalPassportSummary,
  isD4Z4GreyZone,
  parseD4Z4Reading,
} from './profile.passport.js';
import { baselineProfileSchema } from './profile.schema.js';
import type { PatientProfileDTO } from './profile.service.js';

/**
 * The genetic evidence grader.
 *
 * The one sentence this product exists to deliver to a Chinese FSHD
 * patient is that a negative whole-exome report is not a negative
 * answer — it is the wrong test. Giardina et al. 2024 (Clin Genet
 * 106(1):13-26) states it outright: the size and haplotype of the D4Z4
 * repeat array 「cannot be determined by short read WES- or WGS-like
 * technologies」. These tests pin the two halves of that: the grader
 * must SAY it when it can prove it, and must NEVER say it on a fuzzy
 * match — because the consequence of getting it backwards is telling
 * somebody their real Southern blot was inapplicable and sending them
 * to self-fund a second one.
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

const geneticReport = (fields: Record<string, string>) => ({
  id: 'd1',
  documentType: 'genetic_report',
  title: null,
  fileName: 'g.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  storageUri: 'local://g',
  status: 'parsed',
  uploadedAt: '2026-02-01T00:00:00.000Z',
  checksum: null,
  submissionId: null,
  // A ROW AS THE PIPELINE LEAVES IT, WHICH MEANS BOTH LABELS.
  //
  // `classifiedType` is what the parser decided. `documentType` inside
  // `fields` is what the UPLOADER declared: every OCR provider stamps
  // the argument it was called with into that cell before any
  // classification exists (`buildFields` in
  // apps/api/src/services/ocr/embedded-report-ocr.ts, and the same line
  // in mock-ocr.ts and baidu-ocr.ts), and nothing overwrites it — where
  // the column above IS overwritten, with the classification, by
  // `updateDocumentOcrResult`. So the two labels sit side by side and
  // can disagree, and `isLaboratoryGeneticReport` reads the second one
  // as the declaration.
  //
  // It is what separates this fixture from an archived 门诊病历摘要 the
  // old keyword classifier scored `genetic_report`: that row carries
  // `documentType: other` in the same blob, and is refused. Without the
  // cell the two shapes are byte-identical and a genuine report whose
  // page was not stored and whose 检测方法 the parser could not read —
  // which is most of them; see 「没读出检测方法时」 below, where 「未知」
  // is called the common case rather than an edge — grades as a
  // transcription. `geneticTestMethod` would ALSO separate them, and is
  // deliberately not used for it here: this file has tests whose whole
  // subject is a report with no method read, and stamping one on every
  // fixture would delete them.
  ocrPayload: {
    fields: { classifiedType: 'genetic_report', documentType: 'genetic_report', ...fields },
  },
});

const withLadder = (ladder: string) => ({ diseaseBackground: { diagnosisLadder: ladder } });

const evidence = (over: Partial<PatientProfileDTO> = {}) =>
  buildClinicalPassportSummary(base(over)).diagnosis.geneticEvidence;

describe('parseD4Z4Reading —— 报告怎么印的就怎么读', () => {
  it('单个整数给出 value，且不算范围', () => {
    expect(parseD4Z4Reading('3')).toEqual({ raw: '3', value: 3, isRange: false, unit: null });
  });

  it('带单位时把单位记下来，而不是替报告决定单位', () => {
    expect(parseD4Z4Reading('3个').unit).toBe('repeats');
    expect(parseD4Z4Reading('18kb').unit).toBe('kb');
    // 光秃秃的数字不猜 —— 重复单元和 kb 差 3.3 倍。
    expect(parseD4Z4Reading('3').unit).toBeNull();
  });

  it.each([
    ['1-10', '连字符范围'],
    ['≤10', '比较符'],
    ['4~7', '波浪范围'],
    ['1 至 10', '中文范围'],
    // 中文报告是用全角输入法打的，本仓库自己抄的那句指南也把界限写成
    //「若重复单元数大于 10」。半角类只认半角，于是「<10」被拒、它的全角
    // 双胞胎「＜10」却当成了「10 这个计数」—— 一格内容就是「这条臂没有
    // 收缩」的报告，读出来是基因确诊。
    ['＜10', '全角小于'],
    ['＞10', '全角大于'],
    ['≦10', '全角小于等于'],
    ['≧10', '全角大于等于'],
    ['⩽10', '另一种小于等于'],
    ['⩾10', '另一种大于等于'],
    ['～10', '全角波浪'],
    ['大于10', '中文大于'],
    ['大於10', '繁体大于'],
    ['小于4', '中文小于'],
    ['小於4', '繁体小于'],
    ['高于10', '中文高于'],
    ['低于4', '中文低于'],
    ['多于10', '中文多于'],
    ['少于4', '中文少于'],
    ['超过10', '中文超过'],
    ['不足4', '中文不足'],
    ['10以上', '中文以上'],
    ['4以下', '中文以下'],
    ['至少10', '中文至少'],
    ['最多4', '中文最多'],
  ])('%s（%s）isRange=true 且 value 为空', (raw) => {
    const reading = parseD4Z4Reading(raw);
    expect(reading.isRange).toBe(true);
    expect(reading.value).toBeNull();
  });

  it('一格界限的两种写法给出同一个判读 —— 半角被拒、全角当计数是最坏的方向', () => {
    for (const [halfWidth, fullWidth] of [
      ['<10', '＜10'],
      ['>10', '＞10'],
      ['≤10', '≦10'],
      ['≥10', '≧10'],
      ['<4', '小于4'],
      ['>10', '大于10'],
    ]) {
      expect(parseD4Z4Reading(fullWidth).value).toBe(parseD4Z4Reading(halfWidth).value);
      expect(parseD4Z4Reading(fullWidth).isRange).toBe(parseD4Z4Reading(halfWidth).isRange);
    }
  });

  it('读不出数字时 isRange 为 false —— 「给了区间」和「什么都没有」不是一回事', () => {
    expect(parseD4Z4Reading('未检出')).toEqual({
      raw: '未检出',
      value: null,
      isRange: false,
      unit: null,
    });
    expect(parseD4Z4Reading('')).toEqual({ raw: '', value: null, isRange: false, unit: null });
    expect(parseD4Z4Reading(null).value).toBeNull();
  });
});

describe('isLargeD4Z4Deletion 在改成解析器之后行为一字不变', () => {
  // 这张表和 apps/mobile/lib/surveillance-schedule.ts 里手抄的那一份是同一张。
  // 值从上传的基因报告里走一遍，再看渲染出来的待办：`ReportReadD4Z4` 既没有
  // 字符串构造器，也不再是 `record.d4z4` 本身 —— 那个字段是给显示用的，
  // 病历摘要抄来的读数也在里面。要证明的本来就是「基因报告上印成这样时，
  // 指南那一条到底出不出」，那就照它出现在页面上的样子问。
  const readsAsLargeDeletion = (raw: string) =>
    buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: raw })] } as never),
    ).nextSteps.some((step) => step.title === '问一次眼底检查');

  it.each([
    ['1-10'],
    ['≤10'],
    ['4~7'],
    ['1 至 10'],
    [''],
    ['—'],
    ['未检出'],
    ['0'],
    ['5'],
    // kb 是另一个单位、另一个界限：同一句指南把 kb 的界写成 10–20，
    // 「3kb」要落进 1–4 只能靠一次本仓库没写过的换算。
    ['3kb'],
    ['3 kb'],
    // 界限不是计数，全角和中文的写法也不是。AAN Level B 的散瞳眼底
    // 建议原本会被「＜4」挣到 —— 那一格里没有任何人量出来的数。
    ['＜4'],
    ['小于4'],
    ['4以下'],
    ['不足4'],
    ['≦4'],
  ])('%s 不触发', (raw) => {
    expect(readsAsLargeDeletion(raw)).toBe(false);
  });
  it.each([['1'], ['2'], ['3'], ['4'], ['3个']])('%s 触发', (raw) => {
    expect(readsAsLargeDeletion(raw)).toBe(true);
  });
});

describe('一格界限拿不到基因确诊 —— 全角和中文写法跟半角同判', () => {
  const surfaces = (raw: string) => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: raw, haplotype: '4qA' })] } as never),
    );
    return {
      grade: summary.diagnosis.geneticEvidence.grade,
      confirmation: summary.diagnosis.confirmation,
      laboratoryRepeatCount: summary.diagnosis.laboratoryRepeatCount,
      greyZone: summary.diagnosis.geneticEvidence.record.greyZone,
      // 报告原样印出来的那一格没有被吞掉 —— 拿走的只有 value。
      raw: summary.diagnosis.geneticEvidence.record.d4z4?.raw ?? null,
    };
  };

  it.each([['＞10'], ['大于10'], ['10以上'], ['≦10'], ['＜4'], ['小于4'], ['4以下'], ['超过10']])(
    '%s 既不是确诊，也进不了 8–10 灰区',
    (raw) => {
      expect(surfaces(raw)).toEqual({
        grade: 'method_right_incomplete',
        confirmation: 'none',
        laboratoryRepeatCount: null,
        greyZone: false,
        raw,
      });
    },
  );

  it('半角写法本来就是这个判读，全角只是补齐同一张表', () => {
    for (const [halfWidth, fullWidth] of [
      ['>10', '＞10'],
      ['<4', '小于4'],
      ['≤10', '≦10'],
    ]) {
      const half = surfaces(halfWidth);
      const full = surfaces(fullWidth);
      expect({ ...full, raw: null }).toEqual({ ...half, raw: null });
    }
  });
});

describe('8–10 单元灰区 [Giardina 2024]', () => {
  it.each([[8], [9], [10]])('%s 个单元在灰区', (n) => {
    expect(isD4Z4GreyZone(parseD4Z4Reading(String(n)))).toBe(true);
  });

  it('7 和 11 不在灰区', () => {
    expect(isD4Z4GreyZone(parseD4Z4Reading('7'))).toBe(false);
    expect(isD4Z4GreyZone(parseD4Z4Reading('11'))).toBe(false);
  });

  it('kb 不是重复单元 —— 8kb 的 EcoRI 片段不是临界值，是很重的缺失', () => {
    expect(isD4Z4GreyZone(parseD4Z4Reading('8kb'))).toBe(false);
  });

  it('范围不进灰区', () => {
    expect(isD4Z4GreyZone(parseD4Z4Reading('8-10'))).toBe(false);
    expect(isD4Z4GreyZone(null)).toBe(false);
  });

  it('灰区会给出一句「可能致病而不是致病」的说明，并进入待办', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: '9', haplotype: '4qA' })] } as never),
    );
    expect(summary.diagnosis.geneticEvidence.record.greyZone).toBe(true);
    expect(summary.diagnosis.geneticEvidence.greyZoneNote).toContain('可能致病');
    expect(summary.nextSteps.some((step) => step.title.includes('灰区'))).toBe(true);
  });

  it('不在灰区时不说灰区', () => {
    const e = evidence({
      documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qA' })],
    } as never);
    expect(e.greyZoneNote).toBeNull();
    expect(e.record.greyZone).toBe(false);
  });
});

describe('分级：可用于入组', () => {
  // 「齐了才算」 stood here, and 齐 is presence: a report reading D4Z4
  // 30 / 4qA has both items and is not FSHD1. What earns this grade is
  // what the two cells SAY, which is the matrix at the end of this file.
  it('长度说的是缩短、单倍型是允许型 4qA 时才算', () => {
    const e = evidence({
      documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qA' })],
    } as never);
    expect(e.grade).toBe('trial_ready');
    expect(e.gradeLabel).toBe('可用于入组');
  });

  it('齐了就不再给《检查申请说明》 —— 没有东西要跟诊所要了', () => {
    const e = evidence({
      documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qA' })],
    } as never);
    expect(e.testRequest).toBeNull();
  });

  it('不承诺入组资格，只说材料齐了', () => {
    const e = evidence({
      documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qA' })],
    } as never);
    expect(e.action).toContain('由该试验的研究者判断');
  });
});

describe('分级：方法对但结果不全 —— 这是最常见的一档', () => {
  it('只有重复数、没有 4qA/4qB', () => {
    const e = evidence({ documents: [geneticReport({ d4z4Repeats: '3' })] } as never);
    expect(e.grade).toBe('method_right_incomplete');
    expect(e.headline).toContain('4qA / 4qB 单倍型');
  });

  it('只有单倍型、没有长度', () => {
    const e = evidence({ documents: [geneticReport({ haplotype: '4qA' })] } as never);
    expect(e.grade).toBe('method_right_incomplete');
    expect(e.headline).toContain('D4Z4 重复单元数');
  });

  it('重复数是范围时不算「有长度」，但仍然是做过检测', () => {
    const e = evidence({ documents: [geneticReport({ d4z4Repeats: '1-10' })] } as never);
    expect(e.grade).toBe('method_right_incomplete');
    expect(e.record.d4z4?.isRange).toBe(true);
  });

  it('文案是鼓励不是训斥', () => {
    const e = evidence({ documents: [geneticReport({ d4z4Repeats: '3' })] } as never);
    expect(e.action).toContain('通常不需要重新采血');
  });

  /**
   * 「方法是对的」是在说报告上的检测方法那一格，而这一档最常见的情况恰恰
   * 是那一格没读出来 —— 本文件对这个字段没有任何按正文猜的兜底，所以
   * 「未知」是常态而不是边角。同一份产物上还会附着《为什么全外显子 / 全
   * 基因组测序读不到 FSHD》，那一节印出来的条件正是「方法不确定是能测长度
   * 的那几种」。两句话不能同时印在一张纸上。
   */
  it('没读出检测方法时，分级和标题都不说「方法是对的」', () => {
    const unknownMethod = evidence({
      documents: [geneticReport({ d4z4Repeats: '3' })],
    } as never);
    expect(unknownMethod.grade).toBe('method_right_incomplete');
    expect(unknownMethod.gradeLabel).toBe('结果不全');
    expect(unknownMethod.headline).not.toContain('方法是对的');
    expect(unknownMethod.reason).not.toContain('能测长度的方法');
    // 同一份产物上确实附着那一节 —— 这正是不能说「方法是对的」的原因。
    expect(unknownMethod.testRequest?.sections.map((section) => section.heading)).toContain(
      '为什么全外显子 / 全基因组测序读不到 FSHD',
    );

    const namedMethod = evidence({
      documents: [geneticReport({ d4z4Repeats: '3', geneticTestMethod: 'southern_blot' })],
    } as never);
    expect(namedMethod.gradeLabel).toBe('方法对，但结果不全');
    expect(namedMethod.headline).toContain('方法是对的');
    expect(namedMethod.testRequest?.sections.map((section) => section.heading)).not.toContain(
      '为什么全外显子 / 全基因组测序读不到 FSHD',
    );
  });

  /**
   * 方法不适用是要花钱的一句话：它等于告诉患者「你做的那次是错的检查」。
   * 报告上写着一个 D4Z4 长度的时候，不管方法那一格 OCR 成了什么，这一句
   * 都不发 —— kb 在这里不是被「判」了，是它挡下了一句本平台可能说错的话。
   */
  it('报告上有长度时，即使方法那一格写着短读长测序也不说「方法不适用」', () => {
    const e = evidence({
      documents: [
        geneticReport({ geneticTestMethod: 'short_read_sequencing', ecoRIFragment: '18kb' }),
      ],
    } as never);
    expect(e.grade).not.toBe('method_not_applicable');
    expect(e.reason).not.toContain('测不到 FSHD 的位点');
  });

  it('两项都没读出确定结果、方法也没读出来时，不替报告说它测了什么', () => {
    const e = evidence({ documents: [geneticReport({ d4z4Repeats: '1-10' })] } as never);
    expect(e.headline).toBe('这两项都还没有确定的结果');
    expect(e.reason).toContain('报告里也没有能明确认出检测方法的字样');
    expect(e.reason).not.toContain('报告用的是能测长度的方法');
  });

  it('会生成一条 clinical 待办，而不是让人再去传一次文件', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: '3' })] } as never),
    );
    const step = summary.nextSteps.find((item) => item.title.includes('缺的那一项'));
    expect(step?.kind).toBe('clinical');
  });
});

describe('分级：方法不适用 —— 只在明确匹配上才降级', () => {
  it('报告写明是短读长测序、且没有任何 D4Z4 结果', () => {
    const e = evidence({
      documents: [geneticReport({ geneticTestMethod: 'short_read_sequencing' })],
    } as never);
    expect(e.grade).toBe('method_not_applicable');
    expect(e.action).toContain('不能用来排除 FSHD');
  });

  it('同一份报告里如果真的有 D4Z4 结果，就不降级', () => {
    const e = evidence({
      documents: [geneticReport({ geneticTestMethod: 'short_read_sequencing', d4z4Repeats: '3' })],
    } as never);
    expect(e.grade).not.toBe('method_not_applicable');
  });

  /**
   * 0 不是「这份报告上有一个长度」。
   *
   * 挡下这一句的那个判断问的是「这一格有没有值」，而 0 是有值的 —— 于是
   * 一份写着短读长测序、D4Z4 那一格读到 0 的报告靠这个 0 免掉了这一档。
   * 本平台对 0 的判断恰恰相反：0 个重复单元不是 FSHD1 会有的等位基因，
   * 这一格更可能是没被读对 —— 而那正是短读长测序读这个位点时会出现的
   * 情形。以 kb 写的长度是另一回事：那是这次检测真的量出来的数，照旧
   * 挡得住（上面那一条）。
   */
  it('0 挡不下这一句 —— 但那个 0 仍然要在同一段里被说到', () => {
    const e = evidence({
      documents: [geneticReport({ geneticTestMethod: 'short_read_sequencing', d4z4Repeats: '0' })],
    } as never);
    expect(e.grade).toBe('method_not_applicable');
    // 那个 0 照旧印在页面上，所以这一段必须说到它 —— 否则读者看到的是
    // 一个数，和一句与它无关的结论。
    expect(e.reason).toContain('报告读到的 D4Z4 重复单元数是「0」，本平台读不通这个数');
    expect(e.reason).toContain('既不拿它当确诊依据，也不拿它当排除依据');
  });

  it('方法字段是 ambiguous 时落到未知，绝不降级', () => {
    const e = evidence({ documents: [geneticReport({ geneticTestMethod: 'ambiguous' })] } as never);
    expect(e.grade).toBe('unknown');
    expect(e.record.method).toBe('unknown');
  });

  it('报告正文里出现「全外显子」字样但解析器没写方法字段时，落到未知', () => {
    // 本文件不做文本猜测：WES 报告的局限性一节几乎一定提到 Southern blot，
    // 反过来也一样，全文关键词搜索会把两边都判反。
    const e = evidence({
      documents: [
        {
          ...geneticReport({}),
          ocrPayload: {
            fields: { classifiedType: 'genetic_report' },
            extractedText: '检测项目: 全外显子组测序(WES) 未检出明确致病变异',
          },
        },
      ],
    } as never);
    expect(e.grade).toBe('unknown');
  });

  it('降级时给的是 clinical 待办，不是「再传一份报告」', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ geneticTestMethod: 'short_read_sequencing' })] } as never),
    );
    const titles = summary.nextSteps.map((step) => step.title);
    expect(titles).toContain('这份报告用的方法测不到 FSHD');
    expect(titles).not.toContain('补充基因检测报告');
    expect(titles).not.toContain('补充基因或诊断依据');
  });
});

describe('分级：未检测与未知', () => {
  it('自述「还没测过」才说未检测', () => {
    expect(evidence({ baseline: withLadder('untested_wants_test') } as never).grade).toBe(
      'not_tested',
    );
    expect(evidence({ baseline: withLadder('untested_no_plan') } as never).grade).toBe(
      'not_tested',
    );
    expect(evidence({ baseline: withLadder('clinical_only') } as never).grade).toBe('not_tested');
  });

  it('自述「已确诊但报告不在手上」不等于没测过 —— 我们不知道用的什么方法', () => {
    expect(evidence({ baseline: withLadder('confirmed_report_unavailable') } as never).grade).toBe(
      'unknown',
    );
  });

  it('什么都没有时是未知，不是未检测', () => {
    expect(evidence().grade).toBe('unknown');
  });

  it('未知这一档仍然把 WES 那句话说出来，只是作为条件而非断言', () => {
    const e = evidence();
    expect(e.action).toContain('如果你手上的报告写的是');
    expect(e.action).toContain('全外显子测序');
  });

  it('报告证据压过自述 —— 说了没测过但上传了 Southern blot，按报告算', () => {
    const e = evidence({
      baseline: withLadder('untested_no_plan'),
      documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qA' })],
    } as never);
    expect(e.grade).toBe('trial_ready');
  });
});

describe('4qA/4qB 只在明确时才判定', () => {
  it('4qA 是允许型', () => {
    expect(
      evidence({ documents: [geneticReport({ haplotype: '4qA' })] } as never).record
        .permissiveHaplotype,
    ).toBe(true);
  });

  it('4qB 不是', () => {
    expect(
      evidence({ documents: [geneticReport({ haplotype: '4qB' })] } as never).record
        .permissiveHaplotype,
    ).toBe(false);
  });

  it('「4qA/4qB」是探针清单不是结果，判定为未知', () => {
    const e = evidence({
      documents: [geneticReport({ haplotype: '4qA/4qB', d4z4Repeats: '3' })],
    } as never);
    expect(e.record.permissiveHaplotype).toBeNull();
    // 于是长度有了、单倍型没有 —— 不能算入组齐备。
    expect(e.grade).toBe('method_right_incomplete');
  });
});

describe('《检查申请说明》', () => {
  it('没做过检测的人拿到的是「为什么 WES 不行 + 该做什么 + 报告要写什么」', () => {
    const request = evidence({ baseline: withLadder('untested_wants_test') } as never).testRequest;
    const headings = request?.sections.map((section) => section.heading) ?? [];
    expect(headings).toHaveLength(3);
    expect(headings[0]).toContain('全外显子');
    expect(headings[1]).toContain('能测出 FSHD1 的方法');
    expect(headings[2]).toContain('报告上需要写明');
  });

  it('已经做过 Southern blot 的人不用再看「为什么 WES 不行」', () => {
    const request = evidence({
      documents: [geneticReport({ geneticTestMethod: 'southern_blot', d4z4Repeats: '3' })],
    } as never).testRequest;
    const headings = request?.sections.map((section) => section.heading) ?? [];
    expect(headings.some((heading) => heading.includes('全外显子'))).toBe(false);
    expect(headings.some((heading) => heading.includes('报告上需要写明'))).toBe(true);
  });

  it('每一节都带出处，可打印文本里也带', () => {
    const request = evidence({ baseline: withLadder('untested_wants_test') } as never).testRequest;
    expect(request).not.toBeNull();
    for (const section of request!.sections) {
      expect(section.source.length).toBeGreaterThan(0);
      expect(request!.printable).toContain(section.source);
    }
    expect(request!.printable).toContain('10.1111/cge.14533');
  });

  it('灰区患者的说明里多一节灰区，且带上自己的数字', () => {
    const request = evidence({
      documents: [geneticReport({ d4z4Repeats: '9' })],
    } as never).testRequest;
    const greyZone = request?.sections.find((section) => section.heading.includes('灰区'));
    expect(greyZone?.heading).toContain('9');
    expect(greyZone?.body.join('')).toContain('日本');
  });
});

describe('导出的 markdown 带上分级和申请说明', () => {
  it('WES 患者的导出里写明这份报告排除不了 FSHD', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ geneticTestMethod: 'short_read_sequencing' })] } as never),
    );
    const markdown = buildClinicalPassportExport(summary).markdown;
    expect(markdown).toContain('基因证据分级');
    expect(markdown).toContain('方法不适用');
    expect(markdown).toContain('不能用来排除 FSHD');
    expect(markdown).toContain('FSHD（面肩肱型肌营养不良）基因检查申请说明');
  });

  it('材料齐备的患者导出里没有申请说明这一节', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qA' })] } as never),
    );
    const markdown = buildClinicalPassportExport(summary).markdown;
    expect(markdown).toContain('可用于入组');
    expect(markdown).not.toContain('基因检查申请说明');
  });
});

describe('五级诊断阶梯', () => {
  it('阶梯写进护照，并带上中文标签', () => {
    const summary = buildClinicalPassportSummary(
      base({ baseline: withLadder('confirmed_report_unavailable') } as never),
    );
    expect(summary.diagnosis.ladder).toBe('confirmed_report_unavailable');
    expect(summary.diagnosis.ladderLabel).toBe('已确诊，但报告不在手上');
  });

  it('旧档案没有阶梯时是 null，不是猜一个', () => {
    expect(buildClinicalPassportSummary(base()).diagnosis.ladder).toBeNull();
  });

  it('无法识别的字符串不被当成阶梯 —— baseline 是没有约束的 JSONB', () => {
    expect(
      buildClinicalPassportSummary(base({ baseline: withLadder('随便什么') } as never)).diagnosis
        .ladder,
    ).toBeNull();
  });

  it('阶梯不改动 confirmation —— 自述和证据是两个问题', () => {
    const summary = buildClinicalPassportSummary(
      base({ baseline: withLadder('confirmed_with_report') } as never),
    );
    expect(summary.diagnosis.confirmation).toBe('none');
    expect(summary.diagnosis.ready).toBe(false);
  });
});

describe('diagnosedFshd 由阶梯派生 [profile.schema]', () => {
  const parse = (diseaseBackground: Record<string, unknown>) =>
    baselineProfileSchema.parse({ diseaseBackground }).diseaseBackground;

  it.each([
    ['confirmed_with_report', true],
    ['confirmed_report_unavailable', true],
    ['clinical_only', true],
    ['untested_wants_test', false],
    ['untested_no_plan', false],
  ])('%s → diagnosedFshd=%s', (ladder, expected) => {
    expect(parse({ diagnosisLadder: ladder })?.diagnosedFshd).toBe(expected);
  });

  it('阶梯和布尔值冲突时以阶梯为准，两半不允许各说各话', () => {
    expect(parse({ diagnosisLadder: 'untested_no_plan', diagnosedFshd: true })?.diagnosedFshd).toBe(
      false,
    );
  });

  it('没有阶梯的旧客户端提交原样通过，不被拒也不被反推', () => {
    const parsed = parse({ diagnosedFshd: true });
    expect(parsed?.diagnosedFshd).toBe(true);
    expect(parsed?.diagnosisLadder).toBeUndefined();
  });

  it('不认识的阶梯值直接 400，而不是悄悄落库', () => {
    expect(() => parse({ diagnosisLadder: 'maybe' })).toThrow();
  });
});

describe('方法对但结果不全：不能凭空说患者已有某一项', () => {
  /**
   * `reason` is printed into the markdown export as 「- 依据：…」 and
   * handed across a desk. A neurologist who reads 「已有单倍型」 does not
   * re-order the haplotype assay — and that assay is exactly the half a
   * molecular FSHD diagnosis is missing.
   *
   * The branch is reached whenever ANY of {sizing method named, size
   * present, haplotype present, any D4Z4 reading} holds, so 「not size」
   * never implied 「haplotype」. Choosing both strings off the single
   * `size` boolean printed a literal null.
   */
  const reasonFor = (fields: Record<string, string>) =>
    buildClinicalPassportSummary(base({ documents: [geneticReport(fields)] } as never)).diagnosis
      .geneticEvidence.reason;

  it('只有区间读数时，不说「已有单倍型（null）」', () => {
    const reason = reasonFor({ d4z4Repeats: '1-10' });
    expect(reason).not.toContain('null');
    expect(reason).not.toContain('已有单倍型');
    expect(reason).toContain('这两项都还没有确定的结果');
  });

  it('只写了方法、什么结果都没读到时同理', () => {
    const reason = reasonFor({ geneticTestMethod: 'southern_blot' });
    expect(reason).not.toContain('null');
    expect(reason).not.toContain('已有');
    expect(reason).toContain('这两项都还没有确定的结果');
  });

  it('报告写的是探针清单 4qA/4qB 时，不算已有单倍型结果', () => {
    // parsePermissiveHaplotype reads that string as naming its probes,
    // not stating a result. The copy has to agree with the DTO it is
    // built from.
    const reason = reasonFor({ haplotype: '4qA/4qB', geneticTestMethod: 'southern_blot' });
    expect(reason).not.toContain('已有单倍型（4qA/4qB）');
  });

  it('确实只缺单倍型时，仍然如实说已有 D4Z4 长度', () => {
    const reason = reasonFor({ d4z4Repeats: '4' });
    expect(reason).toContain('已有D4Z4 长度（4）');
    expect(reason).toContain('4qA / 4qB 单倍型');
  });

  it('确实只缺长度时，如实说已有单倍型', () => {
    const reason = reasonFor({ haplotype: '4qA' });
    expect(reason).toContain('已有单倍型（4qA）');
    expect(reason).toContain('D4Z4 重复单元数');
  });
});

describe('灰区说明只把指南说过的话算在指南头上', () => {
  /**
   * Giardina 2024 states the 「likely pathogenic」 reporting category for
   * 8 U only, and there as an ethnicity-dependent example. The 1%–2%
   * asymptomatic-carrier figure IS stated for the whole 8–10 range.
   * The note used to attribute the reporting category to the whole
   * range, which put it at odds with buildGreyZoneSection in the same
   * file — and both are patient-facing.
   */
  const noteFor = (repeats: string) =>
    buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: repeats })] } as never),
    ).diagnosis.geneticEvidence.greyZoneNote ?? '';

  it('8 单元时，报告口径归给 8 单元', () => {
    const note = noteFor('8');
    expect(note).toContain('对 8 个单元');
    expect(note).toContain('可能致病');
  });

  it('9 和 10 单元时，明说指南没有单独说明', () => {
    for (const n of ['9', '10']) {
      const note = noteFor(n);
      expect(note).toContain('没有单独说明');
      expect(note).not.toMatch(/指南对这一区间给出的报告口径/);
    }
  });

  it('1%–2% 这一句对整个区间都成立，所以每一档都在', () => {
    for (const n of ['8', '9', '10']) {
      expect(noteFor(n)).toContain('1%–2%');
    }
  });

  it('灰区之外没有这条说明', () => {
    expect(noteFor('4')).toBe('');
    expect(noteFor('15')).toBe('');
  });
});

/**
 * THE PICKER, AS THE PASSPORT RENDERS IT.
 *
 * The ordering itself is pinned in genetic-evidence.test.ts, against
 * `pickGeneticEvidenceDocument` — the one answer the passport, the
 * baseline autofill and the portable exports all now ask. What these
 * add is that the passport's diagnosis block moves with it: the value
 * printed, the document named beside it and the evidence grade all come
 * off the document the picker chose, so an ordering change cannot land
 * in one of the three and not the others.
 */
describe('哪一份报告撑起护照的诊断这一段', () => {
  const fullReport = (over: Record<string, unknown> = {}) => ({
    ...geneticReport({
      diagnosisType: 'FSHD1',
      d4z4Repeats: '4',
      haplotype: '4qA',
      ecoRIFragment: '18kb',
      geneticTestMethod: 'southern_blot',
    }),
    id: 'old-full',
    uploadedAt: '2026-02-01T00:00:00.000Z',
    ...over,
  });

  /** What the passport must not lose. */
  const expectFullReportKept = (profile: PatientProfileDTO) => {
    const diagnosis = buildClinicalPassportSummary(profile).diagnosis;
    expect(diagnosis.d4z4Repeats).toBe('4');
    expect(diagnosis.geneticType).toBe('FSHD1');
    expect(diagnosis.confirmation).toBe('genetic');
    expect(diagnosis.latestDocumentId).toBe('old-full');
    expect(diagnosis.valueOrigins.d4z4Repeats.documentId).toBe('old-full');
  };

  it('正在识别的新报告不会顶掉已经解析出结果的旧报告', () => {
    // The reviewer's repro. A row inserted by the upload endpoint sits
    // in `processing` with no payload until its job lands, and the
    // reparse path nulls `ocr_payload` before it starts — so 「newest」
    // and 「has anything to say」 are different questions.
    expectFullReportKept(
      base({
        documents: [
          fullReport(),
          {
            ...geneticReport({}),
            id: 'new-processing',
            status: 'processing',
            uploadedAt: '2026-06-01T00:00:00.000Z',
            ocrPayload: null,
          },
        ],
      } as never),
    );
  });

  it('识别失败的新报告也顶不掉', () => {
    // `parse_failed` is where a raised parse lands and stays. Unlike
    // `processing` it never resolves on its own, so a passport that let
    // it win would stay empty until somebody pressed 重新识别.
    expectFullReportKept(
      base({
        documents: [
          fullReport(),
          {
            ...geneticReport({}),
            id: 'new-failed',
            status: 'parse_failed',
            uploadedAt: '2026-06-01T00:00:00.000Z',
            ocrPayload: { provider: 'unknown', error: 'OCR failed' },
          },
        ],
      } as never),
    );
  });

  it('更新但读出来的东西更少的报告，也顶不掉更全的那一份', () => {
    // `parsed` is a statement about the job, not about the document: it
    // means the extractor returned. The reparse endpoint exists because
    // a `parsed` row that extracted nothing is a failure wearing a
    // success label — the file did not change, the parser did. So a
    // newer report's silence about D4Z4 重复数 is not a measurement, and
    // it may not delete one.
    expectFullReportKept(
      base({
        documents: [
          fullReport(),
          {
            ...geneticReport({ diagnosisType: 'FSHD1' }),
            id: 'new-thin',
            uploadedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      } as never),
    );
  });

  it('更新且读出来更多的报告，是会顶上来的 —— 这不是「旧的永远赢」', () => {
    const diagnosis = buildClinicalPassportSummary(
      base({
        documents: [
          {
            ...geneticReport({ diagnosisType: 'FSHD1', d4z4Repeats: '4' }),
            id: 'old-thin',
            uploadedAt: '2026-02-01T00:00:00.000Z',
          },
          {
            ...geneticReport({
              diagnosisType: 'FSHD1',
              d4z4Repeats: '9',
              haplotype: '4qA',
              ecoRIFragment: '30kb',
              geneticTestMethod: 'southern_blot',
            }),
            id: 'new-full',
            uploadedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      } as never),
    ).diagnosis;

    expect(diagnosis.d4z4Repeats).toBe('9');
    expect(diagnosis.latestDocumentId).toBe('new-full');
  });

  it('病历摘要抄得再全，护照印的也是基因报告那一份', () => {
    // A 病历摘要 quoting a repeat count is a transcription; a genetics
    // report is the laboratory. Asking how much a document carries
    // before asking what kind of document it is put the transcription
    // on the passport — printed as this patient's genetic result, with
    // the summary named as its source, beside an evidence grade the
    // laboratory's own 检测方法 was supposed to decide.
    const diagnosis = buildClinicalPassportSummary(
      base({
        documents: [
          {
            ...geneticReport({ d4z4Repeats: '4', geneticTestMethod: 'southern_blot' }),
            id: 'lab',
            uploadedAt: '2026-02-01T00:00:00.000Z',
          },
          {
            ...geneticReport({}),
            id: 'summary',
            uploadedAt: '2026-06-01T00:00:00.000Z',
            ocrPayload: {
              fields: {
                classifiedType: 'medical_summary',
                diagnosisType: 'FSHD1',
                d4z4Repeats: '7',
                haplotype: '4qA',
                methylationValue: '12%',
              },
            },
          },
        ],
      } as never),
    ).diagnosis;

    expect(diagnosis.d4z4Repeats).toBe('4');
    expect(diagnosis.latestDocumentId).toBe('lab');
    expect(diagnosis.valueOrigins.d4z4Repeats.documentId).toBe('lab');
  });

  it('基因报告什么都没解析出来时，带着基因字段的另一份文件才是该读的那一份', () => {
    // The boundary between the two rules: a genetics report outranks a
    // transcription, but a genetics report that read out NOTHING is not
    // the laboratory speaking — it is a file this platform has not
    // read, and letting it hide the patient's only repeat count is the
    // same erasure reached by a different road.
    const diagnosis = buildClinicalPassportSummary(
      base({
        documents: [
          {
            ...geneticReport({}),
            id: 'empty-genetic',
            uploadedAt: '2026-06-01T00:00:00.000Z',
          },
          {
            ...geneticReport({}),
            id: 'summary-with-fields',
            uploadedAt: '2026-02-01T00:00:00.000Z',
            ocrPayload: {
              fields: {
                classifiedType: 'medical_summary',
                diagnosisType: 'FSHD1',
                d4z4Repeats: '4',
              },
            },
          },
        ],
      } as never),
    ).diagnosis;

    expect(diagnosis.d4z4Repeats).toBe('4');
    expect(diagnosis.latestDocumentId).toBe('summary-with-fields');
  });

  it('完全平手时按 id 定，所以没改过的档案重新渲染是一模一样的', () => {
    const documents = [
      { ...geneticReport({ d4z4Repeats: '4' }), id: 'bbb' },
      { ...geneticReport({ d4z4Repeats: '7' }), id: 'aaa' },
    ];
    const idOf = (docs: unknown[]) =>
      buildClinicalPassportSummary(base({ documents: docs } as never)).diagnosis.latestDocumentId;

    expect(idOf(documents)).toBe('aaa');
    expect(idOf([...documents].reverse())).toBe('aaa');
  });

  it('一份都没解析成功时，护照照旧不假装读到过什么', () => {
    const diagnosis = buildClinicalPassportSummary(
      base({
        documents: [
          {
            ...geneticReport({}),
            id: 'only-processing',
            status: 'processing',
            uploadedAt: '2026-06-01T00:00:00.000Z',
            ocrPayload: null,
          },
        ],
      } as never),
    ).diagnosis;

    expect(diagnosis.geneticType).toBe('—');
    expect(diagnosis.d4z4Repeats).toBe('—');
    expect(diagnosis.confirmation).toBe('none');
    expect(diagnosis.geneticEvidence.grade).toBe('unknown');
  });
});

/**
 * 病历摘要抄来的读数：照登，但不算实验室说过。
 *
 * `pickGeneticEvidenceDocument` takes a 病历摘要 carrying a genetic
 * result on purpose — for some patients it is the only copy of the
 * number that exists, and dropping it loses the value entirely. That
 * decision is about DISPLAY, and the grading path took it as well:
 * rendered on a profile whose only document was such a summary, this
 * function returned confirmation 「genetic」, grade 「trial_ready」 and a
 * headline telling the reader the report already contained what trial
 * enrolment requires. No laboratory had said any of it.
 *
 * Four renders, because the ordering has four cases and the invariant
 * has to hold in each: the laboratory alone, the transcription alone,
 * and both with either one richer. Each asks the same three questions —
 * what grade, what headline, and is the value still on the page.
 */
describe('病历摘要抄来的结果：值照登，但不给分级、不替实验室说话', () => {
  const LAB_RICH = {
    diagnosisType: 'FSHD1',
    d4z4Repeats: '3',
    haplotype: '4qA',
    geneticTestMethod: 'southern_blot',
  };
  const SUMMARY_RICH = {
    diagnosisType: 'FSHD1',
    d4z4Repeats: '7',
    haplotype: '4qA',
    methylationValue: '12%',
  };

  /** A 病历摘要 — a clinic's summary that quotes the laboratory. The
   *  classified type is what decides this, not the uploader's pick. */
  const medicalSummary = (
    id: string,
    fields: Record<string, string>,
    uploadedAt = '2026-02-01T00:00:00.000Z',
  ) => ({
    ...geneticReport({}),
    id,
    documentType: 'medical_summary',
    uploadedAt,
    ocrPayload: { fields: { classifiedType: 'medical_summary', ...fields } },
  });

  const lab = (
    id: string,
    fields: Record<string, string>,
    uploadedAt = '2026-02-01T00:00:00.000Z',
  ) => ({ ...geneticReport(fields), id, uploadedAt });

  const summaryOf = (documents: unknown[], over: Partial<PatientProfileDTO> = {}) =>
    buildClinicalPassportSummary(base({ documents, ...over } as never));

  describe('一、只有一份基因报告 —— 分级照旧，这一段没有改变它', () => {
    const summary = summaryOf([lab('lab', LAB_RICH)]);

    it('仍然是基因确诊、可用于入组', () => {
      expect(summary.diagnosis.confirmation).toBe('genetic');
      expect(summary.diagnosis.geneticEvidence.grade).toBe('trial_ready');
      expect(summary.diagnosis.geneticEvidence.headline).toContain('入组');
      expect(summary.diagnosis.ready).toBe(true);
    });

    it('值和括号都还是「报告读取」', () => {
      expect(summary.diagnosis.d4z4Repeats).toBe('3');
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('报告读取');
      expect(summary.diagnosis.geneEvidenceOrigin.labelZh).toBe('报告读取');
    });
  });

  describe('二、只有一份病历摘要 —— 值在，分级不在', () => {
    const summary = summaryOf([medicalSummary('summary', SUMMARY_RICH)]);
    const evidence = summary.diagnosis.geneticEvidence;

    it('不是基因确诊', () => {
      expect(summary.diagnosis.confirmation).not.toBe('genetic');
      expect(summary.diagnosis.ready).toBe(false);
      // The completion ring counts confirmed diagnoses only; a
      // transcription must not fill it either.
      expect(summary.completion.completed).toBe(0);
    });

    it('分级是「仅有转录结果」，不是可用于入组，也不是未检测', () => {
      expect(evidence.grade).toBe('transcribed_only');
      expect(evidence.gradeLabel).toBe('仅有转录结果');
    });

    it('标题说的是「读的是转录件」，没有一句替实验室说话', () => {
      expect(evidence.headline).toContain('转录件');
      expect(evidence.headline).not.toContain('入组');
      // The sentence the bug printed, in the export a patient hands
      // across a desk.
      expect(evidence.reason).not.toContain('这份报告已经包含');
      expect(evidence.reason).toContain('转录也不是检测');
    });

    it('依据里点了名是哪一份文件，用的是本平台自己的说法', () => {
      expect(evidence.reason).toContain('病历摘要');
    });

    it('值一个都没丢，而且每一个后面都写着来源', () => {
      const { diagnosis } = summary;
      expect(diagnosis.d4z4Repeats).toBe('7');
      expect(diagnosis.geneticType).toBe('FSHD1');
      expect(diagnosis.methylationValue).toBe('12%');
      expect(diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('转录自非基因报告文件');
      expect(diagnosis.valueOrigins.geneticType.labelZh).toBe('转录自非基因报告文件');
      expect(diagnosis.valueOrigins.methylationValue.labelZh).toBe('转录自非基因报告文件');
    });

    it('括号既不是「报告读取」也不是「本人填写」', () => {
      for (const key of ['geneticType', 'd4z4Repeats', 'methylationValue'] as const) {
        expect(summary.diagnosis.valueOrigins[key].kind).toBe('transcribed');
        expect(summary.diagnosis.valueOrigins[key].labelZh).not.toBe('报告读取');
        expect(summary.diagnosis.valueOrigins[key].labelZh).not.toBe('本人填写');
      }
    });

    it('拼起来的那一行跟着它的几项走，不会独自升格成报告读取', () => {
      expect(summary.diagnosis.geneEvidence).toContain('7');
      expect(summary.diagnosis.geneEvidenceOrigin.labelZh).toBe('转录自非基因报告文件');
    });

    it('括号写在文件上，来源里也点了那份文件的 id', () => {
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.documentId).toBe('summary');
      expect(summary.diagnosis.latestDocumentId).toBe('summary');
    });

    it('导出的 markdown 里，数字在、来源在、入组那句话不在', () => {
      const markdown = buildClinicalPassportExport(summary).markdown;
      expect(markdown).toContain('D4Z4 重复数：7（转录自非基因报告文件）');
      expect(markdown).toContain('分级：仅有转录结果');
      expect(markdown).not.toContain('可用于入组');
      // 未经基因确诊, and asserted as the positive claim it is: a bare
      // `not.toContain('基因确诊')` passes on the string that contains
      // it, which is this one.
      expect(markdown).toContain('未经基因确诊');
    });

    it('《检查申请说明》改成「报告上需要写明的内容」—— 不是叫诊所再开一次单', () => {
      const request = evidence.testRequest;
      const headings = request?.sections.map((section) => section.heading) ?? [];
      expect(headings).toEqual(['报告上需要写明的内容']);
      expect(request?.intro).toContain('报告原件不在本平台手上');
      expect(headings.some((heading) => heading.includes('全外显子'))).toBe(false);
    });

    it('待办让人去取报告，不承诺「传了才能显示这个数」—— 数就在页面上', () => {
      const step = summary.nextSteps.find((item) => item.title.includes('补充基因'));
      expect(step?.description).toContain('标着「转录自非基因报告文件」');
      expect(step?.description).not.toContain('护照才能显示 D4Z4 重复数');
      expect(step?.description).not.toContain('护照才能展示 D4Z4 重复数');
    });
  });

  it('那句话只在页面上真有这个括号时才说', () => {
    // A 病历摘要 carrying only a 单倍型, on a profile whose 分型 and
    // D4Z4 重复数 come out of the archive. The grade is still the
    // transcription's — that is decided by which document was read —
    // but no printed row wears the transcription bracket: the 单倍型
    // appears inside the joined 基因证据 row, and that row's bracket
    // belongs to the join. Addressing 「标着…的那几项」 here points the
    // reader at rows that are not on the page.
    const summary = summaryOf([medicalSummary('summary', { haplotype: '4qA' })], {
      baseline: { diseaseBackground: { d4z4: '6', diagnosisType: 'FSHD1' } },
    } as never);

    expect(summary.diagnosis.geneticEvidence.grade).toBe('transcribed_only');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('来源无法确定');
    const step = summary.nextSteps.find((item) => item.title.includes('补充基因'));
    expect(step?.description).not.toContain('转录自非基因报告文件');
    // And the transcribed value is still on the page, in the row that
    // does carry it.
    expect(summary.diagnosis.geneEvidence).toContain('4qA');
  });

  describe('三、两份都有，病历摘要抄得更全（基因报告什么都没读出来）', () => {
    // The boundary case the picker yields on: a genetics report that
    // read out nothing is a file this platform has not read, so the
    // transcription is what there is. The value survives; the grade
    // still does not follow it.
    const summary = summaryOf([
      lab('lab-empty', {}, '2026-06-01T00:00:00.000Z'),
      medicalSummary('summary', SUMMARY_RICH),
    ]);

    it('页面读的是病历摘要，值没有丢', () => {
      expect(summary.diagnosis.latestDocumentId).toBe('summary');
      expect(summary.diagnosis.d4z4Repeats).toBe('7');
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('转录自非基因报告文件');
    });

    it('哪怕档案里确实有一份基因报告，分级也不跟着它走', () => {
      expect(summary.diagnosis.confirmation).not.toBe('genetic');
      expect(summary.diagnosis.geneticEvidence.grade).toBe('transcribed_only');
      expect(summary.diagnosis.geneticEvidence.headline).not.toContain('入组');
    });
  });

  describe('四、两份都有，基因报告更全 —— 分级和值都归实验室那一份', () => {
    const summary = summaryOf([
      lab('lab', LAB_RICH),
      medicalSummary('summary', SUMMARY_RICH, '2026-06-01T00:00:00.000Z'),
    ]);

    it('印的是报告的 3，不是摘要的 7', () => {
      expect(summary.diagnosis.d4z4Repeats).toBe('3');
      expect(summary.diagnosis.latestDocumentId).toBe('lab');
    });

    it('照常基因确诊、可用于入组，括号是报告读取', () => {
      expect(summary.diagnosis.confirmation).toBe('genetic');
      expect(summary.diagnosis.geneticEvidence.grade).toBe('trial_ready');
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('报告读取');
    });
  });

  describe('按重复数分组的那几条指南建议，转录来的数字一条都不进', () => {
    it('抄来的是 3 时不发眼底那一条 —— 发的是「要看报告原件」', () => {
      const summary = summaryOf([medicalSummary('summary', { d4z4Repeats: '3' })]);
      const titles = summary.nextSteps.map((step) => step.title);
      expect(titles).not.toContain('问一次眼底检查');
      expect(titles).toContain('眼底检查这一条要看报告原件');
    });

    it('那一条不说「取自你的档案」—— 这个数是从一份文件上读来的', () => {
      const summary = summaryOf([medicalSummary('summary', { d4z4Repeats: '3' })]);
      const step = summary.nextSteps.find((item) => item.title.includes('眼底'));
      expect(step?.description).toContain('3（转录自非基因报告文件）');
      expect(step?.description).toContain('不是基因报告本身');
      expect(step?.description).not.toContain('取自你的档案');
    });

    it('抄来的是 8 时不判灰区，也不发灰区那条待办', () => {
      const summary = summaryOf([medicalSummary('summary', { d4z4Repeats: '8' })]);
      expect(summary.diagnosis.geneticEvidence.record.greyZone).toBe(false);
      expect(summary.diagnosis.geneticEvidence.greyZoneNote).toBeNull();
      expect(summary.nextSteps.some((step) => step.title.includes('灰区'))).toBe(false);
    });

    it('抄来的长度加单倍型也凑不出入组齐备', () => {
      const summary = summaryOf([
        medicalSummary('summary', { d4z4Repeats: '8', haplotype: '4qA' }),
      ]);
      expect(summary.diagnosis.geneticEvidence.grade).toBe('transcribed_only');
    });

    it('病历摘要抄了「短读长测序」也不降级 —— 方法要由报告本身写明', () => {
      // The downgrade tells somebody their test was the wrong test.
      // Reading that off a clinic letter's transcription of a method is
      // the same mistake as reading a result off one.
      const summary = summaryOf([
        medicalSummary('summary', {
          geneticTestMethod: 'short_read_sequencing',
          d4z4Repeats: '5',
        }),
      ]);
      expect(summary.diagnosis.geneticEvidence.grade).toBe('transcribed_only');
      expect(summary.nextSteps.map((step) => step.title)).not.toContain(
        '这份报告用的方法测不到 FSHD',
      );
    });
  });

  it('自述「还没做过基因检测」时也不写成未检测 —— 数字就印在同一页上', () => {
    const summary = summaryOf([medicalSummary('summary', { d4z4Repeats: '7' })], {
      baseline: withLadder('untested_wants_test'),
    } as never);
    expect(summary.diagnosis.geneticEvidence.grade).toBe('transcribed_only');
    expect(summary.diagnosis.d4z4Repeats).toBe('7');
  });

  /**
   * 依据那句话不许一边点名「基因报告」一边否认它。
   *
   * The population this grade exists for is an archived 门诊病历摘要
   * that the OLD keyword classifier labelled `genetic_report` —
   * `isLaboratoryGeneticReport` now refuses it on the page's own
   * 主诉 / 现病史 / 查体, and nothing re-parses the row, so the refused
   * label stays on the blob forever. The 依据 read its document name out
   * of `documentLabels[classifiedType]`, i.e. out of that same refused
   * label, and printed 「本平台这次读的是你上传的「基因报告」……但它不是
   * 基因报告本身」 on the passport screen, in the markdown export and in
   * the 下一步 card — with 转录自非基因报告文件 in the brackets beside
   * every value on the same page. A reader who is told he uploaded the
   * 基因报告 has been told the upload this grade is asking him to make
   * is already done.
   */
  describe('归档的旧分类还写着 genetic_report —— 依据不拿这个名字称呼它', () => {
    const NARRATIVE_PAGE = [
      '门诊病历摘要',
      '主诉：双上肢无力 5 年',
      '现病史：患者 5 年前无明显诱因出现双上肢无力',
      '查体：双侧翼状肩胛',
      '外院基因检测：D4Z4 重复单元数 3 个，4qA',
    ].join('\n');

    /** The archived row: classified `genetic_report` by the old rule,
     *  page is a clinic narrative. `documentType` is varied because the
     *  gate reaches its last question by two different routes and the
     *  name printed must not depend on which. */
    const archivedNarrative = (documentType: string) => ({
      ...geneticReport({}),
      id: 'archived',
      documentType,
      ocrPayload: {
        fields: { classifiedType: 'genetic_report', d4z4Repeats: '3', haplotype: '4qA' },
        extractedText: NARRATIVE_PAGE,
      },
    });

    it.each([['other'], ['genetic_report']])(
      '声明为 %s 时都不叫它「基因报告」，也不留下没名字的空引号',
      (documentType) => {
        const summary = summaryOf([archivedNarrative(documentType)]);
        const evidence = summary.diagnosis.geneticEvidence;

        expect(evidence.grade).toBe('transcribed_only');
        expect(evidence.record.source).toBe('transcribed');
        // No name this platform will stand behind, so no name is
        // printed — not a fallback wearing quotation marks.
        expect(evidence.record.documentLabelZh).toBeNull();
        expect(evidence.reason).not.toContain('「基因报告」');
        expect(evidence.reason).not.toContain('「上传的文件」');
        expect(evidence.reason).toContain('本平台这次读的是你上传的文件：');
        // The denial itself is untouched.
        expect(evidence.reason).toContain('它不是基因报告本身');
      },
    );

    it('导出的 markdown 和护照上说的是同一句', () => {
      const summary = summaryOf([archivedNarrative('other')]);
      const markdown = buildClinicalPassportExport(summary).markdown;
      expect(markdown).toContain('本平台这次读的是你上传的文件：');
      expect(markdown).not.toContain('你上传的「基因报告」');
      // And the bracket beside the value still says what it always did.
      expect(markdown).toContain('D4Z4 重复数：3（转录自非基因报告文件）');
    });

    it('分类是病历摘要时照旧点名 —— 这一条没有把好名字一起删掉', () => {
      const evidence = summaryOf([medicalSummary('summary', SUMMARY_RICH)]).diagnosis
        .geneticEvidence;
      expect(evidence.record.documentLabelZh).toBe('病历摘要');
      expect(evidence.reason).toContain('你上传的「病历摘要」');
    });

    it('实验室自己的报告仍然叫基因报告 —— 那一份本平台认', () => {
      const record = summaryOf([lab('lab', LAB_RICH)]).diagnosis.geneticEvidence.record;
      expect(record.source).toBe('laboratory_report');
      expect(record.documentLabelZh).toBe('基因报告');
    });
  });
});

/**
 * 4qB IS NOT A SMALLER 4qA.
 *
 * FSHD1 is a contracted D4Z4 array on a PERMISSIVE 4qA allele — the
 * platform states it in its own words in 「只有 4qA 是允许型，缺了这一
 * 项，重复单元数本身不足以下结论」 and in the phenopacket export's reason
 * for writing no interpretations. So a report stating 4qB has not
 * produced weaker evidence towards the diagnosis; it has produced a
 * result that argues against this mechanism.
 *
 * The gate it walked through was `permissiveHaplotype !== null`, which
 * asks whether the laboratory REPORTED a haplotype and never what the
 * haplotype SAYS. Rendered before these tests existed: D4Z4 3 / 4qB
 * came out 可用于入组 under 「这份报告已经包含临床试验入组通常要求的两项
 * 内容」, 基因确诊 on the share banner, and 「面肩肱型肌营养不良症
 * （FSHD），基因确诊；D4Z4 重复数 3」 in the referral pack.
 *
 * What these pin is the whole page for that profile, not just the
 * grade: the values stay printed, the confirmation moves, the guideline
 * branches keyed to a repeat count stop firing, and no sentence claims
 * either that FSHD1 is confirmed or that it is excluded.
 */
describe('4qB —— 非允许型不是「离确诊更近一步」', () => {
  const nonPermissive = (fields: Record<string, string> = {}) =>
    buildClinicalPassportSummary(
      base({ documents: [geneticReport({ haplotype: '4qB', ...fields })] } as never),
    );

  describe('长度也读到了 —— 两项都在，仍然不是分子诊断', () => {
    const summary = nonPermissive({ d4z4Repeats: '3' });
    const e = summary.diagnosis.geneticEvidence;

    it('不评「可用于入组」，评「单倍型非允许型」', () => {
      expect(e.grade).toBe('non_permissive_haplotype');
      expect(e.gradeLabel).toBe('单倍型非允许型');
    });

    it('不写基因确诊，完整度也不为它加一格', () => {
      expect(summary.diagnosis.confirmation).toBe('genetic_non_permissive');
      expect(summary.diagnosis.ready).toBe(false);
    });

    it('没有任何一句说这份材料满足入组要求', () => {
      const everything = [e.headline, e.reason, e.action].join('');
      expect(everything).not.toContain('入组');
      expect(everything).not.toContain('材料是齐的');
    });

    it('也不写成「结果不全」 —— 两项都读到了，缺的不是结果', () => {
      expect(e.headline).not.toContain('只差');
      expect(e.reason).not.toContain('还没有看到');
    });

    it('说清楚 4qA 才是允许型，并把结论的边界划出来', () => {
      expect(e.headline).toContain('4qB');
      expect(e.headline).toContain('允许型');
      expect(e.reason).toContain('只有 4qA 是允许型');
      // 既不说已确诊，也不说已排除 —— 报告写的是它检测的那条等位基因。
      expect(e.reason).toContain('能不能排除 FSHD');
      expect(e.reason).not.toContain('你没有');
    });

    it('数值不消失，也不被说成没用', () => {
      expect(summary.diagnosis.d4z4Repeats).toBe('3');
      expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('报告读取');
      expect(e.reason).toContain('D4Z4 长度（3）照常印在护照上');
      expect(e.action).toContain('医生需要看到它');
    });

    it('核心摘要那一格说的是「未构成基因确诊」，不是「没有基因结果」', () => {
      const card = summary.summaryCards.find((item) => item.key === 'diagnosis');
      expect(card?.ready).toBe(false);
      expect(card?.summary).toContain('未构成基因确诊');
      expect(card?.summary).toContain('4qB');
      // 这一页印着实验室读出来的 4q 单倍型，「没有从基因报告里读出来的
      // ……4q 单倍型」在这种档案上是假话。
      expect(card?.summary).not.toContain('没有从基因报告里读出来的');
    });
  });

  describe('只有单倍型 —— 没有长度也一样，别把 4qB 说成「已有」', () => {
    const e = nonPermissive().diagnosis.geneticEvidence;

    it('仍然评单倍型非允许型，而不是「方法对，但结果不全」', () => {
      expect(e.grade).toBe('non_permissive_haplotype');
    });

    it('不出现「已有单倍型（4qB）」这种把它算作进度的说法', () => {
      expect(e.reason).not.toContain('已有单倍型');
    });
  });

  describe('按重复数分组的指南建议，一条都不套在它身上', () => {
    it('灰区提示不出现 —— 那段话讲的是 4qA 等位基因', () => {
      const summary = nonPermissive({ d4z4Repeats: '9' });
      expect(summary.diagnosis.geneticEvidence.record.greyZone).toBe(false);
      expect(summary.diagnosis.geneticEvidence.greyZoneNote).toBeNull();
      expect(summary.nextSteps.some((step) => step.title.includes('灰区'))).toBe(false);
    });

    it('大片段缺失的眼底检查不发出，但也不悄悄消失', () => {
      const summary = nonPermissive({ d4z4Repeats: '3' });
      const titles = summary.nextSteps.map((step) => step.title);
      expect(titles).not.toContain('问一次眼底检查');
      const step = summary.nextSteps.find((item) => item.title.includes('眼底检查'));
      expect(step?.kind).toBe('clinical');
      // 数字照说，理由照说，判断交给拿着报告原件的人。
      expect(step?.description).toContain('3');
      expect(step?.description).toContain('4qB');
      expect(step?.description).toContain('不拿一个非允许型的结果把你归进那一组');
    });
  });

  describe('待办：这个人已经做过检测了', () => {
    const summary = nonPermissive({ d4z4Repeats: '3' });
    const titles = summary.nextSteps.map((step) => step.title);

    it('不叫人再传一次报告', () => {
      expect(titles).not.toContain('补充基因检测报告');
      expect(titles).not.toContain('补充基因或诊断依据');
    });

    it('给的是一条 clinical 待办，内容就是分级里那两段', () => {
      const step = summary.nextSteps.find((item) => item.title.includes('单倍型'));
      expect(step?.kind).toBe('clinical');
      expect(step?.description).toContain('只有 4qA 是允许型');
    });
  });

  describe('《检查申请说明》：不是一张检查单', () => {
    const request = nonPermissive({ d4z4Repeats: '3' }).diagnosis.geneticEvidence.testRequest;

    it('只留「报告上需要写明的内容」这一节', () => {
      const headings = request?.sections.map((section) => section.heading) ?? [];
      expect(headings).toEqual(['报告上需要写明的内容']);
    });

    it('开头就说明它不是在要一项检查', () => {
      expect(request?.intro).toContain('这不是一张检查申请单');
      expect(request?.intro).toContain('由您看着报告原件判断');
    });
  });

  it('导出的 markdown 带着这一级和它的依据', () => {
    const markdown = buildClinicalPassportExport(nonPermissive({ d4z4Repeats: '3' })).markdown;
    expect(markdown).toContain('单倍型非允许型');
    expect(markdown).toContain('只有 4qA 是允许型');
    expect(markdown).not.toContain('可用于入组');
  });

  it('4qA 一个字都没变', () => {
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: '3', haplotype: '4qA' })] } as never),
    );
    expect(summary.diagnosis.geneticEvidence.grade).toBe('trial_ready');
    expect(summary.diagnosis.confirmation).toBe('genetic');
    expect(summary.diagnosis.ready).toBe(true);
  });

  it('转录件上的 4qB 不评级 —— 谁的页面还是谁的页面', () => {
    // A 病历摘要 quoting 4qB is a transcription, and this platform does
    // not tell somebody their allele is the non-permissive one on the
    // strength of a clinic letter any more than it confirms one.
    const summary = buildClinicalPassportSummary(
      base({
        documents: [
          {
            ...geneticReport({ d4z4Repeats: '3', haplotype: '4qB' }),
            documentType: 'medical_summary',
            ocrPayload: {
              fields: { classifiedType: 'medical_summary', d4z4Repeats: '3', haplotype: '4qB' },
            },
          },
        ],
      } as never),
    );
    expect(summary.diagnosis.geneticEvidence.grade).toBe('transcribed_only');
    expect(summary.diagnosis.confirmation).not.toBe('genetic_non_permissive');
  });
});

/**
 * THE SAME SHAPE, IN THE GATES BESIDE IT: a predicate that asks whether
 * a field is present where the question is what the field says.
 */
describe('长度这一项也要读出来才算读到', () => {
  it('EcoRI 片段写着「未检出」时，不算已有长度，更不算入组齐备', () => {
    // `Boolean(record.ecoRIFragment)` counted the string. Rendered: the
    // 依据 handed to a neurologist read 「D4Z4 长度 未检出，单倍型 4qA」
    // under 「这份报告已经包含临床试验入组通常要求的两项内容」.
    const e = buildClinicalPassportSummary(
      base({
        documents: [geneticReport({ ecoRIFragment: '未检出', haplotype: '4qA' })],
      } as never),
    ).diagnosis.geneticEvidence;
    expect(e.grade).not.toBe('trial_ready');
    expect(e.reason).not.toContain('未检出');
  });

  /**
   * 转诊资料上曾经印出「面肩肱型肌营养不良症（FSHD），基因确诊；D4Z4
   * 重复数 1-10」—— 确诊是 EcoRI 片段挣来的，而接在那句后面的数字是重复数
   * 那一格里的区间。kb 不参与确诊之后，这一行根本到不了确诊。
   */
  it('重复数是区间、EcoRI 片段是确切值时，两项都不成立', () => {
    const summary = buildClinicalPassportSummary(
      base({
        documents: [
          geneticReport({ d4z4Repeats: '1-10', ecoRIFragment: '18kb', haplotype: '4qA' }),
        ],
      } as never),
    );
    const e = summary.diagnosis.geneticEvidence;
    expect(e.grade).toBe('method_right_incomplete');
    expect(summary.diagnosis.confirmation).not.toBe('genetic');
    // 两个数都还印在页面上，只是没有一个被判过。
    expect(summary.diagnosis.d4z4Repeats).toBe('1-10');
    expect(summary.diagnosis.geneEvidence).toContain('18kb');
    expect(summary.diagnosis.laboratoryRepeatCount).toBeNull();
    expect(e.reason).toContain('报告上以 kb 写的长度（18kb）照常展示');
    // 区间不会被当成读数引用。
    expect(e.headline).not.toContain('1-10');
  });

  it('报告只写了探针清单 4qA/4qB 时，不算基因确诊', () => {
    // Same gate as 4qB: `hasMeaningfulValue(record.haplotype)` counted
    // the string, and `parsePermissiveHaplotype` had already refused to
    // read it as a result — so the passport printed 基因确诊 under a
    // grade whose own headline was 「暂时判断不出你做的是哪一种基因检测」.
    const summary = buildClinicalPassportSummary(
      base({ documents: [geneticReport({ haplotype: '4qA/4qB' })] } as never),
    );
    expect(summary.diagnosis.confirmation).not.toBe('genetic');
    expect(summary.diagnosis.ready).toBe(false);
    // 值仍然印着，那一格就不能说「缺少可直接展示的基因证据」。
    const card = summary.summaryCards.find((item) => item.key === 'diagnosis');
    expect(summary.diagnosis.geneEvidence).toContain('4qA/4qB');
    expect(card?.summary).toContain('4qA/4qB');
  });
});

/**
 * 一个说得清清楚楚的重复数，说的不是缩短。
 *
 * FSHD1 是允许型 4qA 上 D4Z4 重复序列的缩短。`determinateSize` 只问这一
 * 格能不能解析出一个确定的数，所以 30 个重复单元和 3 个重复单元过的是
 * 同一道闸 —— 报告写着 D4Z4 30 / 4qA 时，护照给的是 基因确诊 / 可用于
 * 入组，依据是「D4Z4 长度 30，单倍型 4qA」，转诊包里印的是「面肩肱型肌
 * 营养不良症（FSHD），基因确诊」。
 *
 * 界是本平台自己印在《检查申请说明》上的那一条：「若重复单元数大于 10
 * 而临床仍高度怀疑，需加做 D4Z4 甲基化分析与 SMCHD1 测序，以评估
 * FSHD2」。
 */
describe('长度说的是不是缩短 —— 大于 10 个重复单元', () => {
  const summaryFor = (fields: Record<string, string>) =>
    buildClinicalPassportSummary(
      base({ geneticMutation: 'FSHD1', documents: [geneticReport(fields)] } as never),
    );

  it('30 个重复单元 + 4qA 不是基因确诊，完整度也不为它加一格', () => {
    const summary = summaryFor({ d4z4Repeats: '30', haplotype: '4qA' });
    expect(summary.diagnosis.confirmation).toBe('self_reported');
    expect(summary.diagnosis.geneticEvidence.grade).not.toBe('trial_ready');
    expect(summary.diagnosis.ready).toBe(false);
  });

  it('没有一句说这份材料满足入组要求', () => {
    const summary = summaryFor({ d4z4Repeats: '30', haplotype: '4qA' });
    const evidence = summary.diagnosis.geneticEvidence;
    const everything = `${evidence.headline}${evidence.reason}${evidence.action}\n${
      buildClinicalPassportExport(summary).markdown
    }`;
    expect(everything).not.toContain('可用于入组');
    expect(everything).not.toContain('入组通常要求');
  });

  it('数值不消失，也不被说成没读到', () => {
    const summary = summaryFor({ d4z4Repeats: '30', haplotype: '4qA' });
    expect(summary.diagnosis.d4z4Repeats).toBe('30');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('报告读取');
    const evidence = summary.diagnosis.geneticEvidence;
    expect(evidence.headline).toContain('30');
    expect(`${evidence.headline}${evidence.reason}`).not.toContain('还没有确定的结果');
  });

  it('把指南在这个数上给的下一步说出来，而不是让人再做一次同样的检测', () => {
    const evidence = summaryFor({ d4z4Repeats: '30', haplotype: '4qA' }).diagnosis.geneticEvidence;
    expect(evidence.reason).toContain('SMCHD1');
    expect(evidence.reason).toContain('FSHD2');
    // 「结果不全」在这一档仍然成立：指南在这个数上要的甲基化分析与
    // SMCHD1 测序，本平台从来没有从任何一份报告上读到过 SMCHD1。这份
    // 报告没写检测方法，所以那半句不印。
    expect(evidence.gradeLabel).toBe('结果不全');
    expect(
      summaryFor({ d4z4Repeats: '30', haplotype: '4qA', geneticTestMethod: 'southern_blot' })
        .diagnosis.geneticEvidence.gradeLabel,
    ).toBe('方法对，但结果不全');
    expect(evidence.testRequest?.sections.map((section) => section.heading)).not.toContain(
      '能测出 FSHD1 的方法',
    );
  });

  it('两项都在的时候不会印出「只差「」」这种空括号', () => {
    const evidence = summaryFor({ d4z4Repeats: '30', haplotype: '4qA' }).diagnosis.geneticEvidence;
    expect(evidence.headline).not.toContain('「」');
    expect(evidence.reason).not.toContain('「」');
    expect(evidence.reason).toContain('已有D4Z4 长度（30）、单倍型（4qA）');
  });

  it('按重复数分组的那几条指南建议，一条都不套在它身上', () => {
    // 30 落在 1–4 之外，眼底那一条本来就不发；灰区那一条也不发。
    const summary = summaryFor({ d4z4Repeats: '30', haplotype: '4qA' });
    expect(summary.diagnosis.geneticEvidence.record.greyZone).toBe(false);
    expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');
  });

  it('单倍型还没读到时，两件事都说，不只说其中一件', () => {
    const evidence = summaryFor({ d4z4Repeats: '30' }).diagnosis.geneticEvidence;
    expect(evidence.headline).toContain('30');
    expect(evidence.reason).toContain('4qA / 4qB 单倍型这一项报告上也还没有确定的结果');
  });

  it('4qB 优先 —— 单倍型这一条更早，且它自己的文案里没有重复数那一句', () => {
    const evidence = summaryFor({ d4z4Repeats: '30', haplotype: '4qB' }).diagnosis.geneticEvidence;
    expect(evidence.grade).toBe('non_permissive_haplotype');
    expect(evidence.reason).not.toContain('SMCHD1');
  });

  /**
   * 以 kb 写的长度只印不判。
   *
   * `isLargeD4Z4Deletion` 把「10–20 kb or 1–4 repeats」原样引下来，并写明
   * 不做换算；本仓库另一处写的是「单个 D4Z4 单元长 3.3 kb」，两句合不成
   * 一个换算，所以推不出能用的 kb 界限。既然没有界限，kb 就不能撑起确诊、
   * 分级、灰区或任何一条建议 —— 它照常印在页面上，页面再说明为什么这个数
   * 没有被判。
   */
  it('kb 不按重复单元的界判 —— 只印，不判，并且说明为什么', () => {
    // 标注而不是让它推导：两个键不相交的对象字面量会被拓宽成带
    // `?: undefined` 成员的联合，`Record<string, string>` 不收（TS2345）。
    // esbuild 不做类型检查，所以这一条只有 `npm run typecheck` 会红。
    const halves: Record<string, string>[] = [
      { d4z4Repeats: '18kb', haplotype: '4qA' },
      { ecoRIFragment: '38', haplotype: '4qA' },
    ];
    for (const fields of halves) {
      const summary = summaryFor(fields);
      const label = Object.keys(fields).join(',');
      expect(summary.diagnosis.confirmation, label).not.toBe('genetic');
      expect(summary.diagnosis.geneticEvidence.grade, label).toBe('method_right_incomplete');
      expect(summary.diagnosis.laboratoryRepeatCount, label).toBeNull();
      expect(summary.diagnosis.geneticEvidence.reason, label).toContain(
        '本平台不在 kb 和重复单元数之间做换算',
      );
    }
    // 数本身照旧印在页面上。
    expect(summaryFor({ d4z4Repeats: '18kb', haplotype: '4qA' }).diagnosis.d4z4Repeats).toBe(
      '18kb',
    );
    expect(summaryFor({ ecoRIFragment: '38', haplotype: '4qA' }).diagnosis.geneEvidence).toContain(
      '38',
    );
  });
});

/**
 * 0 个重复单元：读到了一个数，而这个数说不通。
 *
 * FSHD1 的等位基因不可能是 0 个重复单元，所以读到 0 更可能是这一格没被
 * 读对、或者这一格说的根本不是重复单元数。它既不是确诊也不是排除：数照
 * 印，页面上写明本平台读不通它，并请医生看原件。
 */
describe('重复数读到 0', () => {
  const summaryFor = (fields: Record<string, string>) =>
    buildClinicalPassportSummary(
      base({ geneticMutation: 'FSHD1', documents: [geneticReport(fields)] } as never),
    );

  it('不算确诊 —— 0 通不过「说的是缩短」那一关', () => {
    const summary = summaryFor({ d4z4Repeats: '0', haplotype: '4qA' });
    expect(summary.diagnosis.confirmation).not.toBe('genetic');
    expect(summary.diagnosis.geneticEvidence.grade).not.toBe('trial_ready');
    expect(summary.diagnosis.ready).toBe(false);
    expect(summary.diagnosis.laboratoryRepeatCount).toBeNull();
  });

  it('也不算排除 —— 没有一句说这份报告否定了 FSHD', () => {
    const summary = summaryFor({ d4z4Repeats: '0', haplotype: '4qA' });
    const evidence = summary.diagnosis.geneticEvidence;
    const everything = `${evidence.headline}${evidence.reason}${evidence.action}\n${
      buildClinicalPassportExport(summary).markdown
    }`;
    expect(everything).toContain('既不拿它当确诊依据，也不拿它当排除依据');
    expect(everything).not.toContain('可用于入组');
    // 「这份报告排除了 / 不支持 FSHD」这类话一句都没有 —— 4qB 那一档才
    // 说得出「不支持这条致病机制」，0 这一档说不出。
    expect(everything).not.toContain('不支持这条致病机制');
    expect(everything).not.toContain('不是允许型');
  });

  it('数照印，并写明本平台读不通它、请医生看原件', () => {
    const summary = summaryFor({ d4z4Repeats: '0', haplotype: '4qA' });
    const evidence = summary.diagnosis.geneticEvidence;
    expect(summary.diagnosis.d4z4Repeats).toBe('0');
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('报告读取');
    expect(evidence.headline).toBe('报告读到的 D4Z4 重复单元数是「0」，本平台读不通这个数');
    expect(evidence.action).toContain('把报告原件带去门诊，请医生看一下这一格写的是什么');
    // 单倍型已经读到了，所以不会再说它「还没有确定的结果」。
    expect(evidence.reason).not.toContain('4qA / 4qB 单倍型这一项');
    expect(summary.nextSteps.map((step) => step.title)).toContain('带着报告原件问一次这个重复数');
  });

  it('单倍型也没读到时，那一项照旧点出来', () => {
    const evidence = summaryFor({ d4z4Repeats: '0' }).diagnosis.geneticEvidence;
    expect(evidence.reason).toContain('4qA / 4qB 单倍型这一项报告上也还没有确定的结果');
  });

  it('灰区、眼底那几条按重复数分组的建议一条都不套', () => {
    const summary = summaryFor({ d4z4Repeats: '0', haplotype: '4qA' });
    expect(summary.diagnosis.geneticEvidence.record.greyZone).toBe(false);
    expect(summary.diagnosis.geneticEvidence.greyZoneNote).toBeNull();
    expect(summary.nextSteps.map((step) => step.title)).not.toContain('问一次眼底检查');
  });

  /** 4qB 那一档的标题说的是单倍型，可页面上照旧印着那个 0。那一段必须
   *  自己把这个 0 说掉 —— 它不是围着 0 写的，所以不会顺手说到。 */
  it('4qB 那一档也把这个 0 说掉', () => {
    const evidence = summaryFor({ d4z4Repeats: '0', haplotype: '4qB' }).diagnosis.geneticEvidence;
    expect(evidence.grade).toBe('non_permissive_haplotype');
    expect(evidence.reason).toContain('报告读到的 D4Z4 重复单元数是「0」，本平台读不通这个数');
  });

  /** 结果不全那一档的标题和依据本来就是围着这个 0 写的，所以同一段里
   *  不会再说第二遍。 */
  it('围着 0 写的那一档不说第二遍', () => {
    const evidence = summaryFor({ d4z4Repeats: '0', haplotype: '4qA' }).diagnosis.geneticEvidence;
    expect(evidence.reason.split('0 个重复单元不是 FSHD1 会有的等位基因')).toHaveLength(2);
  });
});

/**
 * 印出来的那个数，和它为什么什么都没换来 —— 在只印数、不印这一档文案的
 * 那几张纸上。
 *
 * 护照屏和 markdown 导出带着 `reason`，那一段末尾就是这两句话。分享页
 * 印的是横幅加一行「D4Z4 重复数」，转诊资料印的是结论加同一行 —— 两张
 * 纸上都出现过「D4Z4 重复数 18kb（报告读取）」，和一句说这一项没有确定
 * 结果的话，中间什么都没有。读者据此得出的结论是：这个平台读不懂自己
 * 的报告。
 */
describe('印出来但没被判的读数，在每一张印着它的纸上都有一句话', () => {
  const rendered = (fields: Record<string, string>) => {
    const profile = base({ geneticMutation: 'FSHD1', documents: [geneticReport(fields)] } as never);
    const summary = buildClinicalPassportSummary(profile);
    return {
      summary,
      note: summary.diagnosis.geneticEvidence.readingsNotJudged,
      share: buildPassportSharePage(summary, { expiresAt: '2026-09-01T00:00:00.000Z' }),
      markdown: buildClinicalPassportExport(summary).markdown,
    };
  };

  it.each([
    ['以 kb 写的长度', { d4z4Repeats: '18kb', haplotype: '4qA' }, '18kb'],
    ['读到 0 的重复数', { d4z4Repeats: '0', haplotype: '4qA' }, '0'],
  ])('%s：分享页上那一行下面就写着它为什么什么都没换来', (_name, fields, cell) => {
    const { note, share, summary } = rendered(fields as Record<string, string>);
    // 数照印，括号照写。
    expect(summary.diagnosis.d4z4Repeats).toBe(cell);
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('报告读取');
    expect(note).not.toBeNull();
    expect(share).toContain(`<p class="unjudged">${note}</p>`);
    // 在那一行的下面，不在页尾。
    expect(share.indexOf('class="unjudged"')).toBeGreaterThan(
      share.indexOf('<dt>D4Z4 重复数</dt>'),
    );
    expect(share.indexOf('class="unjudged"')).toBeLessThan(share.indexOf('最近记录'));
  });

  it('EcoRI 片段那一格也算 —— 它不在诊断信息的行里，在基因证据那一行里', () => {
    const { note, share, summary } = rendered({ ecoRIFragment: '18kb', haplotype: '4qA' });
    expect(summary.diagnosis.geneEvidence).toContain('18kb');
    expect(note).toContain('18kb');
    expect(share).toContain('class="unjudged"');
  });

  it('确诊那一档没有这句话 —— 那一档什么都没扣下', () => {
    const { note, share } = rendered({ d4z4Repeats: '6', haplotype: '4qA', ecoRIFragment: '18kb' });
    expect(note).toBeNull();
    expect(share).not.toContain('class="unjudged"');
  });

  it('报告什么都没写的时候，也没有这句话可说', () => {
    const { note, share } = rendered({ haplotype: '4qA' });
    expect(note).toBeNull();
    expect(share).not.toContain('class="unjudged"');
  });

  /** 一份护照上可以同时有这两种读数，两句话都要在。 */
  it('两种读数都在的时候，两句话都印', () => {
    const { note } = rendered({ d4z4Repeats: '0', ecoRIFragment: '18kb' });
    expect(note).toContain('本平台读不通这个数');
    expect(note).toContain('本平台不在 kb 和重复单元数之间做换算');
  });

  /** markdown 导出带的是 `reason`，两者说的是同一件事，所以那一段末尾
   *  也一样有 —— 没有哪张纸同时印这两个串。 */
  it('markdown 导出的依据里也有这句话', () => {
    const { markdown } = rendered({ d4z4Repeats: '18kb', haplotype: '4qA' });
    expect(markdown).toContain('本平台不在 kb 和重复单元数之间做换算');
    expect(markdown).not.toContain('class="unjudged"');
  });
});

/**
 * 报告在手上、读过了、只是它没写这两项 —— 这也不是「还没有上传过基因
 * 报告」。
 *
 * 分级以前挂在「两项之一在报告上」这个析取上，所以一份只解析出甲基化的
 * 基因报告会掉到患者自填的那一级，出来的是 未知：依据开头写着「还没有
 * 上传过基因报告」，待办叫人「补充基因检测报告」—— 而同一页上印着
 * 甲基化 32%（报告读取），最近来源里还列着这份报告本身。
 */
describe('只解析出甲基化的基因报告', () => {
  const summary = () =>
    buildClinicalPassportSummary(
      base({
        geneticMutation: 'FSHD1',
        documents: [geneticReport({ methylationValue: '32%' })],
      } as never),
    );

  it('页面上确实印着从这份报告读出来的那一格，报告本身也在最近来源里', () => {
    const s = summary();
    expect(s.diagnosis.methylationValue).toBe('32%');
    expect(s.diagnosis.valueOrigins.methylationValue.labelZh).toBe('报告读取');
    expect(s.timeline.some((item) => item.tag === '报告')).toBe(true);
  });

  it('不再说「还没有上传过基因报告」，也不再叫人去补传一份', () => {
    const s = summary();
    const everything = [
      s.diagnosis.geneticEvidence.headline,
      s.diagnosis.geneticEvidence.reason,
      s.diagnosis.geneticEvidence.action,
      ...s.nextSteps.map((step) => `${step.title}${step.description}`),
      buildClinicalPassportExport(s).markdown,
    ].join('\n');

    expect(s.diagnosis.geneticEvidence.grade).toBe('method_right_incomplete');
    expect(everything).not.toContain('还没有上传过基因报告');
    expect(everything).not.toContain('上传基因检测报告');
    expect(s.nextSteps.map((step) => step.title)).not.toContain('补充基因检测报告');
    expect(s.nextSteps.map((step) => step.title)).not.toContain('补充基因或诊断依据');
  });

  it('患者自己答过「还没测过」也一样 —— 报告读到的东西压过自填的那一级', () => {
    const s = buildClinicalPassportSummary(
      base({
        baseline: withLadder('untested_no_plan'),
        documents: [geneticReport({ methylationValue: '32%' })],
      } as never),
    );
    expect(s.diagnosis.geneticEvidence.grade).toBe('method_right_incomplete');
    expect(s.diagnosis.geneticEvidence.reason).not.toContain('还没有上传过基因报告');
  });

  /**
   * 解析还没落地的那一份仍然留在 未知。`pickGeneticEvidenceDocument` 会
   * 在没有别的文件时挑一份读不出内容的报告，这时页面上一格读数都没有，
   * 而「报告上这两项都还没有确定的结果」是在替一份没人打开过的报告说话。
   */
  it('解析没落地的报告不进这一档 —— 本平台没读过，就不替它说话', () => {
    const s = buildClinicalPassportSummary(
      base({
        documents: [{ ...geneticReport({}), status: 'processing', ocrPayload: null }],
      } as never),
    );
    expect(s.diagnosis.geneticEvidence.grade).toBe('unknown');
    expect(s.diagnosis.geneticEvidence.reason).not.toContain('报告上这两项都还没有确定的结果');
  });
});

/**
 * THE WHOLE MATRIX, BECAUSE 基因确诊 IS A CONJUNCTION AND A CONJUNCTION
 * IS WHERE 「the cell has something in it」 HIDES.
 *
 * The guideline this platform prints on the passport itself defines the
 * genetic analysis as two items and says what happens when one is
 * missing — 「只有 4qA 是允许型，缺了这一项，重复单元数本身不足以下结论」.
 * The gate was an OR over three fields tested with `hasMeaningfulValue`,
 * so it disagreed with that sentence in every direction at once: a lone
 * repeat count earned 基因确诊, a cell reading 未检出 earned it too
 * because the string was non-empty, and 「未检出 4qA 等位基因」 matched the
 * bare substring 4qA and earned 可用于入组 under a headline saying the
 * report already holds what trial enrolment requires.
 *
 * So the three cells are crossed here rather than sampled: each of them
 * present, absent, saying the thing was NOT found, and holding something
 * this platform cannot parse — plus, for the length, a range, which is a
 * real finding that is not a size, and a count the report states
 * perfectly well that is not a contraction. Every combination is
 * rendered and every surface a human reads is read off it.
 */
describe('三格读数的全矩阵 —— 有值 / 空着 / 否定句 / 读不出', () => {
  /** 重复数这一格。`isCount` 是「这一格给出了本平台可以据以判断的重复
   *  数」，`contraction` 是「这个数说的是缩短」—— 两个不同的问题，混成一个
   *  的时候 30 个重复单元拿到了基因确诊。以 kb 写的和 0 都不是 `isCount`：
   *  前者没有可用的界限，后者不是 FSHD1 会有的等位基因。 */
  const D4Z4_CELLS = [
    { name: '空着', value: null, isCount: false, contraction: false },
    { name: '确定的重复数', value: '3', isCount: true, contraction: true },
    { name: '灰区里的重复数', value: '8', isCount: true, contraction: true },
    { name: '大于 10 的重复数', value: '30', isCount: true, contraction: false },
    { name: '零', value: '0', isCount: false, contraction: false },
    { name: '以 kb 写的长度', value: '18kb', isCount: false, contraction: false },
    { name: '区间', value: '1-10', isCount: false, contraction: false },
    { name: '否定句', value: '未检出', isCount: false, contraction: false },
    { name: '读不出的字', value: '见附页', isCount: false, contraction: false },
  ] as const;

  /** EcoRI 片段一律是 kb，而指南给的界限写在重复单元上：本仓库引到的两句
   *  kb —— 「单个 D4Z4 单元长 3.3 kb」和指南自己的「10–20 kb or 1–4
   *  repeats」—— 合不成一个换算，所以推不出能用的 kb 界限。这一格照印，
   *  但不参与确诊、分级、灰区或任何一条建议，所以这里没有 `isSize`
   *  可言。 */
  const ECORI_CELLS = [
    { name: '空着', value: null },
    { name: '确定的片段长度', value: '18kb' },
    { name: '否定句', value: '未检出 EcoRI 片段' },
    { name: '读不出的字', value: '见附页' },
  ] as const;

  const HAPLOTYPE_CELLS = [
    { name: '空着', value: null, verdict: 'none' },
    { name: '允许型', value: '4qA', verdict: 'permissive' },
    { name: '非允许型', value: '4qB', verdict: 'non_permissive' },
    { name: '否定句', value: '未检出 4qA 等位基因', verdict: 'none' },
    { name: '只列了探针', value: '4qA/4qB', verdict: 'none' },
  ] as const;

  const rows = D4Z4_CELLS.flatMap((d4z4) =>
    ECORI_CELLS.flatMap((ecoRI) =>
      HAPLOTYPE_CELLS.map((haplotype) => {
        const fields: Record<string, string> = {};
        if (d4z4.value) fields.d4z4Repeats = d4z4.value;
        if (ecoRI.value) fields.ecoRIFragment = ecoRI.value;
        if (haplotype.value) fields.haplotype = haplotype.value;
        // 分型 is on the page so the unconfirmed states land on
        // `self_reported` rather than `none` — that is the branch whose
        // copy names the printed values, and it is the one that used to
        // deny a reading this same page prints.
        const summary = buildClinicalPassportSummary(
          base({ geneticMutation: 'FSHD1', documents: [geneticReport(fields)] } as never),
        );
        return {
          label: `长度=${d4z4.name} / EcoRI=${ecoRI.name} / 单倍型=${haplotype.name}`,
          /** 分级读的只有重复数这一格 —— `determinateRepeatCount`。EcoRI
           *  片段是 kb，撑不起任何判断。 */
          saysContraction: d4z4.isCount && d4z4.contraction,
          countAboveRange: d4z4.isCount && !d4z4.contraction,
          /** 0 个重复单元不是 FSHD1 会有的等位基因：既不确诊也不排除，
           *  单独一句话交给医生看原件。 */
          countReadsZero: d4z4.value === '0',
          /** 灰区读的也只是重复数这一格 —— `isD4Z4GreyZone` 的区间是以
           *  重复单元写的，EcoRI 片段是 kb。 */
          greyZoneCount: d4z4.value === '8',
          verdict: haplotype.verdict,
          /**
           * The cell strings this report did NOT state a result in.
           * Nothing written in a laboratory's voice may quote one.
           *
           * A kb length and a 0 are NOT in here: this platform did read
           * a number out of those cells, and each has a sentence that
           * names it in order to say what did not follow from it — a
           * number on the page that changed nothing is exactly what a
           * reader stops on.
           */
          unreadCells: [
            ...(d4z4.value && !d4z4.isCount && d4z4.value !== '0' && d4z4.value !== '18kb'
              ? [d4z4.value]
              : []),
            ...(ecoRI.value && ecoRI.value !== '18kb' ? [ecoRI.value] : []),
            ...(haplotype.verdict === 'none' && haplotype.value ? [haplotype.value] : []),
          ],
          summary,
          share: buildPassportSharePage(summary, { expiresAt: '2026-09-01T00:00:00.000Z' }),
          markdown: buildClinicalPassportExport(summary).markdown,
        };
      }),
    ),
  );

  /** Every sentence this passport writes in a laboratory's voice. The
   *  printed VALUES are deliberately not in here: a cell is shown as the
   *  report wrote it, bracket and all, and that is not a claim. */
  const prose = (row: (typeof rows)[number]) =>
    [
      row.summary.diagnosis.geneticEvidence.headline,
      row.summary.diagnosis.geneticEvidence.reason,
      row.summary.diagnosis.geneticEvidence.action,
      ...row.summary.nextSteps.map((step) => `${step.title}${step.description}`),
    ].join('\n');

  it('基因确诊当且仅当报告读到的长度说的是缩短、且单倍型是允许型 4qA', () => {
    for (const row of rows) {
      // `saysContraction` 而不是 `hasSize`：报告写着 D4Z4 30 / 4qA 时两项
      // 都在、都确定，而 30 个重复单元不是 FSHD1 的缩短 —— 这一行以前拿到
      // 的是 基因确诊 / 可用于入组，依据写着「D4Z4 长度 30，单倍型 4qA」。
      const confirmed = row.saysContraction && row.verdict === 'permissive';
      expect(row.summary.diagnosis.confirmation, row.label).toBe(
        row.verdict === 'non_permissive'
          ? 'genetic_non_permissive'
          : confirmed
            ? 'genetic'
            : 'self_reported',
      );
      // 可用于入组 and 基因确诊 are one fact — the guideline sentence
      // this platform quotes for enrolment is 「临床试验的入组无一例外
      // 要求已确认的分子遗传学诊断」 — so they are read off one
      // expression and cannot come apart.
      expect(row.summary.diagnosis.geneticEvidence.grade === 'trial_ready', row.label).toBe(
        confirmed,
      );
      expect(row.summary.diagnosis.ready, row.label).toBe(confirmed);
    }
  });

  it('没确诊的那些行，没有一句说它可用于入组', () => {
    for (const row of rows.filter((item) => item.summary.diagnosis.confirmation !== 'genetic')) {
      const everything = `${prose(row)}\n${row.share}\n${row.markdown}`;
      expect(everything, row.label).not.toContain('可用于入组');
      expect(everything, row.label).not.toContain('入组通常要求');
      // 「未经基因确诊」/「未构成基因确诊」 carry 基因确诊 inside them, so
      // the share banner's own heading is what gets ruled out rather
      // than the substring — on a confirmed row that heading is
      // 「<h2>基因确诊</h2>」 and nothing else on any of these surfaces
      // produces the same bytes.
      expect(everything, row.label).not.toContain('>基因确诊<');
    }
  });

  it('没读出结果的那一格，不会被任何一句当成读数引用', () => {
    for (const row of rows) {
      for (const cell of row.unreadCells) {
        // The value itself still prints — 「未检出」 is what the report
        // says and the row shows it with 报告读取 in its bracket. What
        // may not happen is a sentence quoting it as a length or a
        // haplotype, which is how 「D4Z4 长度 未检出，单倍型 4qA」 came to
        // be handed to a neurologist as a 依据.
        expect(prose(row), `${row.label} :: ${cell}`).not.toContain(cell);
      }
    }
  });

  it('每一行的横幅和确认状态说的是同一件事', () => {
    for (const row of rows) {
      const { confirmation } = row.summary.diagnosis;
      if (confirmation === 'genetic') {
        expect(row.share, row.label).toContain('<div class="banner ok">');
        expect(row.share, row.label).toContain('基因确诊');
      } else if (confirmation === 'genetic_non_permissive') {
        expect(row.share, row.label).toContain('<div class="banner warn">');
        expect(row.share, row.label).toContain('4q 单倍型不是允许型');
      } else {
        expect(row.share, row.label).toContain('<div class="banner warn">');
        expect(row.share, row.label).toContain('未经基因确诊');
      }
    }
  });

  it('灰区只在报告真的写了 8–10 个单元、且没写 4qB 时才判', () => {
    for (const row of rows) {
      const expected = row.greyZoneCount && row.verdict !== 'non_permissive';
      expect(row.summary.diagnosis.geneticEvidence.record.greyZone, row.label).toBe(expected);
      expect(Boolean(row.summary.diagnosis.geneticEvidence.greyZoneNote), row.label).toBe(expected);
    }
    // 否定句里的 8 不是 8。
    const negatedEight = buildClinicalPassportSummary(
      base({
        documents: [geneticReport({ d4z4Repeats: '未检出8个单元', haplotype: '4qA' })],
      } as never),
    );
    expect(negatedEight.diagnosis.geneticEvidence.record.greyZone).toBe(false);
    expect(negatedEight.diagnosis.confirmation).not.toBe('genetic');
  });

  /**
   * 灰区在「说的是缩短」这条线的哪一边。
   *
   * 指南对 8 个单元的报告口径是「可能致病」，本仓库引的 Xia 2024 里那
   * 219 例确诊 FSHD1 的重复单元数是 2–9 个，而灰区说明自己那一段的最后
   * 一句是「这不推翻你的诊断」。所以把界划在灰区下沿，会让护照一边否认
   * 一个数、一边在同一页上安慰读者说这个数不推翻什么。界划在指南自己
   * 写的那个数上：大于 10。
   */
  it('灰区仍然算缩短，11 个单元不算 —— 界在指南写的 10 上，不在灰区下沿', () => {
    const confirmationFor = (repeats: string) =>
      buildClinicalPassportSummary(
        base({ documents: [geneticReport({ d4z4Repeats: repeats, haplotype: '4qA' })] } as never),
      ).diagnosis.confirmation;
    for (const inside of ['1', '7', '8', '9', '10']) {
      expect(confirmationFor(inside), inside).toBe('genetic');
    }
    for (const outside of ['11', '30', '150']) {
      expect(confirmationFor(outside), outside).not.toBe('genetic');
    }
  });

  it('全表都不再逐条点名那三项读数 —— 那是把评级规则抄进了纸面', () => {
    for (const row of rows) {
      const everything = `${prose(row)}\n${row.share}\n${row.markdown}\n${
        row.summary.summaryCards.find((card) => card.key === 'diagnosis')?.summary ?? ''
      }`;
      expect(everything, row.label).not.toContain('D4Z4 重复数、4q 单倍型或 EcoRI 片段');
      expect(everything, row.label).not.toContain('4q 单倍型或 EcoRI 片段');
    }
  });

  it('报告在手上、只是缺一项时，不会再让人去上传一份已经传过的报告', () => {
    for (const row of rows.filter(
      (item) => item.summary.diagnosis.geneticEvidence.grade === 'method_right_incomplete',
    )) {
      const titles = row.summary.nextSteps.map((step) => step.title);
      // 重复数大于 10 的那些行两项都在，没有哪一项要去要 —— 那一条待办
      // 问的是这个数怎么解读，用的是 4qB 那一条已有的说法。
      expect(titles, row.label).toContain(
        row.countAboveRange || row.countReadsZero
          ? '带着报告原件问一次这个重复数'
          : '问一下报告里缺的那一项',
      );
      expect(titles, row.label).not.toContain('补充基因检测报告');
      expect(titles, row.label).not.toContain('补充基因或诊断依据');
    }
  });

  /**
   * 文案不否认这一页自己印着的读数。
   *
   * 三格的读数器现在只扣下否定句和探针清单的 VALUE，raw 照印，括号里写
   * 着「报告读取」。所以护照上会同时出现「D4Z4 重复数 未检出（报告读
   * 取）」和「还没有看到 D4Z4 重复单元数」—— 后半句是假的，本平台看到
   * 了，报告写的是未检出。「只差某一项」也一样：4qA/4qB 这一格印在页面
   * 上，不是缺。
   */
  it('没有一行说自己没看到页面上印着的那一格', () => {
    for (const row of rows) {
      const everything = `${prose(row)}\n${row.share}\n${row.markdown}`;
      expect(everything, row.label).not.toContain('还没有看到');
      expect(everything, row.label).not.toContain('只差');
      expect(everything, row.label).not.toContain('还没读到');
    }
  });

  it('读到了但不是确定结果的那一格，说的是「没有确定的结果」', () => {
    for (const row of rows.filter(
      (item) => item.summary.diagnosis.geneticEvidence.grade === 'method_right_incomplete',
    )) {
      const evidence = row.summary.diagnosis.geneticEvidence;
      // 大于 10 的那一档两项都读到了，0 那一档是读到了一个读不通的数，
      // 两者说的都是另一件事。
      if (row.countAboveRange || row.countReadsZero) continue;
      expect(`${evidence.headline}${evidence.reason}`, row.label).toContain('还没有确定的结果');
    }
  });
});

/**
 * 否定句里带着数字，是这三格上同一个缺陷的最后一种形状。
 *
 * `parsePermissiveHaplotype` matched the bare substring 4qA, and the
 * size cells were parsed for 「what number is in this string」 — so a
 * cell whose whole content is a statement that nothing was found still
 * handed over the number inside it.
 */
describe('否定句里的数字不是读数', () => {
  const readingOf = (fields: Record<string, string>) =>
    buildClinicalPassportSummary(base({ documents: [geneticReport(fields)] } as never)).diagnosis
      .geneticEvidence;

  it('「未检出 4qA 等位基因」不是允许型', () => {
    const e = readingOf({ d4z4Repeats: '3', haplotype: '未检出 4qA 等位基因' });
    expect(e.record.permissiveHaplotype).toBeNull();
    expect(e.grade).not.toBe('trial_ready');
  });

  it('「未检出3个重复单元的缩短」不是长度', () => {
    const e = readingOf({ d4z4Repeats: '未检出3个重复单元的缩短', haplotype: '4qA' });
    expect(e.record.d4z4?.value).toBeNull();
    expect(e.record.d4z4?.raw).toBe('未检出3个重复单元的缩短');
    expect(e.grade).toBe('method_right_incomplete');
  });

  it('「未检出10kb以下片段」不是 EcoRI 片段长度', () => {
    const e = readingOf({ ecoRIFragment: '未检出10kb以下片段', haplotype: '4qA' });
    expect(e.grade).toBe('method_right_incomplete');
    expect(e.reason).not.toContain('10kb');
  });

  it('英文的 not detected 一样拦得住', () => {
    const e = readingOf({ d4z4Repeats: '3', haplotype: '4qA not detected' });
    expect(e.record.permissiveHaplotype).toBeNull();
    expect(e.grade).not.toBe('trial_ready');
  });
});

/**
 * 页面印着一格读数，同一页的文案不能说这一格没读到。
 *
 * 读数器扣下的是 VALUE，raw 原样留着，所以这些格子都印在护照上，括号里
 * 写的是「报告读取」。文案原本落在「报告还没写这一项」那一套话上 ——
 * 「还没有看到 D4Z4 重复单元数」、「只差「4qA / 4qB 单倍型」」—— 一个拿着
 * 护照的人抬眼就能看见那一格。
 */
describe('method_right_incomplete 的文案对得上页面上印着的读数', () => {
  const rendered = (fields: Record<string, string>) => {
    const summary = buildClinicalPassportSummary(
      base({ geneticMutation: 'FSHD1', documents: [geneticReport(fields)] } as never),
    );
    const evidence = summary.diagnosis.geneticEvidence;
    return {
      summary,
      copy: `${evidence.headline}${evidence.reason}${evidence.action}`,
      printed: `${summary.diagnosis.d4z4Repeats}\n${summary.diagnosis.geneEvidence}`,
    };
  };

  it.each([
    ['否定句', { d4z4Repeats: '未检出', haplotype: '4qA' }, '未检出'],
    ['区间', { d4z4Repeats: '1-10', haplotype: '4qA' }, '1-10'],
    ['读不出的字', { d4z4Repeats: '见附页', haplotype: '4qA' }, '见附页'],
  ])('长度这一格是%s时，页面印着它，文案说的是「没有确定的结果」', (_name, fields, cell) => {
    const { copy, printed, summary } = rendered(fields as Record<string, string>);
    expect(printed).toContain(cell);
    expect(summary.diagnosis.valueOrigins.d4z4Repeats.labelZh).toBe('报告读取');
    expect(copy).not.toContain('还没有看到');
    expect(copy).not.toContain('只差');
    expect(copy).toContain('D4Z4 重复单元数这一项还没有确定的结果');
  });

  it.each([
    ['探针清单', { d4z4Repeats: '3', haplotype: '4qA/4qB' }, '4qA/4qB'],
    ['否定句', { d4z4Repeats: '3', haplotype: '未检出 4qA 等位基因' }, '未检出 4qA 等位基因'],
  ])('单倍型这一格是%s时同理', (_name, fields, cell) => {
    const { copy, printed } = rendered(fields as Record<string, string>);
    expect(printed).toContain(cell);
    expect(copy).not.toContain('还没有看到');
    expect(copy).not.toContain('只差');
    expect(copy).toContain('4qA / 4qB 单倍型这一项还没有确定的结果');
  });

  it('两格都读到了却都不是结果时，也不说「还没读到」', () => {
    const { copy, printed } = rendered({ d4z4Repeats: '未检出', haplotype: '4qA/4qB' });
    expect(printed).toContain('未检出');
    expect(printed).toContain('4qA/4qB');
    expect(copy).not.toContain('还没读到');
    expect(copy).toContain('这两项都还没有确定的结果');
  });

  it('两格都是空的时候，同一句话照样成立 —— 一种说法，不是两种', () => {
    const { copy } = rendered({ geneticTestMethod: 'southern_blot' });
    expect(copy).toContain('这两项都还没有确定的结果');
    // 「可能是报告本身没写，也可能是我们没能从图片里读出来」把原因数尽
    // 了，而报告写着未检出是第三种；这句话删掉，没有换成更长的一句。
    expect(copy).not.toContain('可能是报告本身没写');
  });
});
