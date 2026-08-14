/**
 * 我的 — the way in to 临床试验.
 *
 * The page itself is only worth building if it can be found, and this
 * app already has a trials-shaped row that goes nowhere: 临床试验广场
 * inside 探索 · 即将上线, which opens an UnavailableScreen and is
 * hidden behind EXPO_PUBLIC_ENABLE_EXPLORE by default. Two failures
 * follow from that and this file pins both:
 *
 *  - Wiring the real page inside 探索 · 即将上线 would put it behind a
 *    flag that is off in every shipped build, i.e. build it and ship it
 *    unreachable.
 *  - Wiring it beside 临床试验广场 without a flag would sit a finished,
 *    sourced page next to a placeholder wearing an 即将上线 badge —
 *    the readership cost that group's own header comment describes.
 */

import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

let mockExploreEnabled = false;
jest.mock('../../../lib/feature-flags', () => ({
  __esModule: true,
  isFeatureEnabled: (name: string) => (name === 'explore' ? mockExploreEnabled : false),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn() }),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    user: { phoneNumber: '13800000000', role: 'patient', createdAt: '2025-01-01T00:00:00.000Z' },
    logout: jest.fn(),
  }),
}));

jest.mock('../../../lib/api', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  exportMyData: jest.fn(),
  requestAccountDeletion: jest.fn(),
  cancelAccountDeletion: jest.fn(),
  getAccountDeletionStatus: jest.fn(() => Promise.resolve({ deletion: null })),
}));

import SettingsScreen from '../index';

const collectText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return collectText((node as { children: unknown }).children);
  }
  return '';
};

const render = () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<SettingsScreen />);
  });
  return tree;
};

const rowByLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (instance) =>
      instance.props.accessibilityRole === 'button' &&
      instance.props.accessibilityLabel === label &&
      typeof instance.props.onPress === 'function',
  )[0];

/** The second line of the row, which is unique to it — the label
 *  alone is a prefix of 临床试验广场 in 探索 · 即将上线. */
const ROW_DETAIL = '注册库上登记的 FSHD 试验，以及这份名单是哪天抄下来的';

beforeEach(() => {
  mockPush.mockClear();
  mockExploreEnabled = false;
});

describe('临床试验的入口', () => {
  it('探索标志关着（默认）时，这一行照样在', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('临床试验');
    expect(text).toContain(ROW_DETAIL);
  });

  it('点它去的是 /p-trials，不是那个占位的 /p-trial_square', () => {
    const tree = render();
    act(() => {
      rowByLabel(tree, '临床试验').props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-trials');
  });

  it('它在「了解 FSHD · 在中国」组里，而不是在「探索 · 即将上线」里', () => {
    mockExploreEnabled = true;
    const text = collectText(render().toJSON());
    const chinaGroup = text.indexOf('了解 FSHD · 在中国');
    const exploreGroup = text.indexOf('探索 · 即将上线');
    expect(chinaGroup).toBeGreaterThan(-1);
    expect(exploreGroup).toBeGreaterThan(-1);
    const row = text.indexOf(ROW_DETAIL);
    expect(row).toBeGreaterThan(chinaGroup);
    expect(row).toBeLessThan(exploreGroup);
  });

  it('这一行没有「即将上线」徽标 —— 它是做完的页面', () => {
    const tree = render();
    const row = rowByLabel(tree, '临床试验');
    // `row`, not `row.props.children`. The latter is a list of
    // UNRENDERED React elements, whose text hangs off `props.children`
    // rather than `children` — `collectText` walks into nothing and
    // returns '', so this assertion passed no matter what the row drew.
    // Measured: the same expression over a row that DOES carry the
    // badge also returned ''. A ReactTestInstance's `children` are the
    // rendered ones, which is what makes this able to fail.
    expect(collectText(row)).not.toContain('即将上线');
  });
});
