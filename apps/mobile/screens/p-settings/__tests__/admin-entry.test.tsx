/**
 * 我的 — the only door into the back office, and who does not see it.
 *
 * §B4 asks for an entry point that is 「not merely un-linked, but not
 * rendered at all for a non-admin role」. `__tests__/admin-route-gate`
 * covers the routes; this covers the row, and specifically that a
 * patient gets NOTHING rather than a disabled row or a 「无权限」 notice
 * — either of those tells every patient that a back office exists and
 * that somebody can read their record from it, which is a sentence that
 * belongs in the privacy policy (§10) and not in a settings list.
 */

import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('../../../lib/feature-flags', () => ({
  __esModule: true,
  isFeatureEnabled: () => false,
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

let mockRole = 'patient';
jest.mock('../../../contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    user: { phoneNumber: '13800000000', role: mockRole, createdAt: '2025-01-01T00:00:00.000Z' },
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

const renderAs = (role: string) => {
  mockRole = role;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<SettingsScreen />);
  });
  return tree;
};

describe('the back-office row in 我的', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it.each(['patient', 'caregiver', 'clinician'])('is not rendered for role=%s', (role) => {
    const text = collectText(renderAs(role).toJSON());
    expect(text).not.toContain('运维与患者档案');
    // Not the word either: a section header saying 后台 with nothing
    // under it is the same disclosure.
    expect(text).not.toContain('健康检查、解析失败队列');
  });

  it('is rendered for role=admin and opens /p-admin', () => {
    const tree = renderAs('admin');
    expect(collectText(tree.toJSON())).toContain('运维与患者档案');
    const row = tree.root.find(
      (node) =>
        node.props?.accessibilityLabel === '运维与患者档案' &&
        typeof node.props?.onPress === 'function',
    );
    act(() => {
      row.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-admin');
  });
});
