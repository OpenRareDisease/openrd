import { StyleSheet, Platform } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  scrollView: {
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
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
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
  pageTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
  headerSpacer: {
    width: 40,
  },
  donationIntroSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  introCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
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
  donationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  introTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: CLINICAL_COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  introDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    textAlign: 'center',
    lineHeight: 18,
  },
  donationProcessSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 8,
  },
  processSteps: {
    gap: 8,
  },
  processStep: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
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
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  stepNumberPrimary: {
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  stepNumberSecondary: {
    backgroundColor: CLINICAL_TINTS.successSoft,
  },
  stepNumberAccent: {
    backgroundColor: CLINICAL_TINTS.accentStrong,
  },
  stepNumberTextPrimary: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.accent,
  },
  stepNumberTextSecondary: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.success,
  },
  stepNumberTextAccent: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.accentStrong,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
    marginBottom: 2,
  },
  stepDescription: {
    fontSize: 10,
    color: CLINICAL_COLORS.textSoft,
  },
  privacyProtectionSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  privacyCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 12,
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
  privacyFeatures: {
    gap: 8,
  },
  privacyItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  privacyIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  privacyIconGreen: {
    backgroundColor: CLINICAL_TINTS.successSoft,
  },
  privacyIconBlue: {
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  privacyIconPurple: {
    backgroundColor: CLINICAL_TINTS.accentStrong,
  },
  privacyIconYellow: {
    backgroundColor: CLINICAL_TINTS.warningSoft,
  },
  privacyText: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    flex: 1,
  },
  donationToggleSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  toggleCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 12,
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
  toggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
  },
  toggleSwitch: {
    width: 48,
    height: 24,
    borderRadius: 12,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleSwitchActive: {
    backgroundColor: CLINICAL_COLORS.accent,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: CLINICAL_COLORS.text,
    alignSelf: 'flex-start',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  toggleThumbActive: {
    alignSelf: 'flex-end',
  },
  donationStatusSection: {
    marginHorizontal: 24,
    marginBottom: 32,
  },
  notDonatingCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
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
  notDonatingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  notDonatingTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  notDonatingDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 16,
  },
  enableDonationButton: {
    backgroundColor: CLINICAL_COLORS.accent,
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 8,
  },
  enableDonationButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },
  donatingCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
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
  progressRingContainer: {
    position: 'relative',
    width: 40,
    height: 40,
    marginBottom: 8,
  },
  progressRing: {
    position: 'absolute',
  },
  progressRingIcon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donatingTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  donatingDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    textAlign: 'center',
    marginBottom: 4,
  },
  lastDonationTime: {
    fontSize: 10,
    color: CLINICAL_COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 12,
  },
  donationStats: {
    flexDirection: 'row',
    gap: 48,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: CLINICAL_COLORS.accent,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: CLINICAL_COLORS.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: CLINICAL_TINTS.modalOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 24,
    width: '100%',
    maxWidth: 320,
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
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    lineHeight: 18,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: CLINICAL_COLORS.textSoft,
  },
  modalConfirmButton: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.accent,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalConfirmButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },
  successToast: {
    position: 'absolute',
    top: 80,
    left: '50%',
    transform: [{ translateX: -75 }],
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  successToastText: {
    fontSize: 12,
    color: CLINICAL_COLORS.text,
  },
});
