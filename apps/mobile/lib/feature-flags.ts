/**
 * Build-time feature flags.
 *
 * The five "探索" destinations (community, expert consult, trial
 * square, resource map, rehab share) are all pre-launch placeholders.
 * Until PR-30 they occupied navigation budget in Settings alongside
 * privacy, audit and deletion — genuinely serious features — which
 * made the list read as though everything in it were equally real.
 *
 * They now sit behind a flag instead of behind a「即将上线」badge:
 * off by default, flipped per-build via EXPO_PUBLIC_ENABLE_EXPLORE.
 * The screens and their routes stay in the tree, so a deep link (or
 * flipping the flag) brings a feature back with no code change — the
 * flag governs discoverability, not existence.
 *
 * Where to actually set these
 * ---------------------------
 * `apps/mobile/.env` — the Expo project root, NOT the repository root,
 * which Expo does not read. Both keys are documented in
 * apps/mobile/.env.example.
 *
 * The Docker web image is a separate path and does not read that file:
 * it only forwards EXPO_PUBLIC_API_URL as a build ARG. Turning either
 * flag on for a compose build therefore needs an `ARG` in
 * Dockerfile.web plus an `args:` entry in docker-compose.yml, mirroring
 * how EXPO_PUBLIC_API_URL is plumbed. Until someone needs that, an env
 * var exported around `docker compose build` is silently dropped at
 * bundle time — which is worth knowing before spending an afternoon on
 * it.
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
  /** Surface the pre-launch 探索 section in Settings. */
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
