import { StyleSheet } from 'react-native';
import { COLOR, HAIRLINE, RADIUS, SPACE, TYPE } from '../../lib/design';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';

/**
 * 康复：辅具与运动.
 *
 * What this replaces
 * ------------------
 * The previous stylesheet here described a video-sharing screen — a
 * player, a poster frame, an upload modal, a progress bar, a success
 * toast — for a screen whose index.tsx has always rendered
 * `UnavailableScreen`. None of it was ever on a patient's phone. It is
 * replaced rather than extended because the page this screen now is (two
 * reading-and-answering flows built out of the corpus) shares no element
 * with it, and the old palette (#0F0F23 on rgba white) predates
 * lib/design.ts entirely.
 *
 * Everything below is the same vocabulary as 残疾评定准备 and 我的随访
 * 计划: hairlines, one accented block, sources under every claim.
 */
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

  segmented: {
    marginBottom: SPACE.lg,
  },

  intro: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.md,
  },

  /* The provenance strip. Same placement decision as 残疾评定: the
     failure mode of this page is a stale or unsourced claim, so the
     date sits above the content. */
  provenance: {
    borderLeftWidth: 2,
    borderLeftColor: COLOR.accentLine,
    paddingLeft: SPACE.md,
    marginBottom: SPACE.lg,
  },
  provenanceDate: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    marginBottom: 4,
  },
  provenanceNote: {
    ...TYPE.caption,
    marginBottom: SPACE.sm,
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

  /* The one accented block per tab: the caveat that has to be read
     before the content it qualifies. */
  caveatCard: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  caveatTitle: {
    ...TYPE.title,
    marginBottom: 6,
  },
  caveatBody: {
    ...TYPE.bodyStrong,
    marginBottom: SPACE.sm,
  },

  /* ---- questions ---- */
  question: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.lg,
  },
  questionTitle: {
    ...TYPE.heading,
    marginBottom: 2,
  },
  questionPrompt: {
    ...TYPE.bodyStrong,
    marginBottom: 6,
  },
  questionWhy: {
    ...TYPE.caption,
    marginBottom: SPACE.sm,
  },
  questionHint: {
    ...TYPE.caption,
    color: COLOR.inkFaint,
    marginBottom: SPACE.sm,
  },
  choices: {
    gap: SPACE.sm,
  },
  // Stacked full-width rather than wrapped pills: several of these
  // labels run to two lines of Chinese, and lib/a11y.ts's first rule is
  // that a target never shrinks to fit a row.
  choice: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  choiceSelected: {
    backgroundColor: COLOR.accentWash,
    borderColor: COLOR.accent,
  },
  choiceLabel: {
    ...TYPE.bodyStrong,
  },
  choiceLabelSelected: {
    color: COLOR.accent,
  },
  choiceDetail: {
    ...TYPE.caption,
    marginTop: 4,
  },

  /* ---- the plan ---- */
  planProgress: {
    ...TYPE.caption,
    marginBottom: SPACE.md,
  },
  trackHeading: {
    ...TYPE.micro,
    marginTop: SPACE.md,
    marginBottom: SPACE.sm,
  },
  item: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.md,
  },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginBottom: 4,
  },
  itemTitle: {
    ...TYPE.heading,
    flexShrink: 1,
  },
  kindTag: {
    ...TYPE.micro,
    letterSpacing: 0.2,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  kindTagDevice: {
    color: COLOR.accent,
    backgroundColor: COLOR.accentWash,
  },
  kindTagNeutral: {
    color: COLOR.inkMuted,
    backgroundColor: COLOR.well,
  },
  kindTagWarn: {
    color: COLOR.warn,
    backgroundColor: COLOR.warnWash,
  },
  itemBecause: {
    ...TYPE.caption,
    marginBottom: 6,
  },
  itemBody: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: 8,
  },
  caution: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  cautionRule: {
    width: 2,
    borderRadius: 1,
    backgroundColor: COLOR.accentLine,
    marginRight: 10,
  },
  cautionText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    flex: 1,
  },

  /* ---- the two standing rules ---- */
  ruleBlock: {
    marginBottom: SPACE.md,
  },
  ruleTitle: {
    ...TYPE.heading,
    color: COLOR.accent,
    marginBottom: 2,
  },
  ruleBody: {
    ...TYPE.bodyStrong,
  },

  /* ---- referral ---- */
  clinician: {
    paddingTop: SPACE.sm,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.sm,
  },
  clinicianName: {
    ...TYPE.heading,
  },
  clinicianWhere: {
    ...TYPE.caption,
  },

  /* ---- copyable narrative ---- */
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

  /* ---- exercise: facts ---- */
  fact: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.md,
  },
  factHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginBottom: 2,
  },
  factValue: {
    ...TYPE.metricSmall,
  },
  factLabel: {
    ...TYPE.label,
  },
  factDetail: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  /* The evidence tag. This is the load-bearing control on the exercise
     tab: it is what keeps「原研究实测」and「本页的替代做法」from being
     read in the same register. */
  evidenceTag: {
    ...TYPE.micro,
    letterSpacing: 0.2,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  evidenceTagTrial: {
    color: COLOR.good,
    backgroundColor: COLOR.goodWash,
  },
  evidenceTagGuideline: {
    color: COLOR.inkMuted,
    backgroundColor: COLOR.well,
  },
  evidenceTagSubstitute: {
    color: COLOR.warn,
    backgroundColor: COLOR.warnWash,
  },

  /* ---- exercise: bands, sessions, phases ---- */
  band: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.md,
  },
  bandHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACE.sm,
    marginBottom: 2,
  },
  bandRange: {
    ...TYPE.metricSmall,
  },
  bandLabel: {
    ...TYPE.heading,
  },
  bandLine: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  sessionMeta: {
    ...TYPE.caption,
    marginBottom: SPACE.sm,
  },
  subHeading: {
    ...TYPE.label,
    marginTop: SPACE.sm,
    marginBottom: 4,
  },

  phase: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.md,
  },
  phaseTitle: {
    ...TYPE.heading,
    marginBottom: 4,
  },
  phaseFocus: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: 6,
  },
  phaseTrialNote: {
    ...TYPE.caption,
  },

  remeasure: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    marginBottom: SPACE.md,
  },
  remeasureHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginBottom: 2,
  },
  remeasureLabel: {
    ...TYPE.heading,
  },
  remeasureEvery: {
    ...TYPE.micro,
    color: COLOR.accent,
    backgroundColor: COLOR.accentWash,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  remeasureWhy: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  linkBlock: {
    marginTop: SPACE.sm,
    alignItems: 'flex-start',
    gap: 6,
  },
  linkHint: {
    ...TYPE.caption,
  },

  disclaimer: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginTop: SPACE.sm,
    marginBottom: SPACE.section,
  },
});
