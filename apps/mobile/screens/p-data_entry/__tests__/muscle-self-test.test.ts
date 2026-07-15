import { SELF_TEST_ACTIONS, STRENGTH_LEVELS, buildSelfTestPayload } from '../muscle-self-test';

describe('SELF_TEST_ACTIONS', () => {
  it('uses only metricKeys the body-figure mapper understands', () => {
    // Mirror of the applyStrengthGroup switch in clinical-visuals.ts —
    // a new action whose key isn't mapped would save fine but never
    // light up the figure, silently breaking the loop this feature
    // exists for.
    const mapped = new Set([
      'deltoid',
      'shoulder_abduction',
      'shoulder_abduction_mrc',
      'arm_raise_over_head',
      'biceps',
      'elbow_flexion',
      'triceps',
      'quadriceps',
      'knee_extension',
      'hamstrings',
      'gluteus',
      'tibialis',
      'ankle_dorsiflexion',
      'eye_closure',
      'lip_pursing',
    ]);
    for (const action of SELF_TEST_ACTIONS) {
      expect(mapped.has(action.metricKey)).toBe(true);
    }
  });

  it('covers the FSHD core pattern: face, shoulder girdle, arm, thigh, ankle', () => {
    expect(SELF_TEST_ACTIONS.map((a) => a.bodyRegion)).toEqual([
      'face',
      'shoulder_girdle',
      'upper_arm',
      'thigh',
      'ankle',
    ]);
  });
});

describe('buildSelfTestPayload', () => {
  const face = SELF_TEST_ACTIONS[0];
  const shoulder = SELF_TEST_ACTIONS[1];

  it('sided actions carry the chosen side', () => {
    expect(buildSelfTestPayload(shoulder, 'left', 4)).toMatchObject({
      metricKey: 'arm_raise_over_head',
      bodyRegion: 'shoulder_girdle',
      side: 'left',
      strengthScore: 4,
      entryMode: 'self_report',
    });
  });

  it('face forces side=none regardless of the picker', () => {
    expect(buildSelfTestPayload(face, 'left', 5).side).toBe('none');
  });

  it('mapped movements carry their cohort muscleGroup; face omits it', () => {
    expect(buildSelfTestPayload(shoulder, 'left', 4).muscleGroup).toBe('deltoid');
    expect('muscleGroup' in buildSelfTestPayload(face, 'left', 5)).toBe(false);
  });
});

describe('STRENGTH_LEVELS', () => {
  it('spans MRC 5..0 exactly once each', () => {
    expect(STRENGTH_LEVELS.map((l) => l.score)).toEqual([5, 4, 3, 2, 1, 0]);
  });
});
