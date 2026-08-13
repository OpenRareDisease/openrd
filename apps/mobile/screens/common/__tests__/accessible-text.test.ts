/**
 * @jest-environment jsdom
 */

/**
 * The helper the two citation-grade web tests read the page with.
 *
 * It has to be tested on its own, and specifically on the two cases
 * `textContent` gets wrong. A version of `accessibleText` that quietly
 * degraded to `textContent` would make both of those suites tautological
 * again — which is the exact shape of the bug they were written to
 * close, one level down.
 */

import { accessibleText } from '../__testutils__/accessible-text';

const render = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('accessibleText', () => {
  it('读到普通文字', () => {
    expect(accessibleText(render('<p>指南/共识</p>'))).toBe('指南/共识');
  });

  it('aria-hidden 的内容读不到 —— textContent 却照样读得到', () => {
    const host = render('<span aria-hidden="true">指南/共识</span>');
    expect(host.textContent).toBe('指南/共识');
    expect(accessibleText(host)).toBe('');
  });

  it('aria-label 顶替掉节点自己的内容 —— textContent 完全看不见它', () => {
    const host = render('<span aria-label="病友经验"></span>');
    expect(host.textContent).toBe('');
    expect(accessibleText(host)).toBe('病友经验');
  });

  it('display:none / visibility:hidden 都读不到', () => {
    expect(accessibleText(render('<span style="display: none">文献</span>'))).toBe('');
    expect(accessibleText(render('<span style="visibility: hidden">文献</span>'))).toBe('');
  });

  it('hidden 属性也读不到', () => {
    expect(accessibleText(render('<span hidden>资料</span>'))).toBe('');
  });

  it('只藏掉该藏的那一支', () => {
    const host = render(
      '<div><span aria-hidden="true">指南/共识</span><span>病友经验</span></div>',
    );
    expect(accessibleText(host)).toBe('病友经验');
  });
});

/**
 * The edge of the helper, written down as assertions.
 *
 * `accessible-text.ts` says in prose that it is「a deliberately small
 * subset of the accessible-name computation」and not an accname
 * implementation. That sentence is only worth having if the edge is
 * somewhere a reader can see it, so the two name sources it does NOT
 * model are pinned here. Both are shapes a real screen reader handles
 * and this helper does not, which means a chip built either way is a
 * FALSE RED in the two citation suites — the fix then is to extend the
 * helper, not to loosen those tests back to a document-wide read.
 *
 * These are also the tripwire for a widening that quietly narrows: if
 * someone teaches the helper `aria-labelledby`, this file fails and the
 * paragraph above has to be re-read rather than left standing as a
 * stale disclaimer.
 */
describe('accessibleText 明确没有做的部分', () => {
  it('aria-labelledby 不解析 —— 读到的是节点自己的字', () => {
    const host = render(
      '<div><span id="grade-name">指南/共识</span><span aria-labelledby="grade-name">占位</span></div>',
    );
    // A screen reader announces the second span as「指南/共识」. This
    // helper reads its contents instead, so the label is invisible to it
    // and the placeholder is not.
    expect(accessibleText(host.querySelector('[aria-labelledby]')!)).toBe('占位');
  });

  it('img 的 alt 不算数 —— 画成图片的等级在这里读作空', () => {
    // The one shape that turns a passing chip into a failing one: a
    // grade drawn as an image is announced from `alt`, and this helper
    // has no text node to find.
    expect(accessibleText(render('<img alt="病友经验">'))).toBe('');
  });

  it('只用 clip/1px 藏起来的字仍然读得到 —— 这一条是刻意跟读屏一致的', () => {
    // Not a gap: `display: none` leaves the tree, an off-screen clip
    // does not, and the helper draws the line in the same place a screen
    // reader does. Pinned so a future「hide anything that is not
    // visible」rewrite has to argue with this case.
    expect(
      accessibleText(
        render('<span style="position: absolute; width: 1px; overflow: hidden">文献</span>'),
      ),
    ).toBe('文献');
  });
});
