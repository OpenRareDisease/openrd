import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { normaliseSource } from './export-source.js';
import { buildPhenopacketExport, toPhenopacketSex } from './phenopacket.js';
import type { PatientProfileDTO } from '../profile.service.js';

const build = (overrides: Partial<PatientProfileDTO> = {}, includeLocalOnly = false) =>
  buildPhenopacketExport(
    normaliseSource(
      { ...EXPORT_FIXTURE_PROFILE, ...overrides },
      { includeLocalOnly, generatedAt: FIXTURE_GENERATED_AT },
    ),
  );

const withDiagnosisType = (diagnosisType: string | null): Partial<PatientProfileDTO> => ({
  baseline: {
    ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
    diseaseBackground: { diagnosisType },
  },
  geneticMutation: null,
});

describe('Phenopacket v2 — only verified ontology terms', () => {
  it('emits the FSHD1 disease term with the OMIM id verified in this repo', () => {
    const result = build();
    expect(result.document.diseases).toEqual([
      {
        term: {
          id: 'OMIM:158900',
          label: 'Facioscapulohumeral muscular dystrophy 1 (FSHD1)',
        },
      },
    ]);
    expect(result.codingProvenance.emitted[0].verifiedAgainst[0]).toContain(
      'content/medical-kb/source/',
    );
  });

  it('emits FSHD2 as its own OMIM entry', () => {
    expect(build(withDiagnosisType('FSHD2')).document.diseases?.[0].term.id).toBe('OMIM:158901');
  });

  it('omits `diseases` entirely rather than defaulting an unknown subtype to FSHD1', () => {
    const result = build(withDiagnosisType(null));
    expect(result.document.diseases).toBeUndefined();
    const omission = result.omissions.find((entry) => entry.field === 'diseases');
    expect(omission?.reasonZh).toContain('不是默认写成最常见的 1 型');
    // With no disease term there is no OMIM resource to declare
    // either — a resources entry for a vocabulary we did not use
    // would be a false statement about the packet's dependencies.
    expect(result.document.metaData.resources).toEqual([]);
  });

  it('records that measurements and phenotypic features were withheld for lack of a code', () => {
    const fields = build().omissions.map((entry) => entry.field);
    expect(fields).toContain('measurements');
    expect(fields).toContain('phenotypicFeatures');
    // The counts matter: the receiver has to know data EXISTS and was
    // withheld, not that the patient has no findings.
    const measurements = build().omissions.find((entry) => entry.field === 'measurements');
    expect(measurements?.reasonZh).toContain('2 条肌力记录');
  });

  it('leaves an OMIM release version empty rather than inventing one', () => {
    expect(build().document.metaData.resources[0].version).toBe('');
  });
});

describe('Phenopacket v2 — FSHD1 is not a sequence variant', () => {
  it('never emits interpretations, and says why', () => {
    const result = build();
    expect('interpretations' in result.document).toBe(false);
    const omission = result.omissions.find((entry) => entry.field === 'interpretations');
    expect(omission?.reasonZh).toContain('D4Z4');
    expect(omission?.reasonZh).toContain('不是 DUX4 的序列变异');
  });

  it('does not mention DUX4 as a studied gene anywhere in the packet', () => {
    // The exact defect the lane warned about: stuffing DUX4 into
    // gene-studied so a genomics profile validates.
    const serialised = JSON.stringify(build().document);
    expect(serialised).not.toContain('DUX4');
    expect(serialised).not.toContain('geneContext');
    expect(serialised).not.toContain('gene-studied');
  });
});

describe('Phenopacket v2 — subject', () => {
  it('maps sex without turning a privacy choice into a characteristic', () => {
    expect(toPhenopacketSex('female')).toBe('FEMALE');
    expect(toPhenopacketSex('male')).toBe('MALE');
    expect(toPhenopacketSex('non_binary')).toBe('OTHER_SEX');
    // Declining to answer is not a statement about sex.
    expect(toPhenopacketSex('prefer_not_to_say')).toBe('UNKNOWN_SEX');
    expect(toPhenopacketSex(null)).toBe('UNKNOWN_SEX');
  });

  it('carries no direct identifier, even in the local-only variant', () => {
    const serialised = JSON.stringify(build({}, true));
    expect(serialised).not.toContain('张小雨');
    expect(serialised).not.toContain('13800000000');
    expect(serialised).not.toContain('李医生');
  });
});

describe('Phenopacket v2 — files', () => {
  it('points at the API path and never at the object-store URI', () => {
    const files = build().document.files ?? [];
    expect(files).toHaveLength(2);
    files.forEach((file) => {
      expect(file.uri.startsWith('/patient-profiles/me/documents/')).toBe(true);
    });
    expect(JSON.stringify(build())).not.toContain('local://uploads');
  });

  it('omits a null title instead of stringifying it', () => {
    const result = build({
      documents: [{ ...EXPORT_FIXTURE_PROFILE.documents[0], title: null, mimeType: null }],
    });
    const attributes = result.document.files?.[0].fileAttributes ?? {};
    expect(Object.keys(attributes).sort()).toEqual(['documentType', 'uploadedAt']);
    expect(JSON.stringify(attributes)).not.toContain('null');
  });

  it('omits the files array entirely when there are no documents', () => {
    expect(build({ documents: [] }).document.files).toBeUndefined();
  });
});
