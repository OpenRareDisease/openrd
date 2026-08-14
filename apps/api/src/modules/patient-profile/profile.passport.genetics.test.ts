import { describe, expect, it } from 'vitest';

import {
  buildClinicalPassportExport,
  buildClinicalPassportSummary,
  isD4Z4GreyZone,
  isLargeD4Z4Deletion,
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
  ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
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
  ])('%s（%s）isRange=true 且 value 为空', (raw) => {
    const reading = parseD4Z4Reading(raw);
    expect(reading.isRange).toBe(true);
    expect(reading.value).toBeNull();
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
  // 值从上传的报告里走一遍再判断：`ReportReadD4Z4` 没有字符串构造器，
  // 而且要证明的本来就是「报告上印成这样时，指南那一条到底出不出」。
  const readsAsLargeDeletion = (raw: string) =>
    isLargeD4Z4Deletion(
      buildClinicalPassportSummary(
        base({ documents: [geneticReport({ d4z4Repeats: raw })] } as never),
      ).diagnosis.geneticEvidence.record.d4z4,
    );

  it.each([['1-10'], ['≤10'], ['4~7'], ['1 至 10'], [''], ['—'], ['未检出'], ['0'], ['5']])(
    '%s 不触发',
    (raw) => {
      expect(readsAsLargeDeletion(raw)).toBe(false);
    },
  );
  it.each([['1'], ['2'], ['3'], ['4'], ['3个']])('%s 触发', (raw) => {
    expect(readsAsLargeDeletion(raw)).toBe(true);
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
  it('长度 + 单倍型齐了才算', () => {
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
    expect(e.headline).toContain('方法是对的');
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
    expect(reason).toContain('这两项都还没读到');
  });

  it('只写了方法、什么结果都没读到时同理', () => {
    const reason = reasonFor({ geneticTestMethod: 'southern_blot' });
    expect(reason).not.toContain('null');
    expect(reason).not.toContain('已有');
    expect(reason).toContain('这两项都还没读到');
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
