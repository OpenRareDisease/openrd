/**
 * 六个月居家运动方案 — the content, tested without a renderer.
 *
 * The defect this file exists to catch is a specific one: a substitute
 * that drifts into being presented as a result. Bankolé's numbers were
 * produced on an ergocycle with lab-measured MAP and a supervising
 * exercise physiologist; this page's RPE bands are a stand-in for none
 * of that. So:
 *
 *  - every trial number is tagged 'trial' and matches the paper,
 *  - every part of the substitute is tagged 'substitute',
 *  - the module never states an interval duration or set count, because
 *    those live only in the paper's Figure 3.
 */

import {
  BEFORE_YOU_START,
  EXERCISE_GUIDANCE,
  EXERCISE_PHASES,
  EXERCISE_SUBSTITUTION_NOTE,
  EXERTION_BANDS,
  EXERTION_SCALE_NOTE,
  REMEASURE_ITEMS,
  REMEASURE_WEEKS,
  SESSIONS_PER_WEEK,
  SESSION_TYPES,
  TOTAL_SESSIONS,
  TOTAL_WEEKS,
  TRIAL_CONDITIONS,
  TRIAL_FACTS,
  TRIAL_UNKNOWNS,
  exercisePhaseForWeek,
} from '../../../lib/home-exercise-content';

describe('原研究的数字', () => {
  it('每一条都标为「原研究实测」', () => {
    TRIAL_FACTS.forEach((fact) => {
      expect(fact.evidence).toBe('trial');
      expect(fact.source).toContain('Bankolé');
    });
  });

  it('主要结局和摘要一致', () => {
    const byId = Object.fromEntries(TRIAL_FACTS.map((fact) => [fact.id, fact]));
    expect(byId.vo2peak.value).toBe('+19%');
    expect(byId.vo2peak.detail).toContain('P = 0.002');
    expect(byId.fibre.value).toBe('+34%');
    expect(byId.fibre.detail).toContain('P = 0.008');
    expect(byId.adherence.value).toBe('91%');
    expect(byId.dose.value).toContain('24 周');
    expect(byId.dose.value).toContain('35 分钟');
  });

  it('安全性那一条说的是「没有加重」，不是「安全」', () => {
    const safety = TRIAL_FACTS.find((fact) => fact.id === 'safety');
    expect(safety?.detail).toContain('没有被加重');
    // The one patient whose CK was already high is in the record. A
    // flat「肌酸激酶正常」would be false for him.
    expect(safety?.detail).toContain('基线就高于 1000');
  });

  it('6 分钟步行给的是正文里的数字，不是一个「上升」', () => {
    // §3.3: 「mean difference in change at T24, 14%, P = 0.013」. Only
    // the abstract is silent. This shipped as value「上升」with the
    // percentage declared unpublished — leaving the one outcome the
    // plan tells patients to re-measure at weeks 0/12/24 as the only
    // trial fact on the page with nothing to compare against.
    const walk = TRIAL_FACTS.find((fact) => fact.id === 'walk');
    expect(walk?.value).toBe('+14%');
    expect(walk?.detail).toContain('P = 0.013');
    // §3.3 correlates 6MWD with VO2peak, MAP and MVC. Muscle endurance
    // belongs to the fatigue correlations in §3.4, not to this one.
    expect(walk?.detail).not.toContain('肌肉耐力');
  });

  it('第 24 周那一段把 6 分钟步行和其他结局一起列出来', () => {
    // phase-4 is where the patient reads their own re-measure back
    // against the trial, so omitting 6MWD there is the same defect in
    // the place it costs the most.
    const phase4 = EXERCISE_PHASES.find((phase) => phase.id === 'phase-4');
    expect(phase4?.trialNote).toContain('6 分钟步行距离 +14%');
  });

  it('样本量没有被四舍五入成「16 人的研究」而丢掉入组数', () => {
    const design = TRIAL_FACTS.find((fact) => fact.id === 'design');
    expect(design?.value).toContain('19 人入组');
    expect(design?.value).toContain('16 人');
    expect(design?.detail).toContain('局限');
  });
});

