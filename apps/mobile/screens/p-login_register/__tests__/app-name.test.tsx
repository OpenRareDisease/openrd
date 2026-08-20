/**
 * 登录 / 注册 — what the product calls itself to someone who has not
 * signed in yet.
 *
 * This screen printed 「FSHD-openrd」 in the largest type on the page.
 * That is the GitHub repository; the product is 肌愈通. It is the first
 * screen an unauthenticated patient sees, so it was also the first name
 * they learned — and the one they would read back to us on the phone.
 *
 * 设置 and 关于我们 had both already been fixed for exactly this, and
 * both have tests holding them (see p-settings/__tests__/
 * version-footer.test.tsx and p-about_us/__tests__/index.test.tsx).
 * This screen was missed, which is the failure mode this file exists to
 * stop: a name fixed on the screens somebody happened to look at.
 */

import TestRenderer, { act } from 'react-test-renderer';
import { APP_NAME } from '../../../lib/app-identity';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '9.9.9' } },
}));

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    login: jest.fn(),
    loginWithOtp: jest.fn(),
    recordLegalAcceptance: jest.fn(),
    register: jest.fn(),
    resetPassword: jest.fn(),
    sendOtp: jest.fn(),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ setSession: jest.fn() }),
}));

jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('../../common/ScreenBackButton', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('ScreenBackButton') };
});

// Imported after the mocks so the screen wires up against them.

import LoginRegisterScreen from '../index';

/** Every tree this file mounts, so `afterEach` can unmount them — the
 *  resend countdown is a real `setInterval`. */
const mounted: TestRenderer.ReactTestRenderer[] = [];

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LoginRegisterScreen />);
  });
  mounted.push(tree);
  return tree;
};

const collectText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return collectText((node as { children: unknown }).children);
  }
  return '';
};

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe('登录页上的产品名', () => {
  it('叫产品的名字，不叫仓库的名字', async () => {
    const text = collectText((await render()).toJSON());
    expect(text).toContain(APP_NAME);
    expect(text).not.toContain('FSHD-openrd');
  });

  it('名字是从 lib/app-identity 读的，不是又抄了一份', () => {
    // Renaming the product has to move this screen with it. A
    // hard-coded 肌愈通 satisfies the assertion above and still leaves
    // one more copy of the name to forget — which is how 设置 and
    // 关于我们 came to disagree in the first place.
    //
    // Asserted against the source rather than the render because the
    // render only covers the branch that happens to be mounted.
    const source: string = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'index.tsx'),
      'utf8',
    );
    expect(source).toContain("from '../../lib/app-identity'");
    expect(source).not.toMatch(/<Text[^>]*>\s*FSHD-openrd/);
    expect(source).not.toContain(`>${APP_NAME}<`);
  });
});
