/**
 * 我的 — the way in to 病友经验 and 康复：辅具与运动.
 *
 * Both pages were finished — screens/p-community is the shelf of
 * published, bylined narratives, screens/p-rehab_share is the orthosis
 * ladder plus the six-month home-exercise plan — and both were still
 * listed in 探索 · 即将上线 as 患者社区 and 康复经验分享. That group is
 * hidden behind EXPO_PUBLIC_ENABLE_EXPLORE, which is off by default, so
 * two finished features were unreachable in every shipped build.
 *
 * That is the same failure __tests__/trials-entry.test.tsx was written
 * for, one flag and three rows later, so this file pins the same two
 * things for these two pages:
 *
 *  - a real page listed inside 探索 · 即将上线 ships unreachable;
 *  - a real page wearing an 即将上线 badge, or sitting beside rows that
 *    do, loses the readership that group's own header comment
 *    describes.
 *
 * It also pins the third thing the first fix missed: the placeholder
 * rows those two left behind must be GONE from 探索 · 即将上线, not
 * duplicated there.
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

/**
 * Everything the row actually draws, badge included.
 *
 * `collectText(row.props.children)` does NOT work and does not fail
 * either: those are unrendered React elements, whose text sits at
 * `props.children` rather than `children`, so `collectText` walks into
 * nothing and returns ''. Every assertion written against it passes
 * whatever the row draws. `row` itself is a ReactTestInstance, whose
 * `children` are the RENDERED children — which is what makes the
 * badge assertions below able to fail.
 */
const rowText = (row: TestRenderer.ReactTestInstance) => collectText(row);

/** Label, route, and the second line of the row — the detail is what
 *  the ordering assertions look for, because it belongs to this row
 *  alone. */
const FINISHED = [
  {
    label: '病友经验',
    route: '/p-community',
    detail: '病友自己写下、已公开发表的经历；本页只放摘录和出处',
    /** What this row was called while it was a placeholder. */
    placeholderLabel: '患者社区',
  },
  {
    label: '康复：辅具与运动',
    route: '/p-rehab_share',
    detail: '辅具与助行器怎么选，以及六个月的居家运动计划',
    placeholderLabel: '康复经验分享',
  },
] as const;

beforeEach(() => {
  mockPush.mockClear();
  mockExploreEnabled = false;
});

describe.each(FINISHED)('$label 的入口', ({ label, route, detail, placeholderLabel }) => {
  it('探索标志关着（默认）时，这一行照样在', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain(label);
    expect(text).toContain(detail);
  });

  it(`点它去的是 ${route}`, () => {
    const tree = render();
    act(() => {
      rowByLabel(tree, label).props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it('它在「了解 FSHD · 在中国」组里，而不是在「探索 · 即将上线」里', () => {
    mockExploreEnabled = true;
    const text = collectText(render().toJSON());
    const chinaGroup = text.indexOf('了解 FSHD · 在中国');
    const exploreGroup = text.indexOf('探索 · 即将上线');
    expect(chinaGroup).toBeGreaterThan(-1);
    expect(exploreGroup).toBeGreaterThan(-1);
    const row = text.indexOf(detail);
    expect(row).toBeGreaterThan(chinaGroup);
    expect(row).toBeLessThan(exploreGroup);
  });

  it('这一行没有「即将上线」徽标 —— 它是做完的页面', () => {
    const tree = render();
    const row = rowByLabel(tree, label);
    expect(rowText(row)).not.toContain('即将上线');
  });

  it('它原来那个占位的行已经从「探索 · 即将上线」里删掉了', () => {
    // Leaving it there would give the same page two rows: one honest
    // and one wearing an 即将上线 badge.
    mockExploreEnabled = true;
    expect(collectText(render().toJSON())).not.toContain(placeholderLabel);
  });
});

describe('探索 · 即将上线 里剩下的', () => {
  /** The three screens under apps/mobile/screens that still render
   *  `UnavailableScreen`. */
  const STILL_PLACEHOLDERS = ['专家咨询', '临床试验广场', '医疗资源地图'];

  it('每一行都还带着「即将上线」徽标', () => {
    mockExploreEnabled = true;
    const tree = render();
    for (const label of STILL_PLACEHOLDERS) {
      const row = rowByLabel(tree, label);
      expect(row).toBeDefined();
      expect(rowText(row)).toContain('即将上线');
    }
  });

  it('标志关着时它们一个都不出现', () => {
    const text = collectText(render().toJSON());
    expect(text).not.toContain('探索 · 即将上线');
    for (const label of STILL_PLACEHOLDERS) {
      expect(text).not.toContain(label);
    }
  });
});
