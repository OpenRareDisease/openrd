import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 临床护照 — re-pitched on lib/design.ts.
 *
 * This is the screen a patient holds up across a desk, so it is the one
 * that most has to read as a record rather than as an app. The previous
 * version was the opposite: a gradient page carrying four tinted
 * `sectionShell` panels, each of which held another shadowed card,
 * which in turn held a grid of tinted cells and a tinted note box —
 * three levels of box before any clinical value appeared. Every section
 * was stamped with an 01–04 badge although the sections have no order,
 * radii ran 18–26, and the numbers themselves were set at 14–20pt in
 * the same weight as their labels.
 *
 * Now: the page is paper, the hero (identity + completion + the
 * headline metrics) is the single filled block, and every section below
 * it is set directly on the page and opened by a full-width hairline.
 * Grids became hairline-ruled tables, note boxes became a 2pt left
 * rule, and values are set in tabular figures a full step above their
 * labels.
 *
 * NOTE: a few structural offenders live in the JSX, not here — the
 * `CLINICAL PASSPORT` eyebrow and the 01–04 section badges. Since this
 * pass may only touch the stylesheet, those two are switched off with
 * `display: 'none'` (Yoga drops them from layout entirely, so the
 * surrounding `gap` does not leave a hole). Their keys are kept so the
 * screen keeps compiling.
 */

/** Opens a top-level block. This system separates with a rule and
 *  whitespace before it reaches for another container. */
