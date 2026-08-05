/**
 * 关于我们 — the one screen whose entire job is to say truthfully what
 * this app is. It was the screen doing it least well:
 *
 *  - It called the product 「FSHD青年社区患者平台」, an old working
 *    name. The product is 肌愈通.
 *  - 「版本 1.0.0」was typed in by hand and had drifted four minor
 *    versions behind app.json's 2.5.0 — useless for the only thing a
 *    version line is for, which is a patient reading it back to us.
 *  - 「© 2024」had been wrong for two calendar years.
 *  - It advertised 患者社区 as a 核心功能 and described the platform as
 *    offering 社区互助, while Settings had already stopped listing the
 *    community behind FEATURE_FLAGS.explore. The app was hiding the
 *    feature on one screen and promising it on another, one tap apart.
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

let mockExploreEnabled = false;
jest.mock('../../../lib/feature-flags', () => ({
  __esModule: true,
  isFeatureEnabled: (name: string) => (name === 'explore' ? mockExploreEnabled : false),
}));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
// Icon.tsx renders Ionicons, which asynchronously loads its font and
// setStates outside act(). Stubbed to a host string: these tests are
// about layout and copy, not glyphs.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

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

// The screen calls useAppDialog at the top level, and the real hook
// throws outside a provider by design.
jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn() }),
}));

import AboutUsScreen from '../index';

/**
 * Every string the screen actually renders, in document order and
 * concatenated. Concatenated rather than joined on a separator because
 * a single <Text> splits its interpolations into separate children —
 * 「版本 {appVersion}」arrives as ['版本 ', '9.9.9'] — and the whole
 * point is to assert what a patient reads, not how JSX chunked it.
 */
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
    tree = TestRenderer.create(<AboutUsScreen />);
  });
  return collectText(tree.toJSON());
};

describe('naming', () => {
  it('calls the product 肌愈通', () => {
    expect(renderedText()).toContain('肌愈通');
  });

  it('does not use the old working name or the repository name', () => {
    const text = renderedText();
    expect(text).not.toContain('FSHD青年社区患者平台');
    expect(text).not.toContain('openrd');
  });
});

describe('version', () => {
  afterEach(() => {
    mockExpoConfig = { version: '9.9.9' };
  });

  it('reads the version from the Expo config instead of a literal', () => {
    mockExpoConfig = { version: '9.9.9' };
    const text = renderedText();
    expect(text).toContain('版本 9.9.9');
    expect(text).not.toContain('1.0.0');
  });

  it('renders no version line at all when the config is unreadable', () => {
    // Rather than a placeholder: a version we cannot read is not a
    // version we may guess at on a page a patient quotes back to us.
    mockExpoConfig = null;
    expect(renderedText()).not.toContain('版本');
  });
});

describe('copyright year', () => {
  it('is derived, so it cannot go stale the way 2024 did', () => {
    const thisYear = String(new Date().getFullYear());
    const text = renderedText();
    expect(text).toContain(`© ${thisYear}`);
    // Guarded so this assertion is not vacuous once the year is 2024
    // again, which it will not be.
    expect(thisYear).not.toBe('2024');
    expect(text).not.toContain('© 2024');
  });
});

describe('患者社区 gating', () => {
  afterEach(() => {
    mockExploreEnabled = false;
  });

  it('does not advertise the community while the explore flag is off', () => {
    mockExploreEnabled = false;
    const text = renderedText();
    expect(text).not.toContain('患者社区');
    // The prose claim has to go with it — a paragraph promising
    // 交流经验 is the same promise as the feature row.
    expect(text).not.toContain('交流经验');
  });

  it('lists it again when the flag is on', () => {
    mockExploreEnabled = true;
    const text = renderedText();
    expect(text).toContain('患者社区');
    expect(text).toContain('交流经验');
  });
});
