/**
 * The page as an assistive reader receives it, for the web-export tests.
 *
 * Not `textContent`, which is blind in both directions: `aria-hidden`
 * takes a node out of the accessibility tree and leaves every text node
 * in place, while `aria-label` names a node that has no text of its own.
 * So a `textContent` assertion goes green on a change that destroys
 * screen-reader access and red on one that preserves it.
 *
 * This models only the part of the accessible-name computation that
 * decides whether a run of text reaches the tree at all: `aria-hidden`,
 * `hidden`, `display: none`, `visibility: hidden`, and `aria-label`
 * standing in for a node's contents. Pair it with a plain `textContent`
 * assertion when the claim is about what a SIGHTED reader sees.
 *
 * What it does NOT model: `aria-labelledby` (the referenced element is
 * not followed) and `alt` on an `<img>` (no text node, so it reads as
 * empty). A chip built either way is announced fine by a real screen
 * reader and fails the citation suites anyway — a false red to fix by
 * extending this function, not by loosening those tests back to a
 * document-wide read. Both limits, and the deliberate agreement with
 * screen readers on off-screen-clipped text, are asserted in
 * __tests__/accessible-text.test.ts.
 */

const hiddenByStyle = (element: Element): boolean => {
  const inline = (element.getAttribute('style') ?? '').replace(/\s+/g, '');
  if (/display:none/i.test(inline) || /visibility:hidden/i.test(inline)) return true;
  // react-native-web puts most styling in generated classes, so read the
  // cascade too where the environment computes one (jsdom does).
  const view = element.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return false;
  const computed = view.getComputedStyle(element);
  return computed.display === 'none' || computed.visibility === 'hidden';
};

const hidesSubtree = (element: Element): boolean =>
  element.getAttribute('aria-hidden') === 'true' ||
  element.hasAttribute('hidden') ||
  hiddenByStyle(element);

const labelOf = (element: Element): string => (element.getAttribute('aria-label') ?? '').trim();

export const accessibleText = (node: Node): string => {
  if (node.nodeType === 3 /* text */) return node.nodeValue ?? '';
  if (node.nodeType !== 1 /* element */) return '';

  const element = node as Element;
  if (hidesSubtree(element)) return '';

  // A node with `aria-label` is announced by that label instead of by
  // its contents, so the subtree below it is not what the reader hears.
  const label = labelOf(element);
  if (label) return label;

  return Array.from(element.childNodes).map(accessibleText).join('');
};

/**
 * Whether `node`'s own text still reaches the accessibility tree when the
 * page is read from `root` — i.e. no ancestor between them drops or
 * relabels the subtree. `accessibleText(node)` cannot answer this: it
 * starts below the ancestor that would have dropped it.
 */
export const reachesAccessibilityTreeFrom = (root: Node, node: Element): boolean => {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (hidesSubtree(el) || labelOf(el) !== '') return false;
  }
  return true;
};
