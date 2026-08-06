import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, TYPE } from '../../lib/design';

/**
 * Replaces the previous stylesheet wholesale.
 *
 * That one was written for a forum this app does not have: post cards,
 * avatars, reply threads, an online-count dot, a publish modal with a
 * floating compose button. None of it was reachable — the screen it
 * belonged to rendered `UnavailableScreen` — and all of it was in the
 * pre-`lib/design` vocabulary (white-on-#969FFF, 24pt shadowed cards)
 * that the rest of the app has already left behind.
 *
 * The typographic rule this shelf runs on
 * ---------------------------------------
 * A patient must never have to work out which sentences are ours and
 * which are the author's. So the two never share a treatment:
 *
 *   - **Their words** — the excerpt — are ink, with a teal rule down
 *     the left margin. That rule appears nowhere else on the page.
 *   - **Our words** — blurbs, theme copy, hook ledes — are inkSoft or
 *     inkMuted running text with no rule.
 *
 * It is the same separation the clinical pages use for evidence versus
 * framing, applied to authorship instead.
 */
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
  },
  scrollContent: {
    paddingHorizontal: SPACE.gutter,
    paddingBottom: 48,
  },

  /* Intro ---------------------------------------------------------- */
  intro: {
    ...TYPE.body,
    marginBottom: SPACE.md,
  },
  caveat: {
    ...TYPE.caption,
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
    padding: SPACE.md,
    marginBottom: SPACE.lg,
  },

  /* Theme picker --------------------------------------------------- */
  themeControl: {
    marginBottom: SPACE.md,
  },
  themeBlurb: {
    ...TYPE.caption,
    marginBottom: SPACE.lg,
  },
  countLine: {
    ...TYPE.micro,
    marginBottom: SPACE.sm,
  },

  /* Story card ----------------------------------------------------- */
  card: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  // A serial instalment is visually tied to the one above it: the
  // memoir is one thing in four pieces and must not read as four
  // unrelated cards that happen to share an author.
  cardSerialContinuation: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    marginTop: -SPACE.md,
    borderTopWidth: 0,
  },
  serialBadge: {
    ...TYPE.micro,
    color: COLOR.accent,
    marginBottom: 4,
  },
  cardTitle: {
    ...TYPE.heading,
    marginBottom: 4,
  },
  cardByline: {
    ...TYPE.caption,
    marginBottom: SPACE.md,
  },
  cardBlurb: {
    ...TYPE.body,
    marginBottom: SPACE.md,
  },

  /* The author's own words ----------------------------------------- */
  quote: {
    flexDirection: 'row',
    marginBottom: SPACE.md,
  },
  quoteRule: {
    width: 2,
    borderRadius: 1,
    backgroundColor: COLOR.accentSoft,
    marginRight: SPACE.md,
  },
  quoteText: {
    ...TYPE.bodyStrong,
    flex: 1,
  },
  quoteAttribution: {
    ...TYPE.caption,
    color: COLOR.inkFaint,
    marginTop: SPACE.xs,
  },

  caution: {
    ...TYPE.caption,
    color: COLOR.warn,
    backgroundColor: COLOR.warnWash,
    borderRadius: RADIUS.control,
    padding: SPACE.md,
    marginBottom: SPACE.md,
  },

  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },

  /* Read-the-original sheet ---------------------------------------- */
  sheetOverlay: {
    flex: 1,
    backgroundColor: COLOR.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLOR.paper,
    borderTopLeftRadius: RADIUS.group,
    borderTopRightRadius: RADIUS.group,
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.xl,
    paddingBottom: SPACE.xxl,
    maxHeight: '85%',
  },
  sheetTitle: {
    ...TYPE.title,
    marginBottom: SPACE.sm,
  },
  sheetNote: {
    ...TYPE.body,
    marginBottom: SPACE.lg,
  },
  locator: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.lg,
  },
  locatorRow: {
    marginBottom: SPACE.md,
  },
  locatorLabel: {
    ...TYPE.micro,
    marginBottom: 2,
  },
  // Rendered `selectable` so the title can be long-pressed and pasted
  // into WeChat's search field. The app has no clipboard dependency
  // and is not adding one.
  locatorValue: {
    ...TYPE.bodyStrong,
  },
  locatorValueFaint: {
    ...TYPE.caption,
    color: COLOR.inkFaint,
  },
  sheetActions: {
    gap: SPACE.md,
  },

  /* Contextual hooks: the settings block on this screen ------------- */
  settingsBlock: {
    marginTop: SPACE.section,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingTop: SPACE.lg,
  },
  settingsTitle: {
    ...TYPE.heading,
    marginBottom: SPACE.xs,
  },
  settingsBody: {
    ...TYPE.caption,
    marginBottom: SPACE.md,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  settingsRowLabel: {
    ...TYPE.label,
    color: COLOR.ink,
    flex: 1,
  },
  triggerList: {
    marginTop: SPACE.sm,
    gap: SPACE.sm,
  },
  triggerItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
  },
  triggerText: {
    ...TYPE.caption,
    flex: 1,
  },

  /* Contextual hook card (mounted by other screens) ----------------- */
  hookCard: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
  },
  hookHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
  },
  hookHeaderText: {
    flex: 1,
  },
  hookTitle: {
    ...TYPE.heading,
    marginBottom: 2,
  },
  hookLede: {
    ...TYPE.caption,
    marginBottom: SPACE.md,
  },
  // Not a 20pt glyph in a corner. Dismissing is the action this card
  // most expects to receive, from someone whose grip is the first
  // thing this disease takes, so it gets a full-size target.
  hookDismiss: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
  },
  hookFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: SPACE.sm,
  },

  /* Empty state ----------------------------------------------------- */
  empty: {
    ...TYPE.body,
    color: COLOR.inkMuted,
    paddingVertical: SPACE.xxl,
    textAlign: 'center',
  },
});
