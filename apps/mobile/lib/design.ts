/**
 * Design tokens.
 *
 * What this replaces
 * ------------------
 * The previous look put every block of content inside a tinted,
 * 24pt-radius, bordered, shadowed card, nested cards inside cards, and
 * carried hierarchy entirely through box nesting and size jumps. Every
 * section wore a decorative uppercase Latin eyebrow (PATIENT ENTRY,
 * FOLLOW-UP), every icon sat in a tinted rounded square, and the four
 * data-entry modes were numbered 01–04 despite having no order. The
 * result reads as generic and unfinished: soft on soft, low contrast,
 * and — on the first screen a patient sees — almost no actual data.
 *
 * The stance here
 * ---------------
 * This app is a medical record. Records earn their authority from
 * typography, rules and alignment, not from rounded boxes. So:
 *
 *  - **Hairlines and whitespace separate; cards are rare.** At most
 *    one filled surface per screen, for the thing that screen is
 *    about. Everything else is set on the page.
 *  - **Radii are small and few.** 12 for a surface, 10 for a control.
 *    Pills only where the shape means something (a status chip).
 *  - **The accent is spent, not spread.** Teal marks one thing at a
 *    time. Where the old palette washed whole cards in it, this uses
 *    it for a rule, a value, or a single button.
 *  - **Numbers are the hero.** Clinical values get size, weight and
 *    tabular figures so a column of them aligns and a trend reads at
 *    a glance.
 *  - **No decorative labels.** An eyebrow has to say something the
 *    title doesn't. A number badge has to encode a real sequence.
 *
 * Relationship to `clinical-visuals.ts`
 * -------------------------------------
 * That module keeps the anatomical/body-map vocabulary and the legacy
 * colour names the un-migrated screens still import. New surfaces
 * should import from here. The two palettes are deliberately close —
 * this is the same sand-and-teal identity, re-pitched for contrast
 * rather than replaced.
 */

import { Platform, StyleSheet, type TextStyle } from 'react-native';

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

export const COLOR = {
  /** Page. Warmer than white, cleaner than the old #F8F2EA, which
   *  pulled yellow enough to grey out the teal sitting on it. */
  paper: '#FBF8F3',
  /** Raised surface. Actual white so a card reads as *lifted* rather
   *  than as another shade of the page. */
  surface: '#FFFFFF',
  /** The one tinted fill, for the single primary block per screen. */
  surfaceAccent: '#EFF4F1',
  /** Sunken wells: inputs, code, the inside of a stepper. */
  well: '#F3EFE8',

  /** Deep slate with a teal bias — chosen, not an inherited grey. */
  ink: '#17272E',
  inkSoft: '#42565F',
  /**
   * Secondary text. Every value on this ramp clears WCAG AA (4.5:1)
   * against `paper` — deliberately, because the first cut did not.
   *
   * inkMuted started at #78888F, which measures 3.47:1. That is fine
   * for a label beside a number and wrong for what it actually ended
   * up carrying: `TYPE.caption` maps to it, and caption is the layer
   * holding the longest instructions on the busiest screen ("上不了
   * 楼梯时该怎么填"). A muted tone is a hierarchy decision; it must not
   * double as a legibility decision, so the ramp is now built from the
   * contrast floor upward and hierarchy is carried by the remaining
   * headroom (7.3 / 4.9 / 4.5) plus size and weight.
   */
  inkMuted: '#5F7078', // 4.86:1 on paper
  /** Text that must recede as far as this system allows — units,
   *  footnotes, chevrons. Still readable: 4.5 is a floor, not a
   *  target to be undercut when something looks too present. */
  inkFaint: '#64757D', // 4.52:1 on paper

  /** Hairline. The main structural device in this system. */
  line: 'rgba(23, 39, 46, 0.11)',
  lineStrong: 'rgba(23, 39, 46, 0.18)',

  /** Accent — deeper and more saturated than the old #3F7A70, which
   *  went muddy against sand. Used sparingly. */
  accent: '#26695C',
  accentSoft: '#4E9284',
  /** The tinted-button fill. 0.08 was invisible: a tinted button on
   *  `surfaceAccent` (the hero block) sat on a background only 3% away
   *  from it, so the shape that was supposed to say「this is a control」
   *  said nothing, and only the accent label distinguished it from
   *  running text. 0.14 reads on paper and on surfaceAccent both. */
  accentWash: 'rgba(38, 105, 92, 0.14)',
  /** The accent hairline — the rule above a block that belongs to the
   *  accent rather than to the page. It was hand-rolled from the
   *  accent's rgb in six stylesheets at three different alphas (0.16,
   *  0.18, 0.28), so the same line was three different weights
   *  depending on which screen you were on. 0.16 is the one the
   *  majority already used and the one that reads on paper. */
  accentLine: 'rgba(38, 105, 92, 0.16)',

  /** Behind a modal. Ink, not black: every scrim in the app should be
   *  the same colour, and a pure-black one over warm paper goes grey
   *  where the ink-based ones stay in the palette. */
  scrim: 'rgba(23, 39, 46, 0.45)',

  /** Semantic, kept clearly apart from the accent so "teal" never has
   *  to mean "good". */
  good: '#2F7A5C',
  goodWash: 'rgba(47, 122, 92, 0.10)',
  warn: '#8F5714', // 5.60:1 on paper; #A96A1E measured 4.16
  warnWash: 'rgba(169, 106, 30, 0.10)',
  alert: '#B4472F',
  alertWash: 'rgba(180, 71, 47, 0.10)',

  onAccent: '#FFFFFF',
} as const;

