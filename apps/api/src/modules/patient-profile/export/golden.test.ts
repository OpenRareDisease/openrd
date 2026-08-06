import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { buildPortableExport } from './index.js';

/**
 * Golden files.
 *
 * The targeted tests in the sibling files pin the rules — 「记不清了」
 * stays distinct, a year-pinned milestone never becomes 1 January, no
 * unverified code is emitted. These files pin the WHOLE document, so
 * that a change nobody wrote a rule for still shows up as a diff a
 * human has to look at before it reaches a patient's medical record.
 *
 * They are deterministic by construction: `generatedAt` is injected
 * and every resource id is either a row uuid or a digest of its
 * inputs, so a re-run with no code change produces a byte-identical
 * file.
 *
 * Regenerate with `npx vitest run -u <this file>` — and then READ the
 * diff. An updated golden is a claim that the new output is correct.
 */

const render = (format: Parameters<typeof buildPortableExport>[0], includeLocalOnly: boolean) =>
  `${JSON.stringify(
    buildPortableExport(format, EXPORT_FIXTURE_PROFILE, {
      includeLocalOnly,
      generatedAt: FIXTURE_GENERATED_AT,
    }),
    null,
    2,
  )}\n`;

describe('golden documents', () => {
  it('TREAT-NMD alignment, shareable variant', async () => {
    await expect(render('treat-nmd', false)).toMatchFileSnapshot(
      './__fixtures__/golden.treat-nmd.json',
    );
  });

  it('TREAT-NMD alignment, local-only variant', async () => {
    await expect(render('treat-nmd', true)).toMatchFileSnapshot(
      './__fixtures__/golden.treat-nmd.local-only.json',
    );
  });

  it('GA4GH Phenopacket v2', async () => {
    await expect(render('phenopacket', false)).toMatchFileSnapshot(
      './__fixtures__/golden.phenopacket.json',
    );
  });

  it('FHIR R4 document bundle', async () => {
    await expect(render('fhir-r4', false)).toMatchFileSnapshot(
      './__fixtures__/golden.fhir-r4.json',
    );
  });
});
