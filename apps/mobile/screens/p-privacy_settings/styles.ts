import { StyleSheet, Platform } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: CLINICAL_COLORS.backgroundRaised,
    borderBottomWidth: 1,
    borderBottomColor: CLINICAL_COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
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
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
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
  settingContent: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    lineHeight: 16,
  },
  donationInfoCard: {
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
  donationInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  donationInfoTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailsButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: CLINICAL_COLORS.accent,
    marginRight: 4,
  },
  donationStatus: {
    gap: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLabel: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
  },
  statusValue: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
  privacyNoticeCard: {
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
  privacyNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  privacyIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CLINICAL_TINTS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  privacyNoticeContent: {
    flex: 1,
  },
  privacyNoticeTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: CLINICAL_COLORS.text,
    marginBottom: 8,
  },
  privacyNoticeList: {
    gap: 4,
  },
  privacyNoticeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletPoint: {
    fontSize: 12,
    color: CLINICAL_COLORS.accent,
    marginRight: 8,
    marginTop: 2,
  },
  privacyNoticeText: {
    flex: 1,
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    lineHeight: 16,
  },
});
