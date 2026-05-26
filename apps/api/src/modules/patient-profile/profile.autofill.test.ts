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
          documentType: 'genetic_report',
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
          documentType: 'genetic_report',
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
          documentType: 'genetic_report',
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
