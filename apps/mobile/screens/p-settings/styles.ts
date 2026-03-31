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
  scrollContent: {
    paddingBottom: 80,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerRow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleSection: {
    alignItems: 'center',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: CLINICAL_COLORS.accent,
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
    textAlign: 'center',
  },
  userInfoSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  userInfoCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 12,
    padding: 16,
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
  userProfileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 12,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 4,
  },
  userId: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
    marginBottom: 2,
  },
  userJoinDate: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
  editProfileButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CLINICAL_TINTS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsListSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  settingsList: {
    gap: 8,
  },
  settingItem: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 16,
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
  settingItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  blueIconContainer: {
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  greenIconContainer: {
    backgroundColor: CLINICAL_TINTS.successSoft,
  },
  purpleIconContainer: {
    backgroundColor: CLINICAL_TINTS.accentStrong,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
  },
  logoutItem: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
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
  logoutItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.danger,
  },
  versionInfoSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  versionInfo: {
    alignItems: 'center',
  },
  versionText: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
    marginBottom: 4,
  },
  copyrightText: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: CLINICAL_TINTS.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 320,
  },
  modalContent: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 12,
    padding: 24,
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
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: CLINICAL_TINTS.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
    marginBottom: 24,
    textAlign: 'center',
  },
  modalButtonContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.panel,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.textSoft,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.danger,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },
});
