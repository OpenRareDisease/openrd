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
