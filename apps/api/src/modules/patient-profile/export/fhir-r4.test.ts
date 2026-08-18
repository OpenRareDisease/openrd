import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { ambulationSentences, locatorsIn } from './__fixtures__/reason-claims.js';
import { normaliseSource } from './export-source.js';
import { applyAdminBaselineWrite, BASELINE_PROVENANCE_KEY } from '../baseline-provenance.js';
import { applyGeneticReportAutofill } from '../profile.autofill.js';
import { MAX_OBSERVATIONS, buildFhirExport, toFhirGender, type FhirResource } from './fhir-r4.js';
import { AMBULATION_LABELS, DAILY_IMPACT_LABELS, FUNCTION_TEST_LABELS } from './labels.js';
import { TRANSCRIBED_EVIDENCE_LABEL_ZH } from '../genetic-evidence.js';
import type { PatientProfileDTO } from '../profile.service.js';

const build = (overrides: Partial<PatientProfileDTO> = {}, includeLocalOnly = false) =>
  buildFhirExport(
    normaliseSource(
      { ...EXPORT_FIXTURE_PROFILE, ...overrides },
      { includeLocalOnly, generatedAt: FIXTURE_GENERATED_AT },
    ),
  );

const resourcesOf = (result: ReturnType<typeof build>, resourceType: string): FhirResource[] =>
  result.document.entry
    .map((entry) => entry.resource)
    .filter((resource) => resource.resourceType === resourceType);

describe('FHIR R4 — the bundle is a document', () => {
  it('puts a Composition first, which is what makes type=document true', () => {
    const result = build();
    expect(result.document.type).toBe('document');
    expect(result.document.entry[0].resource.resourceType).toBe('Composition');
    expect(result.document.entry[0].fullUrl).toBe(
      `urn:uuid:${result.document.entry[0].resource.id}`,
    );
  });

  it('names the patient as the author, and says nothing about who typed each value', () => {
    const composition = resourcesOf(build(), 'Composition')[0];
    const patient = resourcesOf(build(), 'Patient')[0];
    expect(composition.author).toEqual([
      { reference: `urn:uuid:${patient.id}`, display: '患者本人' },
    ]);
  });

  it('has no dangling references: every section entry resolves inside the bundle', () => {
    const result = build();
    const present = new Set(result.document.entry.map((entry) => entry.fullUrl));
    const composition = resourcesOf(result, 'Composition')[0];
    const sections = composition.section as Array<{ entry: Array<{ reference: string }> }>;
    sections.forEach((section) => {
      section.entry.forEach((reference) => {
        expect(present.has(reference.reference), reference.reference).toBe(true);
      });
    });
    resourcesOf(result, 'DiagnosticReport').forEach((report) => {
      (report.result as Array<{ reference: string }>).forEach((reference) => {
        expect(present.has(reference.reference), reference.reference).toBe(true);
      });
    });
  });
});

describe('FHIR R4 — no unverified terminology', () => {
  it('gives every clinical concept a text and no coding', () => {
    const result = build();
    ['Condition', 'Observation', 'DiagnosticReport', 'DocumentReference'].forEach((type) => {
      resourcesOf(result, type).forEach((resource) => {
        const code = resource.code ?? resource.type;
        expect(code, `${type}.code`).toBeDefined();
        expect((code as Record<string, unknown>).text).toBeTruthy();
        expect((code as Record<string, unknown>).coding).toBeUndefined();
      });
    });
  });

  it('only ever uses FHIR-spec-internal code systems', () => {
    const result = build();
    const systems = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.system === 'string') systems.add(record.system);
        Object.values(record).forEach(walk);
      }
    };
    walk(result.document);
    systems.forEach((system) => {
      expect(system.startsWith('http://terminology.hl7.org/CodeSystem/'), system).toBe(true);
    });
  });

  it('carries no private extension fields in the conformant document', () => {
    // Anything we want to say that FHIR has no slot for belongs in
    // the envelope, so `document` can go straight to a validator.
    expect(JSON.stringify(build({}, true).document)).not.toContain('_openrd');
  });
});

