import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, MOTION } from '../../lib/design';

/**
 * The app's switch.
 *
 * Lives in common/ because there were two hand-rolled copies of it —
 * 隐私设置 and 数据捐赠 — with the same three defects, which is what a
 * copied control always ends up meaning.
 *
 * These are the highest-stakes controls in the app — they decide
 * whether a cloud LLM may read a patient's records at all — and they
 * had three problems at once:
 *
 *  - **No accessibilityRole, label or state.** A screen reader reached
 *    seven unnamed, unreadable controls. There was no way to know a
 *    switch was there, what it governed, or whether it was on. The
 *    label lives in the row beside the switch, so it has to be passed
 *    in; the switch cannot read its own name off the screen.
 *  - **24pt tall with no hitSlop** — half the 48pt minimum, on a screen
 *    whose users include people with reduced hand strength and grip.
 *  - **The thumb snapped** from one end to the other via `alignSelf`.
 *    An iOS switch slides, and the slide is what makes the two ends
 *    read as one thing in two states rather than two separate marks.
 *
 * Track and thumb keep their 44×24 drawn size — the size is right, the
 * target was not — and the finger gets MIN_TOUCH_TARGET via hitSlop.
 */

interface ToggleSwitchProps {
  isEnabled: boolean;
  onToggle: (newState: boolean) => void;
  /** When true, the switch renders dimmed and ignores presses. Used
   *  by Phase 3a for the precise-values toggle when the base pair
   *  is not yet granted. */
  disabled?: boolean;
  /** What this switch governs, e.g.「个人数据用于 AI」. Spoken in place
   *  of the label text, which sits in the row and not in here. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 24;
const THUMB = 20;
const INSET = 2;
/** Distance the thumb travels between off and on. */
const TRAVEL = TRACK_WIDTH - THUMB - INSET * 2;
const SLOP_Y = Math.round((MIN_TOUCH_TARGET - TRACK_HEIGHT) / 2);

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  isEnabled,
  onToggle,
  disabled,
  accessibilityLabel,
  accessibilityHint,
}) => {
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(isEnabled ? TRAVEL : 0, MOTION.move) }],
  }));

  return (
    <Pressable
      style={[styles.track, isEnabled ? styles.trackOn : null, disabled ? styles.disabled : null]}
      onPress={() => {
        if (!disabled) onToggle(!isEnabled);
      }}
      // The switch is drawn switch-sized; the target is finger-sized.
      hitSlop={{ top: SLOP_Y, bottom: SLOP_Y, left: INSET, right: INSET }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      // Both spellings on purpose. `accessibilityState` is the native
      // API, but react-native-web 0.20 drops it — the rendered element
      // carried role="switch" and a name with no aria-checked at all,
      // so the switch announced itself without announcing whether it
      // was on. The aria-* props are first-class in RN 0.71+ and map
      // back to accessibilityState on device, so this is correct on
      // both and not a web-only patch.
      accessibilityState={{ checked: isEnabled, disabled: Boolean(disabled) }}
      aria-checked={isEnabled}
      aria-disabled={Boolean(disabled)}
    >
      <Animated.View style={[styles.thumb, thumbStyle]} />
    </Pressable>
  );
};

export default ToggleSwitch;

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: COLOR.well,
    justifyContent: 'center',
    paddingHorizontal: INSET,
  },
  trackOn: {
    backgroundColor: COLOR.accent,
  },
  disabled: {
    opacity: 0.4,
  },
  /** White, not ink. On the accent-filled track a near-black thumb
   *  read as a hole punched through the switch rather than as the
   *  thing that moves. */
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: COLOR.surface,
    shadowColor: COLOR.ink,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
});
