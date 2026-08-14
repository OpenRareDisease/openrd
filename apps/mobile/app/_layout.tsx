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
import { LegalConsentProvider, useLegalConsentContext } from '../contexts/LegalConsentContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ADMIN_ROUTES, isAdminRole } from '../lib/admin-access';

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
// p-pregnancy qualifies on identical grounds to p-genetics_family: it
// reads no API, needs no token, and its reader is very often the person
// who has not registered — someone who found this app because they are
// pregnant or deciding whether to be. It was linked from the guest page
// before it was allowed to be one, so the button landed and the gate
// immediately replaced it with the login screen.
const GUEST_ROUTES = new Set(['p-login_register', 'p-genetics_family', 'p-pregnancy']);

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
  'p-pregnancy',
]);

/**
 * The back office is exempt too, and for a reason unlike the others.
 *
 * An administrator is an `app_users` row with `role = 'admin'`; nothing
 * says they also built a patient profile for themselves, and most will
 * not have. Without this, the first operator to open /p-admin would be
 * walked to 「补全你的健康档案」 — the onboarding form, asking the
 * back-office operator for their own diagnosis year before they may
 * look at a parse queue.
 */
for (const route of ADMIN_ROUTES) ONBOARDING_EXEMPT_ROUTES.add(route);

/**
 * Routes the re-consent gate lets through.
 *
 * The gate sends a patient whose accepted document version is older
 * than this build's to /p-legal_update, because 隐私政策 §9 promises
 * 「我们会在 App 内重新征得你的同意」 for a change of this kind and the
 * back office is one. These are the routes where redirecting would do
 * more harm than the ask does good:
 *
 *  - p-legal_update itself, or the gate replaces its own destination.
 *  - p-settings — 导出我的数据 and 注销账号 live there, and they are
 *    exactly what the consent screen tells a patient who does not want
 *    to agree to go and use. A gate that bounced them off that screen
 *    would make the offer a lie.
 *  - p-privacy_settings — the 授权记录 ledger and every withdrawal
 *    control, for the same reason.
 *  - p-about_us — the full legal texts.
 *  - p-login_register — a signed-in user is already bounced off it.
 *  - p-genetics_family / p-pregnancy — reading pages that call no API
 *    and are readable signed OUT. Interrupting only the signed-in
 *    reader would be arbitrary, the same argument that exempts them
 *    from the onboarding gate.
 *  - the back office — an administrator is an app_users row like any
 *    other and may owe a consent on their own patient account; that is
 *    not a reason to shut the parse queue.
 */
const RECONSENT_EXEMPT_ROUTES = new Set([
  'p-legal_update',
  'p-login_register',
  'p-settings',
  'p-privacy_settings',
  'p-about_us',
  'p-genetics_family',
  'p-pregnancy',
]);

for (const route of ADMIN_ROUTES) RECONSENT_EXEMPT_ROUTES.add(route);

