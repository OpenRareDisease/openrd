import TestRenderer, { act } from 'react-test-renderer';
import RootLayout from '../app/_layout';

/**
 * The root navigation gate in app/_layout.tsx.
 *
 * /p-genetics_family is the page that answers「会遗传给孩子吗」— the
 * question people ask before they have decided to trust anyone with a
 * phone number. It is a pure reading page with no API call, every
 * section carrying its source, so it is reachable signed out.
 *
 * The trap this pins: GUEST_ROUTES used to do two jobs at once. It
 * listed what a signed-out visitor may open AND what a signed-in user
 * gets bounced off, because the only member was the login screen where
 * both happen to be true. Adding a second route to that one set would
 * have made it unreachable for every logged-in patient — which is the
 * larger half of the audience for it.
 */

const mockReplace = jest.fn();
let mockSegments: string[] = [];
let mockToken: string | null = null;
let mockProfileStatus: 'ready' | 'missing' | 'error' | 'unknown' = 'ready';

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
  useAuth: () => ({ token: mockToken, isHydrated: true }),
}));

jest.mock('../contexts/ProfileContext', () => ({
  ProfileProvider: ({ children }: { children?: unknown }) => children,
  useProfileContext: () => ({ profileStatus: mockProfileStatus }),
}));

jest.mock('../screens/common/feedback/AppDialog', () => ({
  AppDialogProvider: ({ children }: { children?: unknown }) => children,
}));

jest.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children?: unknown }) => children,
}));

const renderAt = (
  route: string,
  { token = null as string | null, profileStatus = 'ready' as typeof mockProfileStatus } = {},
) => {
  mockSegments = [route];
  mockToken = token;
  mockProfileStatus = profileStatus;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<RootLayout />);
  });
  return tree;
};

/** The gate blocks the render while it is redirecting, so the stack
 *  being on screen is the observable "this route was allowed". */
const stackIsOnScreen = (tree: TestRenderer.ReactTestRenderer): boolean =>
  tree.root.findAll((node) => node.props?.testID === 'stack').length > 0;

describe('root route gate', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it('lets a signed-out visitor read 遗传与生育', () => {
    const tree = renderAt('p-genetics_family');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(stackIsOnScreen(tree)).toBe(true);
  });

  it('still sends a signed-out visitor to login everywhere else', () => {
    const tree = renderAt('p-manage');
    expect(mockReplace).toHaveBeenCalledWith('/p-login_register');
    expect(stackIsOnScreen(tree)).toBe(false);
  });

  it('does NOT bounce a signed-in patient off 遗传与生育', () => {
    // The regression that a single GUEST_ROUTES set would cause: the
    // tap on「遗传与生育」would land on 今天 instead.
    const tree = renderAt('p-genetics_family', { token: 'token-123' });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(stackIsOnScreen(tree)).toBe(true);
  });

  it('still bounces a signed-in user off the login screen', () => {
    renderAt('p-login_register', { token: 'token-123' });
    expect(mockReplace).toHaveBeenCalledWith('/p-home');
  });

  it('lets a signed-in user with no profile yet read 遗传与生育', () => {
    // Someone still deciding whether to build a profile is exactly who
    // this page is for; bouncing only them to onboarding while both a
    // guest and an onboarded patient may read it would be arbitrary.
    renderAt('p-genetics_family', { token: 'token-123', profileStatus: 'missing' });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('still walks a profile-less user to onboarding from a gated route', () => {
    renderAt('p-manage', { token: 'token-123', profileStatus: 'missing' });
    expect(mockReplace).toHaveBeenCalledWith('/p-register_profile?mode=onboarding');
  });
});
