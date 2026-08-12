import { Text } from 'react-native';
import { COLOR } from '../../lib/design';

/**
 * The source-strength stamp on a citation —「指南/共识」/「文献」/
 *「资料」/「病友经验」.
 *
 * Why it has to be on screen
 * --------------------------
 * The API has graded every knowledge-base citation since the authority
 * tiers landed (knowledge.py AUTHORITY_TIERS → `Citation.authorityLabel`),
 * and it puts the grade in the model's prompt header as
 *「｜来源等级：指南/共识」. The patient was the only party not shown it:
 * every chip rendered `formatCitationLabel(sourceFile)`, which is the
 * basename only — deliberately, so a patient report's storage path never
 * reaches the screen — and the basename is exactly the part of
 *「11.病友经验/forum.pdf」that no longer says 病友经验. So an anecdote
 * and a practice guideline arrived under one answer looking equally
 * authoritative, which is the confusion the tiers exist to prevent.
 *
 * Text first, colour second
 * -------------------------
 * The grade is always spelled out. The tone only reinforces it, because
 * a patient reading this on a phone in WeChat may be doing so with a
 * colour filter, at 3am, or with low vision — see lib/design.ts on the
 * contrast ramp. Nothing here is legible by colour alone.
 *
 * 病友经验 carries `warn` rather than the neutral tone the other three
 * share. That is a statement about the strength of the CLAIM, not about
 * the person who wrote it: the KB ranker already applies its largest
 * relevance penalty to that tier, and a chip that looked identical to
 *「指南/共识」would contradict the ranking the answer was built on.
 */

interface AuthorityTone {
  color: string;
  backgroundColor: string;
}

const NEUTRAL: AuthorityTone = { color: COLOR.inkSoft, backgroundColor: COLOR.well };

/**
 * Keyed on the four labels knowledge.py emits. An unrecognised label
 * still renders — with the neutral tone — because the server owns this
 * vocabulary and a tier added there must not vanish from the screen
 * until the app catches up.
 */
const TONES: Record<string, AuthorityTone> = {
  '指南/共识': { color: COLOR.accent, backgroundColor: COLOR.accentWash },
  文献: NEUTRAL,
  资料: NEUTRAL,
  病友经验: { color: COLOR.warn, backgroundColor: COLOR.warnWash },
};

export const authorityToneFor = (label: string): AuthorityTone => TONES[label] ?? NEUTRAL;

/** `null`/blank means the source has no ranking (patient records,
 *  platform docs) — those get no chip at all rather than a chip
 *  claiming an unknown grade. */
export const readAuthorityLabel = (raw: string | null | undefined): string | null => {
  const label = (raw ?? '').trim();
  return label ? label : null;
};

/**
 * Rendered as a nested `<Text>` so it flows inside the citation's title
 * line and cannot push the layout around: on the web export a nested
 * Text is an inline `<span>`, and vertical padding on an inline box does
 * not grow its line, so the padding stays horizontal.
 */
export const AuthorityChip = ({ label }: { label: string | null | undefined }) => {
  const text = readAuthorityLabel(label);
  if (!text) return null;
  const tone = authorityToneFor(text);

  return (
    <Text
      style={{
        color: tone.color,
        backgroundColor: tone.backgroundColor,
        fontSize: 10,
        fontWeight: '700',
        paddingHorizontal: 4,
        borderRadius: 4,
      }}
    >
      {text}
    </Text>
  );
};

export default AuthorityChip;