describe('FHIR R4 — Condition tells the truth about confirmation', () => {
  it('is confirmed only when the graded evidence came off the laboratory report', () => {
    const withReport = resourcesOf(build(), 'Condition')[0];
    expect(
      (withReport.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('confirmed');

    const selfReported = resourcesOf(build({ documents: [] }), 'Condition')[0];
    expect(
      (selfReported.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('unconfirmed');
    // The text says what evidence is missing and where the value sits.
    // It names nobody: an unmarked field is not thereby the patient's,
    // so any 「本人填写」 here would be an author invented out of an
    // absence. See the §B3 block below and the autofill case with it.
    const selfReportedText = (selfReported.verificationStatus as { text: string }).text;
    expect(selfReportedText).toContain('本平台没有把这份档案判定为基因确诊');
    expect(selfReportedText).not.toContain('患者本人填写');
    // AND IT DOES NOT REPORT THE ABSENCE OF A DOCUMENT AS THE REASON.
    // A patient with an unreadable genetics report on file is
    // unconfirmed here and is still holding it; a registry told no
    // report exists sends somebody to re-order a test already run.
    expect(selfReportedText).toContain('也不表示他手里没有报告');
  });

  /**
   * A REPORT ON FILE IS NOT THE QUESTION, AND ASKING IT PUT A
   * LABORATORY BEHIND A TRANSCRIPTION.
   *
   * `hasGeneticReport` was 「is ANY document on file the laboratory's
   * own report」. A genetics report that read out nothing is still one,
   * and it is exactly the state where `pickGeneticEvidenceDocument`
   * falls through to a 病历摘要 quoting the repeat count — so this
   * bundle went out as verificationStatus=confirmed while its own
   * genetic Observations carried no `category` because the reading was
   * a transcription, and while the same patient's passport, referral
   * pack and anesthesia card all read 未经基因确诊.
   */
  it('is not confirmed when the report read out nothing and a 病历摘要 supplied the numbers', () => {
    const result = build({
      documents: [
        {
          ...EXPORT_FIXTURE_PROFILE.documents[0],
          id: '88888888-8888-4888-8888-888888888881',
          documentType: 'genetic_report',
          status: 'parsed',
          ocrPayload: { fields: { reportTime: '2024-01-28' } },
        },
        {
          ...EXPORT_FIXTURE_PROFILE.documents[0],
          id: '88888888-8888-4888-8888-888888888883',
          documentType: 'medical_record',
          status: 'parsed',
          uploadedAt: '2024-03-01T06:00:00.000Z',
          ocrPayload: { fields: { d4z4Repeats: '5', haplotype: '4qA' } },
        },
      ],
    });
    const condition = resourcesOf(result, 'Condition')[0];
    expect(
      (condition.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('unconfirmed');
    // The premise: a laboratory report IS on file. The text must not
    // deny it — what it denies is having read a confirming result.
    expect(result.document.entry.map((entry) => entry.resource.resourceType)).toContain(
      'DocumentReference',
    );
    const text = (condition.verificationStatus as { text: string }).text;
    expect(text).toContain('本平台没有把这份档案判定为基因确诊');
    // And it says which document the numbers in this bundle came off,
    // in the phrase every other surface uses for that document class.
    expect(text).toContain(TRANSCRIBED_EVIDENCE_LABEL_ZH);
  });

  /**
   * A dropdown is not evidence. The uploader picks a type from a menu
   * and the parser reads the page; where they disagree the parser wins,
   * which is `isLaboratoryGeneticReport` — the same answer that ranks
   * the picker and grades the passport. Before this, a 病历摘要 filed
   * under 基因检测报告 arrived at a registry as a laboratory's
   * confirmation, in a bundle whose genetic Observations name a
   * transcription as their source.
   */
  it('is not confirmed by a 病历摘要 the uploader filed as a genetic report', () => {
    const condition = resourcesOf(
      build({
        documents: [
          {
            ...EXPORT_FIXTURE_PROFILE.documents[0],
            documentType: 'genetic_report',
            ocrPayload: {
              fields: { classifiedType: 'medical_summary', d4z4Repeats: '5', haplotype: '4qA' },
            },
          },
        ],
      }),
      'Condition',
    )[0];
    expect(
      (condition.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('unconfirmed');
    // And the text says which document the values came off, because the
    // patient chose that menu item and is owed the reason this answers
    // no.
    expect((condition.verificationStatus as { text: string }).text).toContain(
      TRANSCRIBED_EVIDENCE_LABEL_ZH,
    );
  });

  /**
   * The other direction: the parser recognises a genetics report the
   * uploader filed as 其他医疗文件. Reading the declaration alone lost
   * a real laboratory report, which is the half of this rule that
   * costs a patient a confirmation they earned.
   *
   * The payload carries the report's stated 检测方法 because a real
   * genetics report does. `isLaboratoryGeneticReport` stopped accepting
   * a classification on its own — a keyword classifier scores a
   * document on the genetics words it CONTAINS, so a 病历摘要 quoting a
   * result classified as a genetics report too, and this exact payload
   * minus the method cell is that 病历摘要 as well as this report. What
   * separates them is what the page shows it IS, so this fixture shows
   * it.
   */
  it('is confirmed by a genetics report the uploader filed as something else', () => {
    const condition = resourcesOf(
      build({
        documents: [
          {
            ...EXPORT_FIXTURE_PROFILE.documents[0],
            documentType: 'other',
            ocrPayload: {
              fields: {
                classifiedType: 'genetic_report',
                geneticTestMethod: 'southern_blot',
                d4z4Repeats: '5',
                haplotype: '4qA',
              },
            },
          },
        ],
      }),
      'Condition',
    )[0];
    expect(
      (condition.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('confirmed');
  });

  it('puts the OMIM number inside human-readable text, never as a coding', () => {
    const condition = resourcesOf(build(), 'Condition')[0];
    expect((condition.code as { text: string }).text).toContain('OMIM 158900');
    expect((condition.code as { coding?: unknown }).coding).toBeUndefined();
  });

  it('records the diagnosis year as a bare year, and 记不清了 as a note', () => {
    expect(resourcesOf(build(), 'Condition')[0].recordedDate).toBe('2014');

    const forgotten = resourcesOf(
      build({
        baseline: {
          ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
          foundation: { diagnosisYear: '记不清了' },
        },
        diagnosisDate: null,
      }),
      'Condition',
    )[0];
    expect(forgotten.recordedDate).toBeUndefined();
    expect((forgotten.note as Array<{ text: string }>)[0].text).toContain('记不清了');
  });
});

describe('FHIR R4 — Patient', () => {
  it('uses a bare year for birthDate when only the birth year is known', () => {
    // The whole January-1st defect, in the one place FHIR lets us
    // avoid it natively.
    expect(resourcesOf(build(), 'Patient')[0].birthDate).toBe('1988');
  });

  it('prefers a real date of birth when one exists', () => {
    expect(resourcesOf(build({ dateOfBirth: '1988-04-17' }), 'Patient')[0].birthDate).toBe(
      '1988-04-17',
    );
  });

  it('never carries a name, phone, email or address — not even local-only', () => {
    const serialised = JSON.stringify(build({}, true).document);
    expect(serialised).not.toContain('张小雨');
    expect(serialised).not.toContain('13800000000');
    expect(serialised).not.toContain('四川省');
    expect(serialised).not.toContain('李医生');
  });

  it('maps gender without turning a privacy choice into a characteristic', () => {
    expect(toFhirGender('female')).toBe('female');
    expect(toFhirGender('non_binary')).toBe('other');
    expect(toFhirGender('prefer_not_to_say')).toBe('unknown');
  });
});

describe('FHIR R4 — Observations', () => {
  it('maps 「今天做不了」 to dataAbsentReason, not to a missing value', () => {
    const unable = resourcesOf(build(), 'Observation').find(
      (resource) => (resource.code as { text: string }).text === '爬楼梯计时',
    );
    expect(unable?.valueQuantity).toBeUndefined();
    expect((unable?.dataAbsentReason as { text: string }).text).toContain('不是未测');
  });

  it('omits an empty unit rather than emitting one', () => {
    const walk = resourcesOf(build(), 'Observation').find(
      (resource) => (resource.code as { text: string }).text === '10 米步行计时',
    );
    expect(walk?.valueQuantity).toEqual({ value: 14.2, unit: 'sec' });

    const noUnit = resourcesOf(
      build({
        functionTests: [{ ...EXPORT_FIXTURE_PROFILE.functionTests[0], unit: null }],
      }),
      'Observation',
    ).find((resource) => (resource.code as { text: string }).text === '10 米步行计时');
    expect(noUnit?.valueQuantity).toEqual({ value: 14.2 });
  });

  it('emits a year-pinned milestone as YYYY, never as YYYY-01-01', () => {
    const wheelchair = resourcesOf(build(), 'Observation').find(
      (resource) => (resource.code as { text: string }).text === '开始使用轮椅',
    );
    expect(wheelchair?.effectiveDateTime).toBe('2019');
    expect((wheelchair?.note as Array<{ text: string }>)[0].text).toContain('不要把它当作精确到天');
  });

  it('keeps a genuinely precise milestone at full precision', () => {
    const niv = resourcesOf(build(), 'Observation').find((resource) =>
      (resource.code as { text: string }).text.includes('无创通气'),
    );
    expect(niv?.effectiveDateTime).toBe('2023-08-14T13:30:00.000Z');
  });

  it('carries OCR-derived values as strings, with a note and a link to the report', () => {
    const ck = resourcesOf(build(), 'Observation').find((resource) =>
      (resource.code as { text: string }).text.includes('肌酸激酶'),
    );
    expect(ck?.valueString).toBe('1245 U/L');
    expect((ck?.note as Array<{ text: string }>)[0].text).toContain('未经人工复核');
    const documentReference = resourcesOf(build(), 'DocumentReference').find(
      (resource) => (resource.type as { text: string }).text === '血液检验报告',
    );
    expect(ck?.derivedFrom).toEqual([{ reference: `urn:uuid:${documentReference?.id}` }]);
  });

  it('uses the report’s own stated time, not the upload time', () => {
    const ck = resourcesOf(build(), 'Observation').find((resource) =>
      (resource.code as { text: string }).text.includes('肌酸激酶'),
    );
    expect(ck?.effectiveDateTime).toBe('2025-05-09');
  });
});

describe('FHIR R4 — a report with no readable date is not dated to the upload', () => {
  // A pulmonary function report printed in 2019, photographed and
  // uploaded years later. OCR reads the numbers but no report date.
  const undatedDocument = {
    ...EXPORT_FIXTURE_PROFILE.documents[1],
    id: '88888888-8888-4888-8888-888888888883',
    documentType: 'pulmonary_function',
    title: '肺功能报告',
    uploadedAt: '2026-03-11T02:00:00.000Z',
    ocrPayload: { fields: { fvcPredPct: '78%' } },
  };
  const undated = () => build({ documents: [undatedDocument] });

  it('leaves effectiveDateTime off rather than asserting the upload date', () => {
    const fvc = resourcesOf(undated(), 'Observation').find((resource) =>
      (resource.code as { text: string }).text.includes('FVC%pred'),
    );
    expect(fvc?.valueString).toBe('78%');
    // The failure this guards: a seven-year-old FVC%pred exported as
    // a measurement taken the week it was photographed, on which a
    // clinician defers a respiratory reassessment.
    expect(fvc?.effectiveDateTime).toBeUndefined();
    expect(JSON.stringify(fvc)).not.toContain('2026-03-11');
  });

  it('says on the Observation itself that the test date is unknown', () => {
    const fvc = resourcesOf(undated(), 'Observation').find((resource) =>
      (resource.code as { text: string }).text.includes('FVC%pred'),
    );
    const notes = (fvc?.note as Array<{ text: string }>).map((note) => note.text).join('\n');
    expect(notes).toContain('没有识别到检查或报告日期');
  });

  it('does not put the upload date back on through the DiagnosticReport', () => {
    const report = resourcesOf(undated(), 'DiagnosticReport')[0];
    expect(report.effectiveDateTime).toBeUndefined();
    expect(report.conclusion).toContain('没有识别到日期');
  });

  it('records the missing date as an omission', () => {
    expect(undated().omissions.map((entry) => entry.field)).toContain(
      'Observation.effectiveDateTime（报告自动解析项）',
    );
    // Not raised when every report stated its own date.
    expect(build().omissions.map((entry) => entry.field)).not.toContain(
      'Observation.effectiveDateTime（报告自动解析项）',
    );
  });

  it('still keeps the upload time discoverable, labelled as an upload', () => {
    const documentReference = resourcesOf(undated(), 'DocumentReference')[0];
    expect(documentReference.date).toBe('2026-03-11T02:00:00.000Z');
  });
});

describe('FHIR R4 — instruments are declared as withheld', () => {
  /**
   * Every walking-related Observation this bundle is CAPABLE of
   * carrying, enumerated from the label tables rather than from what
   * the fixture happens to hold. The daily-impact suffix mirrors the
   * one fhir-r4.ts builds its `code.text` with.
   */
  const WALKING_OBSERVATION_LABELS = [
    ...Object.values(FUNCTION_TEST_LABELS),
    ...Object.values(DAILY_IMPACT_LABELS).map((label) => `${label}困难程度`),
  ].filter((label) => /行走|步行/.test(label));

  // A profile exercising all of them at once, so no assertion below
  // can pass by the fixture simply not having the awkward case.
  const walkingHeavy: Partial<PatientProfileDTO> = {
    functionTests: [
      ...EXPORT_FIXTURE_PROFILE.functionTests,
      {
        ...EXPORT_FIXTURE_PROFILE.functionTests[0],
        id: '44444444-4444-4444-8444-444444444443',
        testType: 'six_minute_walk',
        measuredValue: 210,
        unit: 'm',
      },
      {
        ...EXPORT_FIXTURE_PROFILE.functionTests[0],
        id: '44444444-4444-4444-8444-444444444444',
        testType: 'timed_up_and_go',
        measuredValue: 18.5,
        unit: 'sec',
      },
    ],
    dailyImpacts: [
      ...EXPORT_FIXTURE_PROFILE.dailyImpacts,
      {
        ...EXPORT_FIXTURE_PROFILE.dailyImpacts[0],
        id: '66666666-6666-4666-8666-666666666662',
        adlKey: 'walking_outdoors',
        difficultyLevel: 4,
      },
    ],
  };

  const withAmbulation = (independentlyAmbulatory: string) => {
    const baseline = EXPORT_FIXTURE_PROFILE.baseline as {
      currentStatus: Record<string, unknown>;
    } & Record<string, unknown>;
    return build({
      ...walkingHeavy,
      baseline: {
        ...baseline,
        currentStatus: { ...baseline.currentStatus, independentlyAmbulatory },
      },
    });
  };

  const reasonOf = (result: ReturnType<typeof build>) =>
    result.omissions.find((entry) => entry.field.includes('Brooke'))?.reasonZh ?? '';

  it('says Brooke and Vignos are collected and not in this bundle', () => {
    const omission = build().omissions.find((entry) => entry.field.includes('Brooke'));
    expect(omission?.reasonZh).toContain('Vignos');
    expect(omission?.reasonZh).toContain('不表示患者没有做过分级');
  });

  it('carries no resource derived from the baseline walking state, for any of its values', () => {
    // Ground truth for the omission, stated structurally. This used to
    // be `not.toContain('行走')`, which held only because the fixture's
    // walk test is 「10 米步行计时」 — 步行, not 行走 — so a fixture
    // gaining a TUG turned it red with no production change, while a
    // bundle that genuinely leaked the walking state under any other
    // label would not have turned it red at all. What is actually true
    // is that nothing here reads `currentStatus.ambulation`, so neither
    // the stored value nor its display label can appear.
    Object.entries(AMBULATION_LABELS).forEach(([value, labelZh]) => {
      const serialised = JSON.stringify(withAmbulation(value).document);
      expect(serialised, value).not.toContain(value);
      expect(serialised, labelZh).not.toContain(labelZh);
    });
  });

  it('does carry walking measurements, and the reason accounts for every one of them', () => {
    // The half the old wording got wrong: 「本 Bundle 不含任何行走能力
    // （ambulation）资源」 while the same bundle timed the patient walking
    // ten metres. A receiver reading that goes back to the patient for
    // walking ability this document measured.
    const result = build(walkingHeavy);
    const present = resourcesOf(result, 'Observation')
      .map((resource) => (resource.code as { text: string }).text)
      .filter((text) => /行走|步行/.test(text));
    const reason = reasonOf(result);
    expect(WALKING_OBSERVATION_LABELS.length).toBeGreaterThan(0);
    WALKING_OBSERVATION_LABELS.forEach((label) => {
      expect(present, label).toContain(label);
      // Each gets the disambiguation `started_wheelchair` already had.
      // A new walking test in labels.ts turns this red until the
      // sentence covers it, which is the point.
      expect(reason, label).toContain(label);
    });
  });

  it('makes no claim that the walking state is somewhere in this bundle', () => {
    const result = build(walkingHeavy);
    // EVERY omission the bundle carries, not the Brooke one alone. The
    // version of this test that shipped read `reasonOf(...)`, which
    // finds the entry whose field mentions Brooke — so the same false
    // claim written into the LOINC omission pushed three lines above it
    // in fhir-r4.ts left this test green and moved only the golden.
    // This bundle has three omissions; one was guarded.
    const claims = result.omissions.flatMap((entry) => ambulationSentences(entry.reasonZh));
    // Every sentence in those reasons that names the walking state in
    // one of AMBULATION_SUBJECT's words, in order, BY EXACT STRING. A
    // claim written around every word off that list is not here — that
    // bound is at AMBULATION_SUBJECT and pinned in reason-claims.test.ts.
    //
    // A new such sentence turns this red, and so does an edit to an
    // approved one. BY EXACT STRING rather than `expect.stringContaining`,
    // which turns every entry into a safe harbour: a clause hung off an
    // approved sentence with ，or ；satisfies it with the array
    // unchanged, and that is how 「基线行走状态没有单独的资源类型，但会
    // 作为 Observation 写入本 Bundle。」 slipped past.
    //
    // The first two lines are the shared instrument prefix, which
    // reaches this list because it names Vignos, 下肢功能 and 运动功能.
    // Neither makes a claim about the bundle; they are enumerated
    // rather than filtered out, because every rule that would drop them
    // is a rule a false claim can be written to satisfy.
    expect(claims).toEqual([
      '本平台采集 Brooke 上肢功能分级与 Vignos 下肢功能分级（见 /me/instruments），但这两项尚未接入本导出所读取的档案结构，因此本次导出不含任何分级数值、施测时间或量表版本',
      '这是导出管线的缺口，不表示患者没有做过分级——在本记录的全部内容里，这两项通常是唯一可跨患者比较的运动功能测量，需要时请直接向患者索取',
      '本 Bundle 不含基线记录的行走状态（ambulation）：即使患者在填写 Vignos 时选择了同步到基线，基线里的行走状态也不会出现在本 Bundle 的任何位置',
      '本 Bundle 里凡是与走路有关的 Observation，都不是行走状态本身——「10 米步行计时」「6 分钟步行距离」「起立行走计时（TUG）」是某一天的一次计时，「户外行走困难程度」是一项自评，「开始使用轮椅」等随访事件记录的是一个时点，把其中任何一项读作基线行走状态都会读错',
      '基线行走状态不在本 Bundle 中；需要它请向患者索取，或改用 TREAT-NMD 对齐导出',
    ]);
    // No pointer into a document that has no sections at all. Scoped to
    // this reason rather than to every omission, because the LOINC one
    // legitimately points at `codingProvenance.emitted` / `.withheld`,
    // which are places on the envelope this bundle ships in — so a
    // bogus pointer in the LOINC or Observation reason is unguarded
    // here, and enumerating those the way the sentences above are
    // enumerated is what would close it.
    expect(locatorsIn(reasonOf(result))).toEqual([]);
  });
});

describe('FHIR R4 — bounded, and honest about the bound', () => {
  const manyMeasurements = Array.from({ length: 600 }, (_, index) => ({
    ...EXPORT_FIXTURE_PROFILE.measurements[0],
    id: `bulk-${index}`,
    // Oldest first in the source, so a naive implementation that
    // slices without sorting keeps the WRONG half.
    recordedAt: new Date(Date.UTC(2015, 0, 1) + index * 86_400_000).toISOString(),
  }));

  it('caps observations and reports the drop instead of truncating silently', () => {
    const result = build({ measurements: manyMeasurements });
    expect(resourcesOf(result, 'Observation')).toHaveLength(MAX_OBSERVATIONS);
    const omission = result.omissions.find((entry) => entry.field === 'Observation');
    expect(omission?.reasonZh).toContain('未写入');
  });

  it('keeps the newest across ALL categories, not just the first one built', () => {
    // Regression: consuming the budget category by category meant a
    // patient with 500+ strength readings exported no symptom scores
    // at all, and the pool of recent data was silently the older one.
    const result = build({ measurements: manyMeasurements });
    const texts = resourcesOf(result, 'Observation').map(
      (resource) => (resource.code as { text: string }).text,
    );
    expect(texts).toContain('疲劳');
    expect(texts).toContain('10 米步行计时');
    // 2015-era bulk rows must have been evicted before 2025 rows.
    const effectives = resourcesOf(result, 'Observation')
      .map((resource) => String(resource.effectiveDateTime))
      .filter((value) => value.startsWith('2015-01-01'));
    expect(effectives).toEqual([]);
  });

  it('never lets an undated report field evict a record that states its date', () => {
    // The failure: a long-logging patient uploads a stack of old,
    // undated reports today. Each parsed field's `observedAt` is the
    // UPLOAD time, so ranking on it puts Observations that publish no
    // effectiveDateTime at the top of the bundle and pushes genuinely
    // recent readings off the end of the cut. The receiver is told
    // only 「其余 N 条未写入」 and cannot tell what displaced what.
    const datedMeasurements = Array.from({ length: MAX_OBSERVATIONS }, (_, index) => ({
      ...EXPORT_FIXTURE_PROFILE.measurements[0],
      id: `dated-${index}`,
      recordedAt: new Date(Date.UTC(2024, 0, 1) + index * 3_600_000).toISOString(),
    }));
    const oldestDated = datedMeasurements[0].recordedAt;
    const undatedUploadedToday = Array.from({ length: 5 }, (_, index) => ({
      ...EXPORT_FIXTURE_PROFILE.documents[1],
      id: `88888888-8888-4888-8888-99999999000${index}`,
      documentType: 'pulmonary_function',
      // Newer than every measurement above, and the only date this
      // report has is the moment it was photographed.
      uploadedAt: '2026-01-14T00:00:00.000Z',
      ocrPayload: { fields: { fvcPredPct: `${50 + index}%` } },
    }));

    const result = build({
      measurements: datedMeasurements,
      functionTests: [],
      symptomScores: [],
      dailyImpacts: [],
      followupEvents: [],
      documents: undatedUploadedToday,
    });
    const observations = resourcesOf(result, 'Observation');
    expect(observations).toHaveLength(MAX_OBSERVATIONS);

    // Every dated reading survived, including the oldest one — the
    // dateless rows are what fell off, not what stayed.
    expect(
      observations.filter((resource) => (resource.code as { text: string }).text.includes('肌力')),
    ).toHaveLength(MAX_OBSERVATIONS);
    expect(observations.map((resource) => resource.effectiveDateTime)).toContain(oldestDated);
    expect(
      observations.filter((resource) =>
        (resource.code as { text: string }).text.includes('FVC%pred'),
      ),
    ).toHaveLength(0);

    // And the drop notice describes the rule that was applied.
    const omission = result.omissions.find((entry) => entry.field === 'Observation');
    expect(omission?.reasonZh).toContain('没有写明观察时间的条目');
    expect(omission?.reasonZh).toContain('其余 5 条未写入');
  });

  it('lists LOINC withholding as an explicit omission', () => {
    expect(build().omissions.map((entry) => entry.field)).toContain(
      'CodeableConcept.coding (LOINC)',
    );
  });
});

describe('FHIR R4 — documents', () => {
  it('links the API path and never the object-store URI, and omits a mismatched hash', () => {
    const documentReference = resourcesOf(build(), 'DocumentReference')[0];
    const attachment = (
      documentReference.content as Array<{ attachment: Record<string, unknown> }>
    )[0].attachment;
    expect(attachment.url).toBe(
      `/patient-profiles/me/documents/${EXPORT_FIXTURE_PROFILE.documents[0].id}`,
    );
    // `Attachment.hash` is base64 SHA-1 in FHIR; our checksum is not
    // that, and a mismatch reads to a receiver as file corruption.
    expect(attachment.hash).toBeUndefined();
    expect(JSON.stringify(build().document)).not.toContain('local://uploads');
    expect(JSON.stringify(build().document)).not.toContain('sha256:deadbeef');
  });
});

/** The provenance block an administrator's edit actually leaves on
 *  disk, built with the real write helper. */
const adminEdited = (): Partial<PatientProfileDTO> => {
  const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
  const disease = stored.diseaseBackground as Record<string, unknown>;
  const foundation = stored.foundation as Record<string, unknown>;
  // 确诊年份 goes through the real helper, because an administrator can
  // still write it. The 分型 marker is written into the block by hand,
  // and that is the point of the fixture rather than a shortcut:
  // `applyAdminBaselineWrite` now refuses every genetic path, so this
  // marker can no longer be created — but profiles written before that
  // carry one, and an exporter that mishandled them would be shipping a
  // silent regression against real stored data.
  const withYear = applyAdminBaselineWrite(
    stored,
    { ...stored, foundation: { ...foundation, diagnosisYear: 2016 } },
    {
      adminUserId: '11111111-2222-3333-4444-555555555555',
      at: new Date('2026-08-13T04:11:07.912Z'),
    },
  );
  const block = withYear[BASELINE_PROVENANCE_KEY] as Record<string, unknown>;
  return {
    baseline: {
      ...withYear,
      diseaseBackground: { ...disease, diagnosisType: 'FSHD2' },
      [BASELINE_PROVENANCE_KEY]: {
        ...block,
        'diseaseBackground.diagnosisType': {
          source: 'admin_entered',
          adminUserId: '11111111-2222-3333-4444-555555555555',
          at: '2026-08-13T04:11:07.912Z',
        },
      },
    },
  };
};

/**
 * The other way a value arrives without the patient typing it: nothing
 * in the baseline, one uploaded report carrying the field, and
 * `applyGeneticReportAutofill` copying it in on the way out of
 * `getProfileByUserId`. It leaves no marker, so the profile handed to
 * this exporter is indistinguishable from one the patient filled in —
 * which is why an author cannot be read off the absence of a marker.
 */
const ocrAutofilled = (): Partial<PatientProfileDTO> => {
  const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
  const disease = { ...(stored.diseaseBackground as Record<string, unknown>) };
  delete disease.diagnosisType;
  // Not a `genetic_report`: that document type is what flips the
  // Condition to confirmed, and this case has to reach the other branch.
  const documents: PatientProfileDTO['documents'] = [
    {
      ...EXPORT_FIXTURE_PROFILE.documents[0],
      documentType: 'other',
      ocrPayload: { fields: { diagnosisType: 'FSHD1' } },
    },
  ];
  const autoFilled = applyGeneticReportAutofill(
    {
      diagnosisDate: EXPORT_FIXTURE_PROFILE.diagnosisDate,
      geneticMutation: EXPORT_FIXTURE_PROFILE.geneticMutation,
      baseline: { ...stored, diseaseBackground: disease },
    },
    documents,
  );
  return {
    baseline: autoFilled.baseline,
    geneticMutation: autoFilled.geneticMutation,
    documents,
  };
};

/**
 * Contract §B3. A FHIR validator rejects unknown fields, so there is no
 * conformant slot for a per-field 「our staff typed this」 — the envelope
 * carries the list, and the diagnosis-facing ones also go into the
 * Condition's own `note`, which IS conformant and is where a receiver
 * that never opens the envelope will look.
 */
describe('FHIR R4 — §B3：管理员代填的值不能记成患者自述', () => {
  it('报告里读来的分型不会被 Condition 说成患者本人填写', () => {
    const overrides = ocrAutofilled();
    const disease = (overrides.baseline as { diseaseBackground: Record<string, unknown> })
      .diseaseBackground;
    // The value did arrive off the report — this is not a missing field.
    expect(disease.diagnosisType).toBe('FSHD1');
    expect(build(overrides).fieldOrigins).toEqual([]);

    const condition = resourcesOf(build(overrides), 'Condition')[0];
    expect((condition.verificationStatus as { text: string }).text).not.toContain('患者本人填写');
  });

  it('Condition 不再无条件说「患者自述诊断」', () => {
    const marked = build({ ...adminEdited(), documents: [] });
    const condition = resourcesOf(marked, 'Condition')[0];
    const text = (condition.verificationStatus as { text: string }).text;

    expect(text).not.toContain('由患者本人填写');
    // The marker belongs to 分型 alone, and the subject of this sentence
    // is 诊断信息 — which spans `recordedDate` in the same resource. It
    // rides `note` instead.
    expect(text).not.toContain('此项');
  });

  it('确诊年份的来源进 Condition.note，而不是只在信封上', () => {
    const condition = resourcesOf(build({ ...adminEdited(), documents: [] }), 'Condition')[0];
    expect(JSON.stringify(condition.note)).toContain('不是患者本人填写');
  });

  // The fixture carries a `genetic_report`, so this build takes the
  // `confirmed` arm — the one where the Condition is OMIM-coded and a
  // reader is least likely to doubt it.
  it('分型的来源在 confirmed 的那一支上也进 Condition.note', () => {
    const condition = resourcesOf(build(adminEdited()), 'Condition')[0];
    expect(
      (condition.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('confirmed');
    expect(JSON.stringify(condition.note)).toContain('FSHD 分型');
    expect(JSON.stringify(condition.note)).toContain('不是患者本人填写');
  });

  it('Composition 的作者不替患者认领任何一个值', () => {
    const marked = build(adminEdited());
    expect(marked.fieldOrigins.length).toBeGreaterThan(0);
    const composition = resourcesOf(marked, 'Composition')[0];
    expect(JSON.stringify(composition.author)).not.toContain('自述');
    expect(JSON.stringify(composition.author)).not.toContain('自行采集');
  });

  it('信封逐条列出，并且没有标记时明说没有代填', () => {
    expect(build(adminEdited()).fieldOrigins.map((origin) => origin.path)).toEqual([
      'diseaseBackground.diagnosisType',
      'foundation.diagnosisYear',
    ]);
    expect(build(adminEdited()).notes.字段来源).toContain('FSHD 分型');
    expect(build().fieldOrigins).toEqual([]);
    expect(build().notes.字段来源).toContain('没有本平台工作人员代填');
  });
});

/**
 * A genetic value is published off ONE document, and it is the one
 * every clinical surface names.
 *
 * The other Observations in this bundle are measurements with times: a
 * second CK off a second blood panel is a second real result and a
 * receiver wants both. A repeat count is not that — it is one assay's
 * answer about this person, and the passport, the referral pack, the
 * share page and the PDF each print exactly one. A bundle that also
 * carried a 病历摘要's transcription handed a registry a second reading
 * nobody on this platform is looking at, and in the case below a 4q
 * 单倍型 the evidence grade was computed to be WITHOUT.
 */
describe('FHIR R4 —— 基因读数只从被点名的那一份报告出', () => {
  const summaryTranscription: PatientProfileDTO['documents'][number] = {
    ...EXPORT_FIXTURE_PROFILE.documents[0],
    id: '88888888-8888-4888-8888-888888888899',
    documentType: 'medical_summary',
    title: '门诊病历摘要',
    uploadedAt: '2025-09-01T06:00:00.000Z',
    ocrPayload: {
      fields: {
        classifiedType: 'medical_summary',
        d4z4Repeats: '9',
        haplotype: '4qB',
        methylationValue: '30%',
      },
    },
  };

  const geneticObservations = (result: ReturnType<typeof build>) =>
    resourcesOf(result, 'Observation')
      .filter((resource) => /D4Z4|单倍型/.test((resource.code as { text?: string }).text ?? ''))
      .map((resource) => ({
        label: (resource.code as { text: string }).text,
        value: resource.valueString,
      }));

  it('病历摘要抄的重复数和单倍型不会另开一条 Observation', () => {
    const withSummary = build({
      documents: [...EXPORT_FIXTURE_PROFILE.documents, summaryTranscription],
    });

    expect(geneticObservations(withSummary)).toEqual([
      { label: 'D4Z4 重复单元数', value: '5' },
      { label: '4q 单倍型', value: '4qA' },
    ]);
    expect(JSON.stringify(withSummary)).not.toContain('4qB');
  });

  it('病历摘要仍然作为上传文件出现 —— 抹掉的是它的读数，不是它本身', () => {
    // The patient uploaded it and a receiver should see that they did.
    // What it may not do is state this patient's genetic result.
    const withSummary = build({
      documents: [...EXPORT_FIXTURE_PROFILE.documents, summaryTranscription],
    });
    expect(JSON.stringify(resourcesOf(withSummary, 'DocumentReference'))).toContain('门诊病历摘要');
  });

  it('被点名的报告换人时，读数跟着换', () => {
    // Same two documents, except the genetics report parsed to nothing
    // — so the transcription is the only reading there is, and it is
    // the one every other surface prints too.
    const emptyGenetic = {
      ...EXPORT_FIXTURE_PROFILE.documents[0],
      ocrPayload: { fields: { reportTime: '2024-01-28' } },
    };
    const flipped = build({
      documents: [emptyGenetic, ...EXPORT_FIXTURE_PROFILE.documents.slice(1), summaryTranscription],
    });

    expect(geneticObservations(flipped)).toEqual([
      { label: 'D4Z4 重复单元数', value: '9' },
      { label: '4q 单倍型', value: '4qB' },
    ]);
  });

  /**
   * A TRANSCRIPTION MAY NOT BE FILED AS A LABORATORY OBSERVATION.
   *
   * The genetic specs are marked laboratory-category because a repeat
   * count IS a laboratory assay — but the document this bundle read it
   * off is not always the laboratory's page, and the exporter took the
   * category off the spec whatever supplied the value. So a registry
   * received `category=laboratory` over a number this platform read out
   * of a 病历摘要, with a `derivedFrom` pointing at the very document
   * that shows no laboratory measured it here.
   *
   * The reading still ships: for some patients it is the only copy of
   * the number in existence. What goes is the claim about who measured
   * it.
   */
  const transcriptionOnly = (): Partial<PatientProfileDTO> => ({
    documents: [summaryTranscription],
  });

  const categoryCodesOf = (result: ReturnType<typeof build>, labelPattern: RegExp) =>
    resourcesOf(result, 'Observation')
      .filter((resource) => labelPattern.test((resource.code as { text?: string }).text ?? ''))
      .map((resource) => resource.category ?? null);

  it('证据是病历摘要时，基因 Observation 不写 category，也不自己编一个编码', () => {
    const result = build(transcriptionOnly());
    const genetic = geneticObservations(result);
    // The values are there.
    expect(genetic).toEqual([
      { label: 'D4Z4 重复单元数', value: '9' },
      { label: '4q 单倍型', value: '4qB' },
    ]);
    // And carry no category at all — not `laboratory`, and not an
    // invented code either.
    expect(categoryCodesOf(result, /D4Z4|单倍型/)).toEqual([null, null]);

    // Each says what it is, in the phrase every other surface uses for
    // the same document.
    resourcesOf(result, 'Observation')
      .filter((resource) => /D4Z4|单倍型/.test((resource.code as { text?: string }).text ?? ''))
      .forEach((resource) => {
        const notes = (resource.note as Array<{ text: string }>).map((note) => note.text).join('');
        expect(notes).toContain('转录自非基因报告文件');
        expect(notes).toContain('不写 category');
      });

    // And the envelope declares the gap, because a missing element in a
    // conformant document is otherwise indistinguishable from an
    // exporter that never had one.
    const omission = result.omissions.find((entry) =>
      entry.field.startsWith('Observation.category'),
    );
    expect(omission?.reasonZh).toContain('转录自非基因报告文件');
    expect(omission?.reasonZh).toContain('不要把它当作实验室的结论');
  });

  it('是实验室那份报告时 category 照写，声明也不出现', () => {
    // The rule is about the document, not about the field: the same two
    // items off the genetics report keep 检验, which is true there.
    const result = build();
    expect(categoryCodesOf(result, /D4Z4|单倍型/)).toEqual([
      [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
            },
          ],
          text: '检验',
        },
      ],
      [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
            },
          ],
          text: '检验',
        },
      ],
    ]);
    expect(result.omissions.some((entry) => entry.field.startsWith('Observation.category'))).toBe(
      false,
    );
  });

  it('转录规则不会波及血液检验报告上的 CK —— 那是那家实验室自己测的', () => {
    const result = build(transcriptionOnly());
    // The 血液检验 document is gone from that profile, so put it back
    // alongside the transcription and check the CK keeps its category.
    const both = build({
      documents: [summaryTranscription, EXPORT_FIXTURE_PROFILE.documents[1]],
    });
    expect(categoryCodesOf(both, /肌酸激酶/)).toEqual([
      [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
            },
          ],
          text: '检验',
        },
      ],
    ]);
    // And the genetic ones in that same bundle still have none.
    expect(categoryCodesOf(both, /D4Z4|单倍型/)).toEqual([null, null]);
    expect(result.omissions.some((entry) => entry.field.startsWith('Observation.category'))).toBe(
      true,
    );
  });
});

/**
 * A CELL THIS PLATFORM READS NO RESULT OFF IS NOT PUBLISHED AS ONE.
 *
 * `valueString` is the element a registry ingests as this
 * observation's answer, and it used to be written straight off the
 * OCR cell whatever that cell held. So a 4q 单倍型 Observation went
 * out with the laboratory's PROBES as the patient's haplotype, a D4Z4
 * one with 「未检出」 as the repeat count, and the same profile's
 * TREAT-NMD document said 「本平台从它读不出这一项的结果」 about the very
 * same cell on the very same run.
 *
 * What replaces it is FHIR's own answer for 「no value, and this is
 * why」 rather than a note appended under a value that stayed. The cell
 * still travels — for some patients it is the only copy of the number
 * in existence — verbatim, inside the element that says it is not a
 * result.
 */
describe('FHIR R4 —— 读不出结果的基因栏位，不发成结果', () => {
  const geneticReport = (cells: Record<string, string>) => ({
    ...EXPORT_FIXTURE_PROFILE.documents[0],
    ocrPayload: { fields: { reportTime: '2024-01-28', ...cells } },
  });

  const reported = (cells: Record<string, string>) =>
    build({ documents: [geneticReport(cells), ...EXPORT_FIXTURE_PROFILE.documents.slice(1)] });

  const observationFor = (result: ReturnType<typeof build>, labelZh: string) =>
    resourcesOf(result, 'Observation').find(
      (resource) => (resource.code as { text: string }).text === labelZh,
    );

  const absentReasonOf = (result: ReturnType<typeof build>, labelZh: string) =>
    observationFor(result, labelZh)?.dataAbsentReason as
      | { coding: Array<{ system: string; code: string }>; text: string }
      | undefined;

  /** Every cell shape a real report puts in these two boxes, and
   *  whether this platform reads it as that item's result. */
  const CELLS: ReadonlyArray<{
    readonly name: string;
    readonly cells: Record<string, string>;
    readonly labelZh: string;
    readonly isResult: boolean;
  }> = [
    { name: '探针名', cells: { haplotype: '4qA/4qB' }, labelZh: '4q 单倍型', isResult: false },
    { name: '未检出', cells: { haplotype: '未检出' }, labelZh: '4q 单倍型', isResult: false },
    {
      name: '未检出（重复数）',
      cells: { d4z4Repeats: '未检出' },
      labelZh: 'D4Z4 重复单元数',
      isResult: false,
    },
    { name: '区间', cells: { d4z4Repeats: '1-10' }, labelZh: 'D4Z4 重复单元数', isResult: false },
    {
      name: '读不成数的一句话',
      cells: { d4z4Repeats: '详见报告' },
      labelZh: 'D4Z4 重复单元数',
      isResult: false,
    },
    /* THE TWO THAT PARSE AND ARE STILL NOT COUNTS. Both of these hand
     * `parseD4Z4Reading` a single unambiguous number, so a check for
     * 「the cell parses」 published them under a code that says 「D4Z4
     * 重复单元数」: a length in kb, which this platform prints and judges
     * by nothing because it holds no boundary in that unit to compare
     * it against, and a 0, which is not a viable FSHD1 allele and means
     * somebody should look at the original page. Ingested off this
     * element, neither is distinguishable from a repeat count. */
    {
      name: '写成 kb 的长度',
      cells: { d4z4Repeats: '18kb' },
      labelZh: 'D4Z4 重复单元数',
      isResult: false,
    },
    {
      name: '读成 0 的重复数',
      cells: { d4z4Repeats: '0' },
      labelZh: 'D4Z4 重复单元数',
      isResult: false,
    },
    { name: '允许型单倍型', cells: { haplotype: '4qA' }, labelZh: '4q 单倍型', isResult: true },
    { name: '非允许型单倍型', cells: { haplotype: '4qB' }, labelZh: '4q 单倍型', isResult: true },
    {
      name: '一个确定的重复数',
      cells: { d4z4Repeats: '5' },
      labelZh: 'D4Z4 重复单元数',
      isResult: true,
    },
  ];

  CELLS.forEach(({ name, cells, labelZh, isResult }) => {
    it(`${name} → ${isResult ? '发成结果' : '不发成结果'}`, () => {
      const result = reported(cells);
      const observation = observationFor(result, labelZh);
      const cell = Object.values(cells)[0];

      // The reading ships either way — what changes is whether it
      // ships as this observation's answer. An assertion about an
      // Observation that is not in the bundle proves nothing.
      expect(observation, name).toBeDefined();
      expect(JSON.stringify(observation), name).toContain(cell);

      if (isResult) {
        expect(observation?.valueString).toBe(cell);
        expect(observation?.dataAbsentReason).toBeUndefined();
        return;
      }

      // R4 forbids the two together, so the check is both halves.
      expect(observation?.valueString).toBeUndefined();
      const reason = absentReasonOf(result, labelZh);
      expect(reason?.coding).toEqual([
        { system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' },
      ]);
      // The cell itself is still in the document, verbatim.
      expect(reason?.text).toContain(cell);
      expect(reason?.text).toContain('读不出这一项的结果');
    });
  });

  /**
   * WHAT IS NOT CLAIMED ABOUT THE LABORATORY. 「未检出」 is the cell a
   * `NEG` / `ND` interpretation would be tempting on, and nothing here
   * writes one: the only thing that could decide it is a substring
   * matcher whose contract is that it only ever withholds, and no
   * other surface on this platform states a negative finding off it.
   */
  it('不给这些条目安一个「实验室没有检出」的编码', () => {
    const result = reported({ haplotype: '未检出', d4z4Repeats: '未检出' });
    expect(observationFor(result, '4q 单倍型')?.interpretation).toBeUndefined();
    expect(observationFor(result, 'D4Z4 重复单元数')?.interpretation).toBeUndefined();
    expect(JSON.stringify(result.document)).not.toContain('ObservationInterpretation');
  });

  /**
   * The record's lifecycle is not a verdict on the cell. Downgrading
   * `status` would tell a receiver a result is still coming for a
   * report that is finished.
   */
  it('不改 status，也不改 category —— 报告是哪种报告没有变', () => {
    const observation = observationFor(reported({ haplotype: '4qA/4qB' }), '4q 单倍型');
    expect(observation?.status).toBe('final');
    expect(observation?.category).toEqual([
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
          },
        ],
        text: '检验',
      },
    ]);
  });

  const valueOmission = (result: ReturnType<typeof build>) =>
    result.omissions.find((entry) => entry.field.startsWith('Observation.value[x]'));

  it('信封说明本 Bundle 里为什么有 Observation 不带结果值', () => {
    const reason = valueOmission(reported({ haplotype: '4qA/4qB' }))?.reasonZh;
    expect(reason).toContain('读不出这一项的结果');
    expect(reason).toContain('dataAbsentReason');
    expect(reason).toContain('不要把那段原文当作该项的检测结果导入');
  });

  it('本 Bundle 里没有这样的条目时，就不出现这条说明', () => {
    expect(valueOmission(build())).toBeUndefined();
    expect(valueOmission(reported({ d4z4Repeats: '5', haplotype: '4qA' }))).toBeUndefined();
  });

  /**
   * The declaration is read off the SURVIVORS, like every other
   * sentence this envelope makes about its own contents: a genetic
   * Observation the MAX_OBSERVATIONS cut evicted is not in the bundle,
   * and an omission explaining an element it does not carry sends a
   * reader hunting for a resource that is not there.
   */
  it('被上限挤掉时，这条说明跟着消失', () => {
    const symptomScores = Array.from({ length: MAX_OBSERVATIONS + 10 }, (_, index) => ({
      ...EXPORT_FIXTURE_PROFILE.symptomScores[0],
      id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
      recordedAt: new Date(Date.UTC(2026, 0, 1) + index * 86400000).toISOString(),
    }));
    const crowded = build({
      documents: [
        geneticReport({ haplotype: '4qA/4qB' }),
        ...EXPORT_FIXTURE_PROFILE.documents.slice(1),
      ],
      symptomScores,
    });

    expect(observationFor(crowded, '4q 单倍型')).toBeUndefined();
    expect(valueOmission(crowded)).toBeUndefined();
  });

  /**
   * THE GRAY ZONE REACHED THE PATIENT'S PHONE AND NOT THIS BUNDLE.
   *
   * `valueString: 「9」` under a code that says 「D4Z4 重复单元数」 is an
   * unqualified count once ingested, and the guideline says something
   * specific about 8–10: those arrays are carried asymptomatically by
   * 1%–2% of a European control population. The passport DTO, the
   * markdown export, the share page, the mobile PDF and the referral
   * pack all carried that sentence off the same summary this bundle is
   * normalised from; the two documents that reach a registry and a
   * trial site carried none of it.
   */
  const notesOf = (result: ReturnType<typeof build>, labelZh: string): string[] =>
    ((observationFor(result, labelZh)?.note ?? []) as Array<{ text: string }>).map(
      (note) => note.text,
    );

  it('灰区里的重复数，note 里带着指南的限定，OCR 那条照旧', () => {
    const notes = notesOf(reported({ d4z4Repeats: '9', haplotype: '4qA' }), 'D4Z4 重复单元数');
    // The OCR provenance note keeps its place at the head — the new
    // sentence is beside it, not instead of it.
    expect(notes[0]).toContain('自动识别（OCR）');
    expect(notes.join('\n')).toContain('grey_zone_8_10');
    expect(notes.join('\n')).toContain('8–10 单元灰区');
  });

  /**
   * `interpretation` IS THE ELEMENT THIS WOULD BE TEMPTING IN, and its
   * R4 value set has no member meaning 「the classification itself is
   * uncertain」. Coding it `abnormal` would state a verdict the
   * guideline explicitly declines to state for 9–10 units.
   */
  it('灰区不写成 interpretation，也不新造编码', () => {
    const result = reported({ d4z4Repeats: '9', haplotype: '4qA' });
    expect(observationFor(result, 'D4Z4 重复单元数')?.interpretation).toBeUndefined();
    expect(JSON.stringify(result.document)).not.toContain('ObservationInterpretation');
  });

  it('4qB 上的 9、区间外的 5 和 12，都不带灰区限定', () => {
    for (const cells of [
      { d4z4Repeats: '9', haplotype: '4qB' },
      { d4z4Repeats: '5', haplotype: '4qA' },
      { d4z4Repeats: '12', haplotype: '4qA' },
    ]) {
      const notes = notesOf(reported(cells), 'D4Z4 重复单元数');
      expect(notes.join('\n'), JSON.stringify(cells)).not.toContain('grey_zone_8_10');
    }
  });

  /**
   * A QUALIFIER BELONGS TO A RESULT. 「未检出8个重复单元」 carries a
   * number the size-cell reader refuses, so this Observation publishes
   * a `dataAbsentReason` rather than a value — and a guideline verdict
   * printed beside it would be a verdict on a number that is not there.
   */
  it('读不出结果的格子上，不挂灰区限定', () => {
    const result = reported({ d4z4Repeats: '未检出8个重复单元', haplotype: '4qA' });
    expect(observationFor(result, 'D4Z4 重复单元数')?.valueString).toBeUndefined();
    expect(notesOf(result, 'D4Z4 重复单元数').join('\n')).not.toContain('grey_zone_8_10');
  });
});
