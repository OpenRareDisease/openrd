/**
 * Sleep-score buckets.
 *
 * The 0-10 scale used to render as eleven 36pt circles in one row —
 * the hardest control in the app for hands this disease has weakened,
 * on the screen patients use most. The scale itself is worth keeping
 * (it's what gets stored, and it's what makes the trend line
 * readable), but nobody thinks in units of one: they think「一般」and
 * then nudge.
 *
 * So the buckets became the primary control — the same five bands
 * that were already printed underneath as read-only hints, now the
 * thing you tap — and the exact value is reached with two large
 * steppers. Same stored value, no small targets.
 *
 * Lives in its own module because a mislabelled bucket would tell a
 * patient their sleep was「较好」when they recorded「较差」, and that
 * deserves a test rather than a glance.
 */

export interface SleepBucket {
  label: string;
  min: number;
  max: number;
  /** Value applied when the bucket is tapped: `floor((min + max) / 2)`.
   *
   *  The old comment here promised that「±1 仍在同一档」, which was
   *  true of exactly one bucket. Four of the five bands are two scores
   *  wide, so they have no interior point at all — from anywhere in
   *  them, one of the two steps lands in a neighbouring band, and no
   *  choice of `pick` can change that. Only 很差 (0-2) is three wide,
   *  and 1 is its centre.
   *
   *  So the rule that actually holds, and that the tests assert: tap a
   *  band and **+1 stays inside it**; −1 stays inside only for 很差 and
   *  otherwise drops to the band below — which is what the patient
   *  asked for, since they were already at the bottom of this one. The
   *  label under the stepper is recomputed from the score on every
   *  change, so a crossing is always visible rather than silent. */
  pick: number;
}

export const SLEEP_SCORE_MIN = 0;
export const SLEEP_SCORE_MAX = 10;

export const SLEEP_BUCKETS: SleepBucket[] = [
  { label: '很差', min: 0, max: 2, pick: 1 },
  { label: '较差', min: 3, max: 4, pick: 3 },
  // 5, not 6: the odd one out under the floor-midpoint rule above was
  // the only bucket whose +1 left the band.
  { label: '一般', min: 5, max: 6, pick: 5 },
  { label: '较好', min: 7, max: 8, pick: 7 },
  { label: '很好', min: 9, max: 10, pick: 9 },
];

/** The band a score falls in. Out-of-range and non-numeric input clamp
 *  to the nearest end rather than throwing — the caller is a text
 *  field, and a half-typed value must not blank the label. */
export const bucketForScore = (score: number): SleepBucket => {
  if (!Number.isFinite(score)) return SLEEP_BUCKETS[0];
  const clamped = Math.min(SLEEP_SCORE_MAX, Math.max(SLEEP_SCORE_MIN, score));
  return (
    SLEEP_BUCKETS.find((bucket) => clamped >= bucket.min && clamped <= bucket.max) ??
    SLEEP_BUCKETS[0]
  );
};

/** Step the score by ±1, staying in range. */
export const stepSleepScore = (current: string, delta: number): string => {
  const parsed = Number(current);
  const base = Number.isFinite(parsed) ? parsed : 0;
  return String(Math.min(SLEEP_SCORE_MAX, Math.max(SLEEP_SCORE_MIN, base + delta)));
};
