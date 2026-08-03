import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { COLOR, HAIRLINE, INTERACTION, RADIUS, SPACE, TYPE } from '../../../lib/design';

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
      <Icon name="circle-exclamation" size={14} color={COLOR.warn} />
      <Text style={noticeStyles.messageText}>{message}</Text>
    </View>
    {onRetry ? (
      <TouchableOpacity
        style={[noticeStyles.retryButton, retryDisabled && noticeStyles.retryButtonDisabled]}
        activeOpacity={INTERACTION.pressOpacity}
        disabled={retryDisabled}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        accessibilityState={{ disabled: Boolean(retryDisabled) }}
        aria-disabled={Boolean(retryDisabled)}
        onPress={onRetry}
      >
        <Icon name="rotate-right" size={12} color={COLOR.accent} />
        <Text style={noticeStyles.retryText}>{retryLabel}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const noticeStyles = StyleSheet.create({
  container: {
    // Was a fully bordered 14pt-radius amber card. This component lands
    // *inside* other content, so a boxed-in box was the main source of
    // card-in-card on the entry and report screens. Now the alert reads
    // as a marked passage: a 2pt semantic bar and the faintest wash,
    // with no ring around it. It still stops the eye — the stripe is a
    // solid warn, where the old border was warn at 34% — but it stops
    // competing with whatever card it was dropped into.
    borderLeftWidth: 2,
    borderLeftColor: COLOR.warn,
    backgroundColor: COLOR.warnWash,
    borderTopRightRadius: RADIUS.control,
    borderBottomRightRadius: RADIUS.control,
    paddingVertical: SPACE.md,
    paddingLeft: SPACE.md,
    paddingRight: SPACE.md,
    gap: SPACE.md,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
  },
  messageText: {
    flex: 1,
    // Full ink, not inkSoft: this is the sentence the patient has to
    // act on. The header comment's "large-type, high-contrast" promise
    // was already the intent; the token just makes it explicit.
    ...TYPE.bodyStrong,
    fontSize: 14,
    lineHeight: 21,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    // Was 42, i.e. under the floor lib/a11y.ts sets — and this is a
    // control aimed at users with limited fine motor control. Raised,
    // never to be lowered.
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    // Hairline + white, so the button reads as a control lifted off
    // the wash rather than as a second tinted panel.
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  retryButtonDisabled: {
    opacity: 0.5,
  },
  retryText: {
    ...TYPE.label,
    color: COLOR.accent,
  },
});

export default InlineNotice;
