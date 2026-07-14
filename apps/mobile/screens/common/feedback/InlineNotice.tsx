import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../../lib/clinical-visuals';

/**
 * The one way screens surface a recoverable problem.
 *
 * Feedback conventions for this app (the "three-way split"):
 * - recoverable errors / warnings → THIS component, rendered inline
 *   near the thing that failed, with an optional retry action;
 * - success or destructive flows that need a user CHOICE (continue /
 *   navigate / confirm delete) → the system Alert;
 * - blocking validation popups → banned; validation renders inline
 *   next to its field (see lib/validation.ts patterns).
 *
 * Kept deliberately large-type and high-contrast: FSHD users may have
 * limited fine motor control, so the retry target is a full-width row
 * rather than a small link.
 */
interface InlineNoticeProps {
  message: string;
  /** Renders a full-width retry row when provided. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Disables the retry row (e.g. while the retry is in flight). */
  retryDisabled?: boolean;
}

const InlineNotice = ({
  message,
  onRetry,
  retryLabel = '重试',
  retryDisabled = false,
}: InlineNoticeProps) => (
  <View style={noticeStyles.container}>
    <View style={noticeStyles.messageRow}>
      <FontAwesome6 name="circle-exclamation" size={14} color={CLINICAL_COLORS.warning} />
      <Text style={noticeStyles.messageText}>{message}</Text>
    </View>
    {onRetry ? (
      <TouchableOpacity
        style={[noticeStyles.retryButton, retryDisabled && noticeStyles.retryButtonDisabled]}
        activeOpacity={0.85}
        disabled={retryDisabled}
        onPress={onRetry}
      >
        <FontAwesome6 name="rotate-right" size={12} color={CLINICAL_COLORS.accentStrong} />
        <Text style={noticeStyles.retryText}>{retryLabel}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const noticeStyles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.warningBorder,
    backgroundColor: CLINICAL_TINTS.warningSurface,
    padding: 12,
    gap: 10,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageText: {
    flex: 1,
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.accent,
    backgroundColor: CLINICAL_COLORS.panel,
  },
  retryButtonDisabled: {
    opacity: 0.5,
  },
  retryText: {
    color: CLINICAL_COLORS.accentStrong,
    fontSize: 13,
    fontWeight: '700',
  },
});

export default InlineNotice;
