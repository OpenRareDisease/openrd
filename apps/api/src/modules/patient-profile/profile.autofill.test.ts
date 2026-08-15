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
        diagnosedFshd: true,
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
        diagnosedFshd: true,
        diagnosisType: 'FSHD1',
        d4z4: '3/22',
      },
    });
  });
});

/**
 * 「是否确诊 FSHD」 写进的是档案，不是一句话。
 *
 * 这一格原本是 `derived.diagnosisType || derived.d4z4 || ...` —— 问的是
 * 这几格有没有字，而「未检出」有字。所以一份基因内容只有「d4z4Repeats:
 * 未检出」的基因报告，会往 baseline 里写下 `diagnosedFshd: true`；护照
 * 上的句子重渲染就没了，档案里的这一个不会，而且几份可携带导出都会把它
 * 读回去。
 *
 * 用的是护照自己那个读格子的判断（`reportsAbsence`），不是在这里再写一
 * 个：一份报告说了什么是一个问题，两边必须给同一个答案。
 */
describe('applyGeneticReportAutofill：否定句不写「是否确诊 FSHD」', () => {
  const fill = (fields: Record<string, string>) =>
    applyGeneticReportAutofill({ diagnosisDate: null, geneticMutation: null, baseline: null }, [
      {
        id: 'd1',
        documentType: 'genetic_report',
        status: 'parsed',
        uploadedAt: '2026-04-01T08:00:00.000Z',
        ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
      },
    ]);

  const diseaseBackground = (fields: Record<string, string>) =>
    (fill(fields).baseline as Record<string, Record<string, unknown>> | null)?.diseaseBackground;

  it.each([
    ['d4z4Repeats', '未检出'],
    ['haplotype', '未检出 4qA 等位基因'],
    ['diagnosisType', '未检出'],
    ['methylationValue', '阴性'],
    ['d4z4Repeats', 'not detected'],
  ])('%s 这一格写着「%s」时，不写 diagnosedFshd', (key, value) => {
    expect(diseaseBackground({ [key]: value })?.diagnosedFshd).toBeUndefined();
  });

  it('值本身照写 —— 档案不能悄悄丢掉实验室说过的话', () => {
    expect(diseaseBackground({ d4z4Repeats: '未检出' })?.d4z4).toBe('未检出');
  });

  it('几格都是否定句时也不写', () => {
    expect(
      diseaseBackground({ d4z4Repeats: '未检出', haplotype: '未见', methylationValue: '阴性' })
        ?.diagnosedFshd,
    ).toBeUndefined();
  });

  it('真读到结果时照旧写', () => {
    expect(diseaseBackground({ d4z4Repeats: '3', haplotype: '4qA' })?.diagnosedFshd).toBe(true);
  });

  it('区间是真实的结果，只是没定到一个数 —— 照旧写', () => {
    expect(diseaseBackground({ d4z4Repeats: '1-10' })?.diagnosedFshd).toBe(true);
  });

  it('患者自己已经答过的，不被覆盖', () => {
    const result = applyGeneticReportAutofill(
      {
        diagnosisDate: null,
        geneticMutation: null,
        baseline: { diseaseBackground: { diagnosedFshd: false } },
      },
      [
        {
          id: 'd1',
          documentType: 'genetic_report',
          status: 'parsed',
          uploadedAt: '2026-04-01T08:00:00.000Z',
          ocrPayload: { fields: { classifiedType: 'genetic_report', d4z4Repeats: '3' } },
        },
      ],
    );
    const disease = (result.baseline as Record<string, Record<string, unknown>>).diseaseBackground;
    expect(disease.diagnosedFshd).toBe(false);
  });
});
