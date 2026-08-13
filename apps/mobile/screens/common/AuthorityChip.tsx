import { Text, type TextStyle } from 'react-native';
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
 * Three tones over the four labels, ranked the way knowledge.py's
 * AUTHORITY_TIERS ranks them:
 *
 *   指南/共识  accent
 *   文献       neutral
 *   资料       neutral
 *   病友经验   warn
 *
 * That is a statement about the strength of the CLAIM, not about the
 * person who wrote it: the KB ranker gives 指南/共识 no relevance
 * penalty at all and 病友经验 its largest, and a chip that made those
 * two look identical would contradict the ranking the answer was built
 * on. The table above is the whole palette, and
 * __tests__/authority-chip-palette.test.ts reads it back out of this
 * comment and compares it against TONES — a comment describing a map
 * ten lines below it is exactly the pair that drifts.
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
 * The chip is one word, so it has to break like one.
 *
 * On the web export a nested `Text` is an inline `<span>` that inherits
 * the parent's `white-space: pre-wrap`, and CSS allows a line break
 * between any two Han characters — so「指南/共识」is four break
 * opportunities sitting in the middle of a citation title. An inline box
 * that breaks fragments: `box-decoration-break` defaults to `slice`, so
 * each fragment paints its own `backgroundColor` and `borderRadius` and
 * `paddingHorizontal` lands only on the outer edges. The chip comes out
 * as two half-pills on two lines, one of them flush to the margin with a
 * squared-off edge, which reads as a rendering glitch at the moment the
 * grade is meant to be read at a glance.
 *
 * Measured on the 211 source_file names in the live index, laid out in
 * headless Chrome at five phone content widths (280/296/312/328/344px):
 * 107 of 1,055 chip renders split, 0 with this style. `whiteSpace` is a
 * CSS property react-native-web passes straight through to the span and
 * React Native's `TextStyle` has no key for it, hence the cast; native
 * ignores it, which is right — native measures a nested run as a unit
 * and never fragments its background.
 */
const NO_WRAP = { whiteSpace: 'nowrap' } as TextStyle;

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
      style={[
        {
          color: tone.color,
          backgroundColor: tone.backgroundColor,
          fontSize: 10,
          fontWeight: '700',
          paddingHorizontal: 4,
          borderRadius: 4,
        },
        NO_WRAP,
      ]}
    >
      {text}
    </Text>
  );
};

export default AuthorityChip;
