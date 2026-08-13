/**
 * The web document shell — app/+html.tsx and app.json's `web` block.
 *
 * This product ships as an Expo *web* export and is distributed by
 * patients pasting a link into a group chat, usually opened inside
 * WeChat's in-app browser. Before app/+html.tsx existed, every route
 * was served with Expo Router's default template: `lang="en"` and an
 * empty `<title>`. That meant a blank WeChat title bar, a forwarded
 * link that rendered as a bare URL with no name and no description, an
 * unnamed bookmark, and a screen reader pronouncing Chinese medical
 * records with an English voice.
 *
 * None of that shows up in a screenshot or a unit test of a screen,
 * which is exactly why it survived — so it is asserted here.
 *
 * File location: this test sits at the app root rather than under
 * `app/`, because Expo Router's require.context turns every .tsx under
 * `app/` into a route. A `app/__tests__/…` file would ship as a
 * navigable screen.
 */

import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { ScrollViewStyleReset } from 'expo-router/html';
import Root, {
  APP_DESCRIPTION,
  APP_LANG,
  APP_NAME,
  APP_THEME_COLOR,
  APP_TITLE,
} from '../app/+html';
import appConfig from '../app.json';

const render = (): TestRenderer.ReactTestRenderer => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <Root>
        <div id="root" />
      </Root>,
    );
  });
  return tree;
};

/** The `content` of a <meta> matched by one of its identifying props. */
const metaContent = (
  tree: TestRenderer.ReactTestRenderer,
  key: 'name' | 'property',
  value: string,
) => {
  const matches: ReactTestInstance[] = tree.root.findAll(
    (node) => node.type === 'meta' && node.props?.[key] === value,
  );
  expect(matches).toHaveLength(1);
  return matches[0].props.content as string;
};

describe('language', () => {
  it('declares Simplified Chinese on the document, not English', () => {
    const html = render().root.findAll((node) => node.type === 'html');
    expect(html).toHaveLength(1);
    expect(html[0].props.lang).toBe('zh-Hans-CN');
    expect(APP_LANG).toBe('zh-Hans-CN');
  });

  it('agrees with app.json, which is what the PWA manifest reads', () => {
    // Two files, edited at different times, describing one document.
    expect(appConfig.expo.web.lang).toBe(APP_LANG);
  });
});

describe('title', () => {
  it('is not empty — WeChat renders it as the title bar', () => {
    const titles = render().root.findAll((node) => node.type === 'title');
    expect(titles).toHaveLength(1);
    expect(titles[0].props.children).toBe(APP_TITLE);
    expect(APP_TITLE.trim().length).toBeGreaterThan(0);
  });

  it('leads with the product name, since the bar truncates', () => {
    expect(APP_TITLE.startsWith(APP_NAME)).toBe(true);
  });
});

describe('naming', () => {
  it('calls the product 肌愈通 rather than the repository name', () => {
    expect(APP_NAME).toBe('肌愈通');
    for (const text of [APP_TITLE, APP_DESCRIPTION, appConfig.expo.web.description]) {
      expect(text).not.toMatch(/openrd/i);
    }
    expect(appConfig.expo.web.name).toBe(APP_NAME);
    expect(appConfig.expo.web.shortName).toBe(APP_NAME);
  });
});

describe('share card', () => {
  it('gives a forwarded link a name and a description', () => {
    // Without og:title a WeChat / QQ forward is a bare URL, and the
    // paste into a patient group is this product's whole funnel.
    const tree = render();
    // Compared to the constants *and* checked non-empty, so the
    // comparison cannot pass by both sides being blank.
    expect(metaContent(tree, 'property', 'og:title')).toBe(APP_TITLE);
    expect(metaContent(tree, 'property', 'og:title').trim().length).toBeGreaterThan(0);
    expect(metaContent(tree, 'property', 'og:description')).toBe(APP_DESCRIPTION);
    expect(metaContent(tree, 'property', 'og:description').trim().length).toBeGreaterThan(0);
    expect(metaContent(tree, 'property', 'og:site_name')).toBe(APP_NAME);
    expect(metaContent(tree, 'property', 'og:type')).toBe('website');
    expect(metaContent(tree, 'property', 'og:locale')).toBe('zh_CN');
    expect(metaContent(tree, 'name', 'description')).toBe(APP_DESCRIPTION);
    expect(APP_DESCRIPTION.trim().length).toBeGreaterThan(0);
  });

  it('references no external host', () => {
    // No CDN and no webfont reaches these users: both the CSP and the
    // GFW apply. An og:image would need an absolute URL this build does
    // not know, so there is deliberately none.
    const html = JSON.stringify(render().toJSON());
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('keeps the theme colour in step with app.json', () => {
    expect(metaContent(render(), 'name', 'theme-color')).toBe(APP_THEME_COLOR);
    expect(appConfig.expo.web.themeColor).toBe(APP_THEME_COLOR);
  });

  it('keeps the manifest description in step with the meta description', () => {
    expect(appConfig.expo.web.description).toBe(APP_DESCRIPTION);
  });
});

describe('scroll behaviour', () => {
  it('still emits Expo Router’s ScrollView reset', () => {
    // Supplying a custom +html.tsx replaces Expo's default template
    // wholesale. Drop this and the page grows a second, outer scroll
    // bar that fights every in-app ScrollView — the regression that
    // writing this file could most easily have introduced.
    expect(render().root.findAllByType(ScrollViewStyleReset)).toHaveLength(1);
  });
});

/**
 * The identity constants must live in a module the CLIENT bundle can
 * reach.
 *
 * `app/+html.tsx` is evaluated only by the export / SSR step. A first
 * attempt defined APP_TITLE there and imported it into the root layout
 * to re-apply the document title after each navigation; it typechecked,
 * every test passed, and the browser tab said the literal string
 * "undefined" — because at runtime the import resolved to nothing.
 *
 * This is the platform-shaped hole that no amount of reading catches,
 * so it gets a test instead of a comment.
 */
describe('身份常量必须在客户端 bundle 里拿得到', () => {
  const read = (p: string) =>
    require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf8');

  it('常量定义在 lib/app-identity.ts，不在 +html.tsx', () => {
    expect(read('lib/app-identity.ts')).toContain('export const APP_TITLE');
    // +html.tsx may re-export them, but must not be the definition.
    expect(read('app/+html.tsx')).not.toMatch(/export const APP_TITLE\s*=/);
  });

  it('根布局不从 +html 引常量', () => {
    // Importing from an export-only module is the exact failure above,
    // and it fails silently: undefined, not a crash.
    expect(read('app/_layout.tsx')).not.toMatch(/from ['"]\.\/\+html['"]/);
    expect(read('app/_layout.tsx')).toContain('app-identity');
  });

  it('根布局在导航之后把标题写回来', () => {
    // react-navigation syncs document.title from each screen's
    // `options.title`, and those carry developer labels
    // ('底部导航栏', '登录注册页'). Without this the WeChat title bar
    // ends up empty on the one screen reached by tapping a shared link.
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('document.title = APP_TITLE');
    expect(layout).toMatch(/\[segments\]/);
  });
});
