import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  Stack,
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
  useRouter,
  useSegments,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { useEffect } from 'react';
import { AuthProvider } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { ProfileProvider, useProfileContext } from '../contexts/ProfileContext';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
  // 添加其它想暂时忽略的错误或警告信息
]);

const GUEST_ROUTES = new Set(['p-login_register']);

// Routes reachable while the profile is still missing. The onboarding
// destination itself must be exempt (or the gate would loop), and
// about-us carries the legal texts a user may want before filling in
// medical data.
const ONBOARDING_EXEMPT_ROUTES = new Set(['p-login_register', 'p-register_profile', 'p-about_us']);

function AppNavigator() {
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams();
  const navigationState = useRootNavigationState();
  const router = useRouter();
  const segments = useSegments();
  const { token, isHydrated } = useAuth();
  const { profileStatus } = useProfileContext();
  const currentRoute = segments[0] ?? '';
  const isGuestRoute = GUEST_ROUTES.has(currentRoute);
  const isOnboardingExempt = ONBOARDING_EXEMPT_ROUTES.has(currentRoute);
  // The gate fires ONLY on a confirmed 404 ('missing'). 'error' is
  // fail-open by design — see ProfileContext's status semantics.
  const needsOnboarding = Boolean(token) && profileStatus === 'missing' && !isOnboardingExempt;

  useEffect(() => {
    if (!pathname) {
      return;
    }
    let searchString = '';
    if (Object.keys(searchParams).length > 0) {
      const queryString = Object.keys(searchParams)
        .map((key) => {
          const value = searchParams[key];
          if (typeof value === 'string') {
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('&');

      searchString = '?' + queryString;
    }

    const pageId = pathname.replace('/', '').toUpperCase();
    if (typeof window === 'object' && window.parent && window.parent.postMessage) {
      window.parent.postMessage(
        {
          type: 'chux-path-change',
          pageId: pageId,
          pathname: pathname,
          search: searchString,
        },
        '*',
      );
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!isHydrated || !navigationState?.key) {
      return;
    }

    if (!token && !isGuestRoute) {
      router.replace('/p-login_register');
      return;
    }

    if (token && isGuestRoute) {
      router.replace('/p-home');
      return;
    }

    // Onboarding gate: a logged-in user whose profile row is
    // confirmed missing is walked to the minimal setup screen before
    // anything else — previously they landed on an empty home screen
    // and had to discover profile setup via scattered 404 fallbacks.
    if (needsOnboarding) {
      router.replace('/p-register_profile?mode=onboarding');
    }
  }, [isHydrated, navigationState?.key, router, segments, token, needsOnboarding]);

  const shouldBlockRender =
    isHydrated &&
    Boolean(navigationState?.key) &&
    ((!token && !isGuestRoute) || (token && isGuestRoute) || needsOnboarding);

  if (shouldBlockRender) {
    return null;
  }

  return (
    <>
      <StatusBar style="light"></StatusBar>
      <Stack
        screenOptions={{
          animation: 'slide_from_right',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          headerShown: false,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ title: '底部导航栏' }} />
        <Stack.Screen name="p-login_register" options={{ title: '登录注册页' }} />
        <Stack.Screen name="p-register_profile" options={{ title: '编辑档案页' }} />
        <Stack.Screen name="p-data_entry" options={{ title: '添加/更新数据页' }} />
        <Stack.Screen name="p-manage" options={{ title: '病程管理页' }} />
        <Stack.Screen name="p-rehab_share" options={{ title: '康复经验分享页' }} />
        <Stack.Screen name="p-trial_square" options={{ title: '临床试验广场页' }} />
        <Stack.Screen name="p-expert_consult" options={{ title: '专家咨询页' }} />
        <Stack.Screen name="p-privacy_settings" options={{ title: '隐私设置页' }} />
        <Stack.Screen name="p-about_us" options={{ title: '关于我们页' }} />
        <Stack.Screen name="p-clinical_passport" options={{ title: 'FSHD临床护照页' }} />
        <Stack.Screen name="p-data_donation" options={{ title: '数据捐赠页' }} />
        <Stack.Screen name="p-resource_map" options={{ title: '医疗资源地图页' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ProfileProvider>
          <AppNavigator />
        </ProfileProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
