/**
 * Muscle self-test definitions + payload builder (pure, jest-covered).
 *
 * Action-oriented, not anatomy-oriented: each item is a movement a
 * patient can try one-handed at home, keyed by the metricKeys
 * `buildBodyMapFromMeasurements` (clinical-visuals.ts) already maps
 * onto body regions — so every saved score lights up the passport /
 * archive body figure with zero read-side changes.
 */

export interface SelfTestAction {
  /** metricKey persisted to /me/measurements — MUST stay in the
   *  applyStrengthGroup switch of clinical-visuals.ts. */
  metricKey: string;
  label: string;
  /** One-line "how to try it" in plain language. */
  howTo: string;
  /** Canonical body_region enum value for the backend row. */
  bodyRegion: 'face' | 'shoulder_girdle' | 'upper_arm' | 'thigh' | 'ankle';
  /** Face has no left/right in the figure map — side is forced to
   *  'none' and the picker hidden. */
  sided: boolean;
  /** Backend MUSCLE_GROUPS value, when the movement maps onto one.
   *  Writing it feeds GET /me/insights/muscle (cohort percentile
   *  distribution is keyed by muscle_group, not metricKey). Face has
   *  no cohort group. */
  muscleGroup?: 'deltoid' | 'biceps' | 'quadriceps' | 'tibialis';
}

export const SELF_TEST_ACTIONS: SelfTestAction[] = [
  {
    metricKey: 'eye_closure',
    label: '用力闭眼',
    howTo: '闭紧双眼，让家人轻轻扒开——扒不开为满分。',
    bodyRegion: 'face',
    sided: false,
  },
  {
    metricKey: 'arm_raise_over_head',
    muscleGroup: 'deltoid',
    label: '举手过头',
    howTo: '手臂伸直从体侧举过头顶，观察是否费力或耸肩代偿。',
    bodyRegion: 'shoulder_girdle',
    sided: true,
  },
  {
    metricKey: 'elbow_flexion',
    muscleGroup: 'biceps',
    label: '屈肘抬物',
    howTo: '手持一瓶矿泉水弯曲肘部，观察能否对抗重量。',
    bodyRegion: 'upper_arm',
    sided: true,
  },
  {
    metricKey: 'knee_extension',
    muscleGroup: 'quadriceps',
    label: '坐位伸膝',
    howTo: '坐着把小腿伸直抬平，观察能否保持或对抗压力。',
    bodyRegion: 'thigh',
    sided: true,
  },
  {
    metricKey: 'ankle_dorsiflexion',
    muscleGroup: 'tibialis',
    label: '勾脚背',
    howTo: '脚跟着地、脚尖尽力向上勾，观察是否费力或不能完成。',
    bodyRegion: 'ankle',
    sided: true,
  },
];

export type SelfTestSide = 'left' | 'right' | 'bilateral';

/** MRC 0-5 with plain-language anchors, rendered as six big buttons. */
export const STRENGTH_LEVELS: Array<{ score: number; label: string }> = [
  { score: 5, label: '正常' },
  { score: 4, label: '能对抗一定阻力' },
  { score: 3, label: '能抗重力完成' },
  { score: 2, label: '不能抗重力' },
  { score: 1, label: '仅有肌肉收缩' },
  { score: 0, label: '完全无法用力' },
];

/** Assemble the POST /me/measurements payload for one scored action. */
export const buildSelfTestPayload = (
  action: SelfTestAction,
  side: SelfTestSide,
  score: number,
): Record<string, unknown> => ({
  metricKey: action.metricKey,
  ...(action.muscleGroup ? { muscleGroup: action.muscleGroup } : {}),
  bodyRegion: action.bodyRegion,
  side: action.sided ? side : 'none',
  strengthScore: score,
  method: 'MRC 自评',
  entryMode: 'self_report',
});
