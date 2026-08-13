/**
 * 辅具选择决策流 — the content, tested without a renderer.
 *
 * These live under the screen rather than in lib/__tests__ only because
 * of lane ownership on this branch; they are content tests and belong
 * beside orthosis-decision-content.ts.
 *
 * The invariants worth a test are the ones a plausible refactor would
 * break silently:
 *
 *  1. Both standing rules on EVERY reachable answer combination,
 *     including the all-「还好」 one. That is the path where nothing
 *     matched, i.e. the path where 「先试用再定制」 would be easiest to
 *     optimise away, and it is also the path a newly-diagnosed patient
 *     is most likely to take.
 *  2. Every combination ends at the referral block with the four named
 *     clinicians.
 *  3. The three item kinds stay distinct. Collapsing 「指南没写这一档」
 *     into an omission is the specific mistake that turns this page
 *     into reassurance.
 */

import {
  ORTHOSIS_QUESTIONS,
  ORTHOSIS_STANDING_RULES,
  REHAB_CLINICIANS,
  buildOrthosisNarrative,
  buildOrthosisPlan,
  unansweredOrthosisQuestions,
  visibleOrthosisQuestions,
  type OrthosisAnswers,
  type OrthosisQuestionId,
} from '../../../lib/orthosis-decision-content';

/**
 * Every answer combination the flow can actually reach.
 *
 * Built by walking `visibleOrthosisQuestions` rather than by taking the
 * cartesian product of all six questions: `calf` and `walker` are
 * conditional, and a product would generate states the UI can never
 * produce (a calf answer with no ankle weakness) and miss the point of
 * the test.
 */
const reachableAnswerSets = (): OrthosisAnswers[] => {
  let frontier: OrthosisAnswers[] = [{}];
  const complete: OrthosisAnswers[] = [];

  // Six questions is the depth ceiling; the loop bound is a guard, not
  // a schedule.
  for (let depth = 0; depth <= ORTHOSIS_QUESTIONS.length; depth += 1) {
    const next: OrthosisAnswers[] = [];
    frontier.forEach((answers) => {
      const pending = unansweredOrthosisQuestions(answers);
      if (pending.length === 0) {
        complete.push(answers);
        return;
      }
      const questionId: OrthosisQuestionId = pending[0];
      const question = ORTHOSIS_QUESTIONS.find((item) => item.id === questionId);
      if (!question) throw new Error(`no question for ${questionId}`);
      question.choices.forEach((choice) => {
        next.push({ ...answers, [questionId]: choice.id });
      });
    });
    frontier = next;
    if (frontier.length === 0) break;
  }

  return complete;
};

describe('可达的答案组合', () => {
  it('全部走得通，而且数量不是 0（这个测试自己得先有东西可测）', () => {
    const sets = reachableAnswerSets();
    expect(sets.length).toBeGreaterThan(10);
  });
});

describe('两条通则出现在每一个终点', () => {
  it.each(reachableAnswerSets().map((answers) => [JSON.stringify(answers), answers] as const))(
    '%s',
    (_label, answers) => {
      const plan = buildOrthosisPlan(answers);
      const ids = plan.standingRules.map((rule) => rule.id);
      expect(ids).toContain('trial-first');
      expect(ids).toContain('prescribe-and-train-together');
    },
  );

  it('连什么都没答的空白状态也带着这两条', () => {
    const ids = buildOrthosisPlan({}).standingRules.map((rule) => rule.id);
    expect(ids).toEqual(['trial-first', 'prescribe-and-train-together']);
  });

  it('全选「还好」时一条辅具都不推荐，但通则还在', () => {
    // The path where an over-eager cleanup would drop them.
    const plan = buildOrthosisPlan({
      ankle: 'ankle-controlled',
      quadriceps: 'quad-ok',
      trunk: 'trunk-ok',
      stability: 'stability-none',
    });
    expect(plan.complete).toBe(true);
    expect(plan.items.filter((item) => item.kind === 'device')).toHaveLength(0);
    expect(plan.standingRules).toHaveLength(2);
  });

  it('两条通则的正文里就带着它们各自的适用范围', () => {
    // The scoping is inside the rule text on purpose: 5.4 says
    //「先试用再定制」about leg orthoses and the thoraco-lumbar brace,
    // and says「按处方使用并接受培训」about aids AND orthoses.
    const [trial, train] = ORTHOSIS_STANDING_RULES;
    expect(trial.body).toContain('腿部矫形器或胸腰支具');
    expect(train.body).toContain('助行器和／或矫形器');
    expect(train.body).toContain('前方支撑的 AFO');
  });
});

describe('每一个终点都落到「带这份清单去找康复师」', () => {
  it.each(reachableAnswerSets().map((answers) => [JSON.stringify(answers), answers] as const))(
    '%s',
    (_label, answers) => {
      const plan = buildOrthosisPlan(answers);
      expect(plan.referral.title).toBe('带这份清单去找康复师');
      expect(plan.referral.clinicians).toHaveLength(4);
    },
  );

  it('四位康复医师是知识库里那四位，一字不改', () => {
    expect(REHAB_CLINICIANS.map((person) => person.name)).toEqual([
      '孙杨',
      '范亚蓓',
      '张光宇',
      '邓景元',
    ]);
    expect(REHAB_CLINICIANS[0].institution).toBe('复旦大学附属华山医院');
    expect(REHAB_CLINICIANS[3].institution).toBe('西安交通大学第一附属医院');
  });
});

