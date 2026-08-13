import { StyleSheet } from 'react-native';
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
    paddingBottom: 40,
  },
  intro: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.section,
  },
  section: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  sectionTitle: {
    ...TYPE.title,
    color: COLOR.ink,
    marginBottom: 6,
  },
  sectionLede: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: 10,
  },
  point: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  // A rule rather than a dot. Several of these points are three lines
  // long, and a bullet leaves the runover text floating unattached to
  // anything on a narrow screen.
  pointRule: {
    width: 2,
    borderRadius: 1,
    backgroundColor: COLOR.line,
    marginRight: 10,
  },
  pointText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    flex: 1,
  },
  sourceRow: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  sourceText: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },
  // Sits between two sections rather than inside one: the timeline is
  // a different page, not another claim in the 「怀孕本身会怎么样」 card,
  // and putting it inside that card's border would have made a
  // navigation control look like a sourced statement.
  crossLink: {
    marginBottom: SPACE.md,
  },
  crossLinkHint: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginTop: SPACE.sm,
  },
  disclaimer: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginTop: 4,
    marginBottom: SPACE.section,
  },
});
