import { StyleSheet, Dimensions, Platform } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

const { width } = Dimensions.get('window');

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  backgroundGradient: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },

  // Header styles
  header: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  headerTopRow: {
    width: '100%',
    marginBottom: 24,
    alignItems: 'flex-start',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoWrapper: {
    marginBottom: 16,
  },
  logoCard: {
    width: 64,
    height: 64,
    borderRadius: 16,
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
  logoIcon: {
    color: CLINICAL_COLORS.accent,
  },
  appName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: CLINICAL_COLORS.accent,
    marginBottom: 8,
  },
  appSlogan: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
  },

  // Main content styles
  mainContent: {
    flex: 1,
  },

  // Tab switcher styles
  tabSwitcher: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  tabButtonLeft: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    borderRightWidth: 0,
  },
  tabButtonRight: {
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    borderLeftWidth: 0,
  },
  tabButtonActive: {
    backgroundColor: CLINICAL_COLORS.accent,
    borderColor: CLINICAL_COLORS.accent,
  },
  tabButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.textSoft,
  },
  tabButtonTextActive: {
    color: CLINICAL_COLORS.text,
  },

  // Form styles
  formContainer: {
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
  },
  registerSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 12,
    marginTop: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.textSoft,
    marginBottom: 8,
  },
  fieldHintText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: CLINICAL_COLORS.textMuted,
  },
  textInput: {
    width: '100%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    color: CLINICAL_COLORS.text,
    fontSize: 16,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pickerColumn: {
    flex: 1,
  },
  pickerWrapper: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    overflow: 'hidden',
  },
  picker: {
    width: '100%',
    color: CLINICAL_COLORS.text,
    backgroundColor: CLINICAL_COLORS.panel,
  },

  identityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  identityButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLINICAL_COLORS.panel,
  },
  identityButtonActive: {
    borderColor: CLINICAL_COLORS.accent,
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  identityButtonText: {
    fontSize: 13,
    color: CLINICAL_COLORS.textSoft,
  },
  identityButtonTextActive: {
    color: CLINICAL_COLORS.text,
    fontWeight: '600',
  },

  // Password input styles
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    borderRadius: 8,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: CLINICAL_COLORS.text,
    fontSize: 16,
  },
  passwordToggleButton: {
    paddingHorizontal: 12,
  },

  // Verification code styles
  verificationCodeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  verificationCodeInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    color: CLINICAL_COLORS.text,
    fontSize: 16,
  },
  getCodeButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.accent,
  },
  getCodeButtonDisabled: {
    borderColor: CLINICAL_TINTS.accentBorder,
  },
  getCodeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.accent,
  },

  // Primary button styles
  primaryButton: {
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonGradient: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },

  // Forgot password styles
  forgotPasswordContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  forgotPasswordText: {
    fontSize: 14,
    color: CLINICAL_COLORS.accent,
  },

  // Divider styles
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: CLINICAL_COLORS.border,
  },
  dividerText: {
    paddingHorizontal: 16,
    fontSize: 14,
    color: CLINICAL_COLORS.textMuted,
  },

  // Third party login styles
  thirdPartyLogin: {
    gap: 12,
    marginBottom: 32,
  },
  thirdPartyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    gap: 12,
  },
  thirdPartyButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },

  // Agreement styles
  agreement: {
    alignItems: 'center',
    marginBottom: 32,
  },
  agreementText: {
    fontSize: 14,
    color: CLINICAL_COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  agreementLink: {
    color: CLINICAL_COLORS.accent,
  },

  // Modal styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: CLINICAL_TINTS.modalOverlay,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContainer: {
    marginHorizontal: 24,
    maxWidth: width - 48,
    width: '100%',
  },
  modalContent: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    alignItems: 'center',
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
    marginBottom: 12,
  },
  errorIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CLINICAL_TINTS.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CLINICAL_TINTS.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  modalButton: {
    width: '100%',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },

  // Agreement modal styles
  agreementModalContent: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    maxHeight: 384,
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
  agreementModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  agreementModalTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },
  agreementModalScrollView: {
    maxHeight: 320,
  },
  agreementModalText: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
    lineHeight: 22,
  },
});