describe('AFO 分档跟着小腿蹬地力走', () => {
  const ankleWeak: OrthosisAnswers = { ankle: 'ankle-drag' };

  it('还有蹬地力 → 轻便动态后侧 AFO', () => {
    const plan = buildOrthosisPlan({ ...ankleWeak, calf: 'calf-preserved' });
    const ids = plan.items.map((item) => item.id);
    expect(ids).toContain('afo-posterior-dynamic');
    expect(ids).not.toContain('afo-anterior-rigid');
  });

  it('蹬地力没了 / 膝盖发软 → 前方支撑的更硬 AFO，并且点名要训练', () => {
    const plan = buildOrthosisPlan({ ...ankleWeak, calf: 'calf-lost' });
    const item = plan.items.find((entry) => entry.id === 'afo-anterior-rigid');
    expect(item).toBeDefined();
    expect(item?.cautions.join('')).toContain('尤其需要接受使用训练');
  });

  it('落地正常时不问小腿，也不给 AFO', () => {
    const visible = visibleOrthosisQuestions({ ankle: 'ankle-controlled' }).map((q) => q.id);
    expect(visible).not.toContain('calf');
    const plan = buildOrthosisPlan({ ankle: 'ankle-controlled' });
    expect(plan.items.find((item) => item.id === 'afo-not-yet')?.kind).toBe('not-yet');
  });
});

describe('股四头肌的中间档不被静默略过', () => {
  it('「要撑着才站得起来」这一档给出的是「指南没写」，不是空白', () => {
    const plan = buildOrthosisPlan({ quadriceps: 'quad-effortful' });
    const item = plan.items.find((entry) => entry.id === 'quad-between-rungs');
    expect(item?.kind).toBe('no-guidance');
    expect(item?.body).toContain('没有为中间这一档写任何矫形器建议');
  });

  it('只有「严重」那一档才提 KAFO', () => {
    expect(
      buildOrthosisPlan({ quadriceps: 'quad-effortful' }).items.map((item) => item.id),
    ).not.toContain('kafo');
    expect(buildOrthosisPlan({ quadriceps: 'quad-severe' }).items.map((item) => item.id)).toContain(
      'kafo',
    );
  });
});

describe('助行器分档', () => {
  it('单侧不稳 → 手杖，而且写明拄在对侧', () => {
    const item = buildOrthosisPlan({ stability: 'stability-unilateral' }).items.find(
      (entry) => entry.id === 'cane-contralateral',
    );
    expect(item?.body).toContain('对侧');
  });

  it('双侧不稳 → 助行器，并且问一句前倾', () => {
    const answers: OrthosisAnswers = { stability: 'stability-bilateral' };
    expect(visibleOrthosisQuestions(answers).map((q) => q.id)).toContain('walker');
    expect(buildOrthosisPlan(answers).items.map((item) => item.id)).toContain('rollator');
  });

  it('前倾着走 → 追加后置助行器', () => {
    const ids = buildOrthosisPlan({
      stability: 'stability-bilateral',
      walker: 'walker-forward-lean',
    }).items.map((item) => item.id);
    expect(ids).toContain('reverse-walker');
  });

  it('只有平衡问题 → 北欧步行杖，并且带上「不能用来承重」这句', () => {
    const item = buildOrthosisPlan({ stability: 'stability-balance-only' }).items.find(
      (entry) => entry.id === 'nordic-poles',
    );
    expect(item?.cautions.join('')).toContain('北欧助行杖不适合此目的');
  });

  it('走路还稳的时候不问前倾那一题', () => {
    expect(
      visibleOrthosisQuestions({ stability: 'stability-none' }).map((q) => q.id),
    ).not.toContain('walker');
  });
});

describe('复制出去的那段文字', () => {
  it('两条通则在文字里，不只在页面上', () => {
    // A rule that lives only in the app's chrome does not reach the
    // clinician the plan is for.
    const text = buildOrthosisNarrative({
      ankle: 'ankle-drag',
      calf: 'calf-lost',
      quadriceps: 'quad-severe',
      trunk: 'trunk-limited',
      stability: 'stability-bilateral',
      walker: 'walker-forward-lean',
    }).join('\n');
    expect(text).toContain('先试用，再定制');
    expect(text).toContain('矫形器和助行器要一起开、一起练');
    expect(text).toContain('带这份清单去找康复师');
  });

  it('没答的题写成「（未填）」，不当成「还好」', () => {
    const text = buildOrthosisNarrative({ ankle: 'ankle-drag' }).join('\n');
    expect(text).toContain('（未填）');
  });

  it('空白状态也仍然有那两条和那句结尾', () => {
    const text = buildOrthosisNarrative({}).join('\n');
    expect(text).toContain('先试用，再定制');
    expect(text).toContain('带这份清单去找康复师');
  });
});

describe('这一页不冒充处方', () => {
  it('没有任何一条问题把 0-5 肌力分数当成分岔条件', () => {
    // The guideline gives no MRC cut-offs. It describes gait. A future
    // edit that wrote「胫前肌 ≤3 分」would be inventing a threshold.
    ORTHOSIS_QUESTIONS.forEach((question) => {
      const text = [question.prompt, question.why, ...question.choices.map((c) => c.label)].join(
        '',
      );
      expect(text).not.toMatch(/[0-5]\s*分以下|≤\s*[0-5]\s*分|小于\s*[0-5]\s*分/);
    });
  });

  it('每一条都带出处', () => {
    ORTHOSIS_QUESTIONS.forEach((question) => {
      expect(question.source.length).toBeGreaterThan(0);
    });
    reachableAnswerSets().forEach((answers) => {
      buildOrthosisPlan(answers).items.forEach((item) => {
        expect(item.source).toContain('荷兰 FSHD 指南');
      });
    });
  });
});
