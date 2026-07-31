/**
 * Touch-target sizing for a population that loses grip and fine motor
 * control.
 *
 * FSHD weakens the face, shoulder girdle and arms progressively, and
 * for many patients the hands follow. That makes the usual "44pt is
 * the minimum" advice a floor rather than a target here: a control
 * that a healthy tester hits every time can be genuinely unreliable
 * for someone stabilising their forearm with the other hand.
 *
 * Two rules follow from that, and they're worth stating because both
 * are easy to violate without noticing:
 *
 *  1. **Size beats precision.** Prefer fewer, larger targets over
 *     many small ones — a row of eleven 36pt circles asks for exactly
 *     the pointing accuracy this disease takes away. Where a range
 *     has natural semantic buckets, offer the buckets.
 *
 *  2. **Never shrink a target to fit a row.** If N options don't fit
 *     at MIN_TOUCH_TARGET, change the layout (wrap, stack, or bucket
 *     them) rather than the size.
 *
 * `expandHitSlop` covers the remaining case — text links and small
 * glyphs whose *visual* size is deliberately modest. It grows the
 * touchable area without changing what's drawn.
 */

/** Platform minimum (iOS HIG 44pt / Android 48dp). Never go below. */
export const MIN_TOUCH_TARGET = 48;

/** Comfortable size for primary actions and any control a patient
 *  uses on every visit (save, record, the entry composer's send). */
export const COMFORTABLE_TOUCH_TARGET = 56;

/**
 * Hit-area padding that brings a visually-small control up to
 * `MIN_TOUCH_TARGET` without altering its appearance. Pass the
 * rendered size; get back a `hitSlop` for the difference.
 *
 *   <TouchableOpacity hitSlop={expandHitSlop(20)}>  // 20pt text link
 */
export const expandHitSlop = (renderedSize: number, target = MIN_TOUCH_TARGET) => {
  const slop = Math.max(0, Math.ceil((target - renderedSize) / 2));
  return { top: slop, bottom: slop, left: slop, right: slop };
};