function AppNavigator() {
  const navigationState = useRootNavigationState();
  const router = useRouter();
  const segments = useSegments();
  const { token, user, isHydrated } = useAuth();
  const { profileStatus } = useProfileContext();
  const { status: legalConsentStatus, deferred: legalConsentDeferred } = useLegalConsentContext();
  const currentRoute = segments[0] ?? '';
  const isGuestRoute = GUEST_ROUTES.has(currentRoute);
  const isSignedOutOnlyRoute = SIGNED_OUT_ONLY_ROUTES.has(currentRoute);
  const isOnboardingExempt = ONBOARDING_EXEMPT_ROUTES.has(currentRoute);
  // Every segment, not just the first: 我的 is app/(tabs)/p-settings.tsx,
  // so on that screen `segments[0]` is the group name '(tabs)' and a
  // `segments[0]` test would silently fail to exempt the one screen the
  // consent prompt sends a refusing patient to.
  const isReconsentExempt = segments.some((segment) => RECONSENT_EXEMPT_ROUTES.has(segment));
  /**
   * A back-office route opened by someone whose cached role is not
   * 'admin'.
   *
   * This is a DRAWING decision, not the access control — lib/admin-access.ts
   * says at length why, and the short version is that `requireAdmin`
   * re-reads the role from the database on every request, so a forged
   * local role buys a screen on which everything answers 403. What this
   * buys is that a patient who types /p-admin into WeChat's address bar
   * never sees a back-office shell paint at all, which §B4 asks for:
   * the entry point is not merely unlinked, it is not rendered.
   *
   * `user` is null for a moment after `isHydrated` while the stored
   * user JSON is parsed, but the gate below only runs once `isHydrated`
   * is true and both values are restored in the same hydration pass, so
   * an admin is not bounced off their own screen on a cold open. A
   * stored user JSON that fails to parse leaves `user` null with a
   * token present; that session is treated as non-admin here and has to
   * sign in again, which is already true of every other screen that
   * reads `user`.
   */
  const isAdminRouteForNonAdmin =
    ADMIN_ROUTES.has(currentRoute) && Boolean(token) && !isAdminRole(user?.role);
  // The gate fires ONLY on a confirmed 404 ('missing'). 'error' is
  // fail-open by design — see ProfileContext's status semantics.
  const needsOnboarding = Boolean(token) && profileStatus === 'missing' && !isOnboardingExempt;
  /**
   * A returning patient who accepted an older version of a document
   * this build has revised.
   *
   * Fires only on 'pending' — a confirmed answer from
   * `GET /legal/acceptances`. 'error' is fail-open for a reason the
   * onboarding gate does not have: an API we cannot read is an API we
   * cannot record an acceptance against either, so bouncing an offline
   * patient here would park them on a screen whose only button is
   * guaranteed to fail. See LegalConsentContext's status semantics.
   *
   * `deferred` is what keeps 暂不同意 from becoming a lockout: the ask
   * is real, but a refusal must leave the patient inside their own
   * record. It is memory-only, so a fresh visit asks again.
   */
  const needsReconsent =
    Boolean(token) &&
    legalConsentStatus === 'pending' &&
    !legalConsentDeferred &&
    !isReconsentExempt;

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

    // Before the onboarding gate: a non-admin on a back-office route
    // should land on 今天, not on 「补全你的健康档案」.
    if (isAdminRouteForNonAdmin) {
      router.replace('/p-home');
      return;
    }

    // Re-consent gate, ahead of onboarding: a revision that changes
    // who may read the record has to be answered before we ask the
    // patient for more of it. The consent screen's own 暂不同意 sets
    // `deferred`, so a refusal falls through to whatever gate is next
    // rather than looping here.
    if (needsReconsent) {
      router.replace('/p-legal_update');
      return;
    }

    // Onboarding gate: a logged-in user whose profile row is
    // confirmed missing is walked to the minimal setup screen before
    // anything else — previously they landed on an empty home screen
    // and had to discover profile setup via scattered 404 fallbacks.
    if (needsOnboarding) {
      router.replace('/p-register_profile?mode=onboarding');
    }
    // `isGuestRoute` and `isSignedOutOnlyRoute` are omitted on purpose.
    // Both are pure `Set.has(segments[0] ?? '')` reads over module-level
    // constants, and `segments` is already a dependency — neither can
    // change without `segments` changing first, so this effect can never
    // observe a stale copy of them. Listing them is redundant rather
    // than safer, which is why the warning is left standing instead of
    // being disabled.
  }, [
    isHydrated,
    navigationState?.key,
    router,
    segments,
    token,
    needsOnboarding,
    needsReconsent,
    isAdminRouteForNonAdmin,
  ]);

  const shouldBlockRender =
    isHydrated &&
    Boolean(navigationState?.key) &&
    ((!token && !isGuestRoute) ||
      (token && isSignedOutOnlyRoute) ||
      isAdminRouteForNonAdmin ||
      needsReconsent ||
      needsOnboarding);

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
        {/* The re-consent §9 promises. Reached by the gate above, not
            by a link from anywhere. */}
        <Stack.Screen name="p-legal_update" options={{ title: '隐私政策更新页' }} />
        <Stack.Screen name="p-about_us" options={{ title: '关于我们页' }} />
        <Stack.Screen name="p-clinical_passport" options={{ title: 'FSHD临床护照页' }} />
        <Stack.Screen name="p-data_donation" options={{ title: '数据捐赠页' }} />
        <Stack.Screen name="p-resource_map" options={{ title: '医疗资源地图页' }} />
        {/* app/p-genetics_family.tsx existed with no entry here, which
            by this list's own rule means it was silently losing its
            declared title. */}
        <Stack.Screen name="p-genetics_family" options={{ title: '遗传与生育页' }} />
        {/* Without this the route loses its title after hydration in
            WeChat's browser — the defect commit 1e82bc6 fixed for
            p-genetics_family, which this page would otherwise repeat. */}
        <Stack.Screen name="p-pregnancy" options={{ title: '孕期时间线页' }} />
        <Stack.Screen name="p-surveillance" options={{ title: '随访计划页' }} />
        <Stack.Screen name="p-disability_assessment" options={{ title: '残疾评定准备页' }} />
        <Stack.Screen name="p-rare_disease_status" options={{ title: '罕见病身份与权益页' }} />
        <Stack.Screen name="p-referral" options={{ title: '协作网转诊包页' }} />
        <Stack.Screen name="p-falls" options={{ title: '跌倒记录页' }} />
        {/* The back office. Declared here like every other route —
            app/__tests__/route-registry.test.ts asserts that every file
            in app/ has an entry, and a missing one loses the route's
            title after hydration. Declaring them does NOT make them
            reachable: the gate above replaces them with /p-home for
            anyone whose cached role is not 'admin', and the server
            refuses every request behind them regardless. */}
        <Stack.Screen name="p-admin" options={{ title: '后台运维概览页' }} />
        <Stack.Screen name="p-admin_patients" options={{ title: '后台患者列表页' }} />
        <Stack.Screen name="p-admin_patient" options={{ title: '后台患者档案页' }} />
        <Stack.Screen name="p-admin_export" options={{ title: '后台全量导出页' }} />
        {/* Not a rename of p-trial_square, which stays where it is: that
            one is the pre-launch「试验匹配」placeholder behind
            EXPO_PUBLIC_ENABLE_EXPLORE and still opens an
            UnavailableScreen. This one lists what the registries
            actually say, with the date we copied it. */}
        <Stack.Screen name="p-trials" options={{ title: '临床试验页' }} />
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
            {/* Inside ProfileProvider so both gates read one hydrated
                token, and outside AppNavigator because the consent
                screen it gates needs the same instance — a second read
                would let the screen record an acceptance the gate never
                learns about. */}
            <LegalConsentProvider>
              <AppNavigator />
            </LegalConsentProvider>
          </ProfileProvider>
        </AuthProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
