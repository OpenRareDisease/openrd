import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, TYPE } from '../../lib/design';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: SPACE.gutter,
  },
  scrollContent: {
    paddingBottom: 48,
  },

  /** 拉取于 —— the first thing on the page and the only tinted block on
   *  it. lib/design.ts allows one filled surface per screen, for the
   *  thing the screen is about; on this screen that is the date, not
   *  any one trial. */
  freshness: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
    gap: SPACE.xs,
  },
  freshnessValue: {
    ...TYPE.metricSmall,
    color: COLOR.accent,
  },
  freshnessNote: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },

  intro: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.md,
  },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.surface,
    padding: SPACE.md,
    marginBottom: SPACE.md,
  },
  noticeWarn: {
    backgroundColor: COLOR.warnWash,
  },
  noticeText: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    flex: 1,
  },
  noticeTextWarn: {
    color: COLOR.warn,
  },

  coverageLink: {
    marginBottom: SPACE.md,
  },

  disclaimer: {
    ...TYPE.bodyStrong,
    color: COLOR.ink,
    marginBottom: SPACE.section,
  },

  stateCard: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
    gap: SPACE.sm,
    alignItems: 'flex-start',
  },
  stateTitle: {
    ...TYPE.bodyStrong,
  },
  stateText: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },

  group: {
    marginBottom: SPACE.lg,
  },
  /** The whole header is the toggle, and it is a real 48pt box: on the
   *  web export the drawn box is the hit box (`hitSlop` is not read —
   *  see Button.tsx), and this is the control that decides whether a
   *  patient has to scroll past the 52 closed studies in the cache on
   *  2026-08-14 (COMPLETED 45 + TERMINATED 7; the census is in
   *  lib/trials.ts's header). */
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: SPACE.sm,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.accentLine,
    marginBottom: SPACE.md,
  },
  groupTitle: {
    ...TYPE.title,
    flex: 1,
  },
  groupCount: {
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
  },
  groupCountText: {
    ...TYPE.label,
    color: COLOR.inkMuted,
  },
  /** Sits between a group header and its cards. Muted, not warn: it
   *  explains what a group holds, it does not report a failure. */
  groupNote: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginBottom: SPACE.md,
  },

  card: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
    gap: SPACE.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  statusChip: {
    backgroundColor: COLOR.accentWash,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
  },
  statusChipText: {
    ...TYPE.label,
    color: COLOR.accent,
  },
  siteChip: {
    backgroundColor: COLOR.goodWash,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
  },
  siteChipText: {
    ...TYPE.label,
    color: COLOR.good,
  },
  cardTitle: {
    ...TYPE.heading,
  },

  factGrid: {
    gap: SPACE.sm,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
  },
  factLabel: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    // A fixed column so six labels of two to six glyphs read as a
    // column rather than as ragged prose.
    width: 84,
  },
  factValue: {
    ...TYPE.caption,
    color: COLOR.ink,
    flex: 1,
  },
});
