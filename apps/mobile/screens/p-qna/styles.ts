import { Platform, StyleSheet } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

const cardShadow =
  Platform.select({
    ios: {
      shadowColor: '#182B36',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
    },
    android: {
      elevation: 5,
    },
    default: {},
  }) ?? {};

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  eyebrow: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  pageTitle: {
    marginTop: 4,
    color: CLINICAL_COLORS.text,
    fontSize: 24,
    fontWeight: '800',
  },
  pageSubtitle: {
    marginTop: 8,
    maxWidth: 240,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  headerAction: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  headerActionText: {
    color: CLINICAL_COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  memoryBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.accentBorder,
    ...cardShadow,
  },
  memoryIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  memoryContent: {
    flex: 1,
  },
  memoryTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  memoryText: {
    marginTop: 6,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 14,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarAssistant: {
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  avatarError: {
    backgroundColor: CLINICAL_TINTS.warningSoft,
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    ...cardShadow,
  },
  messageBubbleAssistant: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderColor: CLINICAL_COLORS.border,
    borderBottomLeftRadius: 8,
  },
  messageBubbleUser: {
    backgroundColor: CLINICAL_COLORS.accentStrong,
    borderColor: CLINICAL_COLORS.accentStrong,
    borderBottomRightRadius: 8,
  },
  messageBubbleError: {
    backgroundColor: CLINICAL_TINTS.warningSurface,
    borderColor: CLINICAL_TINTS.warningBorder,
  },
  messageAuthor: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 21,
  },
  messageTextAssistant: {
    color: CLINICAL_COLORS.text,
  },
  messageTextUser: {
    color: '#FFFFFF',
  },
  messageMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  messageTime: {
    color: CLINICAL_TINTS.textFaint,
    fontSize: 11,
  },
  messageStateText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  progressCard: {
    marginTop: 4,
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(248, 242, 234, 0.8)',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  progressTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  progressStatus: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
  },
  progressBar: {
    marginTop: 10,
    height: 6,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.panelStrong,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: CLINICAL_COLORS.accentStrong,
  },
  progressStages: {
    marginTop: 12,
    gap: 8,
  },
  progressStageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressStageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: CLINICAL_TINTS.disabledTrack,
  },
  progressStageDotActive: {
    backgroundColor: CLINICAL_COLORS.accentStrong,
  },
  progressStageDotDone: {
    backgroundColor: CLINICAL_COLORS.success,
  },
  progressStageDotError: {
    backgroundColor: CLINICAL_COLORS.warning,
  },
  progressStageText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
  },
  progressStageTextActive: {
    color: CLINICAL_COLORS.text,
  },
  progressStageTextDone: {
    color: CLINICAL_COLORS.text,
  },
  progressStageTextError: {
    color: CLINICAL_COLORS.warning,
  },
  composerShell: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: CLINICAL_TINTS.surfaceOverlay,
    borderTopWidth: 1,
    borderTopColor: CLINICAL_COLORS.border,
  },
  composerCard: {
    minHeight: 66,
    borderRadius: 24,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    paddingLeft: 16,
    paddingRight: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    ...cardShadow,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    lineHeight: 21,
    paddingTop: 4,
    paddingBottom: 4,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLINICAL_COLORS.accentStrong,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  composerHint: {
    marginTop: 10,
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
