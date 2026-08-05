import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { APP_TITLE } from '../lib/app-identity';
import { StatusBar } from 'expo-status-bar';
import { LogBox, Platform } from 'react-native';
import { useEffect } from 'react';
import { AuthProvider } from '../contexts/AuthContext';
import { AppDialogProvider } from '../screens/common/feedback/AppDialog';
import { useAuth } from '../contexts/AuthContext';
import { ProfileProvider, useProfileContext } from '../contexts/ProfileContext';
import { ErrorBoundary } from '../components/ErrorBoundary';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
  // 添加其它想暂时忽略的错误或警告信息
]);

/**
 * Routes a signed-out visitor may open. Everything else redirects to
 * the login screen.
 *
 * p-genetics_family is here because「会遗传给孩子吗」is the question
 * that brings people to this app before they have decided to trust it
 * with a phone number, and that page answers it completely, with the
 * source named on every section (lib/genetics-family-content.ts). It
 * reads no API and needs no token. Making someone register to read a
 * cited reference page is a toll on the one thing we can give away.
 */
const GUEST_ROUTES = new Set(['p-login_register', 'p-genetics_family']);

/**
 * The subset of GUEST_ROUTES a *signed-in* user must be bounced off.
 *
 * This used to be the same set, which is the trap in adding anything
 * to GUEST_ROUTES: the gate below reads `token && isGuestRoute` and
 * replaces with /p-home, so a second guest route would have become
 * unreachable for every logged-in patient — the tap on「遗传与生育」
 * from 我的 would have bounced straight back to 今天. Only the login
 * form itself belongs here: it is the sign-in screen, and showing it to
 * someone who already has a session is a dead end.
 */
const SIGNED_OUT_ONLY_ROUTES = new Set(['p-login_register']);

// Routes reachable while the profile is still missing. The onboarding
// destination itself must be exempt (or the gate would loop), and
// about-us carries the legal texts a user may want before filling in
// medical data. p-genetics_family is exempt for the same reason it is
// a guest route: a signed-out visitor and a fully onboarded patient can
// both read it, and bouncing only the person in between — who is
// deciding whether to build a profile at all — would be arbitrary.
const ONBOARDING_EXEMPT_ROUTES = new Set([
  'p-login_register',
  'p-register_profile',
  'p-about_us',
  'p-genetics_family',
]);

function AppNavigator() {
  const navigationState = useRootNavigationState();
  const router = useRouter();
  const segments = useSegments();
  const { token, isHydrated } = useAuth();
  const { profileStatus } = useProfileContext();
  const currentRoute = segments[0] ?? '';
  const isGuestRoute = GUEST_ROUTES.has(currentRoute);
  const isSignedOutOnlyRoute = SIGNED_OUT_ONLY_ROUTES.has(currentRoute);
  const isOnboardingExempt = ONBOARDING_EXEMPT_ROUTES.has(currentRoute);
  // The gate fires ONLY on a confirmed 404 ('missing'). 'error' is
  // fail-open by design — see ProfileContext's status semantics.
  const needsOnboarding = Boolean(token) && profileStatus === 'missing' && !isOnboardingExempt;

  // NOTE: there used to be a useEffect here that fired
  // `window.parent.postMessage({ type: 'chux-path-change', pathname,
  // search }, '*')` on every navigation. It was a low-code-editor
  // preview hook with no consumer in this product, and on the web
  // export — the only channel that ships — it handed any page that
  // framed us the patient's whole browsing trail, including the
  // `documentId` query param that /p-report_detail carries. Broadcast
  // to targetOrigin '*' means every frame ancestor receives it, so
  // there was no "only our own host" about it. Do not reintroduce a
  // parent-frame channel: nothing in this app is embedded, and route
  // params here are medical identifiers.

  // Keep the document title the product's name.
  //
  // +html.tsx serves the right <title>, and og:title (what a link
  // forwarded into a patient group renders from) comes from that static
  // HTML and is correct regardless. But react-navigation syncs
  // document.title from the focused screen's `options.title` after
  // hydration, and those options carry developer labels
  // ('底部导航栏', '登录注册页'). Measured in a browser: the result is an
  // empty title bar. WeChat's in-app browser renders that bar, and an
  // empty one reads as a page that failed to load — on the one screen a
  // patient reaches by tapping a link someone sent them.
  //
  // Keyed on `segments` so it re-applies after each navigation rather
  // than racing the first one.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.title !== APP_TITLE) document.title = APP_TITLE;
  }, [segments]);

  useEffect(() => {
    if (!isHydrated || !navigationState?.key) {
      return;
    }

    if (!token && !isGuestRoute) {
      router.replace('/p-login_register');
      return;
    }

    if (token && isSignedOutOnlyRoute) {
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
    ((!token && !isGuestRoute) || (token && isSignedOutOnlyRoute) || needsOnboarding);

  if (shouldBlockRender) {
    return null;
  }

  return (
    // AppDialogProvider wraps the whole stack because confirmations
    // and notices are cross-screen concerns — and because the thing it
    // replaces, `Alert.alert`, was a no-op on web (see AppDialog.tsx).
    <AppDialogProvider>
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
        {/* This list must match the files in app/ exactly. expo-router
            resolves it on every render (not inside a memo), so a name
            with no matching route warns on every render, and a route
            with no entry silently loses its declared title. The four
            bar destinations — p-home, p-manage, p-qna, p-settings —
            live under (tabs) and take their titles from that layout, so
            they must NOT be repeated here. p-archive is the one that
            moved out of the bar into this stack; p-qna went the other
            way and got its tab back (see AppTabBar), which is why it
            has no entry below. */}
        <Stack.Screen name="p-archive" options={{ title: '我的档案页' }} />
        <Stack.Screen name="p-report_management" options={{ title: '报告管理页' }} />
        <Stack.Screen name="p-report_detail" options={{ title: '报告详情页' }} />
        <Stack.Screen name="p-timeline_detail" options={{ title: '时间轴详情页' }} />
        <Stack.Screen name="p-audit_history" options={{ title: '隐私审计记录页' }} />
        <Stack.Screen name="p-community" options={{ title: '患者社区页' }} />
        <Stack.Screen name="p-rehab_share" options={{ title: '康复经验分享页' }} />
        <Stack.Screen name="p-trial_square" options={{ title: '临床试验广场页' }} />
        <Stack.Screen name="p-expert_consult" options={{ title: '专家咨询页' }} />
        <Stack.Screen name="p-privacy_settings" options={{ title: '隐私设置页' }} />
        <Stack.Screen name="p-about_us" options={{ title: '关于我们页' }} />
        <Stack.Screen name="p-clinical_passport" options={{ title: 'FSHD临床护照页' }} />
        <Stack.Screen name="p-data_donation" options={{ title: '数据捐赠页' }} />
        <Stack.Screen name="p-resource_map" options={{ title: '医疗资源地图页' }} />
        {/* app/p-genetics_family.tsx existed with no entry here, which
            by this list's own rule means it was silently losing its
            declared title. */}
        <Stack.Screen name="p-genetics_family" options={{ title: '遗传与生育页' }} />
      </Stack>
    </AppDialogProvider>
  );
}

export default function RootLayout() {
  return (
    // The boundary sits inside GestureHandlerRootView (it needs the
    // flex:1 host to fill the screen) but outside every provider, so a
    // throw while AuthProvider hydrates the token — or anywhere below
    // it — still lands on a readable screen instead of unmounting the
    // SPA to white. See components/ErrorBoundary.tsx.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AuthProvider>
          <ProfileProvider>
            <AppNavigator />
          </ProfileProvider>
        </AuthProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
