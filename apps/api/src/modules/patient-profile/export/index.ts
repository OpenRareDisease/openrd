import { normaliseSource, type ExportOptions } from './export-source.js';
import { buildFhirExport } from './fhir-r4.js';
import { buildPhenopacketExport } from './phenopacket.js';
import { buildTreatNmdExport } from './treat-nmd.js';
import type { PatientProfileDTO } from '../profile.service.js';

export { normaliseSource } from './export-source.js';
export type { ExportOptions, NormalisedSource } from './export-source.js';
export { buildTreatNmdExport } from './treat-nmd.js';
export { buildPhenopacketExport } from './phenopacket.js';
export { buildFhirExport } from './fhir-r4.js';
export { PENDING_VERIFICATION, VERIFIED_CODINGS, verifiedCoding } from './codings.js';
export { decodeYear, serialiseYear } from './year-value.js';
export { resolveOccurrenceDate, toPartialFhirDate } from './occurrence-date.js';

/**
 * The formats `GET /me/data-export?format=…` accepts.
 *
 * Deliberately NOT including a bare 「all」: the three documents
 * describe the same facts three different ways, and a caller that
 * wants all three should ask for them one at a time so that each
 * response's own conformance statement and omission list arrive
 * attached to the document they are about. Concatenating them would
 * put three different sets of caveats in one bag.
 */
export const PORTABLE_EXPORT_FORMATS = ['treat-nmd', 'phenopacket', 'fhir-r4'] as const;
export type PortableExportFormat = (typeof PORTABLE_EXPORT_FORMATS)[number];

export const isPortableExportFormat = (value: unknown): value is PortableExportFormat =>
  typeof value === 'string' && (PORTABLE_EXPORT_FORMATS as readonly string[]).includes(value);

/**
 * Build one portable document.
 *
 * The union return type is deliberately wide (the three documents
 * have nothing in common below the envelope) — callers serialise it
 * straight to JSON and do not inspect it.
 */
export const buildPortableExport = (
  format: PortableExportFormat,
  profile: PatientProfileDTO,
  options: ExportOptions,
) => {
  const source = normaliseSource(profile, options);
  switch (format) {
    case 'treat-nmd':
      return buildTreatNmdExport(source);
    case 'phenopacket':
      return buildPhenopacketExport(source);
    case 'fhir-r4':
      return buildFhirExport(source);
  }
};
