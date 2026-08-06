import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-pregnancy';

/**
 * 孕期时间线.
 *
 * TWO ENTRIES ARE STILL MISSING IN app/_layout.tsx, which this lane did
 * not own. Until they are added:
 *
 *  1. This route has no <Stack.Screen> entry, so by that list's own
 *     stated rule it silently loses its declared title — the same
 *     defect app/p-genetics_family.tsx carried until it was found.
 *     Wanted: <Stack.Screen name="p-pregnancy" options={{ title: '孕期时间线页' }} />
 *
 *  2. It is not in GUEST_ROUTES or ONBOARDING_EXEMPT_ROUTES, so a
 *     signed-out reader who taps through from 遗传与生育 — itself a
 *     guest route, precisely because it is the front door — is bounced
 *     to the login screen. This page qualifies on exactly the same
 *     grounds p-genetics_family does: it reads no API, needs no token,
 *     and every claim on it is sourced. Note that GUEST_ROUTES is the
 *     one to extend, NOT SIGNED_OUT_ONLY_ROUTES, which would make the
 *     page unreachable for logged-in patients (see the comment there).
 */
export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
