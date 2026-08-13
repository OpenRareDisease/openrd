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

import { accessibleText, reachesAccessibilityTreeFrom } from '../__testutils__/accessible-text';

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
 * The two name sources the helper does NOT model, pinned so its prose
 * disclaimer cannot go stale: a real screen reader handles both, so a
 * chip built either way is a FALSE RED in the citation suites and the
 * fix is to extend the helper, not to loosen those tests back to a
 * document-wide read. Teaching it `aria-labelledby` turns this red.
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

/**
 * `accessibleText(chip)` starts AT the chip, so it cannot see an
 * ancestor that took the whole subtree out of the tree. The citation
 * suites read the chip and then ask this, which is the half of the
 * old document-wide read that anchoring gave up.
 */
describe('reachesAccessibilityTreeFrom', () => {
  const chipIn = (host: HTMLElement): Element => host.querySelector('.chip')!;

  it('没有祖先挡着就读得到', () => {
    const host = render('<div><span class="chip">指南/共识</span></div>');
    expect(reachesAccessibilityTreeFrom(host, chipIn(host))).toBe(true);
  });

  it('祖先 aria-hidden —— 自己的字还在，但读屏够不到', () => {
    const host = render('<div aria-hidden="true"><span class="chip">指南/共识</span></div>');
    // This is the mutation the anchored read alone is blind to.
    expect(accessibleText(chipIn(host))).toBe('指南/共识');
    expect(reachesAccessibilityTreeFrom(host, chipIn(host))).toBe(false);
  });

  it('祖先带 aria-label —— 顶替掉整棵子树，等级读不出来', () => {
    const host = render('<div aria-label="引用"><span class="chip">指南/共识</span></div>');
    expect(accessibleText(chipIn(host))).toBe('指南/共识');
    expect(accessibleText(host)).toBe('引用');
    expect(reachesAccessibilityTreeFrom(host, chipIn(host))).toBe(false);
  });

  it('祖先 display:none / hidden 同样够不到', () => {
    const none = render('<div style="display: none"><span class="chip">文献</span></div>');
    expect(reachesAccessibilityTreeFrom(none, chipIn(none))).toBe(false);
    const hidden = render('<div hidden><span class="chip">文献</span></div>');
    expect(reachesAccessibilityTreeFrom(hidden, chipIn(hidden))).toBe(false);
  });

  it('只看 root 以下的祖先 —— root 自己不算', () => {
    // The suites pass their own render container as `root`; whatever
    // the harness wrapped that container in is not the screen's doing.
    const host = render('<div aria-hidden="true"><span class="chip">病友经验</span></div>');
    const inner = host.firstElementChild as HTMLElement;
    expect(reachesAccessibilityTreeFrom(inner, chipIn(host))).toBe(true);
  });

  it('节点自己 aria-hidden 由 accessibleText 管，不是这里', () => {
    // The two assertions are complementary, not redundant: this one
    // never looks at the node itself.
    const host = render('<div><span class="chip" aria-hidden="true">文献</span></div>');
    expect(reachesAccessibilityTreeFrom(host, chipIn(host))).toBe(true);
    expect(accessibleText(chipIn(host))).toBe('');
  });
});
