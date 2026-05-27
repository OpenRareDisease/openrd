import { createHash } from 'node:crypto';

/**
 * Stable sha256 hash for an arbitrary prompt body. Whitespace is
 * normalised first so a prompt with cosmetic reformatting still
 * matches the previous hash. Returns the hex digest (64 chars).
 */
export const hashPrompt = (text: string | null | undefined): string => {
  const normalised = (text ?? '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
};
