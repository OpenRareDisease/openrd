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
    marginBottom: SPACE.md,
  },
  provenance: {
    borderLeftWidth: 2,
    borderLeftColor: COLOR.accentLine,
    paddingLeft: SPACE.md,
    marginBottom: SPACE.section,
  },
  provenanceDate: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    marginBottom: 4,
  },
  provenanceNote: {
    ...TYPE.caption,
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

  /* ---- the card block: this screen's one accented surface ---- */
  cardBlock: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
    gap: SPACE.md,
  },
  cardTitle: {
    ...TYPE.title,
  },
  cardSubtitle: {
    ...TYPE.caption,
  },
  cardImage: {
    width: '100%',
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },

  /* ---- the same card as text ---- */
  cardTextBlock: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.md,
  },
  cardTextHint: {
    ...TYPE.caption,
    marginBottom: SPACE.sm,
  },
  cardTextTitle: {
    ...TYPE.heading,
    marginBottom: 2,
  },
  cardTextName: {
    ...TYPE.bodyStrong,
    marginBottom: 4,
  },
  cardTextMeta: {
    ...TYPE.caption,
  },
  cardTextSection: {
    marginTop: SPACE.md,
  },
  cardTextHeading: {
    ...TYPE.label,
    color: COLOR.accent,
    marginBottom: 4,
  },
  cardTextLine: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: 4,
  },
  cardTextFine: {
    ...TYPE.caption,
    marginTop: SPACE.md,
  },

  disclaimer: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginTop: SPACE.sm,
    marginBottom: SPACE.section,
  },
});
