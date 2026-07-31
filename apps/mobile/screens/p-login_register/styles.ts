import { StyleSheet, Dimensions } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, ELEVATION, HAIRLINE, SPACE, SURFACE, TYPE } from '../../lib/design';

const { width } = Dimensions.get('window');

/**
 * 登录 / 注册 — re-pitched on lib/design.ts.
 *
 * This is the first screen every patient sees, and it was carrying the
 * full set of generic-template tells: a heartbeat glyph inside a 64pt
 * tinted rounded square with a teal drop shadow, a gradient page under
 * everything, a centred hero, 48pt of vertical air before any content,
 * a segmented pill switcher, and status icons in tinted circles.
 *
 * Now: the page is paper, the wordmark is left-aligned to the same
 * gutter as the form so the whole screen sits on one axis, the mode
 * switch is an underlined tab strip on a hairline, and inputs are
 * sunken wells rather than beige panels. The accent is spent on two
 * things only — the logo glyph and the primary button.
 *
 * `index.tsx` is unchanged this pass, so two things are handled here
 * rather than removed at the source; both are flagged where they occur:
 * the page `<LinearGradient>` and the primary button's gradient fill.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  backgroundGradient: {
    flex: 1,
  },
  /**
   * The page gradient is still mounted in index.tsx (a <LinearGradient>
   * wrapping everything). Painting its only child opaque paper covers
   * the gradient completely, which is the whole point: a gradient page
   * drags down the contrast of every element sitting on it. Once the
   * screen drops <LinearGradient> for a plain View this can go back to
   * a bare `flex: 1`.
   */
  keyboardAvoidingView: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
    paddingHorizontal: SPACE.gutter,
    paddingBottom: SPACE.xl,
  },

  /* Masthead ------------------------------------------------------ */
  // Was 48pt of padding top and bottom around a centred logo — a third
  // of the first screen spent on decoration. Left-aligned and tightened
  // so the form starts above the fold on a small phone.
  header: {
    alignItems: 'stretch',
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.xl,
  },
  headerTopRow: {
    width: '100%',
    marginBottom: SPACE.xl,
    alignItems: 'flex-start',
  },
  // Left-aligned on the same axis as the labels and inputs below.
  logoContainer: {
    alignItems: 'flex-start',
  },
  logoWrapper: {
    marginBottom: SPACE.md,
  },
  // Was a 64pt tinted, bordered, teal-shadowed rounded square around a
  // 24pt glyph — the single most template-looking element on the app.
  // Now it only reserves space for the icon; the mark is the mark.
  logoCard: {
    width: 28,
    height: 28,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  logoIcon: {
    color: COLOR.accent,
  },
  // The wordmark is set in ink, not accent: the accent is worth more
  // pointing at the primary action than tinting a name that is already
  // the largest thing on the screen.
  appName: {
    ...TYPE.display,
    marginBottom: SPACE.xs,
  },
  appSlogan: {
    ...TYPE.caption,
  },

  /* Main content -------------------------------------------------- */
  mainContent: {
    flex: 1,
  },

  /* Mode switch — underlined tabs, not a segmented pill ------------ */
  // A two-up rounded segmented control at the top of a login form is
  // the shape every generated sign-in screen shares. A tab strip on a
  // hairline says the same thing with a rule instead of a box.
  /** SegmentedControl draws its own track, so the underline and the
   *  row layout that used to separate two bare tab buttons are gone —
   *  they were leaving a 40pt hole between the tabs and the form. */
  tabSwitcher: {
    marginBottom: SPACE.xl,
  },
  // Retained for index.tsx's style arrays. The joined-segment corner
  // radii they used to carry are gone with the segmented control; the
  // tabs are now separated by a gap on tabSwitcher.
  // Weight and ink both change, so the active tab is not signalled by
  // colour alone.

  /* Form ---------------------------------------------------------- */
  formContainer: {
    marginBottom: SPACE.lg,
  },
  inputContainer: {
    marginBottom: SPACE.lg,
  },
  fieldErrorText: {
    ...TYPE.caption,
    marginTop: SPACE.xs,
    color: COLOR.alert,
  },
  // A real section heading (账号信息 / 重置密码), so it gets heading
  // size rather than the 14pt semibold it shared with the field labels.
  registerSectionTitle: {
    ...TYPE.title,
    marginTop: SPACE.sm,
    marginBottom: SPACE.md,
  },
  inputLabel: {
    ...TYPE.label,
    marginBottom: SPACE.sm,
  },
  // Inputs are sunken wells rather than beige panels: a field should
  // read as a place to put something, and the page keeps the lighter
  // value so the wells recede.
  textInput: {
    ...SURFACE.well,
    width: '100%',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    color: COLOR.ink,
    fontSize: 16,
  },

  /* Identity / login-method choice -------------------------------- */
  // Border, fill and weight all move on selection — never colour alone.

  /* Verification code --------------------------------------------- */
  verificationCodeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  verificationCodeInput: {
    ...SURFACE.well,
    flex: 1,
    // Was padding-only (~44pt). Brought up to the floor like every
    // other field on the screen.
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    color: COLOR.ink,
    fontSize: 16,
  },
  /** Sits at the end of the code field's row. */
  getCodeButton: {
    marginLeft: SPACE.sm,
  },
  // Dimming the whole button carries the label with it — the countdown
  // text has no disabled style of its own in index.tsx.

  /* Password fields ----------------------------------------------- */
  passwordInputWrapper: {
    ...SURFACE.well,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: SPACE.xs,
  },
  passwordInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    color: COLOR.ink,
    fontSize: 16,
  },
  // Was a bare 42x17 glyph — the smallest target on the first screen
  // every patient sees. Now a real button.
  passwordToggleButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Primary action ------------------------------------------------ */
  /** Button owns the fill, radius and press response. */
  // Was ink-on-teal, which reads as a disabled button and fails contrast
  // over the darker end of the fill.

  /* Secondary links ----------------------------------------------- */
  forgotPasswordContainer: {
    alignItems: 'center',
    marginBottom: SPACE.lg,
  },
  // The tappable area belongs on the Touchable, not its wrapper —
  // padding the parent View leaves the link itself 70x20.

  /* Agreement ----------------------------------------------------- */
  // A rule instead of 32pt of blank space: the legal line is a footer,
  // and a hairline says so in 1px.
  agreement: {
    alignItems: 'center',
    marginTop: SPACE.sm,
    marginBottom: SPACE.xl,
    paddingTop: SPACE.lg,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  agreementLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  agreementText: {
    ...TYPE.caption,
    textAlign: 'center',
  },
  agreementLink: {
    color: COLOR.accent,
    fontWeight: '600',
  },

  /* Modals -------------------------------------------------------- */
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Ink at low alpha — the scrim should read as the page dimming, not
    // as a grey wash of its own.
    backgroundColor: 'rgba(23, 39, 46, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContainer: {
    marginHorizontal: SPACE.gutter,
    maxWidth: width - SPACE.gutter * 2,
    width: '100%',
  },
  // A modal is one of the few things that genuinely floats, so it keeps
  // an elevation — but the shared neutral one, not a teal-tinted glow.
  modalContent: {
    ...SURFACE.card,
    padding: SPACE.lg,
    alignItems: 'center',
    ...ELEVATION.button,
  },
  modalIconContainer: {
    marginBottom: SPACE.md,
  },
  // Both were 40pt tinted circles behind a 20pt glyph. The glyph is
  // already coloured by index.tsx, so the disc was pure decoration;
  // these now just reserve the space.
  errorIconWrapper: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconWrapper: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    ...TYPE.title,
    marginBottom: SPACE.sm,
  },
  modalMessage: {
    ...TYPE.body,
    textAlign: 'center',
    marginBottom: SPACE.lg,
  },

  /* Agreement modal ----------------------------------------------- */
  agreementModalContent: {
    ...SURFACE.card,
    padding: SPACE.lg,
    maxHeight: 384,
    ...ELEVATION.button,
  },
  agreementModalClose: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Pull the 48pt hit box back so the glyph, not the box, lines up
    // with the panel's padding. The target itself is untouched.
    marginRight: -SPACE.md,
  },
  // The header rule doubles as the scroll boundary for the long legal
  // text below it.
  agreementModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACE.md,
    paddingBottom: SPACE.md,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  agreementModalTitle: {
    ...TYPE.title,
    flex: 1,
  },
  agreementModalScrollView: {
    maxHeight: 320,
  },
  agreementModalText: {
    ...TYPE.body,
  },
});
