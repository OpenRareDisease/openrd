import TestRenderer, { act } from 'react-test-renderer';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import AppTabBar from '../AppTabBar';

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

// `mock`-prefixed so jest's out-of-scope guard allows the factory to
// close over it.
const mockNavigate = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/** `index` is the redirect-only route the bar filters out. */
const ROUTE_NAMES = ['index', 'p-home', 'p-manage', 'p-qna', 'p-settings'];

const DESTINATIONS: Array<{ route: string; label: string; href: string }> = [
  { route: 'p-home', label: '今天', href: '/p-home' },
  { route: 'p-manage', label: '病程', href: '/p-manage' },
  { route: 'p-qna', label: '问答', href: '/p-qna' },
  { route: 'p-settings', label: '我的', href: '/p-settings' },
];

/**
 * The bar reads only `state.routes`, `state.index` and
 * `navigation.emit`, so the props are built by hand rather than by
 * standing up a real navigator — the alternative pins this test to
 * react-navigation's internals instead of to what the bar renders.
 */
const makeProps = (focusedRoute: string): BottomTabBarProps => {
  const routes = ROUTE_NAMES.map((name) => ({ key: `${name}-key`, name, params: undefined }));
  return {
    state: {
      index: routes.findIndex((route) => route.name === focusedRoute),
      routes,
    },
    navigation: { emit: () => ({ defaultPrevented: false }) },
    descriptors: {},
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
};

const render = (focusedRoute: string): TestRenderer.ReactTestRenderer => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<AppTabBar {...makeProps(focusedRoute)} />);
  });
  return renderer;
};

const controlsWithRole = (tree: TestRenderer.ReactTestRenderer, role: string) =>
  tree.root.findAll(
    (node) => node.props?.accessibilityRole === role && typeof node.props?.onPress === 'function',
    { deep: false },
  );

describe('AppTabBar accessibility', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders the four destinations as tabs', () => {
    const labels = controlsWithRole(render('p-home'), 'tab').map(
      (tab) => tab.props.accessibilityLabel,
    );
    expect(labels).toEqual(DESTINATIONS.map((d) => d.label));
  });

  it.each(DESTINATIONS)('announces $label as current when it is', ({ route, label }) => {
    // The bug this pins: `accessibilityRole="button"` + `aria-selected`.
    // ARIA does not declare aria-selected as a supported property of
    // role=button, so browsers drop it from the accessibility tree and
    // every tab announced「…，按钮」whether or not it was the current
    // one — the only remaining cue being colour, which a screen reader
    // cannot see. Both spellings have to be present: react-native-web
    // 0.20 drops accessibilityState (so web needs aria-*), and native
    // ignores aria-* (so device needs accessibilityState).
    for (const tab of controlsWithRole(render(route), 'tab')) {
      const isCurrent = tab.props.accessibilityLabel === label;
      expect(tab.props.accessibilityRole).toBe('tab');
      expect(tab.props.accessibilityState).toEqual({ selected: isCurrent });
      expect(tab.props['aria-selected']).toBe(isCurrent);
    }
  });

  it('states the unselected case explicitly rather than omitting it', () => {
    // `isFocused ? { selected: true } : {}` left three of the four tabs
    // with no selected state at all, so an assistive reader could not
    // tell「not current」from「this control has no such state」.
    const notCurrent = controlsWithRole(render('p-home'), 'tab').filter(
      (tab) => tab.props.accessibilityLabel !== '今天',
    );
    expect(notCurrent).toHaveLength(3);
    for (const tab of notCurrent) {
      expect(tab.props.accessibilityState).toEqual({ selected: false });
      expect(tab.props['aria-selected']).toBe(false);
    }
  });

  it('keeps 记一笔 a button, since it is an action and not a destination', () => {
    // This is also why the row is deliberately not marked `tablist`:
    // a tablist may only own tabs, and this button sits between the
    // two halves.
    const buttons = controlsWithRole(render('p-home'), 'button');
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(['记一笔']);
  });

  it.each(DESTINATIONS)('navigates to $href by path, not by route name', ({ label, href }) => {
    const tree = render('p-home');
    const tab = controlsWithRole(tree, 'tab').find(
      (node) => node.props.accessibilityLabel === label,
    );
    act(() => {
      tab!.props.onPress();
    });
    // The focused tab is a no-op by design.
    expect(mockNavigate).toHaveBeenCalledTimes(label === '今天' ? 0 : 1);
    if (label !== '今天') {
      expect(mockNavigate).toHaveBeenCalledWith(href);
    }
  });
});
