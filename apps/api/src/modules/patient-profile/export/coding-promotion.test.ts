import { describe, expect, it, vi } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { normaliseSource } from './export-source.js';
import { MAX_OBSERVATIONS, buildFhirExport, type FhirResource } from './fhir-r4.js';
import type { PatientProfileDTO } from '../profile.service.js';

/**
 * What happens when someone follows codings.ts's promotion recipe.
 *
 * The recipe promises that moving a PENDING entry into
 * VERIFIED_CODINGS is the whole edit. That promise has been false
 * twice. First: nothing read `ReportField.codingKey`, so the only
 * observable effect of a promotion was CK silently dropping out of
 * `codingProvenance.withheld` — the receiver stopped being told the
 * code was withheld without ever being told it was now emitted.
 * Second: the FHIR envelope's three declarations about external
 * terminology were hardcoded 「没有外部编码」, so a promoted bundle
 * carried a LOINC code while its own `omissions` told the receiving
 * hospital there were none anywhere in the document. Every half is
 * pinned here, on the output rather than on the wiring.
 *
 * The ledger is mocked rather than promoted for real, because the
 * subject under test is fhir-r4.ts's wiring, not the LOINC mapping. No
 * LOINC code may enter a real export until someone has a release open —
 * codings.test.ts is what guards that, and it uses the real ledger.
 */

const PROMOTED = {
  key: 'lab.creatineKinase',
  curiePrefix: 'LOINC',
  fhirSystem: 'http://example.invalid/loinc-stand-in',
  code: 'TEST-2157-6',
  label: 'Creatine kinase [Enzymatic activity/volume] in Serum or Plasma',
  labelZh: '肌酸激酶（CK）',
  verifiedAgainst: ['content/medical-kb/source/… — 测试替身，不是真实核对记录'],
};

const provenanceCalls: string[][] = [];

vi.mock('./codings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./codings.js')>();
  return {
    ...actual,
    verifiedCoding: (key: string) => (key === PROMOTED.key ? PROMOTED : actual.verifiedCoding(key)),
    buildCodingProvenance: (keys: readonly string[]) => {
      provenanceCalls.push([...keys]);
      return actual.buildCodingProvenance(keys);
    },
  };
});

const build = (overrides: Partial<PatientProfileDTO> = {}) =>
  buildFhirExport(
    normaliseSource(
      { ...EXPORT_FIXTURE_PROFILE, ...overrides },
      { includeLocalOnly: false, generatedAt: FIXTURE_GENERATED_AT },
    ),
  );

const observationsOf = (result: ReturnType<typeof build>): FhirResource[] =>
  result.document.entry
    .map((entry) => entry.resource)
    .filter((resource) => resource.resourceType === 'Observation');