const sectionRule = {
  marginTop: SPACE.section,
  paddingTop: SPACE.lg,
  borderTopWidth: HAIRLINE,
  borderTopColor: COLOR.lineStrong,
} as const;

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  /** Kept so the screen can swap <LinearGradient> for a plain View
   *  without changing its JSX shape. A page gradient drags down the
   *  contrast of everything sitting on it. */
  backgroundGradient: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACE.gutter,
    paddingBottom: SPACE.xxl + SPACE.lg,
  },

  /* Header -------------------------------------------------------- */
  /** ScreenHeader lays out the row itself; this only cancels the
   *  component's own gutter, which `scrollContent` already applies to
   *  everything on this screen, and keeps the vertical rhythm the
   *  header had before. */
  header: {
    paddingHorizontal: 0,
    paddingVertical: SPACE.md,
  },
  /** The PDF action. A hairline outline is enough to say "control" —
   *  the filled, shadowed circle it replaces competed with the title. */
  headerAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Error --------------------------------------------------------- */
  errorCard: {
    marginBottom: SPACE.lg,
    padding: SPACE.lg,
    borderRadius: RADIUS.surface,
    backgroundColor: COLOR.alertWash,
    borderWidth: HAIRLINE,
    borderColor: COLOR.alert,
  },
  errorTitle: {
    ...TYPE.heading,
    marginBottom: SPACE.xs,
  },
  errorText: {
    ...TYPE.caption,
  },

  /* Hero — the one filled surface on this screen ------------------ */
  heroCard: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
    // Retained: the JSX still renders this block as a LinearGradient,
    // which needs clipping to the radius.
    overflow: 'hidden',
  },
  heroTopRow: {
    gap: SPACE.md,
  },
  heroCopyBlock: {
    gap: SPACE.xs,
  },
  /** `CLINICAL PASSPORT` over a screen titled 临床护照 said nothing the
   *  title did not. Switched off rather than deleted because the key is
   *  still referenced by the JSX. */
  heroEyebrow: {
    display: 'none',
  },
  /** The patient's name is what this document identifies. */
  heroTitle: {
    ...TYPE.display,
  },
  heroPassportId: {
    ...TYPE.label,
    color: COLOR.accent,
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  heroSubtitle: {
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },
  /** A genuine status chip — completion state — so the pill shape is
   *  earned here. */
  heroStatusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs + 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
  },
  heroStatusText: {
    ...TYPE.label,
    fontSize: 12,
    color: COLOR.accent,
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: SPACE.lg,
    rowGap: SPACE.xs,
    marginTop: SPACE.md,
  },
  /** Was a bordered pill each. Two facts do not need two containers —
   *  bare icon plus text, spaced apart. */
  heroMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs + 2,
  },
  heroMetaText: {
    ...TYPE.caption,
    fontSize: 12,
  },

  /* Headline metrics — a ruled table, not a grid of cards ---------- */
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: SPACE.lg,
    rowGap: SPACE.md,
    marginTop: SPACE.lg,
  },
  metricCard: {
    width: '47%',
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
  },
  /** The value leads and is set in tabular figures so the two columns
   *  align down the page. */
  metricValue: {
    ...TYPE.metricSmall,
  },
  metricLabel: {
    ...TYPE.caption,
    marginTop: SPACE.xs,
    color: COLOR.inkSoft,
  },
  metricHint: {
    ...TYPE.caption,
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: COLOR.inkFaint,
  },

  heroActionRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.lg,
    paddingTop: SPACE.lg,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
  },

  /* 门诊准备 ------------------------------------------------------- */
  /** The dashed outline stays — it is the one border on this screen
   *  doing semantic work, marking drafted text apart from recorded
   *  clinical data. The tint behind it does not: an unfilled outline
   *  reads as "provisional" without becoming a second filled card. */
  visitPrepCard: {
    marginTop: SPACE.section,
    padding: SPACE.lg,
    borderRadius: RADIUS.surface,
    gap: SPACE.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLOR.lineStrong,
  },
  visitPrepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  visitPrepTitle: {
    ...TYPE.heading,
  },
  visitPrepHint: {
    ...TYPE.caption,
  },
  visitPrepBody: {
    ...TYPE.bodyStrong,
    fontSize: 14,
    lineHeight: 22,
  },
  visitPrepFootnote: {
    ...TYPE.caption,
    fontSize: 12,
    lineHeight: 17,
    color: COLOR.inkFaint,
  },
  visitPrepMeta: {
    ...TYPE.caption,
    fontSize: 12,
    color: COLOR.inkFaint,
    fontVariant: ['tabular-nums'],
  },
  visitPrepStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  visitPrepStatusText: {
    ...TYPE.caption,
  },
  visitPrepError: {
    ...TYPE.caption,
    color: COLOR.alert,
  },

  /* Loading ------------------------------------------------------- */
  /** No longer a card: a spinner is not a section of the record. */
  loadingCard: {
    paddingVertical: SPACE.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.md,
  },
  loadingText: {
    ...TYPE.caption,
  },

  /* Sections ------------------------------------------------------ */
  /** Was a tinted, 24pt-radius panel wrapping a card wrapping a grid.
   *  Now a rule and some air. */
  sectionShell: {
    ...sectionRule,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
  },
  /** 01–04 numbered four sections that can be read in any order, and
   *  set them in a tinted circle — two of the strongest generic-UI
   *  tells on the screen. Dropped from layout. */
  sectionBadge: {
    display: 'none',
  },
  sectionBadgeText: {
    ...TYPE.micro,
  },
  sectionHeadingGroup: {
    flex: 1,
    gap: SPACE.xs,
  },
  sectionHeading: {
    ...TYPE.title,
  },
  sectionDescription: {
    ...TYPE.caption,
  },
  sectionContentBlock: {
    marginTop: SPACE.lg,
  },

  /* Summary rows (kept for callers; ruled rows, not cards) --------- */
  /** Icons in tinted rounded squares are the look this pass removes;
   *  the 2pt semantic bar below carries the same colour in less room. */

  /* 诊断与身份 ----------------------------------------------------- */
  /** The section already announced itself; this no longer needs to be
   *  a box inside it. */
  diagnosisCard: {
    marginTop: SPACE.lg,
  },
  cardHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  cardTitle: {
    ...TYPE.heading,
  },
  cardSubtitle: {
    ...TYPE.caption,
    marginTop: SPACE.xs,
  },
  /** Freshness is a state, so it keeps the pill. Tone colours are
   *  applied by the screen. */
  freshnessPill: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.pill,
  },
  freshnessText: {
    ...TYPE.label,
    fontSize: 11,
  },

  /* Identity values — a two-column ruled table --------------------- */
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: SPACE.lg,
    rowGap: SPACE.md,
    marginTop: SPACE.lg,
  },
  infoCell: {
    width: '47%',
    paddingTop: SPACE.sm,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  /** Label first and quiet; the value carries the weight. */
  infoLabel: {
    ...TYPE.caption,
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    ...TYPE.metricSmall,
    // A step down from the headline metrics: D4Z4 repeat counts share
    // this table with gene names and dates, which need room to wrap.
    fontSize: 16.5,
    lineHeight: 22,
  },

  /* Prose notes — a rule in the margin, not another box ------------ */
  noteCard: {
    marginTop: SPACE.lg,
    paddingLeft: SPACE.md,
    borderLeftWidth: 2,
    borderLeftColor: COLOR.lineStrong,
  },
  noteTitle: {
    ...TYPE.label,
    color: COLOR.ink,
    marginBottom: SPACE.xs,
  },
  noteText: {
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },

  /* 正面 / 背面 ---------------------------------------------------- */
  /** SegmentedControl owns its own shape; this only keeps the place in
   *  the page the old two-pill row had. */
  segmentRow: {
    marginTop: SPACE.lg,
  },

  /* Body map ------------------------------------------------------ */
  figureStack: {
    marginTop: SPACE.lg,
    gap: SPACE.xl,
  },
  /** The figure and its readings sit on the page. Boxing them was what
   *  produced the card-inside-panel-inside-page stack. */
  figureShell: {},

  /* Monitoring rows (kept for callers) ---------------------------- */

  /* 待补项 --------------------------------------------------------- */
  gapList: {
    marginTop: SPACE.md,
  },
  /** Ruled rows. A list of four gaps as four bordered cards was four
   *  containers doing the work of three hairlines. */
  gapCard: {
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  gapTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  gapTitle: {
    ...TYPE.heading,
    fontSize: 14.5,
  },
  gapDescription: {
    ...TYPE.body,
    marginTop: SPACE.xs,
    fontSize: 13,
    lineHeight: 20,
  },
  supportCard: {
    ...sectionRule,
  },

  /* Timeline (kept for callers) ----------------------------------- */

  /* Export -------------------------------------------------------- */
  exportCard: {
    ...sectionRule,
  },
});
