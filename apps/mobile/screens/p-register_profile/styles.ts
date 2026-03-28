import { StyleSheet, Platform } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  backgroundGradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CLINICAL_COLORS.panel,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
  headerPlaceholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  loadingContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackBanner: {
    marginHorizontal: 24,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  feedbackError: {
    backgroundColor: CLINICAL_TINTS.dangerSurface,
    borderColor: CLINICAL_TINTS.dangerBorder,
  },
  feedbackSuccess: {
    backgroundColor: CLINICAL_TINTS.successSurface,
    borderColor: CLINICAL_TINTS.successBorder,
  },
  feedbackText: {
    color: CLINICAL_COLORS.text,
    fontSize: 13,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
    marginBottom: 12,
  },
  card: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
      },
      android: { elevation: 6 },
    }),
  },
  inputLabel: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.borderStrong,
    backgroundColor: CLINICAL_TINTS.panel,
  },
  optionButtonActive: {
    borderColor: CLINICAL_COLORS.accent,
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  optionText: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
  },
  optionTextActive: {
    color: CLINICAL_COLORS.text,
    fontWeight: '600',
  },
  primaryButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
});
