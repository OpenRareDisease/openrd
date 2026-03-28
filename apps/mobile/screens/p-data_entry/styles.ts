import { Platform, StyleSheet } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

const cardShadow =
  Platform.select({
    ios: {
      shadowColor: '#182B36',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
    },
    android: {
      elevation: 7,
    },
    default: {},
  }) ?? {};

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  backgroundGradient: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  eyebrow: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    letterSpacing: 1.4,
  },
  pageTitle: {
    marginTop: 2,
    color: CLINICAL_COLORS.text,
    fontSize: 20,
    fontWeight: '800',
  },
  heroCard: {
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.accentBorder,
    backgroundColor: CLINICAL_COLORS.panel,
    ...cardShadow,
  },
  heroTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 25,
    lineHeight: 33,
    fontWeight: '800',
  },
  heroDescription: {
    marginTop: 10,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 14,
    lineHeight: 21,
  },
  heroMetaRow: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
  },
  heroMetaCard: {
    flex: 1,
    minHeight: 92,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(248, 242, 234, 0.78)',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  heroMetaValue: {
    color: CLINICAL_COLORS.text,
    fontSize: 18,
    fontWeight: '800',
  },
  heroMetaLabel: {
    marginTop: 8,
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
  },
  modeGrid: {
    marginTop: 22,
    marginHorizontal: 20,
    gap: 12,
  },
  modeCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    gap: 10,
    ...cardShadow,
  },
  modeCardActive: {
    borderColor: CLINICAL_TINTS.accentBorder,
    backgroundColor: CLINICAL_TINTS.accentSurface,
  },
  modeTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 17,
    fontWeight: '800',
  },
  modeDescription: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  formStack: {
    marginTop: 22,
    marginHorizontal: 20,
    gap: 14,
  },
  sectionCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...cardShadow,
  },
  sectionTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 18,
    fontWeight: '800',
  },
  sectionSubtitle: {
    marginTop: 8,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  fieldBlock: {
    marginTop: 16,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  fieldLabel: {
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  fieldHint: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
  },
  input: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: CLINICAL_COLORS.background,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    color: CLINICAL_COLORS.text,
    fontSize: 14,
  },
  textarea: {
    minHeight: 108,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  rowItem: {
    flex: 1,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  choiceChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: CLINICAL_COLORS.background,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  choiceChipActive: {
    backgroundColor: CLINICAL_TINTS.accentSoft,
    borderColor: CLINICAL_TINTS.accentBorder,
  },
  choiceChipText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  choiceChipTextActive: {
    color: CLINICAL_COLORS.text,
  },
  scoreBlock: {
    marginTop: 16,
  },
  scoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  scoreChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLINICAL_COLORS.background,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  scoreChipActive: {
    backgroundColor: CLINICAL_COLORS.accentStrong,
    borderColor: CLINICAL_COLORS.accentStrong,
  },
  scoreChipText: {
    color: CLINICAL_COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  scoreChipTextActive: {
    color: '#FFFFFF',
  },
  uploadButton: {
    marginTop: 16,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: CLINICAL_TINTS.accentSoft,
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.accentBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  uploadButtonText: {
    flex: 1,
    color: CLINICAL_COLORS.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  submitButton: {
    marginTop: 6,
    minHeight: 56,
    borderRadius: 20,
    backgroundColor: CLINICAL_COLORS.accentStrong,
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(248, 242, 234, 0.76)',
  },
  loadingText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    fontWeight: '600',
  },
});
