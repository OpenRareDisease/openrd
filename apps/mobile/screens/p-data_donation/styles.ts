import { StyleSheet } from 'react-native';
import { COLOR, ELEVATION, HAIRLINE, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 数据捐赠 — re-pitched on lib/design.ts.
 *
 * The previous version was five stacked cards — intro,每一条流程, the
 * toggle, and both status states — each with its own border, its own
 * 32pt-radius shadow and its own tinted icon circle. Nothing was more
 * important than anything else, and the one thing the screen exists to
 * do (grant or revoke the donation authorisation) looked exactly like
 * the marketing paragraph above it.
 *
 * Now: the page is paper. The intro is set directly on it as the page's
 * real headline. 捐赠流程 is three hairline-separated rows, its numerals
 * kept because 授权 → 脱敏 → 科研使用 is a genuine sequence, but stripped
 * of the three arbitrary tinted circles. The authorisation block is the
 * single filled surface. The status is a short block marked by a 2pt
 * semantic stripe rather than boxed again.
 */
export default StyleSheet.create({
  /** A blocked control. Was an inline `{ opacity: 0.6 }` — a fresh
   *  object allocated on every render, and a second opinion about what
   *  「disabled」 looks like alongside Button's own. */
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  scrollView: {
    flex: 1,
  },

  /* Header -------------------------------------------------------- */
  /** Only the page-specific chrome; layout, title and touch targets
   *  come from common/ScreenHeader, which also adds the 首页 control
   *  this screen used to lack. */
  header: {
    paddingVertical: SPACE.sm,
  },

  /* Intro — set on the page, no card ------------------------------ */
  donationIntroSection: {
    paddingHorizontal: SPACE.gutter,
    marginTop: SPACE.md,
    marginBottom: SPACE.section,
  },
  introCard: {
    gap: SPACE.sm,
  },
  /** Was a 40pt gradient circle holding a heart — the most literal
   *  "icon in a tinted round box" tell on the screen. Hidden here so
   *  the JSX still compiles; the <LinearGradient> and its
   *  expo-linear-gradient import should be deleted from index.tsx. */
  donationIcon: {
    display: 'none',
  },
  /** The real page title. Left-aligned: a record is a column of text,
   *  and centred paragraphs are the giveaway of a promo screen. */
  introTitle: {
    ...TYPE.display,
    textAlign: 'left',
  },
  introDescription: {
    ...TYPE.body,
    textAlign: 'left',
  },

  /* 捐赠流程 — hairline rows -------------------------------------- */
  donationProcessSection: {
    paddingHorizontal: SPACE.gutter,
    marginBottom: SPACE.section,
  },
  sectionTitle: {
    ...TYPE.title,
    marginBottom: SPACE.xs,
  },
  /** No gap: the rows are separated by their own top hairline, so a
   *  gap would break the rule into segments. */
  processSteps: {
    gap: 0,
  },
  processStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  /** A numbering column, not a badge. The numbers stay — 授权 → 脱敏 →
   *  科研使用 is a real order — but the circle behind them is gone. */
  stepNumber: {
    width: 18,
    marginRight: SPACE.md,
    paddingTop: 2,
  },
  /** The three tints used to give each step a different colour for no
   *  reason; steps differ in order, not in kind. Kept as no-ops so the
   *  screen's `[styles.stepNumber, styles.stepNumberPrimary]` arrays
   *  still resolve. */
  stepNumberPrimary: {},
  stepNumberSecondary: {},
  stepNumberAccent: {},
  stepNumberTextPrimary: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: COLOR.accent,
    fontVariant: ['tabular-nums'],
  },
  stepNumberTextSecondary: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: COLOR.accent,
    fontVariant: ['tabular-nums'],
  },
  stepNumberTextAccent: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: COLOR.accent,
    fontVariant: ['tabular-nums'],
  },
  stepContent: {
    flex: 1,
    gap: 2,
  },
  /** Was 12pt/10pt — unreadably small for the only explanation a
   *  patient gets of what happens to their data. */
  stepTitle: {
    ...TYPE.heading,
  },
  stepDescription: {
    ...TYPE.caption,
  },

  /* Authorisation — the one filled surface ------------------------ */
  donationToggleSection: {
    paddingHorizontal: SPACE.gutter,
    marginBottom: SPACE.section,
  },
  toggleCard: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
  },
  toggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleTextContainer: {
    flex: 1,
    marginRight: SPACE.lg,
    gap: 2,
  },
  toggleTitle: {
    ...TYPE.heading,
  },
  toggleDescription: {
    ...TYPE.caption,
  },
  /** A switch track is one of the few places a pill shape carries
   *  meaning, so RADIUS.pill stays here. */
  /** White thumb with a hairline instead of a drop shadow — the track
   *  edge already separates it from the surface. */

  /* 捐赠状态 ------------------------------------------------------ */
  donationStatusSection: {
    paddingHorizontal: SPACE.gutter,
    marginBottom: SPACE.xxl,
  },
  /** Not a card: a 2pt neutral stripe marks the state, the way a
   *  margin rule marks a passage in a chart. */
  notDonatingCard: {
    alignItems: 'flex-start',
    gap: SPACE.sm,
    paddingLeft: SPACE.md,
    borderLeftWidth: 2,
    borderLeftColor: COLOR.lineStrong,
  },
  /** Bare icon. The grey circle it used to sit in added a shape the
   *  content did not have. */
  notDonatingIcon: {
    marginBottom: SPACE.xs,
  },
  notDonatingTitle: {
    ...TYPE.heading,
    textAlign: 'left',
  },
  notDonatingDescription: {
    ...TYPE.body,
    textAlign: 'left',
  },
  /** Was COLOR.ink on an accent fill — dark on dark-ish
   *  teal. onAccent is the contrasting pair. */
  /** Same block, semantic stripe: donation is active. */
  donatingCard: {
    alignItems: 'flex-start',
    gap: SPACE.xs,
    paddingLeft: SPACE.md,
    borderLeftWidth: 2,
    borderLeftColor: COLOR.good,
  },
  donatingTitle: {
    ...TYPE.heading,
    textAlign: 'left',
  },
  donatingDescription: {
    ...TYPE.body,
    textAlign: 'left',
  },
  /** A genuine supplementary label (a date), so TYPE.caption with
   *  tabular figures rather than a 10pt whisper. */
  lastDonationTime: {
    ...TYPE.caption,
    textAlign: 'left',
    fontVariant: ['tabular-nums'],
  },

  /* The confirm-modal block that used to live here is gone with the
     screen-local Modal — confirmations come from
     common/feedback/AppDialog now, which styles them once for the
     whole app. */

  /* Toast — genuinely floating, so it keeps a shadow --------------- */
  successToast: {
    position: 'absolute',
    top: 72,
    left: '50%',
    // The screen offsets by half of this width; minWidth pins the
    // actual width to 150 so the toast is really centred.
    minWidth: 150,
    transform: [{ translateX: -75 }],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    ...SURFACE.card,
    ...ELEVATION.button,
  },
  successToastText: {
    ...TYPE.label,
    color: COLOR.ink,
  },
});
