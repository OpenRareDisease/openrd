/**
 * Whether this app draws the back office at all.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not access control. The role read here comes from
 * `AuthContext`'s `user`, which is the login response stored at sign-in
 * (`AuthResponse.user.role` in lib/api.ts). It can be stale —
 * `npm run admin:revoke` changes a row in `app_users` and nothing
 * pushes that to a handset — and on the channel that actually ships it
 * is editable by the person holding the phone: lib/session-storage.ts
 * puts session values in SecureStore only on the native shells, and on
 * `Platform.OS === 'web'` it falls back to AsyncStorage, i.e. the
 * browser's own localStorage.
 *
 * What actually guards a patient's record is `requireAdmin` in
 * apps/api/src/middleware/require-admin.ts: it re-reads `role` and
 * `is_active` FROM THE DATABASE on every admin request, so a revoked
 * administrator's next request is refused whatever this module thinks.
 * Someone who forges a local `role: 'admin'` gets a screen on which
 * every request answers 403, and the screens below render that as
 * 「你的账号没有后台权限」 rather than as an empty dashboard.
 *
 * WHAT IT IS FOR
 * --------------
 * §B4 asks for an entry point that is invisible to a patient — not
 * merely unlinked, but not rendered. Two callers:
 *
 *  - 我的 (screens/p-settings) omits the row entirely.
 *  - app/_layout.tsx refuses to render the routes and replaces them
 *    with /p-home, so typing /p-admin into WeChat's address bar does
 *    not paint a back-office shell at a patient before the 403 lands.
 *
 * Both are drawing decisions, which is why they may be made from a
 * cached value: the cost of getting one wrong is a screen that shows
 * an error, not a record that leaks.
 */

/** `app_users.role`. Admitted by `app_users_role_check` since migration
 *  011; granted only by `npm run admin:grant`, which needs a shell on
 *  the host. The registration schema's enum does NOT include it
 *  (auth.schema.ts) — see contract §B1. */
const ADMIN_ROLE = 'admin';

export const isAdminRole = (role: string | null | undefined): boolean => role === ADMIN_ROLE;

/**
 * The `segments[0]` of every back-office route.
 *
 * Kept beside `isAdminRole` rather than inside app/_layout.tsx so the
 * gate and the list it gates cannot be edited apart, and so a test can
 * assert the list matches the files in app/ without importing
 * expo-router.
 */
export const ADMIN_ROUTES = new Set([
  'p-admin',
  'p-admin_patients',
  'p-admin_patient',
  'p-admin_export',
]);
