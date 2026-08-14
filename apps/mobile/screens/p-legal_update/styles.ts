import { StyleSheet } from 'react-native';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 隐私政策更新.
 *
 * One accented block on the page — 「这一版改了什么」 — because that is
 * the thing this screen exists to say; everything else is set on the
 * paper with hairlines, per lib/design.ts. The decline block is a plain
 * card rather than a warn-coloured one: refusing is not an error state
 * and must not be drawn like one.
 *
 * Every control is a full-width Button, which is 48pt (MIN_TOUCH_TARGET)
 * by construction in screens/common/Button.tsx — no `compact` anywhere
 * on this screen, since none of these is a header affordance and all of
 * them are on a path a patient has to complete.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  scrollContent: {
    padding: SPACE.gutter,
    paddingBottom: SPACE.xxl,
    gap: SPACE.lg,
  },

  pageTitle: {
    ...TYPE.title,
  },
  pageLead: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  stepHint: {
    ...TYPE.caption,
  },

  versionRow: {
    ...SURFACE.well,
    padding: SPACE.md,
  },
  versionText: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },

  /* The one accented block ----------------------------------------- */
  changeCard: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  changeCardTitle: {
    ...TYPE.heading,
  },
  note: {
    gap: SPACE.sm,
  },
  noteHeadline: {
    ...TYPE.bodyStrong,
  },
  changeCardFoot: {
    ...TYPE.micro,
    color: COLOR.inkMuted,
  },

  bulletRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    alignItems: 'flex-start',
  },
  bullet: {
    ...TYPE.body,
    color: COLOR.accent,
  },
  bulletText: {
    ...TYPE.body,
    flex: 1,
  },

  /* Full text, collapsed by default -------------------------------- */
  fullText: {
    ...SURFACE.card,
    padding: SPACE.lg,
    gap: SPACE.lg,
  },
  fullTextSection: {
    gap: SPACE.xs,
  },
  fullTextTitle: {
    ...TYPE.bodyStrong,
  },
  fullTextBody: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },

  errorText: {
    ...TYPE.caption,
    color: COLOR.alert,
  },
  acceptFoot: {
    ...TYPE.micro,
    color: COLOR.inkMuted,
    marginTop: -SPACE.sm,
  },

  /* 如果你不想同意 -------------------------------------------------- */
  declineCard: {
    ...SURFACE.card,
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  declineTitle: {
    ...TYPE.heading,
  },
  declineText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  /* Nothing-to-ask / loading --------------------------------------- */
  emptyBlock: {
    ...SURFACE.card,
    padding: SPACE.lg,
    gap: SPACE.md,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
  },
  emptyTitle: {
    ...TYPE.heading,
  },
  emptyText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
});