/* ------------------------------------------------------------------ */
/* Type                                                                */
/* ------------------------------------------------------------------ */

/** Tabular figures so a column of measurements aligns and a changing
 *  value doesn't shift its neighbours. */
const TABULAR: TextStyle = {
  fontVariant: ['tabular-nums'],
};

export const TYPE = StyleSheet.create({
  /** Screen title. One per screen. */
  display: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: COLOR.ink,
  },
  /** Section heading. */
  title: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: COLOR.ink,
  },
  /** Card / row heading. */
  heading: {
    fontSize: 15.5,
    lineHeight: 22,
    fontWeight: '600',
    color: COLOR.ink,
  },
  /** Running text. */
  body: {
    fontSize: 15,
    lineHeight: 23,
    color: COLOR.inkSoft,
  },
  /** Running text that carries the point. */
  bodyStrong: {
    fontSize: 15,
    lineHeight: 23,
    color: COLOR.ink,
  },
  /** Secondary line under a heading. */
  caption: {
    fontSize: 13,
    lineHeight: 19,
    color: COLOR.inkMuted,
  },
  /** Field labels, chip text, button text. */
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: COLOR.inkSoft,
  },
  /** Genuine eyebrows only — a category the title does not repeat.
   *  Not decoration. */
  micro: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0.7,
    color: COLOR.inkMuted,
  },
  /** A clinical value. */
  metric: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: COLOR.ink,
    ...TABULAR,
  },
  /** A clinical value in a dense row. */
  metricSmall: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    color: COLOR.ink,
    ...TABULAR,
  },
  /** The unit beside a value. */
  unit: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: COLOR.inkFaint,
  },
});

/* ------------------------------------------------------------------ */
/* Space + shape                                                       */
/* ------------------------------------------------------------------ */

/** 4pt base. `gutter` is the page margin; `section` is the gap between
 *  top-level blocks. Everything else is a multiple. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  gutter: 20,
  section: 28,
} as const;

export const RADIUS = {
  /** Surfaces. */
  surface: 12,
  /** A grouped list — the iOS inset-grouped table. Slightly larger
   *  than a lone surface because it wraps several rows, and a radius
   *  that reads as generous on a 56pt row reads as tight on 300pt of
   *  stacked ones. */
  group: 14,
  /** Controls. */
  control: 10,
  /** Only where a pill shape carries meaning — a status chip. */
  pill: 999,
} as const;

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

