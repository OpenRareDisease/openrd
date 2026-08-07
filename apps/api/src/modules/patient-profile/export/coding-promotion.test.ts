import { describe, expect, it, vi } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { normaliseSource } from './export-source.js';
import { buildFhirExport, type FhirResource } from './fhir-r4.js';

/**
 * What happens when someone follows codings.ts's promotion recipe.
 *
 * The recipe promises that moving a PENDING entry into
 * VERIFIED_CODINGS is the whole edit. That promise was false: nothing
 * read `ReportField.codingKey`, so the only observable effect of a
 * promotion was CK silently dropping out of `codingProvenance.withheld`
 * — the receiver stopped being told the code was withheld without ever
 * being told it was now emitted. Both halves are pinned here.
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

const build = () =>
  buildFhirExport(
    normaliseSource(EXPORT_FIXTURE_PROFILE, {
      includeLocalOnly: false,
      generatedAt: FIXTURE_GENERATED_AT,
    }),
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
});
