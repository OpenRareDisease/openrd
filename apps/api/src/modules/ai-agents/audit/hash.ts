import { createHash } from 'node:crypto';

/**
 * Stable sha256 hash for an arbitrary prompt body.
 *
 * Whitespace handling: only leading/trailing whitespace is trimmed.
 * Earlier versions collapsed every whitespace run to a single space so
 * cosmetic reformatting produced the same hash; that made the hash
 * trivially colliding by construction — an attacker could pad
 * arbitrary content with extra spaces to match a known reference
 * prompt's digest. Since the orchestrator serialises messages through
 * a deterministic encoder (see `serializeMessageForHash` in run.ts),
 * we don't need any "cosmetic reformatting tolerance" beyond strip,
 * and we want the hash to actually identify the byte stream.
 *
 * Returns the hex digest (64 chars).
 */
export const hashPrompt = (text: string | null | undefined): string => {
  const normalised = (text ?? '').trim();
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
};
