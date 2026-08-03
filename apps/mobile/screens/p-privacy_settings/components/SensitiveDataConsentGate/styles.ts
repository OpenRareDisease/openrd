import { StyleSheet } from 'react-native';
import { COLOR, HAIRLINE, RADIUS, SPACE, TYPE } from '../../../../lib/design';

/**
 * A consent document has to be readable before it can be agreed to, so
 * the card is tall (85% of the screen at most) and the text scrolls
 * inside it rather than being summarised down to a sentence. Summarised
 * consent copy is how 单独同意 turns back into the bundled tick box this
 * gate exists to replace.
 */
export default StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(23, 39, 46, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.gutter,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    padding: SPACE.lg,
  },
  title: {
    ...TYPE.title,
    marginBottom: SPACE.md,
    paddingBottom: SPACE.md,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  body: {
    flexShrink: 1,
    marginBottom: SPACE.md,
  },
  section: {
    marginBottom: SPACE.md,
  },
  sectionTitle: {
    ...TYPE.heading,
    marginBottom: SPACE.xs,
  },
  sectionBody: {
    ...TYPE.body,
  },
  errorText: {
    ...TYPE.caption,
    color: COLOR.alert,
    marginBottom: SPACE.sm,
  },
  declineRow: {
    marginTop: SPACE.sm,
  },
});
