/**
 * The destructive-confirm layout.
 *
 * What went wrong: the `destructive` option's doc comment claimed the
 * dangerous button was "put second, so a destructive action is never
 * the default position", and the code only swapped the fill colour.
 * Both buttons stayed in a `justifyContent: 'flex-end'` row, sized by
 * their own labels (「取消」/「退出登录」lands around 62–80pt wide) and
 * SPACE.sm — eight points — apart. lib/a11y.ts is explicit that a
 * target may never be shrunk to fit a row, and this row carried the
 * seven confirmations where a mis-tap costs the most: logout, delete
 * report, withdraw consent.
 *
 * So these tests pin the layout, not the colour: column, stretched to
 * full width, at least SPACE.lg apart, dangerous action on top. And
 * they pin that reordering the buttons did not swap which one resolves
 * true — the obvious way to break this while it still looks right.
 */

import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { AppDialogProvider, useAppDialog } from '../AppDialog';
import { MIN_TOUCH_TARGET } from '../../../../lib/a11y';
import { SPACE } from '../../../../lib/design';

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
// Icon.tsx renders Ionicons, which asynchronously loads its font and
// setStates outside act(). Stubbed to a host string: these tests are
// about layout and copy, not glyphs.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

type DialogApi = ReturnType<typeof useAppDialog>;

let api: DialogApi;

const Capture = () => {
  api = useAppDialog();
  return null;
};

const mount = (): TestRenderer.ReactTestRenderer => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppDialogProvider>
        <Capture />
      </AppDialogProvider>,
    );
  });
  return renderer;
};

/** The two action buttons, in render order. `deep: false` keeps this
 *  to the outermost touchable rather than its inner host views. */
const actionButtons = (tree: TestRenderer.ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll(
    (node) =>
      node.props?.accessibilityRole === 'button' && typeof node.props?.onPress === 'function',
    { deep: false },
  );

/** Label text of a button, which is its only child <Text>. */
const labelOf = (button: ReactTestInstance): string =>
  button.findAll((node) => typeof node.props?.children === 'string', { deep: false })[0].props
    .children as string;

/** Walk up from a button to the container that lays the row (or stack)
 *  out — the nearest ancestor that declares a flexDirection. */
const actionsContainerStyle = (button: ReactTestInstance) => {
  let node: ReactTestInstance | null = button.parent;
  while (node) {
    const style = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined;
    if (style && typeof style.flexDirection === 'string') return style;
    node = node.parent;
  }
  throw new Error('no laid-out actions container above the button');
};

const openConfirm = (
  tree: TestRenderer.ReactTestRenderer,
  options: Parameters<DialogApi['confirm']>[0],
) => {
  let settled: Promise<boolean>;
  act(() => {
    settled = api.confirm(options);
  });
  return () => settled;
};

const DESTRUCTIVE = {
  title: '确定退出登录吗？',
  confirmLabel: '退出登录',
  cancelLabel: '取消',
  destructive: true,
} as const;

const ORDINARY = {
  title: '保存这次记录？',
  confirmLabel: '保存',
  cancelLabel: '取消',
} as const;

describe('destructive confirm layout', () => {
  it('stacks full width instead of squeezing two targets into a row', () => {
    const tree = mount();
    openConfirm(tree, DESTRUCTIVE);

    const style = actionsContainerStyle(actionButtons(tree)[0]);
    expect(style.flexDirection).toBe('column');
    // `stretch` is what makes each button the full width of the card;
    // without it a column still sizes every button to its own label.
    expect(style.alignItems).toBe('stretch');
  });

  it('separates the two targets by at least SPACE.lg', () => {
    const tree = mount();
    openConfirm(tree, DESTRUCTIVE);

    const style = actionsContainerStyle(actionButtons(tree)[0]);
    expect(typeof style.gap).toBe('number');
    expect(style.gap as number).toBeGreaterThanOrEqual(SPACE.lg);
  });

  it('puts the dangerous action on top, ahead of the way out', () => {
    const tree = mount();
    openConfirm(tree, DESTRUCTIVE);

    expect(actionButtons(tree).map(labelOf)).toEqual(['退出登录', '取消']);
  });

  it('keeps both stacked buttons at the minimum touch target', () => {
    const tree = mount();
    openConfirm(tree, DESTRUCTIVE);

    for (const button of actionButtons(tree)) {
      const style = StyleSheet.flatten(button.props.style) as Record<string, unknown>;
      expect(style.minHeight).toBe(MIN_TOUCH_TARGET);
      // Centred by hand: once the button is stretched it is no longer
      // sized by its label, so the label needs centring explicitly.
      expect(style.alignItems).toBe('center');
    }
  });

  it('still resolves true for the dangerous button and false for cancel', async () => {
    // The reordering is exactly the change that can silently invert
    // this: move the JSX, keep the handlers where they were, and a
    // patient pressing 取消 deletes the report.
    const tree = mount();
    const dangerous = openConfirm(tree, DESTRUCTIVE);
    act(() => {
      actionButtons(tree)[0].props.onPress();
    });
    await expect(dangerous()).resolves.toBe(true);

    const cancelled = openConfirm(tree, DESTRUCTIVE);
    act(() => {
      actionButtons(tree)[1].props.onPress();
    });
    await expect(cancelled()).resolves.toBe(false);
  });
});

describe('ordinary confirm layout', () => {
  it('keeps the compact trailing row', () => {
    const tree = mount();
    openConfirm(tree, ORDINARY);

    const style = actionsContainerStyle(actionButtons(tree)[0]);
    expect(style.flexDirection).toBe('row');
    expect(style.justifyContent).toBe('flex-end');
  });

  it('leaves cancel first and the affirmative in the trailing position', () => {
    const tree = mount();
    openConfirm(tree, ORDINARY);

    expect(actionButtons(tree).map(labelOf)).toEqual(['取消', '保存']);
  });

  it('resolves true for the trailing affirmative', async () => {
    const tree = mount();
    const settled = openConfirm(tree, ORDINARY);
    act(() => {
      actionButtons(tree)[1].props.onPress();
    });
    await expect(settled()).resolves.toBe(true);
  });
});
