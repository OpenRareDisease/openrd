import { StyleSheet } from 'react-native';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 今天 — the first screen, re-pitched on lib/design.ts.
 *
 * The previous version stacked tinted, 22pt-radius, shadowed cards
 * over a gradient page; the brief wore a dot-plus-uppercase-eyebrow,
 * and every row carried an icon in a tinted rounded square. Hierarchy
 * came from box nesting rather than from type, and the whole thing sat
 * in one low-contrast sage-on-sand register.
 *
 * Now the page is paper. Exactly one block is filled — the brief, the
 * thing this screen is about — and everything else is set on the page
 * and separated by hairlines. Rows are rows. The accent appears on the
 * brief label and the primary chip, nowhere else.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  /** Kept so the screen can drop <LinearGradient> for a plain View
   *  without touching its JSX shape. */
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
    gap: SPACE.xs,
  },
  /** A real eyebrow: the date says something the greeting doesn't.
   *  Muted rather than accent — it labels, it doesn't decorate. */
  eyebrow: {
    ...TYPE.micro,
  },
  pageTitle: {
    ...TYPE.display,
  },

  /* 简报 — the single accented surface --------------------------- */
  briefCard: {
    marginHorizontal: SPACE.gutter,
    marginTop: SPACE.lg,
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
    gap: SPACE.sm,
  },
  briefHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  /** Retained as a 1pt accent rule rather than a dot — a bullet that
   *  bullets nothing was decoration. */
  briefDot: {
    width: 14,
    height: 1.5,
    backgroundColor: COLOR.accent,
  },
  briefLabel: {
    ...TYPE.micro,
    color: COLOR.accent,
  },
  briefHeadline: {
    ...TYPE.title,
    lineHeight: 26,
  },
  briefText: {
    ...TYPE.body,
  },
  briefActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginTop: SPACE.xs,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
  },

  /* Sections ------------------------------------------------------ */
  section: {
    paddingHorizontal: SPACE.gutter,
    marginTop: SPACE.section,
    gap: SPACE.sm,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...TYPE.title,
  },

  /* Rows — hairline-separated, not cards -------------------------- */
  actionRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  /** A 2pt bar carries urgency by colour, costs no horizontal room,
   *  and replaces the tinted icon square. */
  rowStripe: {
    width: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
  },
  /** No longer rendered — kept so an un-migrated caller compiles.
   *  Icons in tinted squares are the look this pass removed. */
  rowTextWrap: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...TYPE.heading,
  },
  rowSubtitle: {
    ...TYPE.caption,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
  },
  trendBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  reviewItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    paddingVertical: SPACE.xs,
  },
  reviewItemText: {
    flex: 1,
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
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
