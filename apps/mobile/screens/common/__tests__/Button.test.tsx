/**
 * The shared Button's two hand-facing guarantees.
 *
 * Both of these were live defects rather than hypotheticals:
 *
 *  1. `user-select` was left at the browser default, so on the web
 *     export (which is what patients actually open, usually inside
 *     WeChat) a slow press on 登录 selected the word instead of
 *     submitting the form. A slow, drifting release is what a weakened
 *     hand produces, so the app's primary action was intermittently a
 *     no-op for precisely its users.
 *
 *  2. The press-scale spring lived inline in this file, which is why
 *     nothing else in the app had a press response at all. It now
 *     comes from `lib/press-scale`, and this pins that the button did
 *     not lose it on the way out.
 */

import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import Button from '../Button';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const render = (element: React.ReactElement) => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
};

/** The button's outermost pressable — the node that owns the press
 *  handlers and the style array. */
const control = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.props?.onPressIn === 'function', { deep: false })[0];

/**
 * True when `style` carries a reanimated animated style whose initial
 * value is a scale transform.
 *
 * Asserting the animated *value* is not possible here — the spring runs
 * on the UI thread and never ticks under jest — but the shape is the
 * part that matters: it proves the feedback goes through reanimated's
 * `withSpring`, which is what reads `prefers-reduced-motion` for us
 * (`ReducedMotion.ts` calls `matchMedia` on web). A hand-rolled timer
 * would satisfy "it moves" and silently ignore that preference.
 */
const hasReanimatedScaleStyle = (style: unknown): boolean =>
  (Array.isArray(style) ? style : [style]).some((entry) => {
    const initial = (
      entry as { initial?: { value?: { transform?: Array<{ scale?: number }> } } } | null
    )?.initial?.value;
    return Boolean(initial?.transform?.some((transform) => typeof transform.scale === 'number'));
  });

describe('Button', () => {
  it('never lets a press become a text selection on web', () => {
    // react-native-web renders <Text> with the browser's default
    // user-select. Without this the label is selectable, and holding
    // the press for a beat — or releasing a pixel or two off — turns
    // 登录 into a highlighted word and no login.
    const flattened = StyleSheet.flatten(
      control(render(<Button label="登录" onPress={() => {}} />)).props.style as never,
    ) as { userSelect?: string };
    expect(flattened.userSelect).toBe('none');
  });

  it('keeps user-select off for every variant, not just the default', () => {
    for (const variant of ['prominent', 'tinted', 'plain', 'destructive'] as const) {
      const flattened = StyleSheet.flatten(
        control(render(<Button label="登录" variant={variant} onPress={() => {}} />)).props
          .style as never,
      ) as { userSelect?: string };
      expect(flattened.userSelect).toBe('none');
    }
  });

  it('answers a press with a reanimated scale, not opacity alone', () => {
    const node = control(render(<Button label="保存" onPress={() => {}} />));
    expect(hasReanimatedScaleStyle(node.props.style)).toBe(true);
    expect(typeof node.props.onPressIn).toBe('function');
    expect(typeof node.props.onPressOut).toBe('function');
    // Driving them must not throw — the handlers now come from a hook
    // in another module, so this is the seam most likely to rot.
    act(() => {
      node.props.onPressIn();
      node.props.onPressOut();
    });
  });

  it('draws a full-size target by default', () => {
    const flattened = StyleSheet.flatten(
      control(render(<Button label="登录" onPress={() => {}} />)).props.style as never,
    ) as { minHeight?: number };
    expect(flattened.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});
