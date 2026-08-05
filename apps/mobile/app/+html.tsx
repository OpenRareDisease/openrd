import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The document shell every web route is rendered into.
 *
 * Why this file exists at all
 * --------------------------
 * There was no `+html.tsx`, so the static export used Expo Router's
 * built-in template: `<html lang="en">` and an empty `<title>`. This
 * product ships as an Expo *web* export — a patient opens it in a
 * phone browser, very often WeChat's in-app one — so that default was
 * the actual document served to every user, on every route:
 *
 *  - WeChat's title bar renders the document title. Empty title, blank
 *    bar; the app looked like a page that had failed to load.
 *  - A link pasted into a patient group renders as a bare URL with no
 *    name and no description. That paste *is* this product's entire
 *    distribution channel — nobody finds it through an app store.
 *  - A bookmark saved from the home screen had no name.
 *  - `lang="en"` tells a screen reader to pronounce Chinese medical
 *    records with an English voice, which for 肌力评估 or 化验单 is not
 *    "accented" but unintelligible. The people most likely to be using
 *    a screen reader here are the ones least able to work around it.
 *
 * `zh-Hans-CN` rather than `zh`: Simplified script, mainland region.
 * Every patient-facing string in this app is Simplified Chinese, and
 * the region tag is what gets number/date formatting right.
 *
 * Kept as exported constants because the same strings have to agree
 * across three places that are edited at different times — this file,
 * `app.json`'s `web` block (the PWA manifest / bookmark name), and the
 * about screen. See __tests__/document-shell.test.tsx, which fails if
 * they drift apart.
 */

/** The product's name to a patient. NOT the repository name. */
export const APP_NAME = '肌愈通';

/** Document title. Name first, because WeChat's title bar truncates
 *  hard and the name is the part that has to survive. */
export const APP_TITLE = '肌愈通 — FSHD 患者自我管理';

/** What a forwarded link says about itself in a group chat. Describes
 *  only what the app actually does; no claim about outcomes. */
export const APP_DESCRIPTION =
  '面向面肩肱型肌营养不良（FSHD）患者的自我管理平台：记录症状与肌力变化，整理化验单和检查报告，查阅带出处的疾病知识。';

/** BCP 47: Simplified Chinese, mainland. */
export const APP_LANG = 'zh-Hans-CN';

/** Matches COLOR.paper in lib/design.ts. Not imported from there: this
 *  module is rendered by the static-export step and pulling in the
 *  design system (and its react-native-web dependencies) to read one
 *  hex string would drag the whole token file into the HTML build. */
export const APP_THEME_COLOR = '#FBF8F3';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang={APP_LANG}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <title>{APP_TITLE}</title>
        <meta name="description" content={APP_DESCRIPTION} />
        <meta name="application-name" content={APP_NAME} />
        <meta name="theme-color" content={APP_THEME_COLOR} />

        {/* Open Graph is what WeChat, QQ and most Chinese clients read
            when someone forwards the link. Without og:title they fall
            back to the raw URL.

            Deliberately no og:image: the spec requires an absolute URL,
            this deployment's origin is not known at build time, and an
            image hosted anywhere external would be blocked by both the
            CSP and the GFW. Clients that want a thumbnail fall back to
            the first image on the page, which is served from our own
            origin. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={APP_NAME} />
        <meta property="og:title" content={APP_TITLE} />
        <meta property="og:description" content={APP_DESCRIPTION} />
        <meta property="og:locale" content="zh_CN" />

        {/*
          Disables body scrolling on web so ScrollView components work
          as they do on native. Remove this and the page gets a second,
          outer scroll bar that fights every in-app ScrollView. Keep it
          before any custom styles.
        */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
