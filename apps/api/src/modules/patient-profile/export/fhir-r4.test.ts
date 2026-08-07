import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { normaliseSource } from './export-source.js';
import { buildFhirExport, toFhirGender, type FhirResource } from './fhir-r4.js';
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

  it('names the patient as the author, because they are', () => {
    const composition = resourcesOf(build(), 'Composition')[0];
    const patient = resourcesOf(build(), 'Patient')[0];
    expect(composition.author).toEqual([
      { reference: `urn:uuid:${patient.id}`, display: '患者本人（本记录由患者自行采集与自述）' },
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
  it('is confirmed only when a genetic report is on file', () => {
    const withReport = resourcesOf(build(), 'Condition')[0];
    expect(
      (withReport.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('confirmed');

    const selfReported = resourcesOf(build({ documents: [] }), 'Condition')[0];
    expect(
      (selfReported.verificationStatus as { coding: Array<{ code: string }> }).coding[0].code,
    ).toBe('unconfirmed');
    expect((selfReported.verificationStatus as { text: string }).text).toContain('患者自述诊断');
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
  it('says Brooke and Vignos are collected and not in this bundle', () => {
    const omission = build().omissions.find((entry) => entry.field.includes('Brooke'));
    expect(omission?.reasonZh).toContain('Vignos');
    expect(omission?.reasonZh).toContain('不表示患者没有做过分级');
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
    expect(resourcesOf(result, 'Observation')).toHaveLength(500);
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
