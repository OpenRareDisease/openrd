import { StyleSheet } from 'react-native';
import { COLOR, HAIRLINE, RADIUS, SPACE, TYPE } from '../../lib/design';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';

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
    paddingBottom: 40,
  },
  intro: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.section,
  },

  /* ---------------------------------------------------------------- */
  /* The optional due-date block — the one accented surface here.      */
  /* ---------------------------------------------------------------- */
  tracker: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
    padding: SPACE.lg,
    marginBottom: SPACE.section,
  },
  trackerTitle: {
    ...TYPE.heading,
    marginBottom: 6,
  },
  trackerText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.md,
  },
  /** The week readout. A statement of position, not a milestone. */
  gestation: {
    ...TYPE.metricSmall,
    marginBottom: 4,
  },
  gestationHint: {
    ...TYPE.caption,
    marginBottom: SPACE.md,
  },
  consentBlock: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.md,
    marginBottom: SPACE.md,
  },
  consentTitle: {
    ...TYPE.label,
    color: COLOR.ink,
    marginBottom: 6,
  },
  consentBody: {
    ...TYPE.caption,
    marginBottom: SPACE.md,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  consentRowLabel: {
    ...TYPE.caption,
    color: COLOR.ink,
    flex: 1,
  },
  fieldLabel: {
    ...TYPE.label,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    paddingHorizontal: SPACE.md,
    // A 48pt field, not a 36pt one: this is typed by a hand that this
    // disease has already taken grip and reach from.
    minHeight: MIN_TOUCH_TARGET,
    ...TYPE.body,
    color: COLOR.ink,
    marginBottom: SPACE.sm,
  },
  inputError: {
    borderColor: COLOR.alert,
  },
  errorText: {
    ...TYPE.caption,
    color: COLOR.alert,
    marginBottom: SPACE.sm,
  },
  clearedNotice: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  /** Spacing above the quiet re-open control. Deliberately separated
   *  from the notice so the two do not read as one sentence. */
  reopenBlock: {
    marginTop: SPACE.md,
    alignItems: 'flex-start',
  },

  /* ---------------------------------------------------------------- */
  /* Stages                                                            */
  /* ---------------------------------------------------------------- */
  segmented: {
    marginBottom: SPACE.lg,
  },
  stageHeader: {
    marginBottom: SPACE.md,
  },
  stageTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  stageTitle: {
    ...TYPE.title,
  },
  stageWeeks: {
    ...TYPE.caption,
  },
  stageLede: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginTop: 6,
  },
  item: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  itemTitle: {
    ...TYPE.heading,
    marginBottom: 6,
  },
  itemDetail: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  sourceRow: {
    marginTop: SPACE.md,
    paddingTop: SPACE.sm,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  sourceText: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },

  /* ---------------------------------------------------------------- */
  /* Cross-links + footer                                              */
  /* ---------------------------------------------------------------- */
  links: {
    marginTop: SPACE.sm,
    marginBottom: SPACE.section,
    gap: SPACE.md,
  },
  linksTitle: {
    ...TYPE.label,
    marginBottom: SPACE.xs,
  },
  linkHint: {
    ...TYPE.caption,
    marginTop: SPACE.xs,
  },
  disclaimer: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginBottom: SPACE.section,
  },
});
