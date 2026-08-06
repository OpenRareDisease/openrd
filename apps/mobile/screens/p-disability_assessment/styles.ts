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
    marginBottom: SPACE.md,
  },
  /* The provenance strip. Not a footnote: a stale entitlement claim is
     the failure mode of this whole page, so the date it was last
     checked sits above the content rather than under it. */
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
  // A rule rather than a dot — several of these run to four lines, and
  // a bullet leaves the runover floating unattached on a narrow screen.
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

  /* ---- the pulled-out functional clauses ---- */
  highlightCard: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  highlightTitle: {
    ...TYPE.title,
    marginBottom: 6,
  },
  highlightLede: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.md,
  },
  highlightRow: {
    marginBottom: SPACE.md,
  },
  highlightGrade: {
    ...TYPE.label,
    color: COLOR.accent,
    marginBottom: 2,
  },
  highlightClause: {
    ...TYPE.bodyStrong,
  },

  /* ---- verbatim grade blocks ---- */
  gradeBlock: {
    marginBottom: SPACE.lg,
  },
  gradeHeading: {
    ...TYPE.heading,
    marginBottom: 2,
  },
  gradeClause: {
    ...TYPE.caption,
    marginBottom: 6,
  },
  gradeHeadline: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: 8,
  },
  gradeItem: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  gradeMarker: {
    ...TYPE.body,
    color: COLOR.inkFaint,
    width: 26,
  },
  gradeItemText: {
    ...TYPE.body,
    flex: 1,
  },
  // The functional clause, in ink rather than inkSoft and against an
  // accent rule. It is the same verbatim text as its neighbours; only
  // its position in the list made it invisible.
  gradeItemFunctional: {
    ...TYPE.bodyStrong,
    flex: 1,
  },
  gradeItemFunctionalWrap: {
    borderLeftWidth: 2,
    borderLeftColor: COLOR.accent,
    paddingLeft: 8,
    marginLeft: -10,
  },

  /* ---- ADL ---- */
  adlIntro: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.md,
  },
  adlItem: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.md,
  },
  adlLabel: {
    ...TYPE.heading,
    marginBottom: 4,
  },
  adlPrompt: {
    ...TYPE.caption,
    marginBottom: 2,
  },
  adlChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
  },
  adlChoice: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  adlChoiceSelected: {
    backgroundColor: COLOR.accentWash,
    borderColor: COLOR.accent,
  },
  adlChoiceText: {
    ...TYPE.label,
  },
  adlChoiceTextSelected: {
    color: COLOR.accent,
  },

  tallyBlock: {
    marginTop: SPACE.sm,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  tallyRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACE.sm,
    marginBottom: 6,
  },
  tallyValue: {
    ...TYPE.metricSmall,
  },
  tallyLabel: {
    ...TYPE.caption,
  },
  // The sentence that stops the number reading as a result. It is not
  // small print — it is the same size as the number's own label and
  // sits directly beneath it.
  tallyDisclaimer: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginTop: 4,
  },

  narrativeBlock: {
    marginTop: SPACE.md,
    padding: SPACE.md,
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
  },
  narrativeHint: {
    ...TYPE.caption,
    marginBottom: SPACE.sm,
  },
  narrativeLine: {
    ...TYPE.body,
    color: COLOR.ink,
    marginBottom: 2,
  },

  /* ---- materials ---- */
  materialItem: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.md,
  },
  materialHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginBottom: 2,
  },
  materialLabel: {
    ...TYPE.heading,
    flexShrink: 1,
  },
  materialTag: {
    ...TYPE.micro,
    letterSpacing: 0.2,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  materialTagRequired: {
    color: COLOR.accent,
    backgroundColor: COLOR.accentWash,
  },
  materialTagSuggested: {
    color: COLOR.inkMuted,
    backgroundColor: COLOR.well,
  },
  materialDetail: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  disclaimer: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginTop: SPACE.sm,
    marginBottom: SPACE.section,
  },
});
