import { Platform, StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 报告详情 — re-pitched on lib/design.ts.
 *
 * What this replaces
 * ------------------
 * Every block on this screen used to be a 22–24pt-radius, bordered,
 * heavily shadowed panel floating on a gradient page, and the two
 * things a patient actually comes here to read — the OCR fields and
 * the extracted highlights — were each broken into a grid of tinted
 * rounded tiles nested *inside* those panels. Labels and values were
 * within 2pt of each other in size, so nothing read as data.
 *
 * The stance here
 * ---------------
 *  - One filled surface: the report identity block at the top. Every
 *    other section is set directly on the paper and separated by a
 *    full-width hairline.
 *  - **The field list is a table.** A fixed label column, a value
 *    column with tabular figures, one hairline per row. That is what
 *    "核对识别出来的字段" looks like on paper, and it lets the eye run
 *    down either column.
 *  - Radii collapse to 12 / 10. The pill shape survives only on the
 *    parse-status chip, where the shape actually means "state".
 *  - Shadows are gone entirely — nothing on this screen floats.
 */

/** Raw OCR/JSON is machine output; a monospace column makes the
 *  structure legible instead of just small. */
const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },

  /* Header — supplied by ScreenHeader, which already renders the row,
     the gutter and the title (deliberately smaller than the report
     name below it: this line is navigation context, the report name is
     the subject). ------------------------------------------------- */
  content: {
    paddingHorizontal: SPACE.gutter,
    paddingBottom: SPACE.xxl,
  },

  /* Report identity — the one filled surface on this screen -------- */
  hero: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  /** A genuine eyebrow: the report *kind* is not in the report name. */
  kindEyebrow: {
    ...TYPE.micro,
    color: COLOR.accent,
  },
  /** Parse state — the one place a pill still earns its shape. */
  statusChip: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  statusChipText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: COLOR.inkSoft,
  },
  statusChipGood: {
    borderColor: 'rgba(47, 122, 92, 0.35)',
    backgroundColor: COLOR.goodWash,
  },
  statusChipGoodText: {
    color: COLOR.good,
  },
  statusChipWarn: {
    borderColor: COLOR.warn,
    backgroundColor: COLOR.warnWash,
  },
  statusChipWarnText: {
    color: COLOR.warn,
  },
  statusChipAlert: {
    borderColor: 'rgba(180, 71, 47, 0.35)',
    backgroundColor: COLOR.alertWash,
  },
  statusChipAlertText: {
    color: COLOR.alert,
  },
  heroTitle: {
    ...TYPE.title,
  },
  heroDescription: {
    ...TYPE.caption,
    marginTop: SPACE.xs,
    color: COLOR.inkFaint,
  },
  /** Was a tinted box inside the tinted card. Now a hairline-topped
   *  row inside the same surface — no second container. */
  processingRow: {
    marginTop: SPACE.md,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  processingText: {
    flex: 1,
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },
  /** Shared spacer for inline notices, replacing ad-hoc inline styles. */
  noticeBlock: {
    marginTop: SPACE.md,
  },

  /* Extracted highlights — bare label/value pairs, no tiles -------- */
  highlightGrid: {
    marginTop: SPACE.lg,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: SPACE.md,
    columnGap: SPACE.lg,
  },
  highlightItem: {
    flexBasis: '45%',
    flexGrow: 1,
    gap: 2,
  },
  highlightLabel: {
    ...TYPE.caption,
  },
  /** The value outweighs its label — that inversion is the whole
   *  point of a clinical readout. */
  highlightValue: {
    ...TYPE.metricSmall,
    fontSize: 17,
    lineHeight: 23,
  },

  /* Sections — hairline-separated, set on the page ----------------- */
  section: {
    marginTop: SPACE.xl,
    paddingTop: SPACE.xl,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    gap: SPACE.sm,
  },
  /** Sits on top of the section's own 8pt gap — an action reads as
   *  detached from the paragraph that explains it. */
  actionBlock: {
    marginTop: SPACE.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  sectionTitle: {
    ...TYPE.title,
  },

  /* MRI view switch ------------------------------------------------ */
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginTop: SPACE.md,
  },
  summaryTag: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
  },
  summaryTagText: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },

  /* OCR fields — an actual table ----------------------------------- */
  fieldGroup: {
    marginTop: SPACE.sm,
  },
  fieldGroupTitle: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    marginBottom: SPACE.xs,
  },
  /** The table's own top rule; each row carries the rule below it, so
   *  the block closes cleanly. */
  fieldTable: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.lineStrong,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
    paddingVertical: SPACE.sm + 2,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  /** Fixed width so the value column starts at the same x on every
   *  row — that alignment is what makes it read as a table. */
  fieldLabel: {
    ...TYPE.caption,
    width: 92,
  },
  fieldValue: {
    flex: 1,
    ...TYPE.bodyStrong,
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  /** THE SAME VALUE TYPE WITHOUT THE `flex`, for the stacked row below.
   *  `flex: 1` on a child of a COLUMN stretches it vertically, so the
   *  wrapper owns the placement there and this owns only the type.
   *  Spelled out rather than shared with a const: `StyleSheet.create`
   *  infers each entry from its own object literal, and an entry built
   *  by spreading a variable collapses the whole sheet to one union. */
  fieldValueStacked: {
    ...TYPE.bodyStrong,
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  /** The value column of a row that carries a mark under its value.
   *  `fieldValue` owns the `flex: 1` on an unmarked row, so the wrapper
   *  has to take it over or the mark and the number both collapse. */
  fieldValueColumn: {
    flex: 1,
    gap: 2,
  },
  /** WHAT THIS PLATFORM SAID ABOUT THE CELL ABOVE IT — never part of
   *  the value. Caption weight and muted ink, because the number is the
   *  report's and this line is ours; giving it the value's weight would
   *  read as the laboratory having printed it. */
  fieldMark: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },
  /** A sentence in the value column rather than a reading. Same column,
   *  none of `fieldValue`'s number typography — tabular figures and 600
   *  weight on a sentence make it look like a result. */
  fieldNote: {
    flex: 1,
    ...TYPE.caption,
  },

  /* Actions -------------------------------------------------------- */
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLOR.accent,
  },

  /* Text ----------------------------------------------------------- */
  summaryText: {
    ...TYPE.body,
    color: COLOR.ink,
  },
  smallText: {
    ...TYPE.caption,
  },

  codeBlock: {
    marginTop: SPACE.md,
    ...SURFACE.well,
    padding: SPACE.md,
  },
  codeText: {
    fontFamily: MONO,
    fontSize: 11.5,
    lineHeight: 17,
    color: COLOR.inkSoft,
  },

  /** A text link, sized to stay tappable. */
  inlineState: {
    marginTop: SPACE.xl,
    alignItems: 'center',
    gap: SPACE.sm,
  },

  /* Correction sheet ----------------------------------------------- */
  correctOverlay: {
    flex: 1,
    backgroundColor: 'rgba(23, 39, 46, 0.45)',
    justifyContent: 'center',
    padding: SPACE.gutter,
  },
  correctSheet: {
    ...SURFACE.card,
    padding: SPACE.lg,
    maxHeight: '82%',
    gap: SPACE.sm,
  },
  correctList: {
    marginTop: SPACE.sm,
  },
  correctRow: {
    marginBottom: SPACE.md,
    gap: SPACE.xs,
  },
  correctLabel: {
    ...TYPE.caption,
  },
  correctInput: {
    ...SURFACE.well,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    fontSize: 15,
    color: COLOR.ink,
  },
  correctErrorText: {
    ...TYPE.caption,
    color: COLOR.alert,
  },
  correctActions: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.xs,
  },
});
