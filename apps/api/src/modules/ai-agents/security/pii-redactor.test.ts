import { describe, expect, it, vi } from 'vitest';

import { redactFields } from './pii-redactor.js';

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return silentLogger;
  },
};

const profileSample = {
  // Layer 1 hard-delete
  fullName: '张三',
  contactPhone: '13812345678',
  contactEmail: 'zhangsan@example.com',
  idCard: '11010119900520XXXX',
  dateOfBirth: '1990-05-20',
  regionDistrict: '海淀',
  notes: '私人备注，不能进 prompt',
  // Layer 2 candidates (strict mode clinicalises)
  d4z4: '3/22',
  methylation: '12%',
  haplotype: '4qA',
  diagnosisDate: '2023-06-01',
  // Already-clinical or non-PII fields
  ageGroup: '30_39',
  gender: 'female',
  diagnosisStage: 'confirmed',
  diagnosisYear: 2023,
  diagnosisType: 'FSHD1',
  onsetRegion: '肩胛带',
  familyHistory: '母亲疑似',
  independentlyAmbulatory: true,
  assistiveDevices: ['AFO'],
  // A made-up rogue key not in any allowlist
  privateScratchpad: 'should be dropped with a warning',
};

describe('redactFields (profile, strict mode)', () => {
  it('hard-deletes obvious identifiers regardless of mode', () => {
    const { fields, stats } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
      logger: silentLogger as unknown as Parameters<typeof redactFields>[1]['logger'],
    });
    for (const key of [
      'fullName',
      'contactPhone',
      'contactEmail',
      'idCard',
      'regionDistrict',
      'notes',
    ]) {
      expect(stats.hardDeleted).toContain(key);
      expect(fields[key]).toBeUndefined();
    }
  });

  it('clinicalises D4Z4 / methylation / haplotype and drops the raw values', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
    });
    expect(fields.d4z4).toBeUndefined();
    expect(fields.methylation).toBeUndefined();
    expect(fields.haplotype).toBeUndefined();
    expect(fields.d4z4_clinical).toBe('low_repeat_severe');
    expect(fields.methylation_clinical).toBe('hypomethylated_severe');
    expect(fields.haplotype_clinical).toBe('pathogenic_haplotype_permissive');
  });

  it('replaces diagnosisDate with diagnosisYear', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
    });
    expect(fields.diagnosisDate).toBeUndefined();
    expect(fields.diagnosisYear).toBe(2023);
  });

  it('drops fields not in the strict allowlist and warns', () => {
    const warn = vi.fn();
    const fakeLogger = {
      fatal: vi.fn(),
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child() {
        return fakeLogger;
      },
    };
    const { fields, stats } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
      logger: fakeLogger as unknown as Parameters<typeof redactFields>[1]['logger'],
    });
    expect(fields.privateScratchpad).toBeUndefined();
    expect(stats.notAllowed).toContain('privateScratchpad');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('passes allowed clinical fields through', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'strict',
    });
    expect(fields.ageGroup).toBe('30_39');
    expect(fields.gender).toBe('female');
    expect(fields.diagnosisType).toBe('FSHD1');
    expect(fields.onsetRegion).toBe('肩胛带');
    expect(fields.independentlyAmbulatory).toBe(true);
    expect(fields.assistiveDevices).toEqual(['AFO']);
  });
});

describe('HARD_DELETE_KEYS is matched case-insensitively', () => {
  it('removes PatientName / PATIENT_NAME / Date_Of_Birth / EMAIL', () => {
    const input = {
      PatientName: '李四',
      PATIENT_NAME: '王五',
      Date_Of_Birth: '1990-05-20',
      EMAIL: 'leak@example.com',
      diagnosisType: 'FSHD1',
    };
    const { fields, stats } = redactFields(input, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.PatientName).toBeUndefined();
    expect(fields.PATIENT_NAME).toBeUndefined();
    expect(fields.Date_Of_Birth).toBeUndefined();
    expect(fields.EMAIL).toBeUndefined();
    expect(stats.hardDeleted).toEqual(
      expect.arrayContaining(['PatientName', 'PATIENT_NAME', 'Date_Of_Birth', 'EMAIL']),
    );
    expect(fields.diagnosisType).toBe('FSHD1');
  });
});

