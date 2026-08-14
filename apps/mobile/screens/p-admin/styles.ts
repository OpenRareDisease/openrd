import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, INTERACTION, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 后台 — one stylesheet for the back-office screens.
 *
 * SHARED ON PURPOSE. The back office is one tool used in one sitting,
 * and a stylesheet per screen would let the same row drift into a
 * different height on each. It is also the only place in the
 * app where a screen may not look like the patient app: an operator
 * needs to know at a glance that what is on screen is somebody else's
 * record. Hence `auditBanner` — the same warn-coloured block on every
 * screen here, carrying the sentence in screens/p-admin/common.tsx that
 * says this page is being recorded.
 *
 * DESIGNED FOR THE SAME PHONE EVERYTHING ELSE HERE RUNS ON. §C says the
 * back office is a web export read in WeChat's in-app browser like the
 * rest — so no side-by-side columns, no hover-only affordances, no
 * table wider than a thumb. Values stack under their labels rather than
 * sitting in a second column, because a two-column row at 375pt makes
 * either the label or the value wrap to three lines.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  scrollContent: {
    padding: SPACE.gutter,
    paddingBottom: SPACE.xxl,
    gap: SPACE.section,
  },

  /* The page's own title block ------------------------------------- */
  pageTitle: {
    ...TYPE.display,
  },
  pageSubtitle: {
    ...TYPE.caption,
    marginTop: SPACE.xs,
  },

  /* The banner every admin screen wears ---------------------------- */
  //
  // Warn, not accent: the accent is the patient app's own colour and
  // this is the one surface where the person reading is not the person
  // the data is about.
  auditBanner: {
    flexDirection: 'row',
    gap: SPACE.sm,
    alignItems: 'flex-start',
    backgroundColor: COLOR.warnWash,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.warn,
    padding: SPACE.md,
  },
  auditBannerText: {
    ...TYPE.caption,
    color: COLOR.ink,
    flex: 1,
  },

  /* A block: one titled section that loads and fails on its own ----- */
  block: {
    gap: SPACE.md,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
  },
  blockTitle: {
    ...TYPE.title,
    flex: 1,
  },
  blockNote: {
    ...TYPE.caption,
  },
  blockBody: {
    ...SURFACE.card,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
  },

  /* A label/value pair inside a block ------------------------------ */
  stat: {
    paddingVertical: SPACE.md,
    gap: 2,
  },
  statDivider: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  statLabel: {
    ...TYPE.label,
  },
  statValue: {
    ...TYPE.metricSmall,
  },
  /** A value we do not have. Never rendered in the value weight — a
   *  missing number must not look like a number. */
  statMissing: {
    ...TYPE.body,
    color: COLOR.inkMuted,
  },
  statDetail: {
    ...TYPE.caption,
  },
  statValueAlert: {
    color: COLOR.alert,
  },

  /* State blocks (loading / error / empty) ------------------------- */
  state: {
    alignItems: 'flex-start',
    gap: SPACE.sm,
    paddingVertical: SPACE.lg,
  },
  stateText: {
    ...TYPE.body,
  },
  stateTitle: {
    ...TYPE.heading,
  },

  /* Search ---------------------------------------------------------- */
  searchRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    alignItems: 'center',
  },
  searchInput: {
    ...SURFACE.well,
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    fontSize: 15,
    color: COLOR.ink,
  },

  /* Pager ----------------------------------------------------------- */
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  pagerText: {
    ...TYPE.caption,
    flex: 1,
    textAlign: 'center',
  },

  /* The edit form --------------------------------------------------- */
  field: {
    paddingVertical: SPACE.md,
    gap: SPACE.sm,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
  },
  fieldLabel: {
    ...TYPE.label,
    flex: 1,
  },
  input: {
    ...SURFACE.well,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    fontSize: 15,
    color: COLOR.ink,
  },
  multilineInput: {
    minHeight: 88,
    paddingTop: SPACE.md,
  },

  /* Provenance marker ----------------------------------------------- */
  originChip: {
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
  },
  originChipText: {
    ...TYPE.micro,
    letterSpacing: 0,
  },

  /* A queue row, which unlike the others navigates ------------------ */
  queueRow: {
    // The rows around it only display; this one opens a patient, so it
    // has to clear the touch minimum on its own rather than rely on
    // however much text happens to be in it.
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  queueRowPressed: {
    backgroundColor: INTERACTION.pressFill,
  },

  /* A history row (report / follow-up / fall / instrument) ---------- */
  historyRow: {
    paddingVertical: SPACE.md,
    gap: 2,
  },
  historyTitle: {
    ...TYPE.bodyStrong,
  },
  historyMeta: {
    ...TYPE.caption,
  },
});
