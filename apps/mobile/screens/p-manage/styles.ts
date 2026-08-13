import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 病程 — the densest screen in the app, re-pitched on lib/design.ts.
 *
 * What was wrong
 * --------------
 * This screen carries more clinical data than any other, and every bit
 * of it was buried: a gradient page, a 28pt-radius gradient hero, and
 * then a card for each section — with cards nested inside them (metric
 * cards inside the hero, cohort boxes inside the intervention card,
 * metric pills inside the evidence cards). Eight rounded, shadowed,
 * tinted containers deep, the actual numbers were 12–14pt semi-muted
 * text, smaller and quieter than the section chrome around them.
 *
 * What this is now
 * ----------------
 * Paper, with exactly one filled block — the status hero, which is
 * what this screen is about. Everything below it is set directly on
 * the page and separated by hairlines and space. Sub-blocks inside a
 * section are headings plus rules, not boxes.
 *
 * Values get `TYPE.metric*` (tabular figures, large, ink); their
 * labels drop to `TYPE.caption`. That inversion is the whole point:
 * on a progression screen the patient is reading numbers, not looking
 * at panels.
 *
 * Also gone: the `PROGRESSION` eyebrow (病程 says it), tinted icon
 * squares, and every shadow — depth is a hairline and the paper
 * behind it.
 *
 * Tabs
 * ----
 * The ten stacked sections are now five tabs, so this sheet no longer
 * carries `section*` (a title + subtitle pair per block) or the
 * 展开/收起 `inlineAction` — the strip names the block and the tab
 * itself does the hiding. What replaced them is deliberately thin: a
 * strip that is a hairline plus an underline, and a panel that is the
 * page gutter plus one caption. A tab bar is navigation; it should not
 * arrive as another surface.
 */