/**
 * How a tappable thing announces itself.
 *
 * The screens this replaces carried no affordance at all: a row that
 * navigated and a row that only displayed looked identical, and the
 * only way to find out which was which was to tap. The tested
 * complaint was exactly that — 「我看不出哪些是可点选的」.
 *
 * iOS answers this with three signals, and this app now uses the same
 * three, because they are learned behaviour rather than house style:
 *
 *  1. **A chevron** on anything that navigates. Nothing else gets one,
 *     so its presence is information rather than decoration.
 *  2. **A press state** that is visible at the moment of contact — the
 *     row fills, it does not merely fade. Opacity alone disappears
 *     under a thumb.
 *  3. **Accent colour on the label** for an action that is not a row —
 *     a text button. Teal means "this does something" and is spent
 *     nowhere else.
 */
export const INTERACTION = {
  /** `activeOpacity` for TouchableOpacity. Restrained: the fill below
   *  is doing the work, and stacking both reads as a flicker. */
  pressOpacity: 0.75,
  /** How far a control shrinks under a finger.
   *
   *  iOS answers a press with geometry, not just colour — a button
   *  compresses slightly and springs back. 0.96 is the value that reads
   *  as physical without looking like the button moved: at 44pt that is
   *  under 2pt of travel. */
  pressScale: 0.96,
  /** The fill under a pressed row. Warm rather than grey so it reads
   *  as the paper darkening, not as a grey overlay. */
  pressFill: 'rgba(23, 39, 46, 0.05)',
  /** Chevron size + colour. Small and receding — it marks a row, it is
   *  not a feature of it. */
  chevronSize: 15,
  chevronColor: COLOR.inkFaint,
} as const;

export const HAIRLINE = StyleSheet.hairlineWidth;

/**
 * Elevation is nearly absent by design: the tab bar and the record
 * button are the only things that float, because they are the only
 * things that persist above the page.
 */
export const ELEVATION = {
  floating: Platform.select({
    ios: {
      shadowColor: COLOR.ink,
      shadowOpacity: 0.1,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: -2 },
    },
    android: { elevation: 8 },
    default: { boxShadow: '0 -2px 16px rgba(23,39,46,0.10)' },
  }),
  button: Platform.select({
    ios: {
      shadowColor: COLOR.ink,
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 6 },
    default: { boxShadow: '0 4px 10px rgba(23,39,46,0.18)' },
  }),
} as const;

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const SURFACE = StyleSheet.create({
  /** The default container: a hairline-bordered white panel. No
   *  shadow — depth comes from the border and the paper behind it. */
  card: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
  },
  /** The one accented block per screen. */
  cardAccent: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
  },
  /** A full-width hairline. The workhorse separator — this system
   *  reaches for it before it reaches for another card. */
  rule: {
    height: HAIRLINE,
    backgroundColor: COLOR.line,
  },
  /** Sunken input. */
  well: {
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
  },
});

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

/**
 * Timing.
 *
 * Apple's interface motion is spring-based, not curve-based: a control
 * responds with mass and settles, it does not travel a fixed distance
 * over a fixed duration. react-native-reanimated 4 ships `withSpring`
 * with the same damping/stiffness model, so these are real springs
 * rather than an easing curve pretending to be one.
 *
 * Two springs, because there are two kinds of movement here:
 *
 *  - `press` — a control answering a finger. Critically damped and
 *    fast: no overshoot, because a button that bounces under the thumb
 *    reads as loose.
 *  - `move` — something travelling across the screen on its own (the
 *    selected pill in a segmented control). Slight overshoot, which is
 *    what makes it read as a physical object rather than a crossfade.
 *
 * `enter` is a duration rather than a spring: fading a newly-arrived
 * block in has no physical analogue to model.
 */
export const MOTION = {
  press: { damping: 26, stiffness: 420, mass: 0.6 },
  move: { damping: 18, stiffness: 260, mass: 0.8 },
  /** Something arriving on its own — a dialog, a new chat message, a
   *  panel swapped in behind a tab. Softer than `move` because the
   *  thing was not dragged there by a finger; it should look placed,
   *  not thrown. */
  present: { damping: 20, stiffness: 200, mass: 0.9 },
  enter: 220,
  /** A dialog starts slightly small and settles. iOS scales presented
   *  content rather than only fading it — a pure crossfade reads as a
   *  screenshot swap, not as something arriving. */
  presentScaleFrom: 0.94,
} as const;
