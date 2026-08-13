import { Platform, StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 隐私设置 — re-pitched on lib/design.ts.
 *
 * This screen governs who may read a patient's genetic and clinical
 * data. That is the most consequential thing the app asks of them, and
 * the old treatment undercut it: every one of the nine consent
 * switches sat in its own tinted, shadowed card (a 32pt teal-tinted
 * shadow, at that), the sections were separated by a full screen of
 * air, and the privacy promise wore a shield icon in a tinted circle.
 * Soft boxes on soft boxes read as marketing, not as a consent record.
 *
 * Now the page is paper and the consent rows are *rows* — hairline-
 * separated, left-aligned on one column, the way a signed authorisation
 * form is set. Exactly one filled surface remains: the donation status
 * block, because it is the only place on the screen carrying actual
 * values (state, grant date, record count). Seriousness comes from the
 * alignment and the rules.
 */

/**
 * Horizontal margin for every block on this screen.
 *
 * Deliberately SPACE.xl (24) rather than SPACE.gutter (20): index.tsx
 * hard-codes `paddingHorizontal: 24` on its inline loading / error /
 * consent-level texts, and those cannot be reached from here. Matching
 * 24 keeps the whole screen on one left edge. The inline texts are also
 * why the horizontal inset lives on each block instead of on
 * `scrollView` — padding on the scroll container would stack with
 * theirs and push them 48pt in, off the column.
 */
const GUTTER = SPACE.xl;

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },

  /* Header -------------------------------------------------------- */
  /** Layout, title and the touch targets now come from
   *  common/ScreenHeader (which also carries the 首页 control this
   *  screen used to lack). All that is left here is the page-specific
   *  chrome: same paper as the page, divided by a hairline. The old
   *  raised panel + drop shadow implied a floating bar that never
   *  floats. */
  header: {
    // Overrides ScreenHeader's SPACE.gutter so the back control lands
    // on this screen's 24pt column with everything else.
    paddingHorizontal: GUTTER,
    backgroundColor: COLOR.paper,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },

  scrollView: {
    flex: 1,
    paddingTop: SPACE.lg,
  },

  /* Sections ------------------------------------------------------ */
  section: {
    marginBottom: SPACE.section,
  },
  sectionTitle: {
    ...TYPE.title,
    marginHorizontal: GUTTER,
    marginBottom: SPACE.sm,
  },

  /* Consent rows — the form itself -------------------------------- */
  /** A row, not a card: hairline above, content on the page. Nine of
   *  these stacked read as one authorisation list instead of nine
   *  unrelated widgets. minHeight keeps the whole row (including the
   *  audit-history row, which is tappable) above the touch floor. */
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: GUTTER,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  settingContent: {
    flex: 1,
    marginRight: SPACE.lg,
    gap: 2,
  },
  /** The switch label carries the decision, so it outranks its
   *  explanation in weight rather than in box nesting. */
  settingTitle: {
    ...TYPE.heading,
  },
  settingDescription: {
    ...TYPE.caption,
  },

  /* 数据捐赠详情 — the one filled surface on this screen ----------- */
  donationInfoCard: {
    marginHorizontal: GUTTER,
    ...SURFACE.card,
    padding: SPACE.lg,
  },
  donationInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SPACE.md,
    marginBottom: SPACE.md,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  donationInfoTitle: {
    ...TYPE.heading,
  },
  /** minHeight expands the tap area of the "查看详情" link, which is
   *  visually small by design; the wrapping TouchableOpacity sizes to
   *  this view. */
  donationStatus: {
    gap: SPACE.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  statusLabel: {
    ...TYPE.caption,
  },
  /** The value is the data — heavier and darker than its label, with
   *  tabular figures so the date and the record count line up in the
   *  right-hand column. (index.tsx overrides `color` on the status
   *  row only.) */
  statusValue: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: COLOR.ink,
    fontVariant: ['tabular-nums'],
  },

  /* 隐私保护承诺 — set on the page, not in a second card ---------- */
  privacyNoticeCard: {
    marginHorizontal: GUTTER,
    paddingTop: SPACE.lg,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  privacyNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  /** Was a 32pt tinted circle around a 14pt shield — the single most
   *  generic pattern on the screen. The icon now sits bare; only the
   *  optical alignment and the gap survive. */
  privacyIconContainer: {
    marginRight: SPACE.sm,
    marginTop: 3,
  },
  privacyNoticeContent: {
    flex: 1,
  },
  privacyNoticeTitle: {
    ...TYPE.heading,
    marginBottom: SPACE.sm,
  },
  privacyNoticeList: {
    gap: SPACE.xs,
  },
  privacyNoticeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  /** Muted, not accent: four teal bullets spend the accent on
   *  punctuation. */
  bulletPoint: {
    ...TYPE.caption,
    color: COLOR.inkFaint,
    marginRight: SPACE.sm,
  },
  privacyNoticeText: {
    flex: 1,
    ...TYPE.caption,
  },
  shareFresh: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    marginBottom: 12,
  },
  shareFreshTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLOR.ink,
    marginBottom: 6,
  },
  // Monospace and selectable: this is a credential the patient has to
  // get out of the app intact, and a proportional font makes a
  // mistyped character invisible.
  shareFreshValue: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 20,
    color: COLOR.ink,
    marginBottom: 8,
  },
  shareHint: {
    fontSize: 13,
    lineHeight: 20,
    color: COLOR.inkMuted,
    marginTop: 8,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  shareRowCopy: {
    flex: 1,
  },
  shareRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLOR.ink,
  },
  shareRowMeta: {
    fontSize: 12.5,
    color: COLOR.inkMuted,
    marginTop: 2,
  },
});
