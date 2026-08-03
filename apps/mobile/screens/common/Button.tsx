import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Icon from './Icon';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, INTERACTION, MOTION, RADIUS, SPACE, TYPE } from '../../lib/design';

/**
 * The app's buttons.
 *
 * Why this exists
 * ---------------
 * The tested complaint was「用户可互动的按钮更明确，现在很多都是文字可
 * 以直接点，人 apple 的操作系统会这样吗」— and the answer is no. iOS
 * uses bare tappable text in exactly two places: a navigation bar and
 * inside a list row. Everywhere else an action wears a shape, because
 * the shape is what says "this is a control" before you read the words.
 *
 * This app had bare tappable text everywhere — 「查看全部」, 「重新
 * 加载」, 「继续问 AI 这份报告 →」 — each screen inventing its own, none
 * of them looking like controls.
 *
 * The three variants
 * ------------------
 * Taken from SwiftUI's button styles, because the hierarchy is the
 * useful part, not the pixels:
 *
 *  - `prominent` — filled with the accent. **One per screen**, for the
 *    thing that screen exists to do. Two prominent buttons on a screen
 *    means neither is the primary.
 *  - `tinted` — accent text on an accent wash. A real, obvious control
 *    that is not *the* control. This is the default and most actions
 *    belong here.
 *  - `plain` — text only, no shape. Legal only in a header/toolbar
 *    position or inside a list row, where position already establishes
 *    that it is interactive. Not a way to make a button quieter.
 *
 * Press behaviour
 * ---------------
 * Every variant scales to `INTERACTION.pressScale` on a spring. On iOS
 * a control answers a finger with geometry, and opacity alone
 * disappears under the thumb that caused it.
 */

export type ButtonVariant = 'prominent' | 'tinted' | 'plain' | 'destructive';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Leading icon name (see Icon.tsx). */
  icon?: string;
  /** Trailing icon — for「→」-style forward affordances. */
  trailingIcon?: string;
  disabled?: boolean;
  /** Swaps the label for a spinner and blocks presses. */
  busy?: boolean;
  /** Stretches to the container width. Prominent buttons usually want
   *  this; a tinted button beside a heading usually does not. */
  fullWidth?: boolean;
  /** A visually smaller control for a header or a toolbar slot.
   *
   *  It shrinks to 34pt of *drawn* height and keeps the 48pt target
   *  with hitSlop. Before this, `compact` changed only padding and
   *  type, so a header action was drawn exactly as tall as a form's
   *  submit — the reason the top of every screen looked heavy. */
  compact?: boolean;
  style?: ViewStyle;
  /** Overrides the spoken name. Needed where the visible label is a
   *  shorthand the screen's layout disambiguates but speech does not:
   *  a 「清空」 button beside a chat log is 「清空对话」 to a screen
   *  reader. Defaults to `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Drawn height of a compact button. The finger still gets
 *  MIN_TOUCH_TARGET via hitSlop — smaller visually, never smaller to
 *  the touch. */
const COMPACT_HEIGHT = 34;
const COMPACT_SLOP = Math.round((MIN_TOUCH_TARGET - COMPACT_HEIGHT) / 2);

const Button = ({
  label,
  onPress,
  variant = 'tinted',
  icon,
  trailingIcon,
  disabled,
  busy,
  fullWidth,
  compact,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const blocked = Boolean(disabled || busy);
  const tone = TONE[variant];

  return (
    <AnimatedPressable
      style={[
        styles.base,
        compact ? styles.compact : null,
        tone.container,
        fullWidth ? styles.fullWidth : null,
        blocked ? styles.blocked : null,
        animatedStyle,
        style,
      ]}
      onPressIn={() => {
        if (!blocked) scale.value = withSpring(INTERACTION.pressScale, MOTION.press);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, MOTION.press);
      }}
      onPress={onPress}
      // The visual shrink must not shrink the target.
      hitSlop={compact ? { top: COMPACT_SLOP, bottom: COMPACT_SLOP } : undefined}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      // `accessibilityState` is the native API; react-native-web 0.20
      // drops it, so a disabled or busy button announced itself as an
      // ordinary one. aria-* is first-class in RN 0.71+ and maps back
      // to accessibilityState on device — see SegmentedControl.
      accessibilityState={{ disabled: blocked, busy: Boolean(busy) }}
      aria-disabled={blocked}
      aria-busy={Boolean(busy)}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tone.text.color} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={compact ? 14 : 16} color={tone.text.color} /> : null}
          <Text style={[styles.label, compact ? styles.labelCompact : null, tone.text]}>
            {label}
          </Text>
          {trailingIcon ? (
            <Icon name={trailingIcon} size={compact ? 13 : 14} color={tone.text.color} />
          ) : null}
        </View>
      )}
    </AnimatedPressable>
  );
};

export default Button;

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  compact: {
    minHeight: COMPACT_HEIGHT,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  blocked: {
    opacity: 0.45,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  label: {
    ...TYPE.label,
    fontSize: 15,
    lineHeight: 20,
  },
  labelCompact: {
    fontSize: 13.5,
    lineHeight: 18,
  },
});

/** Container + text colour per variant. Kept as one table so the
 *  hierarchy is legible in one place rather than spread across four
 *  style blocks. */
const TONE: Record<ButtonVariant, { container: ViewStyle; text: { color: string } }> = {
  prominent: {
    container: { backgroundColor: COLOR.accent },
    text: { color: COLOR.onAccent },
  },
  tinted: {
    container: { backgroundColor: COLOR.accentWash },
    text: { color: COLOR.accent },
  },
  destructive: {
    container: { backgroundColor: COLOR.alertWash },
    text: { color: COLOR.alert },
  },
  plain: {
    // No fill: the label *is* the control. It keeps the touch-target
    // minimum from `styles.base` but loses the horizontal padding,
    // which would otherwise make the tap area lie about where the text
    // ends.
    container: { backgroundColor: 'transparent', paddingHorizontal: SPACE.xs },
    text: { color: COLOR.accent },
  },
};
