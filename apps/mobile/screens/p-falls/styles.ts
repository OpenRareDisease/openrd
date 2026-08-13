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

  intro: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.lg,
  },

  /** The one filled surface on this screen, and it is the FORM — not a
   *  count and not a chart. What this page is for is recording a fall. */
  form: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    padding: SPACE.lg,
    marginBottom: SPACE.lg,
  },
  question: {
    ...TYPE.label,
    color: COLOR.inkSoft,
    marginBottom: SPACE.sm,
  },
  questionBlock: {
    marginTop: SPACE.lg,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  /** MIN_TOUCH_TARGET tall, and wrapped rather than squeezed: nine
   *  activity options do not fit one row on a narrow phone, and
   *  lib/a11y.ts forbids shrinking the target to make them. */
  option: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  // Selection is carried by fill, border, weight and ink together —
  // colour alone fails for the colour-blind and washes out in sunlight.
  optionSelected: {
    borderWidth: 2,
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accentWash,
  },
  optionText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  optionTextSelected: {
    color: COLOR.accent,
    fontWeight: '700',
  },

  dateInput: {
    ...TYPE.body,
    color: COLOR.ink,
    minHeight: MIN_TOUCH_TARGET,
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },

  disclosure: {
    marginTop: SPACE.lg,
  },
  detailHint: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginTop: SPACE.md,
  },

  submit: {
    marginTop: SPACE.lg,
  },
  formError: {
    ...TYPE.caption,
    color: COLOR.alert,
    marginTop: SPACE.md,
  },
  savedNote: {
    ...TYPE.caption,
    color: COLOR.accent,
    marginBottom: SPACE.lg,
  },

  /** The count. Caption-sized and below the form on purpose: a fall
   *  diary that opens with a running total is a progression alert. */
  contextBlock: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingTop: SPACE.md,
    marginBottom: SPACE.lg,
    gap: SPACE.xs,
  },
  contextLine: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  contextCaveat: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },

  listHeading: {
    ...TYPE.title,
    color: COLOR.ink,
    marginBottom: SPACE.sm,
  },
  entry: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingVertical: SPACE.md,
  },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  entryDay: {
    ...TYPE.heading,
    color: COLOR.ink,
  },
  entryDate: {
    ...TYPE.caption,
    color: COLOR.inkFaint,
    marginTop: 2,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.xs,
    marginTop: SPACE.sm,
  },
  chip: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLOR.well,
  },
  chipText: {
    ...TYPE.micro,
    color: COLOR.inkMuted,
    letterSpacing: 0,
  },
  /** A date-only entry says so, once, in the entry itself. It is a
   *  statement about the row, never about the person who wrote it. */
  dateOnlyText: {
    ...TYPE.caption,
    color: COLOR.inkFaint,
    marginTop: SPACE.sm,
  },

  stateBlock: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    gap: SPACE.sm,
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
});
