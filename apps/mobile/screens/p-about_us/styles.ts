import { StyleSheet, Platform } from 'react-native';
import { COLOR } from '../../lib/design';

export default StyleSheet.create({
  container: {
    flex: 1,
    // Flat paper, like every screen you can reach from 我的. This was
    // the sand gradient from the old palette, so the one static page
    // in the app announced itself as a different app one tap away.
    backgroundColor: COLOR.paper,
  },
  safeArea: {
    flex: 1,
  },
  // The header row, its title and its 40x40 back disc are gone:
  // ScreenHeader renders all three, and its control is
  // MIN_TOUCH_TARGET rather than the 40pt this file hard-coded.
  scrollView: {
    flex: 1,
    paddingHorizontal: 24,
  },
  appInfoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  appLogo: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: COLOR.well,
    borderWidth: 1,
    borderColor: COLOR.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: COLOR.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLOR.accent,
    marginBottom: 8,
  },
  appVersion: {
    fontSize: 14,
    color: COLOR.inkMuted,
    marginBottom: 16,
  },
  appTaglineContainer: {
    backgroundColor: COLOR.well,
    borderWidth: 1,
    borderColor: COLOR.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    ...Platform.select({
      ios: {
        shadowColor: COLOR.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  appTagline: {
    fontSize: 14,
    color: COLOR.inkSoft,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLOR.ink,
    marginBottom: 12,
  },
  introContent: {
    backgroundColor: COLOR.well,
    borderWidth: 1,
    borderColor: COLOR.line,
    borderRadius: 8,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: COLOR.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  introText: {
    fontSize: 14,
    color: COLOR.inkSoft,
    lineHeight: 20,
  },
  featuresContainer: {
    gap: 12,
  },
  featureItem: {
    backgroundColor: COLOR.well,
    borderWidth: 1,
    borderColor: COLOR.line,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: COLOR.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  featureIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureTextContainer: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: COLOR.ink,
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: 12,
    color: COLOR.inkMuted,
  },
  copyrightSection: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 24,
  },
  copyrightText: {
    fontSize: 12,
    color: COLOR.inkMuted,
    textAlign: 'center',
  },
  copyrightSubText: {
    fontSize: 12,
    color: COLOR.inkMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLOR.scrim,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    justifyContent: 'flex-end',
    minHeight: '100%',
  },
  modalContent: {
    backgroundColor: COLOR.well,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: COLOR.line,
    maxHeight: '80%',
    ...Platform.select({
      ios: {
        shadowColor: COLOR.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.line,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLOR.ink,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLOR.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrollView: {
    maxHeight: 320,
  },
  modalTextContainer: {
    padding: 16,
  },
  modalSection: {
    marginBottom: 16,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: COLOR.ink,
    marginBottom: 8,
  },
  modalSectionText: {
    fontSize: 14,
    color: COLOR.inkSoft,
    lineHeight: 20,
  },
});
