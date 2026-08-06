import { StyleSheet } from 'react-native';
import { COMFORTABLE_TOUCH_TARGET, MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/**
 * 记录数据 — the highest-traffic screen, re-pitched on lib/design.ts.
 *
 * What this pass removed, and why
 * -------------------------------
 *  - **01/02/03/04 on the four modes.** The four entry points can be
 *    opened in any order — there is no first and no last — so the
 *    numbers encoded a sequence that does not exist. Same for the
 *    「当前 03」pill that mirrored them.
 *  - **FOLLOW-UP / EVENT / REPORT / MUSCLE eyebrows.** Each sat
 *    directly above 日常记录 / 事件记录 / 报告上传 / 肌力自测 — an
 *    English restatement of the Chinese title one line below it.
 *  - **The hero card.**「或者自己选一个入口填」was set at 25pt, larger
 *    than the 20pt page title it sat under, so the screen appeared to
 *    be about the fallback path. Its only real content — 当前档案 and
 *    基础档案 — is now a two-column meta line under the title, where a
 *    record header belongs.
 *  - **The 当前已选择 recap card.** It repeated the title and
 *    description of the row the user had just tapped, immediately
 *    above a form whose own heading says the same thing a third time.
 *  - **Cards inside cards.** Mode tiles, form panels and the tips list
 *    were each a shadowed 22-28pt-radius panel on a gradient page.
 *    Exactly one filled surface survives — 说一句话就行, the primary
 *    path — and every other block is set on the paper, separated by a
 *    hairline.
 *  - **Icons in tinted rounded squares**, on the mode tiles: replaced
 *    by a bare glyph plus the 2pt selection stripe (p-home's rowStripe
 *    vocabulary), which is also what now carries "this one is active".
 *
 * Touch targets are unchanged or larger: the sleep buckets and stepper
 * keep MIN_TOUCH_TARGET / COMFORTABLE_TOUCH_TARGET, and the two
 * secondary upload buttons were raised from 44 to MIN_TOUCH_TARGET.
 */
export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  /** Kept so the screen can render a plain View where a page-wide
   *  <LinearGradient> used to be, without reshaping its JSX. The
   *  gradient cost every element on top of it some contrast. */
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
    paddingBottom: SPACE.lg,
    gap: SPACE.md,
  },
  pageTitle: {
    ...TYPE.display,
  },
  /** 当前档案 / 基础档案, demoted out of the old hero card. A record
   *  header states whose record this is; it doesn't need a panel. */
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: SPACE.lg,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  headerMetaItem: {
    // RN defaults flexShrink to 0 (unlike the web), so without this a
    // long 姓名 neither wraps nor shrinks — it pushes the divider and
    // the second column off-screen.
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerMetaLabel: {
    ...TYPE.caption,
  },
  headerMetaValue: {
    ...TYPE.heading,
  },
  headerMetaDivider: {
    width: HAIRLINE,
    backgroundColor: COLOR.line,
  },

  /* 说一句话 — the one filled surface on this screen --------------- */
  speakCard: {
    marginHorizontal: SPACE.gutter,
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  speakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  speakTitle: {
    ...TYPE.title,
  },
  speakHint: {
    ...TYPE.caption,
  },
  speakInput: {
    minHeight: 84,
    borderRadius: RADIUS.control,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    textAlignVertical: 'top',
    // White inside the tinted card: an input has to read as sunken
    // relative to the surface it sits on, and the card is no longer
    // white itself.
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    fontSize: 15,
    lineHeight: 22,
    color: COLOR.ink,
  },
  /** The「可以用键盘的语音键」line, under the composer rather than
   *  above it: it is an alternative route for someone who has already
   *  looked at the box and decided typing is too much, not part of the
   *  card's opening pitch. Set at caption weight for the same reason —
   *  it must not read as the recommended path (see the comment at the
   *  call site). */
  speakVoiceHint: {
    ...TYPE.caption,
    marginTop: -SPACE.xs,
  },
  speakNoticeWrap: {
    marginTop: -SPACE.xs,
  },

  /* Mode picker — hairline rows, not a 2×2 grid of tiles ---------- */
  modeSection: {
    marginTop: SPACE.section,
    paddingHorizontal: SPACE.gutter,
  },
  modeSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
    paddingBottom: SPACE.sm,
  },
  modeSectionTitle: {
    ...TYPE.title,
  },
  modeList: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  modeRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  /** 2pt bar instead of a tinted icon square + 「当前任务」badge +
   *  filled card background — three devices that all said the same
   *  one thing. */
  modeStripe: {
    width: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  modeStripeActive: {
    backgroundColor: COLOR.accent,
  },
  modeTextWrap: {
    flex: 1,
    gap: 2,
  },
  modeTitle: {
    ...TYPE.heading,
  },
  modeTitleActive: {
    color: COLOR.accent,
  },
  modeDescription: {
    ...TYPE.caption,
  },

  /* Forms — set on the page, divided by rules --------------------- */
  formStack: {
    marginTop: SPACE.section,
    marginHorizontal: SPACE.gutter,
    gap: SPACE.xl,
  },
  /** Was `sectionCard`: a shadowed, bordered, 24pt-radius panel. Now a
   *  block on the page with a rule above it. Renamed so the next
   *  reader doesn't reintroduce the panel. */
  formSection: {
    gap: SPACE.sm,
    paddingTop: SPACE.lg,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  sectionTitle: {
    ...TYPE.title,
  },
  sectionSubtitle: {
    ...TYPE.caption,
  },
  fieldBlock: {
    marginTop: SPACE.lg,
    gap: SPACE.sm,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
  },
  fieldLabel: {
    ...TYPE.label,
    fontSize: 14,
    color: COLOR.ink,
  },
  fieldHint: {
    ...TYPE.caption,
  },
  previousValueText: {
    ...TYPE.caption,
    // Tabular so「上次记录：18.5 秒」lines up with the value the user
    // is typing directly above it.
    fontVariant: ['tabular-nums'],
  },
  fieldErrorText: {
    ...TYPE.caption,
    color: COLOR.alert,
  },
  /** Why a question is being asked, with its source — the habit
   *  lib/genetics-family-content.ts set. Set apart from the surrounding
   *  captions by a rule and a wash, because it is provenance rather
   *  than instruction: a patient skimming for what to tap should be
   *  able to skip it, and a patient wondering why the app keeps asking
   *  about pain should be able to find it. */
  guidelineNote: {
    ...TYPE.caption,
    marginTop: SPACE.lg,
    padding: SPACE.md,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.well,
    borderLeftWidth: 2,
    borderLeftColor: COLOR.accentLine,
  },

  input: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    ...SURFACE.well,
    // Size/colour set field-by-field rather than by spreading TYPE:
    // a `lineHeight` on a single-line TextInput clips the glyphs on
    // Android, so the running-text token can't be reused verbatim.
    fontSize: 15,
    color: COLOR.ink,
  },
  textarea: {
    minHeight: 108,
    textAlignVertical: 'top',
  },

  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  choiceChip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
    // Not a pill: these are option controls, not status.
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
  },
  choiceChipActive: {
    backgroundColor: COLOR.accent,
    borderColor: COLOR.accent,
  },
  choiceChipText: {
    ...TYPE.label,
  },
  choiceChipTextActive: {
    color: COLOR.onAccent,
  },

  /* Sleep score — buckets + stepper (touch sizes unchanged) ------- */
  scoreBlock: {
    marginTop: SPACE.lg,
    gap: SPACE.sm,
  },
  // Buckets wrap onto a second row rather than shrinking to fit —
  // see lib/a11y.ts: never trade target size for a tidy single line.
  sleepBucketRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  sleepBucket: {
    flexGrow: 1,
    // Sized so three fit per row and the five wrap 3+2; they grow to
    // fill the remainder rather than shrinking below MIN_TOUCH_TARGET.
    flexBasis: 78,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
  },
  sleepBucketActive: {
    backgroundColor: COLOR.accent,
    borderColor: COLOR.accent,
  },
  sleepBucketText: {
    ...TYPE.label,
    fontSize: 15,
    color: COLOR.ink,
  },
  sleepBucketTextActive: {
    color: COLOR.onAccent,
  },
  sleepStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
    padding: SPACE.sm,
    ...SURFACE.well,
  },
  sleepStepButton: {
    width: COMFORTABLE_TOUCH_TARGET,
    height: COMFORTABLE_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
  },
  sleepValueWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  /** The one number this form is actually about — tabular figures so
   *  stepping 9 → 10 doesn't shove the label sideways. */
  sleepValue: {
    ...TYPE.metric,
  },
  sleepValueLabel: {
    ...TYPE.caption,
  },
  /** Was four pill-shaped chips. It is a legend for the field above,
   *  so it is now one line of text. */
  scoreHintWrap: {
    marginTop: SPACE.xs,
  },
  scoreHintText: {
    ...TYPE.caption,
    fontVariant: ['tabular-nums'],
  },

  /* Report upload -------------------------------------------------- */
  uploadAltRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
  },
  /** The two pickers still split the row; Button owns everything else
   *  about their shape now. */
  uploadAltButton: {
    flex: 1,
  },
  /* Batch queue --------------------------------------------------- */
  /** The picked-but-not-yet-uploaded list. Set on the page behind a
   *  hairline like every other block on this screen — a batch of seven
   *  scans is long, and boxing it would put a card inside the form
   *  section it already belongs to. */
  uploadQueue: {
    marginTop: SPACE.lg,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  uploadQueueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
    paddingBottom: SPACE.xs,
  },
  uploadQueueCount: {
    ...TYPE.caption,
    fontVariant: ['tabular-nums'],
  },
  uploadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    // Row height is set by the 48pt action buttons inside it; this is
    // the floor for a row that has none (a pending file with nothing
    // but the remove button, which is itself 48).
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: SPACE.xs,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  uploadItemText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  uploadItemName: {
    ...TYPE.label,
    fontSize: 14,
    color: COLOR.ink,
  },
  uploadItemMeta: {
    ...TYPE.caption,
  },
  uploadItemMetaError: {
    color: COLOR.alert,
  },
  uploadItemAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  /** 「正在上传第 3 / 7 份」— the reason the uploads are serial is that
   *  a patient can be told where the batch is. */
  uploadProgressText: {
    ...TYPE.caption,
    paddingTop: SPACE.sm,
    fontVariant: ['tabular-nums'],
  },

  tipList: {
    marginTop: SPACE.xs,
    gap: SPACE.sm,
  },
  tipItem: {
    flexDirection: 'row',
    gap: SPACE.sm,
    alignItems: 'flex-start',
  },
  tipText: {
    flex: 1,
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },

  /* Submit ---------------------------------------------------------- */
  /** Button owns the fill, radius and press response; the form only
   *  says where the submit sits. */
  submitButton: {
    marginTop: SPACE.sm,
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.md,
    // Translucent, not COLOR.paper: while a save is in flight the
    // patient should still see the form they just filled in. design.ts
    // has no scrim token, and swapping in the solid page colour
    // silently dropped the alpha the old value carried.
    backgroundColor: 'rgba(251, 248, 243, 0.82)',
  },
  loadingText: {
    ...TYPE.caption,
  },
});
