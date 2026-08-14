import fs from 'node:fs';
import path from 'node:path';
import TestRenderer, { act } from 'react-test-renderer';
import RootLayout from '../app/_layout';
import { ADMIN_ROUTES } from '../lib/admin-access';

/**
 * §B4: the back office must be invisible to a patient — 「not merely
 * un-linked, but not rendered at all for a non-admin role, and the
 * route itself must not render for them either」.
 *
 * The row in 我的 is the un-linking half and is guarded separately
 * (screens/p-settings). This file pins the other half: a patient who
 * types /p-admin into WeChat's address bar, or follows a link an
 * operator pasted into a group, gets no back-office shell at all —
 * not an empty one, not one that paints for a frame and then 403s.
 *
 * A separate file from route-gate.test.tsx on purpose: that one mocks
 * `useAuth` without a `user`, which is exactly the case this gate must
 * treat as「not an admin」, and keeping it that way is a second
 * assertion for free.
 */

const mockReplace = jest.fn();
let mockSegments: string[] = [];
let mockToken: string | null = null;
let mockRole: string | null = null;

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stack = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, { testID: 'stack' }, children);
  Stack.displayName = 'Stack';
  Stack.Screen = function StackScreen() {
    return null;
  };
  return {
    Stack,
    useRootNavigationState: () => ({ key: 'root-key' }),
    useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
    useSegments: () => mockSegments,
  };
});

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return { GestureHandlerRootView: View };
});

jest.mock('../contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children?: unknown }) => children,
  useAuth: () => ({
    token: mockToken,
    isHydrated: true,
    user: mockRole === null ? null : { id: 'u1', role: mockRole },
  }),
}));

jest.mock('../contexts/ProfileContext', () => ({
  ProfileProvider: ({ children }: { children?: unknown }) => children,
  // 'missing' on purpose: an administrator is an app_users row and
  // usually has no patient profile of their own. Without the
  // onboarding exemption this would walk them to 「补全你的健康档案」.
  useProfileContext: () => ({ profileStatus: 'missing' }),
}));

jest.mock('../screens/common/feedback/AppDialog', () => ({
  AppDialogProvider: ({ children }: { children?: unknown }) => children,
}));

jest.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children?: unknown }) => children,
}));

const renderAt = (
  route: string,
  { token, role }: { token?: string | null; role?: string | null } = {},
) => {
  mockSegments = [route];
  mockToken = token === undefined ? 'token-123' : token;
  mockRole = role ?? null;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<RootLayout />);
  });
  return tree;
};

/** The gate blocks the render while it redirects, so the stack being on
 *  screen is the observable 「this route was allowed」. */
const stackIsOnScreen = (tree: TestRenderer.ReactTestRenderer): boolean =>
  tree.root.findAll((node) => node.props?.testID === 'stack').length > 0;

describe('ADMIN_ROUTES covers every back-office file in app/', () => {
  /**
   * The hole this closes: a new back-office route added to app/ but not
   * to ADMIN_ROUTES gets no gate at all. It would pass
   * route-registry.test.ts (which only checks the Stack declarations),
   * render for anyone who typed its URL, and only be stopped by the
   * server's 403 — after the shell had already painted.
   *
   * Read from disk rather than imported, for the same reason
   * route-registry.test.ts reads _layout.tsx as source: this is an
   * assertion about a list of files, not about rendering.
   */
  it('has an entry for every app/p-admin* route', () => {
    const appDir = path.resolve(__dirname, '..', 'app');
    const adminFiles = fs
      .readdirSync(appDir)
      .filter((file) => file.startsWith('p-admin') && file.endsWith('.tsx'))
      .map((file) => file.replace(/\.tsx$/, ''))
      .sort();
    expect(adminFiles.length).toBeGreaterThan(0);
    expect(adminFiles.filter((route) => !ADMIN_ROUTES.has(route))).toEqual([]);
  });

  it('does not list a route that no longer exists', () => {
    const appDir = path.resolve(__dirname, '..', 'app');
    const files = new Set(fs.readdirSync(appDir).map((file) => file.replace(/\.tsx$/, '')));
    expect([...ADMIN_ROUTES].filter((route) => !files.has(route))).toEqual([]);
  });
});

describe('the back office is not rendered for a patient', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it.each([...ADMIN_ROUTES])('%s is replaced with /p-home for role=patient', (route) => {
    const tree = renderAt(route, { role: 'patient' });
    expect(mockReplace).toHaveBeenCalledWith('/p-home');
    expect(stackIsOnScreen(tree)).toBe(false);
  });

  it.each([...ADMIN_ROUTES])('%s is replaced with /p-home when the role is unknown', (route) => {
    // A session whose stored user JSON failed to parse. Not an admin.
    const tree = renderAt(route, { role: null });
    expect(mockReplace).toHaveBeenCalledWith('/p-home');
    expect(stackIsOnScreen(tree)).toBe(false);
  });

  it('sends a signed-out visitor to login rather than to 今天', () => {
    // The order matters: an unauthenticated visitor is a login problem,
    // not a permission problem, and bouncing them to /p-home would put
    // them on a screen the auth gate then bounces again.
    const tree = renderAt('p-admin', { token: null, role: null });
    expect(mockReplace).toHaveBeenCalledWith('/p-login_register');
    expect(stackIsOnScreen(tree)).toBe(false);
  });
});

describe('the back office renders for an administrator', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it.each([...ADMIN_ROUTES])('%s renders for role=admin', (route) => {
    const tree = renderAt(route, { role: 'admin' });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(stackIsOnScreen(tree)).toBe(true);
  });

  it('does not walk an administrator with no profile into onboarding', () => {
    // profileStatus is 'missing' for every case in this file. An
    // operator asked for their own diagnosis year before they may read
    // a parse queue is the failure the exemption prevents.
    renderAt('p-admin', { role: 'admin' });
    expect(mockReplace).not.toHaveBeenCalledWith('/p-register_profile?mode=onboarding');
  });

  it('still walks a patient with no profile into onboarding elsewhere', () => {
    // The exemption must be scoped to the admin routes and not have
    // quietly turned the onboarding gate off.
    renderAt('p-archive', { role: 'patient' });
    expect(mockReplace).toHaveBeenCalledWith('/p-register_profile?mode=onboarding');
  });
});
