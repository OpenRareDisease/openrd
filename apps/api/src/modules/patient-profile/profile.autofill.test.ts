import { describe, expect, it } from 'vitest';
import { applyGeneticReportAutofill } from './profile.autofill.js';

describe('applyGeneticReportAutofill', () => {
  it('fills missing FSHD baseline fields from genetic report OCR output', () => {
    const result = applyGeneticReportAutofill(
      {
        diagnosisDate: null,
        geneticMutation: null,
        baseline: null,
      },
      [
        {
          id: 'd1',
          documentType: 'genetic_report',
          status: 'parsed',
          uploadedAt: '2026-04-01T08:00:00.000Z',
          ocrPayload: {
            fields: {
              classifiedType: 'genetic_report',
              diagnosisType: 'FSHD1',
              d4z4Repeats: '3/22',
              haplotype: '4qA',
              methylationValue: '12%',
            },
          },
        },
      ],
    );

    expect(result.geneticMutation).toBe('FSHD1');
    expect(result.baseline).toEqual({
      foundation: {},
      diseaseBackground: {
        diagnosisType: 'FSHD1',
        d4z4: '3/22',
        haplotype: '4qA',
        methylation: '12%',
      },
    });
  });

  it('preserves manually entered values when OCR only provides fallbacks', () => {
    const result = applyGeneticReportAutofill(
      {
        diagnosisDate: '2023-05-20',
        geneticMutation: 'Manual mutation note',
        baseline: {
          foundation: {
            diagnosisYear: 2023,
          },
          diseaseBackground: {
            diagnosedFshd: true,
            diagnosisType: 'Manual type',
            d4z4: '5/22',
          },
        },
      },
      [
        {
          id: 'd1',
          documentType: 'genetic_report',
          status: 'parsed',
          uploadedAt: '2026-04-01T08:00:00.000Z',
          ocrPayload: {
            fields: {
              diagnosisType: 'FSHD1',
              d4z4Repeats: '3/22',
              haplotype: '4qA',
              methylationValue: '12%',
            },
          },
        },
      ],
    );

    expect(result.diagnosisDate).toBe('2023-05-20');
    expect(result.geneticMutation).toBe('Manual mutation note');
    expect(result.baseline).toEqual({
      foundation: {
        diagnosisYear: 2023,
      },
      diseaseBackground: {
        // The patient's own answer, carried through untouched. It was
        // already here; nothing in this function may write it, and
        // nothing in this function may erase it either.
        diagnosedFshd: true,
        diagnosisType: 'Manual type',
        d4z4: '5/22',
        haplotype: '4qA',
        methylation: '12%',
      },
    });
  });

  it('treats empty strings as missing and still backfills from OCR', () => {
    const result = applyGeneticReportAutofill(
      {
        diagnosisDate: '',
        geneticMutation: '',
        baseline: {
          diseaseBackground: {
            diagnosisType: '',
          },
        },
      },
      [
        {
          id: 'd1',
          documentType: 'genetic_report',
          status: 'parsed',
          uploadedAt: '2026-04-01T08:00:00.000Z',
          ocrPayload: {
            fields: {
              diagnosisType: 'FSHD1',
              d4z4Repeats: '3/22',
            },
          },
        },
      ],
    );

    expect(result.geneticMutation).toBe('FSHD1');
    expect(result.baseline).toEqual({
      foundation: {},
      diseaseBackground: {
        diagnosisType: 'FSHD1',
        d4z4: '3/22',
      },
    });
  });
});

/**
 * 「是否确诊 FSHD」 问的是患者自己，报告替不了他回答。
 *
 * 这一格问的是「有没有医生诊断过你」。答它的只有患者本人 —— 报告上没有
 * 这个答案，本平台也编不出来。这个函数原本会在四格里任意一格有结果时写
 * 下 `diagnosedFshd: true`：那是把本平台自己编的一个答案，写进患者那道
 * 题的档案里。档案不是页面 —— 护照上的句子重渲染就没了，档案里的这一个
 * 不会，而且几份可携带导出都会把它读回去。
 *
 * 它和「基因确诊」也不是同一件事。基因确诊由证据闸口按报告判定、是推导
 * 出来的，从不入库；一个人可以有临床诊断而没有基因确诊，两者可以不一
 * 致。两件事都留着，谁也不从谁那里写出来。
 */
