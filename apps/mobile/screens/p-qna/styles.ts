import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 智能问答 — re-pitched on lib/design.ts.
 *
 * What this pass removed
 * ----------------------
 * The previous version was the generic-chatbot look: every message in
 * a 22pt-radius shadowed bubble, the assistant's answers boxed at 82%
 * width behind a robot glyph in a tinted rounded square, a 24pt-radius
 * shadowed composer, a shadowed progress *card*, and a `SMART CHAT`
 * eyebrow over a title that already said 智能问答.
 *
 * The stance here
 * ---------------
 * A Q&A transcript in a medical record is a *document*, not a
 * messaging app. So the assistant's answer — the long-form clinical
 * content, the thing the user actually came to read — is set directly
 * on the page at full width, delimited by a 2pt accent rule down its
 * left edge (the same device as p-home's `rowStripe`). Only the
 * user's own turns keep a container, right-aligned and tinted, so
 * "who said this" still reads at a glance. Nothing carries a shadow;
 * the only saturated accent on the screen is the send button.
 *
 * Body copy went 14/21 → 15/23: these answers are the densest reading
 * on any screen in the app and were set smaller than the paragraphs
 * everywhere else.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  keyboardAvoidingView: {
    flex: 1,
  },

  /* Header -------------------------------------------------------- */
  /** The strip below ScreenHeader: what this screen does, plus 清空.
   *  The page title moved into the shared header, and `SMART CHAT`
   *  (previously kept alive as `display: none`) is gone with it. */
  header: {
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACE.md,
  },
  headerText: {
    flex: 1,
    gap: SPACE.xs,
  },
  pageTitle: {
    ...TYPE.display,
  },
  pageSubtitle: {
    ...TYPE.caption,
  },
  /** 清空. A destructive-ish secondary action, not a status — so a
   *  control radius, not a pill. */
  headerAction: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
  },

  /* Transcript ---------------------------------------------------- */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACE.gutter,
    paddingBottom: SPACE.xl,
    gap: SPACE.lg,
  },
  messageRow: {
    flexDirection: 'row',
    // `stretch` lets the assistant rule run the full height of the
    // answer beside it.
    alignItems: 'stretch',
    gap: SPACE.md,
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  /**
   * Was a 34pt tinted rounded square holding a robot glyph — the most
   * recognisable "generated UI" tell in the app. It is now a 2pt
   * semantic rule spanning the answer. The glyph the JSX still puts
   * inside is clipped by `overflow: hidden`; removing the <FontAwesome6>
   * belongs with the next index.tsx edit.
   */
  avatar: {
    width: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarAssistant: {
    backgroundColor: COLOR.accent,
  },
  avatarError: {
    backgroundColor: COLOR.alert,
  },
  messageBubble: {
    maxWidth: '100%',
    borderRadius: RADIUS.surface,
  },
  /** Not a bubble any more: the answer is set on the page, full
   *  width, with the rule at its left doing the containing. */
  messageBubbleAssistant: {
    flex: 1,
    paddingVertical: 2,
  },
  /** The user's own turn keeps a container so authorship reads
   *  without a colour-coded avatar. Tinted rather than solid accent —
   *  ink-on-tint keeps the timestamp and metadata legible, which
   *  white-on-teal never did. */
  messageBubbleUser: {
    ...SURFACE.cardAccent,
    maxWidth: '84%',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm + 2,
  },
  /** Applied last, so it restores the padding the assistant variant
   *  drops — an error bubble is a real surface again. */
  messageBubbleError: {
    backgroundColor: COLOR.alertWash,
    borderWidth: HAIRLINE,
    borderColor: 'rgba(180, 71, 47, 0.22)',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
  },
  /** Real speaker attribution, not decoration — kept, but demoted.
   *  No letter-spacing: this label is Chinese. */
  messageAuthor: {
    marginBottom: SPACE.xs,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: COLOR.inkMuted,
  },
  messageText: {
    ...TYPE.body,
  },
  messageTextAssistant: {
    color: COLOR.ink,
  },
  messageTextUser: {
    color: COLOR.ink,
  },
  messageMetaRow: {
    marginTop: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  messageTime: {
    fontSize: 11,
    lineHeight: 15,
    // inkMuted, not inkFaint: this row also renders inside the tinted
    // user surface, where faint drops under 3:1.
    color: COLOR.inkMuted,
  },
  messageStateText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: COLOR.accent,
  },

  /* Consent-epoch divider ----------------------------------------- */
  systemDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    marginVertical: SPACE.xs,
  },
  systemDividerLine: {
    flex: 1,
    ...SURFACE.rule,
  },
  systemDividerText: {
    fontSize: 11,
    lineHeight: 16,
    maxWidth: '70%',
    textAlign: 'center',
    color: COLOR.inkMuted,
  },

  /* Consent gate, inside an errored bubble ------------------------ */
  consentCard: {
    marginTop: SPACE.md,
    gap: SPACE.md,
  },
  consentCardText: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },

  /* Per-answer progress ------------------------------------------- */
  /** Was a tinted 22pt-radius card stacked under the bubbles — a
   *  second container for something transient. It is now the tail of
   *  the transcript, opened by a hairline. */
  progressCard: {
    marginTop: SPACE.xs,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    gap: SPACE.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
  },
  progressTitle: {
    ...TYPE.label,
  },
  progressStatus: {
    ...TYPE.caption,
    fontSize: 12,
  },
  progressBar: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLOR.line,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
    backgroundColor: COLOR.accent,
  },
  progressStages: {
    marginTop: SPACE.xs,
    gap: SPACE.sm,
  },
  progressStageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  progressStageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLOR.lineStrong,
  },
  progressStageDotActive: {
    backgroundColor: COLOR.accent,
  },
  progressStageDotDone: {
    backgroundColor: COLOR.good,
  },
  progressStageDotError: {
    backgroundColor: COLOR.alert,
  },
  progressStageText: {
    ...TYPE.caption,
    fontSize: 12,
  },
  progressStageTextActive: {
    color: COLOR.ink,
    fontWeight: '600',
  },
  progressStageTextDone: {
    color: COLOR.inkSoft,
  },
  progressStageTextError: {
    color: COLOR.alert,
  },

  /* Starters ------------------------------------------------------ */
  /** Openers for a blank transcript. Sits on the page rather than in a
   *  card — the transcript below it is set on paper too, and boxing the
   *  starters would read as a banner rather than as the first thing to
   *  do. */
  starterBlock: {
    marginTop: SPACE.md,
    gap: SPACE.sm,
  },
  starterTitle: {
    ...TYPE.micro,
  },
  /** Full-width rows, one per line: these are tap targets for hands
   *  that cannot aim, so nothing here shares a row with anything else.
   *  Same stance as AskAboutDrawer's suggestion stack. */
  starterStack: {
    gap: SPACE.sm,
  },
  starterNote: {
    ...TYPE.caption,
    fontSize: 12,
    lineHeight: 17,
  },

  /* Composer ------------------------------------------------------ */
  composerShell: {
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.lg,
    // Opaque paper, not a translucent overlay: the transcript must not
    // ghost through the thing the user is typing into.
    backgroundColor: COLOR.paper,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  /** A sunken well, per the token doc — an input should read as
   *  recessed, not as another floating card. */
  composerCard: {
    ...SURFACE.well,
    minHeight: 66,
    paddingLeft: SPACE.md,
    paddingRight: SPACE.sm,
    paddingVertical: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACE.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    color: COLOR.ink,
    fontSize: 15,
    lineHeight: 23,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.sm,
  },
  /** The one saturated accent on this screen. */
  sendButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.accent,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  composerHint: {
    marginTop: SPACE.sm,
    ...TYPE.caption,
    fontSize: 12,
    lineHeight: 17,
  },
});
