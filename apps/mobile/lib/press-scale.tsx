import { forwardRef, type ComponentRef } from 'react';
import { TouchableOpacity, type TouchableOpacityProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { INTERACTION, MOTION } from './design';

/**
 * The press response, as something other than one button can use.
 *
 * Why this is not just a style
 * ----------------------------
 * `lib/design.ts` already says what a press should look like — 「a
 * press state that is visible at the moment of contact … opacity alone
 * disappears under a thumb」 — but the only implementation of it lived
 * inside `screens/common/Button.tsx`, in two lines that nothing else
 * could reach. Every other control in the two highest-traffic form
 * screens (登录/注册 and 记录数据) was a bare `TouchableOpacity`, i.e.
 * react-native-web's default opacity fade and nothing else.
 *
 * That gap matters more here than it would elsewhere. FSHD takes away
 * sustained grip and steady aim, so a press is often slow, braced with
 * the other arm, and finished somewhere the finger did not start. A
 * control that does not visibly move under that press reads as「没按
 * 上」, and the patient presses again — which is the most credible
 * mechanism this app has for duplicate submissions.
 *
 * Reduced motion
 * --------------
 * The spring is reanimated's, not a hand-rolled timer, and that is the
 * point: reanimated resolves `ReduceMotion.System` by reading
 * `(prefers-reduced-motion: reduce)` through `matchMedia` on web (see
 * `ReducedMotion.ts`) and, when it is set, `withSpring` jumps straight
 * to the target instead of animating there. So a patient who has asked
 * their phone for less motion still gets the state change — the
 * control is still visibly smaller while held — without the travel.
 * Nothing in this module needs to check the media query itself, and it
 * deliberately does not: a second implementation of the same question
 * is a second thing to get out of sync.
 */

/**
 * A control that shrinks slightly while held. Returns the animated
 * style to put last in the component's `style` array, plus the two
 * handlers that drive it.
 *
 * `blocked` covers disabled/busy: a control that answers a press it is
 * going to ignore is worse than one that stays still, because the
 * movement is the app's promise that the press landed.
 *
 * The return type is inferred rather than annotated — reanimated's
 * `AnimatedStyle` is wider than what an animated View accepts, so
 * naming it here makes every call site fail to typecheck.
 */
export const usePressScale = (blocked = false) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return {
    animatedStyle,
    onPressIn: () => {
      if (!blocked) {
        scale.value = withSpring(INTERACTION.pressScale, MOTION.press);
      }
    },
    // Unconditional: a control disabled *while* it was held (a submit
    // button that just became busy) must still spring back, or it stays
    // visibly compressed with nothing left to release it.
    onPressOut: () => {
      scale.value = withSpring(1, MOTION.press);
    },
  };
};

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

/**
 * Drop-in replacement for `TouchableOpacity` that adds the press
 * scale.
 *
 * A component rather than "call the hook at each site" because most of
 * these controls are rendered inside a `.map` — a chip per event type,
 * a bucket per sleep band — where a hook cannot be called. Each
 * instance owning its own shared value is also what makes the
 * feedback tell you *which* chip you hit.
 *
 * `activeOpacity` still defaults to the token, so the opacity dip and
 * the scale arrive together as they do on `Button`.
 */
const PressableScale = forwardRef<ComponentRef<typeof TouchableOpacity>, TouchableOpacityProps>(
  ({ style, onPressIn, onPressOut, disabled, activeOpacity, ...rest }, ref) => {
    const press = usePressScale(Boolean(disabled));

    return (
      <AnimatedTouchableOpacity
        ref={ref}
        disabled={disabled}
        activeOpacity={activeOpacity ?? INTERACTION.pressOpacity}
        // Caller handlers are kept, not replaced: this is feedback
        // layered onto whatever the control already did.
        onPressIn={(event) => {
          press.onPressIn();
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          press.onPressOut();
          onPressOut?.(event);
        }}
        style={[style, press.animatedStyle]}
        {...rest}
      />
    );
  },
);

PressableScale.displayName = 'PressableScale';

export default PressableScale;
