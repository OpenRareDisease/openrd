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
 * Three places have to agree and are edited at different times: the
 * document shell, the root layout's title sync, and the about screen.
 */

/** The product's name to a patient. NOT the repository name — the login
 *  screen used to render 「FSHD-openrd」 as its largest element. */
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
