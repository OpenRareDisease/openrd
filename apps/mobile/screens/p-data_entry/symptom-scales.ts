/**
 * 疼痛 and 疲劳 — the 0-10 bands, and the shared stepper maths.
 *
 * WHY THESE TWO ARE ON THE DAILY FORM AT ALL
 * ------------------------------------------
 * `SYMPTOM_KEYS` on the API has carried `pain` and `fatigue` since the
 * schema was written, and `patient_symptom_scores` has had scale_min /
 * scale_max the whole time — but the followup form only ever wrote
 * `sleep_quality` and the stairs ADL. Production reflects exactly that:
 * a pile of sleep rows and almost no pain rows, from a disease where
 * pain and fatigue are among the most commonly reported problems and
 * the most commonly missed ones. The gap was in the UI, not the model.
 *
 * The 2010 ENMC consensus on FSHD standards of care (Tawil R, van der
 * Maarel S, Padberg GW, van Engelen BGM. 171st ENMC International
 * Workshop: Standards of care and management of facioscapulohumeral
 * muscular dystrophy. Neuromuscul Disord. 2010;20(7):471-475) and the
 * Dutch FSHD guideline both put pain and fatigue among the things to
 * ask about at every visit, precisely because patients do not raise
 * them unprompted.
 *
 * WHY BANDS AND NOT ELEVEN CIRCLES
 * --------------------------------
 * Same reason sleep-score.ts gives: eleven 36pt targets in a row is the
 * single hardest control in this app for a hand this disease has
 * weakened. Tap a band, then nudge with two large steppers. The stored
 * value is still the 0-10 integer the API wants.
 *
 * WHY THE DIRECTION IS SPELLED OUT EVERYWHERE
 * -------------------------------------------
 * Sleep runs 0 = 很差 → 10 = 很好. Pain and fatigue run the other way:
 * 0 = 没有 → 10 = 最重. Three sliders on one screen pointing in two
 * directions is how a patient records「今天不疼」as a 10. Every band is
 * labelled in words, the stepper repeats the band label under the
 * number, and `directionNote` prints the direction above the control.
 */

export interface ScoreBucket {
  label: string;
  min: number;
  max: number;
  /** Value applied when the band is tapped. */
  pick: number;
}

export const SYMPTOM_SCORE_MIN = 0;
export const SYMPTOM_SCORE_MAX = 10;

/** 0-10 numeric rating scale bands, the split used clinically for pain
 *  (none / mild 1-3 / moderate 4-6 / severe 7-9 / worst 10). Fatigue
 *  reuses the same shape with its own words. */
export const PAIN_BUCKETS: ScoreBucket[] = [
  { label: '没有', min: 0, max: 0, pick: 0 },
  { label: '轻微', min: 1, max: 3, pick: 2 },
  { label: '中等', min: 4, max: 6, pick: 5 },
  { label: '明显', min: 7, max: 9, pick: 8 },
  { label: '最重', min: 10, max: 10, pick: 10 },
];

export const FATIGUE_BUCKETS: ScoreBucket[] = [
  { label: '不累', min: 0, max: 0, pick: 0 },
  { label: '有点累', min: 1, max: 3, pick: 2 },
  { label: '比较累', min: 4, max: 6, pick: 5 },
  { label: '很累', min: 7, max: 9, pick: 8 },
  { label: '累到做不了事', min: 10, max: 10, pick: 10 },
];

/**
 * The band a score falls in.
 *
 * Clamps rather than throwing, and returns null only for an empty list
 * — the caller is a picker whose value can be mid-edit, and a blanked
 * label mid-tap reads as the app losing the answer.
 */
export const bucketForScoreIn = (buckets: ScoreBucket[], score: number): ScoreBucket | null => {
  if (buckets.length === 0) return null;
  if (!Number.isFinite(score)) return buckets[0];
  const clamped = Math.min(SYMPTOM_SCORE_MAX, Math.max(SYMPTOM_SCORE_MIN, score));
  return buckets.find((bucket) => clamped >= bucket.min && clamped <= bucket.max) ?? buckets[0];
};

/**
 * Step a 0-10 score by ±1, staying in range.
 *
 * An empty string means「还没回答」on this form, not 0 — pain and
 * fatigue are deliberately unanswered until the patient touches them
 * (see index.tsx). Stepping up from unanswered therefore has to land on
 * 0 rather than 1, and stepping down from unanswered stays at 0, so the
 * first press never skips the answer「一点也不疼」.
 */
export const stepSymptomScore = (current: string, delta: number): string => {
  const parsed = Number(current);
  const hasValue = current !== '' && Number.isFinite(parsed);
  if (!hasValue) {
    // Either direction lands on 0: it is the nearest real answer to
    //「还没回答」, and it is the one an unanswered form most often means.
    return String(SYMPTOM_SCORE_MIN);
  }
  return String(
    Math.min(SYMPTOM_SCORE_MAX, Math.max(SYMPTOM_SCORE_MIN, Math.round(parsed) + delta)),
  );
};

/** Normalize a stored/rehydrated value back to「0-10 或未回答」.
 *
 *  Returns '' for anything unusable rather than a number, because the
 *  one thing this form must never do is turn "no answer" into a score
 *  the patient did not give. */
export const normalizeSymptomScore = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.min(SYMPTOM_SCORE_MAX, Math.max(SYMPTOM_SCORE_MIN, Math.round(value))));
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return '';
  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) return '';
  return String(Math.min(SYMPTOM_SCORE_MAX, Math.max(SYMPTOM_SCORE_MIN, numeric)));
};

export interface SymptomScaleDefinition {
  /** `patient_symptom_scores.symptom_key` — must be one of the API's
   *  SYMPTOM_KEYS. */
  key: 'pain' | 'fatigue';
  label: string;
  /** Printed above the control. Says which end is which. */
  directionNote: string;
  /** Stored in the row's `notes`, so a later reader of the raw record
   *  can tell which direction the number runs — the same job the sleep
   *  row's「0=很差，10=很好」does. */
  storedNote: string;
  buckets: ScoreBucket[];
}

export const PAIN_SCALE: SymptomScaleDefinition = {
  key: 'pain',
  label: '最近一周疼痛程度',
  directionNote: '0 表示完全不疼，10 表示疼到不能再疼。包括肩背、腰和四肢的疼。',
  storedNote: '0=没有疼痛，10=疼痛最重',
  buckets: PAIN_BUCKETS,
};

export const FATIGUE_SCALE: SymptomScaleDefinition = {
  key: 'fatigue',
  label: '最近一周疲劳程度',
  directionNote: '0 表示一点都不累，10 表示累到什么都做不了。指整体的累，不只是运动后的累。',
  storedNote: '0=不疲劳，10=疲劳最重',
  buckets: FATIGUE_BUCKETS,
};

/** Why both questions are on the form, in one sentence with its source
 *  — the same inline-citation habit as lib/genetics-family-content.ts. */
export const SYMPTOM_GUIDELINE_NOTE =
  '疼痛和疲劳每次都会问：2010 年 ENMC 第 171 次国际研讨会的 FSHD 诊疗共识（Neuromuscular Disorders 2010;20(7):471-475）和荷兰 FSHD 诊疗指南都建议每次随访都记录这两项，因为它们在 FSHD 里很常见，却最容易在门诊被漏掉。不想评的话可以跳过。';
