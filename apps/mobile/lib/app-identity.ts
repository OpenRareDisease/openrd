/**
 * The product's name and how it describes itself, in one place.
 *
 * Lives here rather than in `app/+html.tsx` because that file is only
 * evaluated by the static-export / SSR step — it is not part of the
 * client bundle, and importing a constant from it at runtime yields
 * `undefined`. Measured, not assumed: a first attempt read APP_TITLE
 * from `+html.tsx` inside the root layout and the browser tab said the
 * literal string "undefined".
 *
 * Every screen that names or versions the build imports from here. The
 * set of them is deliberately not listed: it grows, and a list in a
 * comment is what goes stale while the code stays fine. `grep -rn
 * app-identity apps/mobile` answers it. What holds the screens to it is
 * a test each, pinning that the name they draw is THIS one — see
 * screens/p-login_register/__tests__/app-name.test.tsx,
 * screens/p-settings/__tests__/version-footer.test.tsx and
 * screens/p-about_us/__tests__/index.test.tsx.
 */
import Constants from 'expo-constants';

/** The product's name to a patient. NOT the repository name. */
export const APP_NAME = '肌愈通';

/** Document title. Name first: WeChat's title bar truncates hard and
 *  the name is the part that has to survive. */
export const APP_TITLE = '肌愈通 — FSHD 患者自我管理';

/** What a forwarded link says about itself in a group chat. Describes
 *  what the app does; makes no claim about outcomes. */
export const APP_DESCRIPTION =
  '面向面肩肱型肌营养不良（FSHD）患者的自我管理平台：记录症状与肌力变化，整理化验单和检查报告，查阅带出处的疾病知识。';

/** BCP 47: Simplified Chinese, mainland. */
export const APP_LANG = 'zh-Hans-CN';

/** Matches COLOR.paper in lib/design.ts. Not imported from there: the
 *  document shell renders in the export step and pulling in the token
 *  file (and its react-native-web deps) to read one hex string would
 *  drag the whole design system into the HTML build. */
export const APP_THEME_COLOR = '#FBF8F3';

/**
 * The build's version, read from the Expo config rather than typed in.
 *
 * Lives here, next to APP_NAME, because both are answers to «what is
 * this thing called and which one is it» and both were previously
 * typed by hand into individual screens. 设置 said 「FSHD-openrd
 * v1.0.0」 while app.json said 2.5.0 — one and a half years of releases
 * apart, on the screen a patient is told to read back when reporting a
 * problem. A version string that is wrong is worse than absent: it
 * sends the person reading it to the wrong build.
 *
 * Returns undefined rather than a placeholder when the config is
 * unreadable. A version we cannot read is not one we may guess at.
 */
export const readAppVersion = (): string | undefined => Constants.expoConfig?.version ?? undefined;
