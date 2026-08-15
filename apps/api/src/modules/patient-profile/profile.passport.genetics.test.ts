import { describe, expect, it } from 'vitest';

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
  // 值从上传的基因报告里走一遍，再看渲染出来的待办：`ReportReadD4Z4` 既没有
  // 字符串构造器，也不再是 `record.d4z4` 本身 —— 那个字段是给显示用的，
  // 病历摘要抄来的读数也在里面。要证明的本来就是「基因报告上印成这样时，
  // 指南那一条到底出不出」，那就照它出现在页面上的样子问。
  const readsAsLargeDeletion = (raw: string) =>
    buildClinicalPassportSummary(
      base({ documents: [geneticReport({ d4z4Repeats: raw })] } as never),
    ).nextSteps.some((step) => step.title === '问一次眼底检查');

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

  it('重复数是区间、EcoRI 片段是确切值时，印出来的是那个确切值', () => {
    // 「有没有长度」和「长度是多少」出自同一个表达式，所以印在依据里的
    // 不会是另一项的读数。
    const e = buildClinicalPassportSummary(
      base({
        documents: [
          geneticReport({ d4z4Repeats: '1-10', ecoRIFragment: '18kb', haplotype: '4qA' }),
        ],
      } as never),
    ).diagnosis.geneticEvidence;
    expect(e.grade).toBe('trial_ready');
    expect(e.reason).toContain('D4Z4 长度 18kb');
    expect(e.reason).not.toContain('1-10');
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
