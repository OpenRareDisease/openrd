import { z } from 'zod';

import { LEGAL_DOCUMENT_IDS, LEGAL_VERSION_MAX_LENGTH } from './legal.constants.js';

/**
 * Body of POST /api/legal/acceptances.
 *
 * `document` is an enum rather than a free string so an unknown value
 * comes back as a 400 naming the field, instead of reaching Postgres
 * and surfacing as a 500 from the CHECK constraint — a client typo
 * would otherwise look like a server fault in the logs.
 *
 * `version` is deliberately NOT pinned to the server's current version.
 * The web export ships separately from the API, so a client can
 * legitimately be one revision behind, and the honest record is the
 * version the user actually read. The bound mirrors the column CHECK.
 */
export const recordAcceptanceSchema = z.object({
  document: z.enum(LEGAL_DOCUMENT_IDS),
  version: z.string().trim().min(1).max(LEGAL_VERSION_MAX_LENGTH),
});

export type RecordAcceptanceBody = z.infer<typeof recordAcceptanceSchema>;
