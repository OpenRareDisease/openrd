/**
 * 我的 — the 了解 FSHD · 在中国 group.
 *
 * This pins the placement, not the copy. The two administrative pages
 * are finished and sourced, and the group they sit in decides whether a
 * patient believes that before tapping: every row under 探索 · 即将上线
 * wears an 即将上线 badge and opens an UnavailableScreen, which teaches
 * this audience to read a chevron in Settings as 「大概又是个空页面」.
 * Dropping either row into that group — or letting it acquire that
 * badge — costs the pages their readership without changing a word of
 * their content.
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

beforeEach(() => {
  mockPush.mockClear();
  mockExploreEnabled = false;
});

describe('了解 FSHD · 在中国', () => {
  it('这一组存在，标题说明它也包含「在中国」的那一半', () => {
    // Half of this group is not about the disease — it is about the
    // offices, which is the part nobody helps with.
    expect(collectText(render().toJSON())).toContain('了解 FSHD · 在中国');
  });

  it('三行都在：遗传与生育、残疾评定准备、罕见病身份与权益', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('遗传与生育');
    expect(text).toContain('残疾评定准备');
    expect(text).toContain('罕见病身份与权益');
  });

  it('残疾评定准备去的是它自己的路由', () => {
    const tree = render();
    act(() => {
      rowByLabel(tree, '残疾评定准备').props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-disability_assessment');
  });

  it('罕见病身份与权益去的是它自己的路由', () => {
    const tree = render();
    act(() => {
      rowByLabel(tree, '罕见病身份与权益').props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-rare_disease_status');
  });
});

describe('这两行不属于 探索 · 即将上线', () => {
  it('开了 explore 标志之后，两行仍然在它上面，而不是在它里面', () => {
    mockExploreEnabled = true;
    const text = collectText(render().toJSON());
    const chinaGroup = text.indexOf('了解 FSHD · 在中国');
    const exploreGroup = text.indexOf('探索 · 即将上线');
    expect(chinaGroup).toBeGreaterThan(-1);
    expect(exploreGroup).toBeGreaterThan(-1);
    expect(text.indexOf('残疾评定准备')).toBeGreaterThan(chinaGroup);
    expect(text.indexOf('残疾评定准备')).toBeLessThan(exploreGroup);
    expect(text.indexOf('罕见病身份与权益')).toBeLessThan(exploreGroup);
  });

  it('两行都没有「即将上线」徽标 —— 它们是做完的页面', () => {
    mockExploreEnabled = true;
    const tree = render();
    // The badge replaces the chevron on the placeholder rows. These two
    // must keep the chevron, because the chevron is the app's promise
    // that something is behind it.
    [' 残疾评定准备', '罕见病身份与权益'].forEach((label) => {
      const row = rowByLabel(tree, label.trim());
      expect(row).toBeDefined();
      expect(collectText(row.props.children)).not.toContain('即将上线');
    });
  });
});
