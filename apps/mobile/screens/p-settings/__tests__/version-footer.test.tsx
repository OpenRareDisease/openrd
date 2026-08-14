/**
 * 我的 — the footer, which described a different build than the one
 * running.
 *
 * Two lines carried three untruths at once:
 *
 *  - 「FSHD-openrd」is the repository. The product is 肌愈通. A patient
 *    reading this back to us on the phone would name a GitHub org.
 *  - 「v1.0.0」was typed by hand against app.json's 2.5.0 — one and a
 *    half years of releases apart, which points a bug report at the
 *    wrong build. A wrong version is worse than no version.
 *  - 「© 2024」was rendered in 2026.
 *
 * 关于我们 had already been fixed for all three and had tests holding
 * it; this screen was missed, so the app disagreed with itself one tap
 * apart. These assertions exist so the next fix cannot be half-applied
 * again.
 */

import TestRenderer, { act } from 'react-test-renderer';

let mockExpoConfig: { version?: string } | null = { version: '9.9.9' };
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

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

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
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

const renderedText = (): string => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<SettingsScreen />);
  });
  return collectText(tree.toJSON());
};

describe('the version line', () => {
  afterEach(() => {
    mockExpoConfig = { version: '9.9.9' };
  });

  it('names the product, not the repository', () => {
    const text = renderedText();
    expect(text).toContain('肌愈通');
    expect(text).not.toContain('FSHD-openrd');
  });

  it('reads the version from the Expo config rather than a typed literal', () => {
    expect(renderedText()).toContain('v9.9.9');
  });

  it('never renders the stale 1.0.0', () => {
    // Not merely «differs from app.json» — the specific string that was
    // wrong, so a future hand-typed regression to it fails here.
    expect(renderedText()).not.toContain('v1.0.0');
  });

  it('renders no version at all when the config is unreadable', () => {
    mockExpoConfig = null;
    const text = renderedText();
    expect(text).not.toContain('v9.9.9');
    // The name still shows: it is a constant, not something we read at
    // runtime, so losing the config is no reason to stop saying what
    // the app is called.
    expect(text).toContain('肌愈通');
  });

  it('renders no version when the config is present but carries none', () => {
    mockExpoConfig = {};
    expect(renderedText()).not.toContain(' v');
  });
});

describe('the copyright line', () => {
  it('derives the year, so it cannot go stale the way 2024 did', () => {
    const thisYear = String(new Date().getFullYear());
    const text = renderedText();
    expect(text).toContain(`© ${thisYear}`);
    // Guards the assertion from becoming vacuous — it will not be 2024
    // again, but the next reader should not have to work that out.
    expect(thisYear).not.toBe('2024');
    expect(text).not.toContain('© 2024');
  });
});