describe('替代做法从头到尾标着「不是原研究的方法」', () => {
  it('自觉用力程度那一节自己声明了它不是换算', () => {
    expect(EXERTION_SCALE_NOTE).toContain('不是 Bankolé 2016 用的口径');
    expect(EXERTION_SCALE_NOTE).toContain('没有在那项研究里被验证');
  });

  it('三档强度都给了不用器材也能判断的口径（说话测试）', () => {
    expect(EXERTION_BANDS).toHaveLength(3);
    EXERTION_BANDS.forEach((band) => {
      expect(band.talkTest.length).toBeGreaterThan(0);
      expect(band.useFor.length).toBeGreaterThan(0);
    });
  });

  it('总说明里点明了原研究用的是实验室测出的最大有氧功率和上门监督', () => {
    expect(EXERCISE_SUBSTITUTION_NOTE).toContain('最大有氧功率');
    expect(EXERCISE_SUBSTITUTION_NOTE).toContain('运动生理学家');
    expect(EXERCISE_SUBSTITUTION_NOTE).toContain('那些发表出来的数字，不是这样练出来的');
  });

  it('筛查那一条明说没有替代品', () => {
    // The one condition of the trial that cannot be substituted is the
    // one where getting it wrong is dangerous.
    const screening = TRIAL_CONDITIONS.find((item) => item.id === 'screening');
    expect(screening?.substitute).toContain('这一条没有替代品');
    expect(screening?.body).toContain('心律失常');
    expect(screening?.body).toContain('体质指数');
  });
});

describe('论文里没有的东西，这一页不补', () => {
  it('明说间歇的时长和组数只在 Figure 3 里', () => {
    expect(TRIAL_UNKNOWNS.join('')).toContain('Figure 3');
    expect(TRIAL_UNKNOWNS.join('')).toContain('本页也读不出来');
  });

  it('列出来的「查不到」都是论文正文真的没写的东西', () => {
    // A declared unknown is as much a claim about the paper as a
    // number is, and it is the one nobody re-checks. An entry here
    // once said the paper never gave a 6-minute-walk percentage;
    // §3.3 gives 14% (P = 0.013). Everything left must be Figure 3.
    expect(TRIAL_UNKNOWNS).toHaveLength(2);
    TRIAL_UNKNOWNS.forEach((unknown) => {
      expect(unknown).toContain('Figure 3');
    });
    expect(TRIAL_UNKNOWNS.join('')).not.toContain('6 分钟步行');
  });

  it('课程描述里没有出现编造的秒数或组数', () => {
    // A refactor that "helpfully" filled in「4 分钟 × 4 组」would go red
    // here. The guard is deliberately about the shape of the claim,
    // not about a particular string.
    const text = SESSION_TYPES.map((session) =>
      [...session.fromTrial, ...session.substitute].join(''),
    ).join('');
    expect(text).not.toMatch(/\d+\s*秒/);
    expect(text).not.toMatch(/\d+\s*组/);
    expect(text).not.toMatch(/\d+\s*轮/);
  });

  it('组合课和间歇课都保留了原文能读到的那部分', () => {
    const combined = SESSION_TYPES.find((session) => session.id === 'combined');
    expect(combined?.fromTrial.join('')).toContain('60%');
    expect(combined?.fromTrial.join('')).toContain('接近最大转速');
    expect(combined?.perWeek).toBe(2);
    const interval = SESSION_TYPES.find((session) => session.id === 'interval');
    expect(interval?.perWeek).toBe(1);
  });
});

describe('24 周的分段', () => {
  it('四段连续覆盖第 1 到第 24 周，不重不漏', () => {
    expect(EXERCISE_PHASES[0].fromWeek).toBe(1);
    expect(EXERCISE_PHASES[EXERCISE_PHASES.length - 1].toWeek).toBe(TOTAL_WEEKS);
    EXERCISE_PHASES.slice(1).forEach((phase, index) => {
      expect(phase.fromWeek).toBe(EXERCISE_PHASES[index].toWeek + 1);
    });
  });

  it('分段边界就是原研究的复测点', () => {
    expect([...REMEASURE_WEEKS]).toEqual(EXERCISE_PHASES.map((phase) => phase.toWeek));
  });

  it('exercisePhaseForWeek 在范围内外都不说谎', () => {
    expect(exercisePhaseForWeek(1)?.id).toBe('phase-1');
    expect(exercisePhaseForWeek(6)?.id).toBe('phase-1');
    expect(exercisePhaseForWeek(7)?.id).toBe('phase-2');
    expect(exercisePhaseForWeek(24)?.id).toBe('phase-4');
    expect(exercisePhaseForWeek(0)).toBeNull();
    expect(exercisePhaseForWeek(25)).toBeNull();
    expect(exercisePhaseForWeek(6.5)).toBeNull();
  });

  it('总次数就是原研究算完成率的那个分母', () => {
    expect(TOTAL_SESSIONS).toBe(72);
    expect(TOTAL_WEEKS * SESSIONS_PER_WEEK).toBe(TOTAL_SESSIONS);
  });
});

