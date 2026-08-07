import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Icon from './Icon';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, RADIUS, SPACE, TYPE } from '../../lib/design';
import { usePressScale } from '../../lib/press-scale';

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
 *
 * The spring itself now lives in `lib/press-scale.tsx` so the ordinary
 * touchables on the form screens can answer a finger the same way —
 * this component was the only thing in the app that did.
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
   *  It shrinks to 34pt of *drawn* height. Before this, `compact`
   *  changed only padding and type, so a header action was drawn
   *  exactly as tall as a form's submit — the reason the top of every
   *  screen looked heavy.
   *
   *  **The hitSlop below does not restore the 48pt target on web.**
   *  react-native-web 0.20 implements `hitSlop` only in the legacy
   *  `Touchable` mixin; neither `Pressable` nor `TouchableOpacity`
   *  reads it (grep the package — it appears in `exports/Touchable`
   *  and nowhere else). This product ships as an Expo *web* export, so
   *  a `compact` button is a 34pt target for the patients who actually
   *  use it, and the earlier version of this comment — "keeps the 48pt
   *  target with hitSlop" — asserted a guarantee the code only
   *  provides on device.
   *
   *  So: `compact` is for a header/toolbar affordance sitting beside
   *  other full-size chrome, never for a control on a path a patient
   *  must complete. The three text links on 登录/注册 dropped it for
   *  exactly that reason — see that screen. */
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

/** Drawn height of a compact button. The hitSlop below buys back the
 *  difference on device only — see the `compact` prop's note. */
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
  const blocked = Boolean(disabled || busy);
  const press = usePressScale(blocked);
  const tone = TONE[variant];

  return (
    <AnimatedPressable
      style={[
        styles.base,
        compact ? styles.compact : null,
        tone.container,
        fullWidth ? styles.fullWidth : null,
        blocked ? styles.blocked : null,
        press.animatedStyle,
        style,
      ]}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      // Native only. react-native-web's Pressable does not read
      // hitSlop at all (nothing under its exports/ imports the module),
      // so on the platform patients actually use, COMPACT_HEIGHT is the
      // whole target — which is why it is what it is. Kept for the
      // native shells, where it does buy the extra area.
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
    /**
     * The button's label is a control, not prose.
     *
     * react-native-web renders `Text` with the browser's default
     * `user-select`, so a press that is held for even a moment and
     * released a pixel or two away is a text *selection*, not a tap:
     * clicking 登录 highlighted the word 登录 and did not log anyone
     * in. A slow, drifting release is exactly what a weakened hand
     * produces, so this turned every primary action in the product
     * into an intermittent no-op for the people the product is for.
     *
     * `user-select` inherits in CSS, so setting it on the container is
     * enough to cover the label and any icon inside it. It has no
     * effect on native, where nothing selectable is being rendered.
     */
    userSelect: 'none',
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
    // ends. The minimum survives `plain` ALONE — combined with
    // `compact` it does not, because compact's own minHeight (34) wins
    // over base's. That combination drew the 撤销 button on 隐私设置 at
    // roughly 35x34pt, and it is the reason to read `compact`'s note
    // before reaching for it.
    container: { backgroundColor: 'transparent', paddingHorizontal: SPACE.xs },
    text: { color: COLOR.accent },
  },
};
