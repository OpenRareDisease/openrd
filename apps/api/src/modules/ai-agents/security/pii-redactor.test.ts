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
  independentlyAmbulatory: 'unable',
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
    expect(fields.independentlyAmbulatory).toBe('unable');
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
    // `classifiedType` is a classification the pipeline assigned, not a
    // measurement and not an identifier, so strict keeps it. Dropping
    // it left the report summariser unable to say what kind of report
    // it was reading — it called a stool panel「血液检测报告」.
    expect(fc.classifiedType).toBe('genetic_report');
    // Known-pattern keys still survive as clinicalised siblings.
    expect(fc.d4z4Repeats_clinical).toBe('low_repeat_severe');
  });

  it('strict mode keeps qualitative results but withholds measurements', () => {
    const { fields } = redactFields(
      {
        fields: {
          classifiedType: 'infection_screening',
          tppa: '阴性(-)',
          trust_ab: '阴性(-)',
          ck: '1024',
          fvc: '2.31',
          patientName: '张三',
        },
      },
      { scope: 'reports', mode: 'strict' },
    );
    const fc = fields.fields_clinical as Record<string, unknown>;
    // The consent the patient withheld is「精确数值」, and 阴性 is not a
    // number — it is the test's own conclusion.
    expect(fc.tppa).toBe('阴性(-)');
    expect(fc.trust_ab).toBe('阴性(-)');
    // Measurements stay withheld, but their existence is stated so the
    // model reports「需要授权」rather than「报告识别失败」.
    expect(fc.ck).toBeUndefined();
    expect(fc.fvc).toBeUndefined();
    expect(fc.numericValuesWithheld).toBe(2);
    expect(fc.patientName).toBeUndefined();
  });

  // A titre is the number, wearing a qualitative word in front of it.
  // The value observed in production inside `ecgSummary` — a key on the
  // precise safe list. The allowlist's premise is that a listed key
  // holds a short structured value; the extractor broke that premise,
  // and every row already in the database still holds the old value.
  it('drops a safe key whose value carries an identifier', () => {
    const { fields } = redactFields(
      {
        fields: {
          classifiedType: 'ecg',
          ecgSummary:
            '房率: 70 bmp 实性心律不齐 年龄:23 科别:神经内科 门诊号: 住院号:R000000 本报告仅供临床医师参考',
          heartRate: '70',
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.ecgSummary).toBeUndefined();
    expect(f.fieldsDroppedAsUnsafe).toBe(1);
    // The rest of the report is untouched — one bad value is not a
    // reason to withhold the whole panel.
    expect(f.heartRate).toBe('70');
  });

  it('drops a safe key whose value is far too long to be one', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'ecg', ecgSummary: '所见描述文字。'.repeat(40) } },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.ecgSummary).toBeUndefined();
    expect(f.fieldsDroppedAsUnsafe).toBe(1);
  });

  it('keeps a normal conclusion', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'ecg', ecgSummary: '窦性心律不齐，不完全性右束支传导阻滞。' } },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.ecgSummary).toBe('窦性心律不齐，不完全性右束支传导阻滞。');
    expect(f.fieldsDroppedAsUnsafe).toBeUndefined();
  });

  // `reportImpression` is not on the safe list at all, so the MRI
  // impression — signature and all — never reached a prompt. Pinned so
  // a future "let the model read the impression" change has to notice
  // that the value-level guard is what makes that safe.
  it('still denies an un-listed free-text key by default', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'muscle_mri', reportImpression: '脂肪浸润，请结合临床. 钱医' } },
      { scope: 'reports', mode: 'precise' },
    );
    expect((fields.fields as Record<string, unknown>).reportImpression).toBeUndefined();
  });

  // The pipeline writes every lab field twice. Both spellings are safe
  // keys, so both used to reach the prompt — and the model reported the
  // duplicate as a third analyte.
  it('collapses camelCase/snake_case aliases of the same value', () => {
    const { fields } = redactFields(
      {
        fields: {
          classifiedType: 'infection_screening',
          trustAb: '阴性(-)',
          trust_ab: '阴性(-)',
          stoolColor: '黄色',
          stool_color: '黄色',
        },
      },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.trustAb).toBe('阴性(-)');
    expect(f.stoolColor).toBe('黄色');
    expect(f.trust_ab).toBeUndefined();
    expect(f.stool_color).toBeUndefined();
  });

  // Disagreement is data, not noise — picking one would be the redactor
  // silently editing a clinical value.
  it('keeps both spellings when they disagree', () => {
    const { fields } = redactFields(
      { fields: { stoolColor: '黄色', stool_color: '棕色' } },
      { scope: 'reports', mode: 'precise' },
    );
    const f = fields.fields as Record<string, unknown>;
    expect(f.stoolColor).toBe('黄色');
    expect(f.stool_color).toBe('棕色');
  });

  it('strict mode withholds a qualitative-looking value carrying a figure', () => {
    const { fields } = redactFields(
      { fields: { classifiedType: 'infection_screening', trust_ab: '阳性(1:8)' } },
      { scope: 'reports', mode: 'strict' },
    );
    const fc = fields.fields_clinical as Record<string, unknown>;
    expect(fc.trust_ab).toBeUndefined();
    expect(fc.numericValuesWithheld).toBe(1);
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

describe('OCR fields — lab panels in precise mode', () => {
  // A coagulation report whose values were all extracted correctly
  // still reached the model empty, because the nested-fields allowlist
  // only ever listed the genetics keys. The model then reported an OCR
  // failure that had not happened.
  const COAGULATION = {
    classifiedType: 'coagulation',
    pt: '13.7',
    aptt: '34',
    inr: '1.12',
    fibrinogen: '2.68',
    // Identity travelling in the same payload — must not follow the
    // values through.
    patientName: '张三丰·李四光',
    orderingDoctor: '赵医生',
    bedNo: '011',
    facility: '示例市第一人民医院',
    department: '神经内科',
  };

  it('forwards the measured values', () => {
    const { fields } = redactFields({ fields: COAGULATION }, { scope: 'reports', mode: 'precise' });
    const inner = fields.fields as Record<string, unknown>;
    expect(inner.pt).toBe('13.7');
    expect(inner.aptt).toBe('34');
    expect(inner.inr).toBe('1.12');
    expect(inner.fibrinogen).toBe('2.68');
  });

  it('still denies every identity field beside them', () => {
    const { fields } = redactFields({ fields: COAGULATION }, { scope: 'reports', mode: 'precise' });
    const blob = JSON.stringify(fields);
    for (const leaked of ['张三丰', '赵医生', '011', '示例市第一人民医院', '神经内科']) {
      expect(blob).not.toContain(leaked);
    }
  });

  it('drops lab values entirely in strict mode', () => {
    // precise is opt-in; basic consent still gets the classification
    // only.
    const { fields } = redactFields({ fields: COAGULATION }, { scope: 'reports', mode: 'strict' });
    expect(JSON.stringify(fields)).not.toContain('13.7');
  });
});
