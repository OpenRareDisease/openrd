import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import {
  PENDING_VERIFICATION,
  VERIFIED_CODINGS,
  buildCodingProvenance,
  toCurie,
  verifiedCoding,
} from './codings.js';
import { buildPortableExport, PORTABLE_EXPORT_FORMATS } from './index.js';

/**
 * Every export, serialised with the `codingProvenance` blocks removed.
 *
 * Those blocks LIST the withheld codes on purpose — that is how a
 * receiver learns what we could not code and why — so a naive
 * whole-document search for a pending code would match its own
 * disclosure and prove nothing. Stripping them leaves exactly the
 * surface where a code would actually be believed.
 */
const stripProvenance = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripProvenance);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'codingProvenance')
        .map(([key, nested]) => [key, stripProvenance(nested)]),
    );
  }
  return value;
};

const renderAll = (includeLocalOnly: boolean) =>
  PORTABLE_EXPORT_FORMATS.map((format) =>
    JSON.stringify(
      stripProvenance(
        buildPortableExport(format, EXPORT_FIXTURE_PROFILE, {
          includeLocalOnly,
          generatedAt: FIXTURE_GENERATED_AT,
        }),
      ),
    ),
  );

describe('coding ledger — the gate', () => {
  it('answers only for ledgered keys', () => {
    expect(verifiedCoding('disease.fshd1')?.code).toBe('158900');
    expect(verifiedCoding('disease.fshd2')?.code).toBe('158901');
    expect(verifiedCoding('lab.creatineKinase')).toBeNull();
    expect(verifiedCoding('anything.else')).toBeNull();
  });

  it('every ledgered entry names at least one source that exists in this repo', () => {
    expect(VERIFIED_CODINGS.length).toBeGreaterThan(0);
    VERIFIED_CODINGS.forEach((entry) => {
      expect(entry.verifiedAgainst.length, entry.key).toBeGreaterThan(0);
      entry.verifiedAgainst.forEach((citation) => {
        // A citation has to point at a path, not just name a paper —
        // "verified" means a reviewer can open the thing.
        expect(citation, entry.key).toContain('content/medical-kb/source/');
      });
    });
  });

  it('builds CURIEs in the form Phenopacket expects', () => {
    expect(toCurie(VERIFIED_CODINGS[0])).toBe('OMIM:158900');
  });
});

describe('coding ledger — nothing unverified reaches an export', () => {
  it.each(PENDING_VERIFICATION)('never emits the withheld code $code ($wouldMean)', (pending) => {
    // The load-bearing assertion of this whole lane. If someone
    // pastes a remembered LOINC code into a serialiser without
    // promoting it through the ledger, this goes red.
    renderAll(false)
      .concat(renderAll(true))
      .forEach((serialised) => {
        expect(serialised).not.toContain(pending.code);
      });
  });

  it('never emits a LOINC system URI', () => {
    renderAll(true).forEach((serialised) => {
      expect(serialised.toLowerCase()).not.toContain('loinc.org');
    });
  });

  it('tells the receiver what was withheld and why', () => {
    const provenance = buildCodingProvenance([]);
    expect(provenance.emitted).toEqual([]);
    expect(provenance.withheld.map((entry) => entry.code)).toEqual(
      PENDING_VERIFICATION.map((entry) => entry.code),
    );
    provenance.withheld.forEach((entry) => {
      expect(entry.whyNotVerified.length).toBeGreaterThan(0);
    });
  });

  it('carries the citation forward when a coding IS emitted', () => {
    const provenance = buildCodingProvenance(['disease.fshd1', 'lab.creatineKinase']);
    // The unledgered key is dropped rather than emitted uncited.
    expect(provenance.emitted).toHaveLength(1);
    expect(provenance.emitted[0].curie).toBe('OMIM:158900');
    expect(provenance.emitted[0].verifiedAgainst[0]).toContain('content/medical-kb/source/');
  });
});
