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

  sectionHeading: {
    ...TYPE.title,
    color: COLOR.ink,
    marginBottom: SPACE.sm,
  },
  sectionLede: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.md,
  },

  /* ---- one identity code ---- */
  code: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  codeTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    marginBottom: 6,
  },
  codeSystem: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    flexShrink: 1,
  },
  scopeChip: {
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  /* Only `us_only` gets the warn treatment. It is the one scope on this
     page that can send a patient to a counter with a code nobody there
     can look up, so it is the one that has to look different before it
     is read. */
  scopeChipWarning: {
    borderColor: COLOR.warn,
    backgroundColor: COLOR.warnWash,
  },
  scopeChipText: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },
  scopeChipTextWarning: {
    ...TYPE.caption,
    color: COLOR.warn,
    fontWeight: '600',
  },
  /* The quotable string is the product of this page. It is set at
     heading weight and is `selectable` at the render site, because the
     only way to get it off a phone in WeChat's in-app browser — no
     clipboard API in this app, no print dialog in that browser — is a
     long press on the text itself. */
  codeQuotable: {
    ...TYPE.heading,
    color: COLOR.ink,
    marginBottom: 4,
  },
  codeNames: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
    marginBottom: SPACE.sm,
  },
  codeUse: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginBottom: SPACE.sm,
  },
  codeCaveat: {
    ...TYPE.body,
    color: COLOR.ink,
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.control,
    padding: SPACE.md,
    marginBottom: SPACE.sm,
  },
  codeSourceRow: {
    marginTop: 2,
    paddingTop: 8,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  codeSource: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },

  /* ---- the honest gap ---- */
  gapBlock: {
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    padding: SPACE.lg,
    marginBottom: SPACE.section,
  },
  gapTitle: {
    ...TYPE.heading,
    marginBottom: 6,
  },
  gapText: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },

  /* ---- 转诊资料 ---- */
  packBlock: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.lg,
    marginBottom: SPACE.section,
    gap: SPACE.md,
  },
  packLede: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  /* A full-width bar, not a right-aligned pill. Reaching across a phone
     with a thumb is the movement this disease takes away first, so the
     one control on this block is as wide as the block and taller than
     the platform minimum. */
  packButton: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  packButtonDisabled: {
    backgroundColor: COLOR.accentSoft,
  },
  packButtonText: {
    ...TYPE.bodyStrong,
    color: COLOR.onAccent,
  },
  packError: {
    ...TYPE.body,
    color: COLOR.alert,
    backgroundColor: COLOR.alertWash,
    borderRadius: RADIUS.control,
    padding: SPACE.md,
  },
  packTitle: {
    ...TYPE.heading,
    color: COLOR.ink,
  },
  packMeta: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },
  /* The diagnosis sentence. Neutral when a genetic report backs it,
     warn-toned when nothing does — the sentence itself already says
     「请勿按已确诊处理」, and this is only so the reader sees which of
     the two it is before they have read it. */
  packDiagnosis: {
    ...TYPE.body,
    color: COLOR.ink,
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.control,
    padding: SPACE.md,
  },
  packDiagnosisUnconfirmed: {
    color: COLOR.warn,
    backgroundColor: COLOR.warnWash,
  },
  packSlot: {
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingTop: SPACE.md,
  },
  packSlotTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACE.sm,
    marginBottom: 4,
  },
  packSlotTitle: {
    ...TYPE.bodyStrong,
    color: COLOR.ink,
  },
  packSlotStatement: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  packSlotNote: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
    marginTop: 4,
  },
  /* Three states, three looks. `absent` deliberately does NOT get the
     alert treatment — 「本平台没有记录」 is a fact about this app, not
     about the patient, and colouring it red is how a missing upload
     starts reading as a missing test. */
  packStateChip: {
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  packStateChipUnreadable: {
    borderColor: COLOR.warn,
    backgroundColor: COLOR.warnWash,
  },
  packStateChipText: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },
  packStateChipTextUnreadable: {
    ...TYPE.caption,
    color: COLOR.warn,
    fontWeight: '600',
  },
  packDocument: {
    ...TYPE.body,
    color: COLOR.ink,
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.control,
    padding: SPACE.md,
  },

  /* ---- 我想问的问题 ---- */
  questionBlock: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: RADIUS.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.accentLine,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
    gap: SPACE.md,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.md,
    // The whole row is the target, not a checkbox glyph. Sustained grip
    // and pointing accuracy are what this disease takes away first.
    minHeight: MIN_TOUCH_TARGET,
  },
  questionRowSelected: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.surfaceAccent,
  },
  questionMark: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLOR.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACE.md,
    marginTop: 2,
  },
  questionMarkSelected: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  questionMarkGlyph: {
    ...TYPE.caption,
    color: COLOR.surface,
    fontWeight: '700',
  },
  questionBody: {
    flex: 1,
  },
  questionPrompt: {
    ...TYPE.body,
    color: COLOR.ink,
    marginBottom: 4,
  },
  questionHint: {
    ...TYPE.caption,
    color: COLOR.inkSoft,
    marginBottom: 4,
  },
  questionSource: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },

  noteLabel: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    marginBottom: 6,
  },
  noteInput: {
    ...TYPE.body,
    color: COLOR.ink,
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.md,
    minHeight: 96,
    textAlignVertical: 'top',
  },

  sheetBlock: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.md,
  },
  sheetHint: {
    ...TYPE.caption,
    marginBottom: SPACE.sm,
  },
  sheetText: {
    ...TYPE.body,
    color: COLOR.ink,
  },

  disclaimer: {
    ...TYPE.body,
    color: COLOR.inkSoft,
    marginTop: SPACE.sm,
    marginBottom: SPACE.section,
  },
});