describe('redactFields (profile, precise mode)', () => {
  it('preserves raw d4z4 / methylation / haplotype values', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.d4z4).toBe('3/22');
    expect(fields.methylation).toBe('12%');
    expect(fields.haplotype).toBe('4qA');
    expect(fields.d4z4_clinical).toBeUndefined();
  });

  it('still hard-deletes pure identifiers in precise mode', () => {
    const { fields } = redactFields(profileSample, {
      scope: 'profile',
      mode: 'precise',
    });
    expect(fields.fullName).toBeUndefined();
    expect(fields.contactPhone).toBeUndefined();
    expect(fields.idCard).toBeUndefined();
    expect(fields.notes).toBeUndefined();
  });
});

describe('redactFields (reports)', () => {
  const reportFields = {
    classifiedType: 'genetic_report',
    documentType: 'genetic_report',
    title: '基因检测报告',
    reportDate: '2026-04-01',
    status: 'processed',
    fields: {
      classifiedType: 'genetic_report',
      diagnosisType: 'FSHD1',
      d4z4Repeats: '3/22',
      haplotype: '4qA',
      methylationValue: '12%',
      reportIssueDate: '2026-04-01',
    },
  };

  it('strict mode clinicalises OCR field map and drops the raw `fields`', () => {
    const { fields } = redactFields(reportFields, {
      scope: 'reports',
      mode: 'strict',
    });
    expect(fields.fields).toBeUndefined();
    expect(fields.reportDate).toBeUndefined();
    expect(fields.reportDate_year).toBe(2026);
    const fc = fields.fields_clinical as Record<string, unknown>;
    expect(fc).toBeDefined();
    expect(fc.d4z4Repeats_clinical).toBe('low_repeat_severe');
    expect(fc.haplotype_clinical).toBe('pathogenic_haplotype_permissive');
    expect(fc.methylationValue_clinical).toBe('hypomethylated_severe');
    expect(fc.reportIssueDate_year).toBe(2026);
  });

  it('strict mode drops unknown OCR keys (deny-by-default)', () => {
    const { fields } = redactFields(
      {
        ...reportFields,
        fields: {
          ...(reportFields.fields as Record<string, unknown>),
          patientName: '张三',
          freeFormFindings: '患者张三主诉下肢无力，姓名身份证已记录',
          classifiedType: 'genetic_report',
        },
      },
      { scope: 'reports', mode: 'strict' },
    );
    const fc = fields.fields_clinical as Record<string, unknown>;
    expect(fc.patientName).toBeUndefined();
    expect(fc.freeFormFindings).toBeUndefined();
    expect(fc.classifiedType).toBeUndefined();
    // Known-pattern keys still survive as clinicalised siblings.
    expect(fc.d4z4Repeats_clinical).toBe('low_repeat_severe');
  });

  it('strict mode strips `title` even when callers add it', () => {
    const { fields } = redactFields(
      { ...reportFields, title: '张三的基因检测报告 2026' },
      { scope: 'reports', mode: 'strict' },
    );
    expect(fields.title).toBeUndefined();
  });

  it('precise mode keeps raw OCR fields and raw report date', () => {
    const { fields } = redactFields(reportFields, {
      scope: 'reports',
      mode: 'precise',
    });
    const f = fields.fields as Record<string, unknown>;
    expect(f).toBeDefined();
    expect(f.d4z4Repeats).toBe('3/22');
    expect(f.haplotype).toBe('4qA');
    expect(fields.fields_clinical).toBeUndefined();
  });
});