describe('applyGeneticReportAutofill：「是否确诊 FSHD」由患者自己答，这里一律不写', () => {
  const fill = (fields: Record<string, string>, baseline: Record<string, unknown> | null = null) =>
    applyGeneticReportAutofill({ diagnosisDate: null, geneticMutation: null, baseline }, [
      {
        id: 'd1',
        documentType: 'genetic_report',
        status: 'parsed',
        uploadedAt: '2026-04-01T08:00:00.000Z',
        ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
      },
    ]);

  const diseaseBackground = (
    fields: Record<string, string>,
    baseline: Record<string, unknown> | null = null,
  ) =>
    (fill(fields, baseline).baseline as Record<string, Record<string, unknown>> | null)
      ?.diseaseBackground;

  it.each([
    ['两项齐全的阳性报告', { d4z4Repeats: '3', haplotype: '4qA' }],
    ['只有一个重复数', { d4z4Repeats: '3' }],
    ['区间', { d4z4Repeats: '1-10' }],
    ['以 kb 写的长度', { d4z4Repeats: '18kb' }],
    ['重复数是 0', { d4z4Repeats: '0' }],
    ['非允许型单倍型', { d4z4Repeats: '3', haplotype: '4qB' }],
    ['否定句', { d4z4Repeats: '未检出' }],
    ['几格都是否定句', { d4z4Repeats: '未检出', haplotype: '未见', methylationValue: '阴性' }],
    ['只有分型', { diagnosisType: 'FSHD1' }],
  ])('报告写的是%s时，档案里不出现这一格', (_name, fields) => {
    expect(diseaseBackground(fields as Record<string, string>)).not.toHaveProperty('diagnosedFshd');
  });

  it('值本身照写 —— 档案不能悄悄丢掉实验室说过的话', () => {
    expect(diseaseBackground({ d4z4Repeats: '未检出' })?.d4z4).toBe('未检出');
    expect(diseaseBackground({ d4z4Repeats: '18kb' })?.d4z4).toBe('18kb');
    expect(diseaseBackground({ d4z4Repeats: '0' })?.d4z4).toBe('0');
  });

  it.each([[true], [false]])('患者自己答过的（%s）原样留着', (answer) => {
    expect(
      diseaseBackground(
        { d4z4Repeats: '3', haplotype: '4qA' },
        { diseaseBackground: { diagnosedFshd: answer } },
      )?.diagnosedFshd,
    ).toBe(answer);
  });

  /**
   * 两件事可以不一致，而且这是临床上很平常的一种状态。
   *
   * 一个人可以有临床诊断而没有基因确诊；反过来，一个人也可以在建档表单上
   * 答「没被诊断过」，而手上的报告已经写全了两项。哪一边都不许改写另一
   * 边 —— 患者的答案照他填的留着，报告的读数照报告写的留着。
   */
  it('患者答「没有」而报告写全了两项时，两个答案各留各的', () => {
    const disease = diseaseBackground(
      { d4z4Repeats: '3', haplotype: '4qA', diagnosisType: 'FSHD1' },
      { diseaseBackground: { diagnosedFshd: false } },
    );
    expect(disease?.diagnosedFshd).toBe(false);
    expect(disease?.d4z4).toBe('3');
    expect(disease?.haplotype).toBe('4qA');
    expect(disease?.diagnosisType).toBe('FSHD1');
  });

  /** 报告一个字都没读出来时，这个函数原样返回 profile —— 患者的答案连
   *  经手都不经手。 */
  it('报告读不出任何东西时，档案原样返回', () => {
    const baseline = { diseaseBackground: { diagnosedFshd: true } };
    const result = applyGeneticReportAutofill(
      { diagnosisDate: null, geneticMutation: null, baseline },
      [
        {
          id: 'd1',
          documentType: 'genetic_report',
          status: 'parsed',
          uploadedAt: '2026-04-01T08:00:00.000Z',
          ocrPayload: { fields: { classifiedType: 'genetic_report' } },
        },
      ],
    );
    expect(result.baseline).toBe(baseline);
  });
});