describe('复测项复用已有的功能测试类型', () => {
  it('用的都是后端已有的 FUNCTION_TEST_TYPES 值或自评项', () => {
    const allowedTests = ['six_minute_walk', 'sit_to_stand', 'ten_meter_walk'];
    const allowedSelfTests = ['knee_extension', 'ankle_dorsiflexion'];
    REMEASURE_ITEMS.forEach((item) => {
      const keyed = item.functionTestType ?? item.selfTestMetricKey;
      expect(keyed).toBeDefined();
      if (item.functionTestType) expect(allowedTests).toContain(item.functionTestType);
      if (item.selfTestMetricKey) expect(allowedSelfTests).toContain(item.selfTestMetricKey);
      expect(item.source.length).toBeGreaterThan(0);
    });
  });

  it('不是 Bankolé 指标的那几项，出处写的不是 Bankolé', () => {
    // 坐立测试 comes from Andersen 2015 via the Dutch guideline; 10 米
    // 步行 from 5.4. Attributing them to the trial would be a citation
    // that does not survive being looked up.
    const sitToStand = REMEASURE_ITEMS.find((item) => item.id === 'sit-to-stand');
    expect(sitToStand?.source).not.toContain('Bankolé');
    expect(sitToStand?.why).toContain('不是 Bankolé 的指标');
  });

  it('10 米步行的理由指向蹬地（小腿），不是踝背屈', () => {
    // Dutch 5.4: 「Weakness of push-off power will also lead to reduced
    // walking speed, particularly if there is additional weakness of
    // the trunk muscles (Rijken 2015)」. Dorsiflexor paresis gets the
    // other consequence set in the same paragraph — first rocker, foot
    // drag, stumbling. The corpus's Chinese translation inverts this
    // and the page copied it. It matters beyond one line: the AFO
    // ladder in orthosis-decision-content.ts branches on whether
    // push-off is preserved, so a patient aimed at the wrong muscle
    // arrives at that question having watched the wrong thing.
    const tenMetre = REMEASURE_ITEMS.find((item) => item.id === 'ten-meter-walk');
    expect(tenMetre?.why).toContain('蹬地');
    expect(tenMetre?.why).toContain('躯干');
    expect(tenMetre?.why).not.toMatch(/踝背屈无力和躯干无力都会让步速下降/);
    expect(tenMetre?.source).toContain('5.4');
  });

  it('自评肌力那一项承认它比原研究粗', () => {
    const selfTest = REMEASURE_ITEMS.find((item) => item.id === 'knee-extension');
    expect(selfTest?.why).toContain('粗得多');
  });
});

describe('力量训练的两个顾虑没有被删成一句鼓励', () => {
  it('King 和 Pandya 的两条都在', () => {
    const section = EXERCISE_GUIDANCE.find((item) => item.id === 'resistance-two-concerns');
    expect(section?.points).toHaveLength(3);
    expect(section?.points.join('')).toContain('过用');
    expect(section?.points.join('')).toContain('肩胛稳定肌');
    expect(section?.points.join('')).toContain('活动量');
  });

  it('每一节都带出处，而且标了证据类型', () => {
    EXERCISE_GUIDANCE.forEach((section) => {
      expect(section.source.length).toBeGreaterThan(0);
      expect(['trial', 'guideline', 'substitute']).toContain(section.evidence);
    });
  });

  it('开始之前那一节里有「先做基线」和「先问医生」', () => {
    const text = BEFORE_YOU_START.join('');
    expect(text).toContain('先做基线');
    expect(text).toContain('先问医生');
  });
});