export default StyleSheet.create({
  /** A blocked control. Was an inline `{ opacity: 0.6 }` — a fresh
   *  object allocated on every render, and a second opinion about what
   *  「disabled」 looks like alongside Button's own. */
  blockedOpacity: {
    opacity: 0.45,
  },
  /** An empty state is a sentence plus an action, not one tappable
   *  paragraph with an arrow on the end. */
  emptyBlock: {
    gap: SPACE.md,
    alignItems: 'flex-start',
  },
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  /** Kept so the screen can swap <LinearGradient> for a plain View
   *  without changing its JSX shape. The page gradient made every
   *  surface above it lower-contrast for no informational gain. */
  backgroundGradient: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },

  /* Header -------------------------------------------------------- */
  header: {
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
  },
  pageTitle: {
    ...TYPE.display,
  },
  /** Was a 48pt accent disc holding a bare "+". A record app's primary
   *  verb deserves a word: same target, now legible without guessing. */

  /* Status hero — the one filled block on this screen -------------- */
  heroCard: {
    marginHorizontal: SPACE.gutter,
    marginTop: SPACE.lg,
    // Carries the gap that used to sit on tabStrip — see the note
    // there. Normal-flow appearance is identical.
    marginBottom: SPACE.xl,
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  /** A pill that earns the shape: it reports a state. */
  riskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
    backgroundColor: COLOR.surface,
  },
  riskDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  riskText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    /** Cancels the last link's tap padding so its text still sits on
     *  the block's right margin. */
    marginRight: -SPACE.md,
  },
  /** Text links, not two more bordered boxes inside a filled block.
   *  The touch target is held by minHeight + horizontal padding. */
  heroTitle: {
    marginTop: SPACE.md,
    ...TYPE.title,
    fontSize: 20,
    lineHeight: 27,
  },
  heroText: {
    marginTop: SPACE.sm,
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },
  /** Columns split by a hairline instead of three tinted boxes inside
   *  an already-tinted block. */
  heroMetrics: {
    marginTop: SPACE.lg,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
    flexDirection: 'row',
  },
  metricCell: {
    flex: 1,
    gap: 2,
  },
  metricCellDivided: {
    borderLeftWidth: HAIRLINE,
    borderLeftColor: COLOR.accentLine,
    paddingLeft: SPACE.md,
  },
  /** The number leads; the label follows it and is smaller. The old
   *  order and sizing had that backwards. */
  metricValue: {
    ...TYPE.metricSmall,
  },
  metricLabel: {
    ...TYPE.caption,
    fontSize: 12,
  },

  /* Tab strip ------------------------------------------------------ */
  /** Opaque, because it's a sticky header: transparent paper would let
   *  the panel scroll through it. The hairline is the strip's own
   *  baseline — the active tab's 2pt underline sits on top of it. */
  tabStrip: {
    // No marginTop here — the gap lives on heroCard's bottom instead.
    //
    // react-native-web implements a sticky header by wrapping the child
    // in its own `position: sticky` div and leaving the child's style
    // untouched (ScrollView/index.js). A marginTop on the child stays
    // *inside* that wrapper, so once pinned the wrapper's top 24px is
    // empty and transparent — and the panel below, being a later
    // sibling with auto z-index, scrolls up through the gap. The result
    // is a 24pt letterbox with text sliding across above the tabs.
    //
    // Native is unaffected (it hoists the child's style onto the
    // animated view), which is why this only shows up in the browser —
    // i.e. in production, since this ships as an Expo web export.
    backgroundColor: COLOR.paper,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  tabStripContent: {
    paddingHorizontal: SPACE.gutter,
    gap: SPACE.md,
  },
  /** Full-height target: the whole 48pt column is tappable, not just
   *  the text. `borderBottomWidth` is declared on both states so the
   *  label doesn't shift by 2pt when it becomes active. */
  tabItem: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACE.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: COLOR.accent,
  },
  tabLabel: {
    ...TYPE.label,
    fontSize: 15,
    lineHeight: 21,
    color: COLOR.inkMuted,
  },
  /** Ink + 700 on top of the underline. Three redundant cues, none of
   *  which is colour alone. */
  tabLabelActive: {
    color: COLOR.ink,
    fontWeight: '700',
  },

  /* Panel — the body of whichever tab is open ---------------------- */
  panel: {
    paddingHorizontal: SPACE.gutter,
    marginTop: SPACE.lg,
  },
  /** One line of context per tab, in place of the per-section title +
   *  subtitle pair the strip made redundant. */
  panelCaption: {
    ...TYPE.caption,
    marginBottom: SPACE.lg,
  },
  panelError: {
    marginBottom: SPACE.lg,
  },

  /* Sub-blocks inside a section — headings + rules, not cards ------ */
  blockHeading: {
    ...TYPE.heading,
    // Without this the following row's borderTop lands ~3pt under the
    // descenders and reads as an underline rather than a divider.
    marginBottom: SPACE.sm,
  },
  /** Replaces the in-card divider. Full-bleed inside the gutter. */
  rule: {
    ...SURFACE.rule,
    marginVertical: SPACE.lg,
  },

  /* Error / retry -------------------------------------------------- */
  /** A 2pt semantic bar rather than another filled panel — the hero
   *  is this screen's one fill, and an error doesn't get to compete
   *  with it as a *surface*, only as colour. */
  stateWrap: {
    borderLeftWidth: 2,
    borderLeftColor: COLOR.alert,
    paddingLeft: SPACE.md,
    gap: SPACE.sm,
    alignItems: 'flex-start',
  },
  stateText: {
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },
  retryText: {
    ...TYPE.label,
    color: COLOR.onAccent,
  },

  /* 药物和辅具 ----------------------------------------------------- */
  medHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  medForm: {
    marginTop: SPACE.md,
    gap: SPACE.sm,
  },
  medInput: {
    ...SURFACE.well,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    color: COLOR.ink,
    fontSize: 15,
  },
  medErrorText: {
    ...TYPE.caption,
    color: COLOR.alert,
  },
  medSubmit: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.accent,
  },
  medSubmitText: {
    ...TYPE.label,
    color: COLOR.onAccent,
  },
  /** Med / device tags. Not status, so not pills — a bordered tag at
   *  control radius, unfilled so a long list stays quiet. */
  pillWrap: {
    marginTop: SPACE.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  pill: {
    paddingHorizontal: SPACE.md,
    paddingVertical: 7,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  pillText: {
    ...TYPE.label,
    color: COLOR.ink,
  },

  /* 和病友群体相比 — a value column, not a stack of tinted boxes ---- */
  cohortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  cohortCopy: {
    flex: 1,
    gap: 2,
  },
  cohortLabel: {
    ...TYPE.bodyStrong,
    fontSize: 14,
    fontWeight: '600',
  },
  cohortCaption: {
    ...TYPE.caption,
  },
  /** The patient's own score, right-aligned so a column of them lines
   *  up. Tabular figures come from TYPE.metricSmall. */
  cohortValue: {
    ...TYPE.metricSmall,
  },
  cohortOwner: {
    ...TYPE.caption,
    alignSelf: 'flex-end',
    paddingBottom: 3,
  },
  cohortUnit: {
    ...TYPE.unit,
  },
  cohortValueWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },

  /* 跌倒记录 -------------------------------------------------------- */
  /** Body weight, not `metric`. The count is context on this page; the
   *  30pt treatment TYPE.metric gives a clinical value would make it
   *  the headline of 近况, and a fall count as a headline is a
   *  progression alert. */
  fallsLine: {
    ...TYPE.bodyStrong,
  },
  fallsAction: {
    marginTop: SPACE.md,
    alignItems: 'flex-start',
  },

  /* 最近记录的变化 ------------------------------------------------- */
  changeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  changeCopy: {
    flex: 1,
    gap: 2,
  },
  changeTitle: {
    ...TYPE.heading,
    fontSize: 15,
  },
  changeDetail: {
    ...TYPE.caption,
  },
  /** Outlined rather than filled: the trend word plus its colour is
   *  the signal, and a tinted lozenge behind it only lowered the
   *  contrast of the word itself. */
  changeBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
  },
  changeBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  /* FSHD 关键证据 -------------------------------------------------- */
  insightGrid: {
    gap: SPACE.lg,
  },
  /** Was a shadowed 22pt card per panel. Now a block on the page,
   *  divided from its neighbour by a rule. */
  insightBlock: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingTop: SPACE.md,
  },
  insightTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: SPACE.md,
  },
  insightTitle: {
    flex: 1,
    ...TYPE.heading,
  },
  /** A genuine eyebrow: the date is information the title lacks. */
  insightDate: {
    ...TYPE.micro,
  },
  insightSummary: {
    marginTop: SPACE.sm,
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },
  /** Two columns of label-over-value. No pills: these are readings,
   *  and a reading wants to align with the one below it. */
  metricWrap: {
    marginTop: SPACE.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: SPACE.md,
  },
  metricItem: {
    width: '50%',
    paddingRight: SPACE.md,
    gap: 2,
  },
  metricItemLabel: {
    ...TYPE.caption,
    fontSize: 12,
  },
  metricItemValue: {
    ...TYPE.metricSmall,
    fontSize: 16,
    lineHeight: 22,
  },

  /* 患者端数据可视化 ----------------------------------------------- */
  visualizationChartStack: {
    gap: SPACE.xl,
  },
  visualizationSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
    marginBottom: SPACE.sm,
  },
  visualizationChartBlock: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingTop: SPACE.md,
  },
  visualizationChartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACE.md,
  },
  visualizationChartHeaderMain: {
    flex: 1,
  },
  visualizationChartTitle: {
    ...TYPE.caption,
    fontSize: 13,
  },
  /** The headline number of the chart underneath it — full metric
   *  size, above the prose rather than after it. */
  visualizationChartValue: {
    marginTop: 2,
    ...TYPE.metric,
    fontSize: 26,
    lineHeight: 31,
  },
  visualizationChartSummary: {
    marginTop: SPACE.sm,
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },
  visualizationChartHint: {
    marginTop: SPACE.xs,
    ...TYPE.caption,
    fontSize: 12,
  },
  /** Segmented control (正面/背面). One shape, one radius. */
  toggleRow: {
    flexDirection: 'row',
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    overflow: 'hidden',
  },
  chartWrap: {
    marginTop: SPACE.md,
    marginHorizontal: -SPACE.sm,
    alignItems: 'center',
  },
  chart: {
    borderRadius: RADIUS.control,
  },
  chartEmpty: {
    marginTop: SPACE.md,
    minHeight: 88,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLOR.well,
  },
  /** 就地追问. A link under the curve, not another tinted capsule. */

  /* Timeline / system panels are styled by their shared components -- */

  emptyText: {
    ...TYPE.caption,
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.md,
    backgroundColor: COLOR.paper,
  },
  loadingText: {
    ...TYPE.caption,
  },
});
