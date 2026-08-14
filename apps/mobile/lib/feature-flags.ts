/**
 * Build-time feature flags.
 *
 * `explore` gates the 探索 group in Settings: the destinations that
 * are still placeholders, each of which opens an UnavailableScreen.
 * Until PR-30 they occupied navigation budget alongside privacy, audit
 * and deletion — genuinely serious features — which made the list read
 * as though everything in it were equally real.
 *
 * They sit behind the flag instead of behind a「即将上线」badge: off by
 * default, flipped per-build via EXPO_PUBLIC_ENABLE_EXPLORE. The
 * screens and their routes stay in the tree either way, so a deep link
 * (or flipping the flag) reaches one with no code change — the flag
 * governs discoverability, not existence.
 *
 * Which destinations are still in that group is a question for the
 * group itself, in screens/p-settings; a page leaves it once it is
 * finished and picks up a row elsewhere in Settings. A second copy of
 * the list here is what goes stale while the code stays fine — this
 * docblock listed 患者社区 and 康复经验分享 as pre-launch placeholders
 * while both were already shipped pages.
 *
 * Prose that describes a feature is subject to the same rule from the
 * other side: a sentence about something still in the group belongs
 * behind this flag, and a sentence about a page that has left it must
 * not be, or a default build hides a feature the app ships and links
 * to.
 *
 * Where to actually set these
 * ---------------------------
 * `apps/mobile/.env` — the Expo project root, NOT the repository root,
 * which Expo does not read. Both keys are documented in
 * apps/mobile/.env.example.
 *
 * The Docker web image is a separate path and does not read that file:
 * apps/mobile/Dockerfile.web declares an `ARG` per key and the `web`
 * service in docker-compose.yml passes each one through, so a compose
 * build takes them from the shell environment (or the repository-root
 * .env compose interpolates) rather than from apps/mobile/.env.
 *
 * These are build-time constants: Metro inlines them, so flipping one
 * always means a rebuild, never a restart.
 */

const readBooleanEnv = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export const FEATURE_FLAGS = {
  /** Surface the 探索 group of placeholder destinations in Settings. */
  explore: readBooleanEnv(process.env.EXPO_PUBLIC_ENABLE_EXPLORE, false),

  /**
   * Surface the 个性化设置 entry (大字体 / 语音读屏 / 高对比度).
   *
   * Off until it does something. It currently opens an alert saying
   * the feature is coming — and of everything in this app that could
   * be a placeholder, accessibility settings are the worst candidate:
   * the people who tap that row are the ones who need it to be real,
   * and telling them to wait is a worse answer than not offering it.
   *
   * The underlying work (a text-scale context threaded through 22
   * screens of fixed-size StyleSheets, plus a contrast palette) is
   * its own piece of work, not a checkbox. Until then the app's
   * accessibility lives in the things that don't need a settings
   * screen — touch targets (see lib/a11y.ts) and labelled controls.
   */
  personalization: readBooleanEnv(process.env.EXPO_PUBLIC_ENABLE_PERSONALIZATION, false),
} as const;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;

export const isFeatureEnabled = (name: FeatureFlagName): boolean => FEATURE_FLAGS[name];
