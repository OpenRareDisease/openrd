import { StyleSheet } from 'react-native';
import { COLOR, ELEVATION, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 我的 — re-pitched on lib/design.ts.
 *
 * What this replaces
 * ------------------
 * Every one of the ~12 destinations on this screen was its own
 * shadowed, bordered, 8pt-radius panel, grouped into four *more*
 * bordered sections, each row carrying its icon inside a 40pt tinted
 * circle colour-coded by nothing in particular (blue / green / purple
 * assigned by rotation, not by meaning). A settings screen is a list;
 * that markup made it twelve cards stacked on a card.
 *
 * The stance here
 * ---------------
 * Rows are rows: a hairline above each, a bare icon in a fixed-width
 * column so every title starts on the same vertical, a chevron at the
 * end. The one filled surface is the identity block at the top — the
 * thing this screen is actually about — and the phone number gets
 * tabular figures and real size because it is the value the patient
 * came here to check. Colour is spent only where it means something:
 * warn on the pending-deletion row, alert on 注销 and 退出登录.
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
  scrollContent: {
    paddingBottom: 120,
  },

  /* Header -------------------------------------------------------- */
  // Left-aligned rather than centred: a centred title/subtitle pair is
  // a marketing header, and it broke the left margin every row below
  // it aligns to.
  header: {
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.xs,
    gap: SPACE.xs,
  },
  pageTitle: {
    ...TYPE.display,
  },
  pageSubtitle: {
    ...TYPE.caption,
  },

  /* Identity — the single filled block ---------------------------- */
  identity: {
    marginHorizontal: SPACE.gutter,
    marginTop: SPACE.lg,
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
    gap: SPACE.xs,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  /** The phone number is this screen's headline value — tabular
   *  figures so it reads as an identifier, not as prose. */
  identityValue: {
    ...TYPE.metricSmall,
    fontSize: 21,
    lineHeight: 27,
  },
  /** Role and join date collapsed onto one line. Three stacked
   *  12–14pt greys were three lines of nothing. */
  identityMeta: {
    ...TYPE.caption,
  },
  /** A labelled control instead of a tinted 48pt circle holding a
   *  pencil: the word says what the icon only implied. */

  /* Groups -------------------------------------------------------- */
  /** With the section cards gone, this label is the only thing
   *  separating one group of rows from the next — it names a category
   *  no row title repeats, so it earns TYPE.micro. */

  /* Rows ---------------------------------------------------------- */
  /** Fixed width so every title in the list starts on the same
   *  vertical — the alignment is what makes a bare icon read as
   *  structure rather than as clip-art. */
  /** Destructive and pending states. Colour on the title, not a
   *  tinted box around the icon. */

  /** A pill that means something: 即将上线 is a status. */
  comingSoonBadge: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  comingSoonBadgeText: {
    ...TYPE.micro,
    letterSpacing: 0,
    color: COLOR.inkFaint,
  },

  /* Sign out ------------------------------------------------------ */

  /* Footer -------------------------------------------------------- */
  versionInfo: {
    marginTop: SPACE.xl,
    paddingHorizontal: SPACE.gutter,
    alignItems: 'center',
    gap: 2,
  },
  versionText: {
    ...TYPE.caption,
    fontSize: 12,
    color: COLOR.inkFaint,
  },
  copyrightText: {
    ...TYPE.caption,
    fontSize: 12,
    color: COLOR.inkFaint,
  },

  /* Modals — the only things here that genuinely float ------------- */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(23, 39, 46, 0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACE.lg,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 340,
  },
  modalContent: {
    ...SURFACE.card,
    padding: SPACE.xl,
    gap: SPACE.sm,
    ...ELEVATION.button,
  },
  /** Bare icon beside the title. The 64pt tinted circle it replaces
   *  was the most "generic app" object on the screen, and it pushed
   *  the actual question a third of the way down the dialog. */
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  modalTitle: {
    ...TYPE.title,
  },
  modalMessage: {
    ...TYPE.body,
    marginBottom: SPACE.md,
  },
  modalButtonContainer: {
    flexDirection: 'row',
    gap: SPACE.md,
  },
  deleteConfirmInput: {
    alignSelf: 'stretch',
    marginBottom: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    ...SURFACE.well,
    color: COLOR.ink,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  deleteErrorText: {
    alignSelf: 'stretch',
    marginBottom: SPACE.sm,
    ...TYPE.caption,
    color: COLOR.alert,
  },
});
