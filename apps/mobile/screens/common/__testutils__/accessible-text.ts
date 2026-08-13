/**
 * The page as an assistive reader receives it, for the web-export tests.
 *
 * Why this is not `textContent`
 * -----------------------------
 * Two tests in this repo claimed to「read the page the way a screen
 * reader does」and then asserted on `container.textContent`.
 * `textContent` is the concatenation of every text node in the subtree,
 * so it is blind to the two things that actually decide what a screen
 * reader gets:
 *
 *   - `aria-hidden="true"` removes a node from the accessibility tree
 *     and leaves `textContent` untouched. Adding it to the citation chip
 *     hides the source grade from every screen reader while both tests
 *     stay green.
 *   - `aria-label` supplies a name for a node that has no text of its
 *     own. It contributes nothing to `textContent`, so a chip labelled
 *     that way reads as empty to those tests while a screen reader
 *     announces it fine.
 *
 * Those are opposite directions, which is why the old assertion was not
 * merely weak: it went red on a change that PRESERVED screen-reader
 * access and green on one that destroyed it.
 *
 * What this implements
 * --------------------
 * A deliberately small subset of the accessible-name computation — the
 * part that decides whether a run of text reaches the tree at all:
 * `aria-hidden`, `hidden`, `display: none`, `visibility: hidden`, and
 * `aria-label` standing in for a node's contents. It is not an accname
 * implementation and does not try to be; it is the projection those two
 * assertions always claimed to be reading. Pair it with a plain
 * `textContent` assertion when the claim is about what a SIGHTED reader
 * sees — the two projections answer different questions, and the bug
 * this replaces was one test trying to answer both.
 *
 * What it does NOT model, precisely
 * ---------------------------------
 * Two name sources a real screen reader honours are invisible here:
 * `aria-labelledby` (the referenced element is not followed — the node's
 * own contents are read instead) and `alt` on an `<img>` (no text node,
 * so it reads as empty). A chip built either way is announced fine and
 * fails the citation suites anyway. That is a false red to fix by
 * extending this function, not by loosening those tests back to a
 * document-wide `textContent` read.
 *
 * Both of those, and the deliberate agreement with screen readers on
 * off-screen-clipped text, are asserted in
 * __tests__/accessible-text.test.ts, so this paragraph cannot go stale
 * quietly: teaching the function one of them turns that file red.
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

export const accessibleText = (node: Node): string => {
  if (node.nodeType === 3 /* text */) return node.nodeValue ?? '';
  if (node.nodeType !== 1 /* element */) return '';

  const element = node as Element;
  if (element.getAttribute('aria-hidden') === 'true') return '';
  if (element.hasAttribute('hidden')) return '';
  if (hiddenByStyle(element)) return '';

  // A node with `aria-label` is announced by that label instead of by
  // its contents, so the subtree below it is not what the reader hears.
  const label = (element.getAttribute('aria-label') ?? '').trim();
  if (label) return label;

  return Array.from(element.childNodes).map(accessibleText).join('');
};
