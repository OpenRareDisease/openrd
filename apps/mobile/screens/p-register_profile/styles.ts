import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 建档 / 编辑档案 — the intake form, re-pitched on lib/design.ts.
 *
 * The previous version wrapped every field group in a tinted,
 * shadowed panel floating over a gradient page: four cards stacked
 * down a form that is already four screens long, each one repeating
 * the same border-plus-shadow noise while the fields inside stayed
 * small and low-contrast. On a form, a card around a group says
 * nothing a heading and a rule don't say more quietly — and the
 * shadows cost the inputs the contrast they need.
 *
 * So: the page is paper, the groups are a title, a caption and a
 * hairline, and the only filled surface on the screen is the
 * onboarding note — the one thing a brand-new user has to read before
 * they start typing. Inputs became sunken wells at full touch height,
 * because on this screen the fields *are* the content.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  /** Kept so the screen can render a plain View in place of the old
   *  <LinearGradient> page background without changing its JSX shape.
   *  The gradient greyed down every input border sitting on it. */
  backgroundGradient: {
    flex: 1,
  },

  /* Header -------------------------------------------------------- */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.gutter,
    paddingVertical: SPACE.md,
    // A rule anchors the header instead of a shadow or a fill.
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  headerTitle: {
    ...TYPE.title,
    flex: 1,
    textAlign: 'center',
  },
  /** Matches the back button's real footprint (MIN_TOUCH_TARGET) so
   *  the centred title is actually centred; it was 40 against a 48pt
   *  button. */
  headerPlaceholder: {
    width: MIN_TOUCH_TARGET,
  },

  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.lg,
    paddingBottom: SPACE.xxl,
  },
  loadingContainer: {
    paddingVertical: SPACE.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Feedback ------------------------------------------------------ */
  feedbackBanner: {
    // No marginHorizontal: this renders inside scrollContent, which
    // already carries the page gutter — the old 24 stacked on top of
    // it and inset the banner from every field it referred to.
    marginBottom: SPACE.lg,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    // A 3pt semantic edge carries the state at a glance; the wash
    // alone was too faint to read as an error.
    borderLeftWidth: 3,
  },
  feedbackError: {
    backgroundColor: COLOR.alertWash,
    borderColor: 'rgba(180, 71, 47, 0.28)',
    borderLeftColor: COLOR.alert,
  },
  feedbackText: {
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 20,
    color: COLOR.ink,
  },

  /* Onboarding note — the single filled surface on this screen ----- */
  introNote: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
    marginBottom: SPACE.section,
  },
  introNoteText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  /* Field groups — heading + rule, not a card --------------------- */
  section: {
    marginBottom: SPACE.section,
  },
  sectionTitle: {
    ...TYPE.title,
  },
  sectionSubtitle: {
    ...TYPE.caption,
    marginTop: SPACE.xs,
  },
  /** Was a shadowed, bordered panel. Now it is just the field block,
   *  separated from its heading by a hairline — the group reads as a
   *  group without another box around it. */
  card: {
    marginTop: SPACE.md,
    paddingTop: SPACE.lg,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },

  /* Fields -------------------------------------------------------- */
  inputLabel: {
    ...TYPE.label,
    marginBottom: SPACE.sm,
  },
  input: {
    ...SURFACE.well,
    // Inputs are the content of this screen, so they get the full
    // touch height and body-size text rather than 14pt in a 38pt box.
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    fontSize: 15,
    color: COLOR.ink,
    marginBottom: SPACE.lg,
  },
  multilineInput: {
    minHeight: 88,
    paddingTop: SPACE.md,
  },
  /** A sentence under a field label, before the control. The ladder is
   *  the one question on this form whose *point* needs a sentence: five
   *  rungs that look like degrees of the same thing are actually five
   *  different next steps. */
  fieldHint: {
    ...TYPE.caption,
    marginTop: -SPACE.xs,
    marginBottom: SPACE.md,
  },
  /**
   * The diagnosis ladder — one full-width row per rung, stacked.
   *
   * NOT `optionRow`. That wraps chips horizontally, which works for
   * 「能」/「不能」 but puts four of these five labels on their own line
   * anyway at 12 characters each — and on a mid-range Android at 200%
   * text size the wrapped chips interleave, so the tap target for
   * 「已确诊，但报告不在手上」 stops being obviously one row. Stacked
   * rows also give this cohort a single vertical scan and a target the
   * full width of the screen, which matters when the hand doing the
   * tapping cannot be held steady.
   */
  ladderColumn: {
    gap: SPACE.sm,
    marginBottom: SPACE.lg,
  },
  ladderOption: {
    width: '100%',
    alignItems: 'flex-start',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    // Matches the input's bottom margin so a mixed group keeps one
    // vertical rhythm.
    marginBottom: SPACE.lg,
  },
  optionButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    // 16 read as a pill; these are choices, not status chips.
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  optionButtonActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accentWash,
  },
  optionText: {
    ...TYPE.label,
    fontWeight: '500',
  },
  /** Selection is carried by colour AND weight — the old version
   *  changed only the tint, which is invisible to a colour-blind or
   *  low-contrast reader. */
  optionTextActive: {
    ...TYPE.label,
    color: COLOR.accent,
    fontWeight: '700',
  },

  /* Save ---------------------------------------------------------- */
  /** Name kept for the screen's JSX; it is now a plain padding box,
   *  not a <LinearGradient>. */
});