describe('promoting a ledger entry actually reaches the export', () => {
  it('puts the coding on the Observation the codingKey points at', () => {
    const ck = observationsOf(build()).find((resource) =>
      (resource.code as { text: string }).text.includes('肌酸激酶'),
    );
    expect((ck?.code as { coding?: Array<{ system: string; code: string }> }).coding).toEqual([
      { system: PROMOTED.fhirSystem, code: PROMOTED.code, display: PROMOTED.label },
    ]);
    // The label survives alongside the code — a receiver that cannot
    // resolve the system still has something a human can read.
    expect((ck?.code as { text: string }).text).toBe('肌酸激酶（CK）');
  });

  it('leaves an unledgered field as text with no coding', () => {
    const haplotype = observationsOf(build()).find((resource) =>
      (resource.code as { text: string }).text.includes('单倍型'),
    );
    expect((haplotype?.code as { coding?: unknown }).coding).toBeUndefined();
  });

  it('declares the promoted key to codingProvenance instead of passing an empty list', () => {
    provenanceCalls.length = 0;
    build();
    // The receiver has to be TOLD the code is now emitted. Promotion
    // removes the entry from PENDING_VERIFICATION and therefore from
    // `withheld`, so a bundle that keeps handing this an empty array
    // leaves the receiver informed of neither state.
    //
    // Asserted on the argument rather than on `emitted`, because
    // `buildCodingProvenance` resolves keys through the real ledger
    // and the promotion here is a test double. That the ledger turns
    // a key into a cited `emitted` entry is codings.test.ts's job.
    expect(provenanceCalls.at(-1)).toContain(PROMOTED.key);
  });

  it('stops the envelope declaring an absence the same bundle contradicts', () => {
    const result = build();

    // Ground truth, read off the document: a third-party system URI is
    // now in the bundle. Everything below is that fact's consequence.
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
    const external = [...systems].filter(
      (system) => !system.startsWith('http://terminology.hl7.org/CodeSystem/'),
    );
    expect(external).toEqual([PROMOTED.fhirSystem]);

    // A receiver that trusts `omissions` — which envelope.ts exists to
    // make trustworthy — must not be told this document has no
    // external codings while it is holding one.
    const loinc = result.omissions.find(
      (entry) => entry.field === 'CodeableConcept.coding (LOINC)',
    );
    expect(loinc?.reasonZh).toContain(PROMOTED.fhirSystem);
    expect(loinc?.reasonZh).not.toContain('不附带 LOINC 等外部编码');

    expect(result.conformanceZh).toContain(PROMOTED.fhirSystem);
    expect(result.conformanceZh).not.toContain('不附带外部术语编码');

    expect(result.notes.编码).toContain(PROMOTED.fhirSystem);
    expect(result.notes.编码).not.toContain('不是第三方术语');
  });

  it('unsays it when MAX_OBSERVATIONS evicts the only coded Observation', () => {
    // The mirror of the case above, and the one the derivation got
    // wrong: the declarations were read off every candidate the
    // report-field loop built, not off the Observations that survived
    // the cut. A patient with more than MAX_OBSERVATIONS rows therefore
    // got a bundle announcing a terminology system that is nowhere in
    // it — a receiver told to resolve LOINC codes, holding a document
    // with none.
    provenanceCalls.length = 0;
    const newerThanTheReport = Array.from({ length: MAX_OBSERVATIONS }, (_, index) => ({
      ...EXPORT_FIXTURE_PROFILE.measurements[0],
      id: `crowd-${index}`,
      recordedAt: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
    }));
    const result = build({ measurements: newerThanTheReport });

    // Ground truth: the coded CK Observation lost its place, so the
    // third-party system is not in the document at all.
    const observations = observationsOf(result);
    expect(observations).toHaveLength(MAX_OBSERVATIONS);
    expect(
      observations.some((resource) =>
        (resource.code as { text: string }).text.includes('肌酸激酶'),
      ),
    ).toBe(false);
    expect(JSON.stringify(result.document)).not.toContain(PROMOTED.fhirSystem);

    // So every statement the envelope makes about terminology has to be
    // back to the one that matches the document.
    const loinc = result.omissions.find(
      (entry) => entry.field === 'CodeableConcept.coding (LOINC)',
    );
    expect(loinc?.reasonZh).not.toContain(PROMOTED.fhirSystem);
    expect(loinc?.reasonZh).toContain('不附带 LOINC 等外部编码');

    expect(result.conformanceZh).not.toContain(PROMOTED.fhirSystem);
    expect(result.conformanceZh).toContain('不附带外部术语编码');

    expect(result.notes.编码).not.toContain(PROMOTED.fhirSystem);
    expect(result.notes.编码).toContain('不是第三方术语');

    // And the receiver is not handed a citation for a code the bundle
    // does not carry.
    expect(provenanceCalls.at(-1)).not.toContain(PROMOTED.key);
    expect(result.codingProvenance.emitted).toEqual([]);
  });

  it('stops explaining a missing effectiveDateTime once the cut removed every such entry', () => {
    // Same class as the assertion above, on the fourth statement this
    // envelope makes about its own contents. The omission explains why
    // certain Observations IN THE BUNDLE carry no `effectiveDateTime`;
    // when the cut evicts all of them it describes nothing a reader can
    // find, so it is not raised.
    const undatedReport = {
      ...EXPORT_FIXTURE_PROFILE.documents[1],
      id: '88888888-8888-4888-8888-888888888884',
      documentType: 'pulmonary_function',
      uploadedAt: '2025-01-02T00:00:00.000Z',
      ocrPayload: { fields: { fvcPredPct: '78%' } },
    };
    const field = 'Observation.effectiveDateTime（报告自动解析项）';

    // Present while the undated Observation is in the bundle …
    expect(build({ documents: [undatedReport] }).omissions.map((entry) => entry.field)).toContain(
      field,
    );

    // … and gone once MAX_OBSERVATIONS dated rows have pushed it out.
    const crowded = build({
      documents: [undatedReport],
      measurements: Array.from({ length: MAX_OBSERVATIONS }, (_, index) => ({
        ...EXPORT_FIXTURE_PROFILE.measurements[0],
        id: `crowd-${index}`,
        recordedAt: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
      })),
    });
    expect(
      observationsOf(crowded).some((resource) =>
        (resource.code as { text: string }).text.includes('FVC%pred'),
      ),
    ).toBe(false);
    expect(crowded.omissions.map((entry) => entry.field)).not.toContain(field);
    // The drop itself is still declared — the receiver is never left
    // without an account of what is missing.
    expect(crowded.omissions.map((entry) => entry.field)).toContain('Observation');
  });
});
