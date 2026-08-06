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
    paddingBottom: 48,
  },

  intro: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.lg,
  },
  matchedLine: {
    ...TYPE.bodyStrong,
    color: COLOR.ink,
    marginBottom: SPACE.md,
  },
  coverageNote: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.surface,
    padding: SPACE.md,
    marginBottom: SPACE.section,
  },

  stateCard: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
    gap: SPACE.sm,
  },
  stateTitle: {
    ...TYPE.bodyStrong,
    color: COLOR.ink,
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

  groupHeader: {
    marginTop: SPACE.lg,
    marginBottom: SPACE.sm,
  },
  groupTitle: {
    ...TYPE.title,
    color: COLOR.ink,
  },
  groupLede: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginTop: 4,
  },

  row: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  // A matched row is the one this patient's own record put on the
  // page. It gets a left rule rather than a fill: a filled card would
  // read as an alert, and「你记录过开始用轮椅」is not an alarm.
  rowMatched: {
    borderLeftWidth: 3,
    borderLeftColor: COLOR.accent,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.xs,
    marginBottom: SPACE.sm,
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
  },
  chipLevel: {
    backgroundColor: COLOR.accentWash,
  },
  chipLevelText: {
    color: COLOR.accent,
  },
  chipMatched: {
    backgroundColor: COLOR.accentWash,
  },
  chipMatchedText: {
    color: COLOR.accent,
  },
  chipDoNot: {
    backgroundColor: COLOR.warnWash,
  },
  chipDoNotText: {
    color: COLOR.warn,
  },
  rowTitle: {
    ...TYPE.bodyStrong,
    color: COLOR.ink,
    marginBottom: 6,
  },
  rowGuideline: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  evidenceBlock: {
    marginTop: SPACE.md,
    paddingTop: SPACE.sm,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  evidenceLabel: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    marginBottom: 4,
  },
  evidenceText: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },

  askBlock: {
    marginTop: SPACE.md,
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.group,
    padding: SPACE.md,
  },
  askLabel: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    marginBottom: 4,
  },
  askText: {
    ...TYPE.body,
    color: COLOR.ink,
  },

  linkBlock: {
    marginTop: SPACE.md,
    gap: 6,
  },
  linkHint: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },

  sourceText: {
    ...TYPE.micro,
    color: COLOR.inkFaint,
    marginTop: SPACE.sm,
  },

  legend: {
    marginTop: SPACE.section,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    gap: 6,
  },
  legendTitle: {
    ...TYPE.label,
    color: COLOR.inkMuted,
  },
  legendRow: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },
  disclaimer: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginTop: SPACE.lg,
  },
});
