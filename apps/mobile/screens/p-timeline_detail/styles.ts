import { StyleSheet, type TextStyle } from 'react-native';
import { COMFORTABLE_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/** Same device design.ts uses for metrics. Declared with an explicit
 *  TextStyle so the literal narrows — inside StyleSheet.create the
 *  contextual type is a union and would leave this as string[]. */
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * 时间轴详情 — re-pitched on lib/design.ts.
 *
 * What this pass removed
 * ----------------------
 *  - Four stacked 22–24pt-radius tinted cards, each with a 24pt-blur
 *    shadow, plus a *fifth* tier of cards nested inside 记录信息.
 *    A record detail is one subject with facts under it, not five
 *    floating panels. Only the hero stays filled; the rest is set on
 *    the page and separated by hairlines.
 *  - The `TIMELINE DETAIL` eyebrow. It was a Latin transliteration of
 *    the 时间轴详情 sitting directly under it — pure decoration.
 *  - The page-level shadow vocabulary. Depth here comes from the one
 *    filled block and from rules.
 *
 * What this pass promoted
 * -----------------------
 *  The record's own title, not the screen name, is now the largest
 *  thing on the page: 时间轴详情 is a nav label beside a back button,
 *  while the title/timestamp/values are the data the patient came for.
 *  Timestamps use tabular figures so the 记录信息 column aligns.
 *
 * Note on the two <LinearGradient> wrappers in index.tsx: that file is
 * off-limits this pass, so the page gradient is neutralised from here
 * instead — the header and the scroll content both paint COLOR.paper
 * over it, and the content container grows to fill the viewport so no
 * banding is left showing under short records.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  backgroundGradient: {
    flex: 1,
  },

  /* Header --------------------------------------------------------- */
  /** Only the paper fill and the rule live here now — the padding and
   *  the row layout come from ScreenHeader, so this wrapper must not
   *  add its own or the two stack up. The fill is what covers the
   *  legacy page gradient at the top of the screen. */
  header: {
    backgroundColor: COLOR.paper,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },

  /* Scroll body ---------------------------------------------------- */
  content: {
    // flexGrow + paper is the second half of the gradient cover-up.
    flexGrow: 1,
    backgroundColor: COLOR.paper,
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.lg,
    paddingBottom: SPACE.xxl,
    gap: SPACE.xl,
  },

  /* Hero — the single filled block on this screen ------------------- */
  heroCard: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
    // The fill still arrives as CLINICAL_GRADIENTS.surface from
    // index.tsx; its two stops resolve within ~2/255 of each other, so
    // it reads as the flat tint this system wants.
    overflow: 'hidden',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  /** A real status chip — the record's category — so the pill shape
   *  is earned here. */
  tagPill: {
    paddingHorizontal: SPACE.sm + 2,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
  },
  tagPillText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: COLOR.accent,
  },
  heroTime: {
    ...TYPE.caption,
    // A timestamp is a number: align it like one.
    ...TABULAR,
  },
  /** The largest type on the page — this is the record. */
  heroTitle: {
    marginTop: SPACE.md,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: COLOR.ink,
  },
  heroDescription: {
    marginTop: SPACE.sm,
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },

  /* Sections — on the page, opened by a rule, not boxed ------------- */
  card: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingTop: SPACE.md,
  },
  cardTitle: {
    ...TYPE.title,
  },
  cardText: {
    marginTop: SPACE.sm,
    ...TYPE.body,
  },

  /* 记录信息 — a label/value column, not a grid of mini-cards -------- */
  metaGrid: {
    marginTop: SPACE.md,
  },
  metaCard: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACE.md,
    paddingVertical: SPACE.sm + 2,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  metaLabel: {
    ...TYPE.caption,
  },
  /** The value outweighs its label, and carries tabular figures so the
   *  timestamp lines up with anything added beside it later. */
  metaValue: {
    ...TYPE.metricSmall,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'right',
    flexShrink: 1,
  },

  /* Actions -------------------------------------------------------- */
  primaryAction: {
    // Unchanged from the previous 52pt: never shrink a target.
    minHeight: 52,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SPACE.sm,
  },
  primaryActionText: {
    ...TYPE.label,
    fontSize: 14,
    color: COLOR.onAccent,
  },

  /* Terminal states ------------------------------------------------
   * `card` no longer draws a box, so these two variants mark
   * themselves with a 2pt semantic bar instead of a tinted border —
   * the same device p-home uses in place of an icon tile. */
  dangerCard: {
    borderLeftWidth: 2,
    borderLeftColor: COLOR.alert,
    paddingLeft: SPACE.md,
  },
  doneCard: {
    borderLeftWidth: 2,
    borderLeftColor: COLOR.good,
    paddingLeft: SPACE.md,
  },
  dangerButton: {
    marginTop: SPACE.lg,
    // COMFORTABLE_TOUCH_TARGET, not the 48pt floor: this is a
    // destructive control a shaky hand has to hit deliberately.
    minHeight: COMFORTABLE_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.alert,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
  },
  dangerButtonDisabled: {
    opacity: 0.72,
  },
  dangerButtonText: {
    ...TYPE.label,
    fontSize: 15,
    color: COLOR.onAccent,
  },
  noticeText: {
    marginTop: SPACE.md,
    ...TYPE.caption,
    color: COLOR.alert,
  },
});
