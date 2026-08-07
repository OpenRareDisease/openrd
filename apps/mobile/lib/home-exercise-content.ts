/**
 * 六个月居家运动方案 — Bankolé 2016, and an honest account of the gap
 * between what that trial did and what most people reading this can do.
 *
 * The sources, for every clinical sentence below:
 *
 *  [Bankolé] Bankolé L-C, Millet GY, Temesi J, Bachasson D,
 *            Ravelojaona M, Wuyam B, Verges S, Ponsot E, Antoine J-C,
 *            Kadi F, Féasson L. Safety and efficacy of a 6-month
 *            home-based exercise program in patients with
 *            facioscapulohumeral muscular dystrophy: a randomized
 *            controlled trial. Medicine (Baltimore). 2016;95(31):e4497.
 *            ClinicalTrials.gov NCT01116570. In the corpus at
 *            05.相关研究/第一批：2025年3月31日/B.6个月居家康复计划及研究.pdf.
 *  [King]    King WM, Pandya S. Physical Therapy & FSHD: A Guide for
 *            Patients & Physical Therapists. FSH Society, May 2009. In
 *            the corpus at 02.临床管理与治疗/第一批：2025年3月31日/
 *            A.指南【康复】PhysicalTherapyAndFSHD_May2009.pdf.
 *  [荷兰5.2] Spierziekten Nederland. Dutch FSHD Guideline, 24-01-2019,
 *            module 5, question 5.2「体能训练对提高 FSHD 患者活动能力的
 *            价值是什么？」— 结论 (all graded 低等级), 考虑因素 and 建议.
 *            Corpus holds both the English original
 *            (02.临床管理与治疗/…Dutch-FSHD-Guideline-English-24012019.pdf)
 *            and a Chinese translation (指南共识/…_translate.pdf). Read
 *            the English one for anything load-bearing: the translation
 *            has at least one page-break defect that inverts a muscle
 *            attribution in 5.4 — see the 10 米步行 note below, which
 *            this page once got wrong by trusting it.
 *
 * The one thing this file exists to keep straight
 * -----------------------------------------------
 * Bankolé's numbers are real and they are good: +19% VO2peak, +34%
 * fibre cross-sectional area, no worsening of the dystrophic picture,
 * 91% adherence over 24 weeks. They were also obtained on a stationary
 * ergocycle, with the first 5–10 sessions supervised in the patient's
 * home by an exercise physiologist, with weekly telephone support plus
 * one attended session, and with intensity set as a percentage of
 * maximal aerobic power measured in a lab on an incremental cycling
 * test to task failure — re-measured every 6 weeks and re-prescribed.
 *
 * Almost nobody reading this app has any of that. So this file carries
 * an RPE-based substitute, and every piece of that substitute is tagged
 * `evidence: 'substitute'`. Nothing tagged 'substitute' may be rendered
 * as though it were tagged 'trial'. The screen renders the tag, and
 * there is a test that every substitute-tagged item is reachable only
 * on a page that also shows EXERCISE_SUBSTITUTION_NOTE.
 *
 * Specifically: there is no published equivalence between the RPE bands
 * below and Bankolé's 60% MAP. The bands are this page's own
 * operational description so that someone without a power meter can
 * start; they are not a conversion, and this file must never imply one.
 *
 * What the paper does not say in text
 * -----------------------------------
 * The per-session structure — how long each interval was, how many
 * sets of near-maximal revolutions, the rest ratios — is drawn in the
 * paper's Figure 3 and appears nowhere in its running text. It could
 * not be read out of the corpus PDF. So this file does NOT state
 * interval durations or set counts. Inventing plausible ones would be
 * exactly the defect this repo has shipped before: a number that looks
 * sourced because it sits next to a citation.
 *
 * Measurement
 * -----------
 * The re-measures below reuse FUNCTION_TEST_TYPES that already exist
 * (six_minute_walk, sit_to_stand, ten_meter_walk) plus the muscle
 * self-test. This module only names them; the data-entry surface is
 * owned elsewhere.
 */

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export const HOME_EXERCISE_AS_OF = '2026-08-05';

export const TRIAL_SOURCE = 'Bankolé 等，Medicine (Baltimore) 2016;95(31):e4497（随机对照试验）';
export const PT_GUIDE_SOURCE =
  'King WM、Pandya S，《Physical Therapy & FSHD》，FSH Society，2009 年 5 月';
export const DUTCH_SOURCE = '荷兰 FSHD 指南（2019-01-24，中译全文）5.2';

/**
 * Where an item comes from. The screen renders this — it is the whole
 * point of the module.
 *
 *  'trial'      — measured in Bankolé 2016 and reported there.
 *  'guideline'  — a recommendation from the Dutch guideline or from
 *                 King & Pandya. Expert consensus, not a measured
 *                 result.
 *  'substitute' — this page's stand-in for something the trial did
 *                 with equipment and supervision most readers do not
 *                 have. NOT how the published results were produced.
 */
export type ExerciseEvidence = 'trial' | 'guideline' | 'substitute';

export const EXERCISE_EVIDENCE_LABEL: Record<ExerciseEvidence, string> = {
  trial: '原研究实测',
  guideline: '指南建议',
  substitute: '本页的替代做法（不是原研究的方法）',
};

export const HOME_EXERCISE_INTRO =
  '2016 年有一项针对 FSHD 的随机对照试验，让患者在家骑 24 周功率自行车，每周三次、每次 35 分钟。结果是好的，而且没有把肌肉练坏。这一页把那项研究讲清楚，然后诚实地说明：在国内的条件下照着做，和研究里做的不是同一件事。';

/**
 * The honest part, and it goes above the plan rather than under it.
 */
export const EXERCISE_SUBSTITUTION_NOTE =
  '下面标着「本页的替代做法」的部分，不是 Bankolé 2016 的方法。原研究用的是家里的固定功率自行车，强度按实验室递增功率测试测出的最大有氧功率（MAP）的百分比来设定，每 6 周重测一次再重新定量；前 5 到 10 次训练由有临床人群经验的运动生理学家上门监督；此后每周两次电话支持，第三次到场，核对心率记录和训练日志、检查器材、调整个体化强度。这一页用「自觉用力程度」来替代功率百分比，是为了让没有功率车、也没有人上门的人能开始——但那些发表出来的数字，不是这样练出来的。';

/* ------------------------------------------------------------------ */
/* What the trial measured                                             */
/* ------------------------------------------------------------------ */

export interface TrialFact {
  id: string;
  label: string;
  /** The number as the paper reports it. */
  value: string;
  detail: string;
  evidence: ExerciseEvidence;
  source: string;
}

export const TRIAL_FACTS: TrialFact[] = [
  {
    id: 'design',
    label: '研究规模',
    value: '19 人入组，16 人进入分析',
    detail:
      '训练组 8 人、对照组 8 人。对照组在 24 周后自愿再做同一套训练（作者称为 CTG），结果与训练组相似。作者自己写明：这项试验的主要局限就是人数少。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'dose',
    label: '训练量',
    value: '24 周，每周 3 次，每次 35 分钟',
    detail:
      '全部在家用固定功率自行车完成。两次是「组合课」：恒定中等强度有氧（60% 最大有氧功率）之后接若干组接近最大转速的冲刺。第三次是间歇训练课。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'adherence',
    label: '完成率',
    value: '91%',
    detail:
      '训练组平均完成 72 次预定训练中的 66 次。后来加入训练的对照组是 83%（60 次）。整个 24 周没有出现训练相关并发症。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'vo2peak',
    label: '峰值摄氧量（VO2peak）',
    value: '+19%',
    detail:
      'P = 0.002。第 6 周就已经出现显著提高，之后到第 24 周继续上升。对照组 24 周内没有变化。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'mvc',
    label: '股四头肌最大随意收缩力（MVC）',
    value: '+15%',
    detail: 'P = 0.014，第 24 周对比基线。对照组没有变化。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'endurance',
    label: '股四头肌耐力',
    value: '+23%',
    detail: 'P = 0.018，第 24 周对比基线。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'walk',
    label: '6 分钟步行距离',
    value: '+14%',
    detail:
      'P = 0.013，第 24 周。摘要只写了「增加」没有给百分比，数字在正文 3.3 节和 Table 2 里。距离的变化与 VO2peak（r = 0.62）、最大有氧功率（r = 0.72）、MVC（r = 0.68）的变化都正相关。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'fatigue',
    label: '疲劳严重度量表（FSS）',
    value: '−38%',
    detail:
      'P = 0.001，第 24 周。疲劳的下降与 VO2peak、最大有氧功率、肌肉耐力、MVC 和 6 分钟步行距离的改善都相关。生活质量量表（SF-36）总体没有显著变化。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'fibre',
    label: '肌纤维横截面积',
    value: '+34%',
    detail:
      'P = 0.008，取自股外侧肌活检（训练前后各一次）。柠檬酸合成酶活性同时上升 46%（P = 0.003）。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
  {
    id: 'safety',
    label: '有没有把肌肉练坏',
    value: '没有',
    detail:
      '论文结论：营养不良性的病理生理表现没有被加重。各组各时间点最大骑行和肌力测试后 24 小时的血清肌酸激酶都低于 1000 IU/L；训练组有一位患者基线就高于 1000，他运动后各时间点都在 1000 到 2000 之间，没有随训练升高。',
    evidence: 'trial',
    source: TRIAL_SOURCE,
  },
];

/** How the trial was actually delivered. Rendered next to the numbers. */
export interface TrialConditionItem {
  id: string;
  title: string;
  body: string;
  /** What this page offers instead, when it can offer anything. */
  substitute: string | null;
}

export const TRIAL_CONDITIONS: TrialConditionItem[] = [
  {
    id: 'ergocycle',
    title: '器材：家用固定功率自行车',
    body: '全部 72 次训练都在功率自行车上完成。功率车能显示瓦数，所以「60% 最大有氧功率」是一个可以照着踩的具体数字。',
    substitute:
      '没有功率车的话，可以用任何能持续进行、强度可控、对肌肉机械应力小的有氧方式（健身车、走路、游泳）。但强度就只能靠自我感觉定，见下面的自觉用力程度。',
  },
  {
    id: 'map',
    title: '强度：实验室测出的最大有氧功率',
    body: '每位患者做递增负荷骑行测试到力竭（每 2 分钟加 10 到 30 瓦），由此得出 VO2peak 和最大有氧功率（MAP），训练强度按 MAP 的百分比设定，并每 6 周随复测调整。',
    substitute:
      '本页用自觉用力程度替代。它和 60% MAP 之间没有在这项研究里被测过的对应关系——这是替代，不是换算。',
  },
  {
    id: 'supervision',
    title: '监督：前 5 到 10 次由运动生理学家上门',
    body: '之后每周仍有两次电话支持，第三次由该运动生理学家到场：核对每次训练记录的心率、检查训练日志有没有填、检查器材，并根据心率下降或新的 MAP 调整个体化强度。',
    substitute:
      '找不到这种支持时，退而求其次：开始前先由康复师看一次动作和强度，前几次找家人在旁边，把训练日志当成给康复师看的东西认真填。',
  },
  {
    id: 'screening',
    title: '入选和排除：先筛过一遍',
    body: '入选条件是分子诊断确诊的 FSHD1 型、年满 18 岁、并且有能力完成这套骑行方案。排除条件包括心血管疾病史（含心律失常）和临床心血管异常、炎症综合征或糖尿病、凝血异常、体质指数 ≥ 35。',
    substitute:
      '这一条没有替代品。上面任何一项符合你的情况，就意味着这套方案在你身上没有被验证过——开始前必须先问医生。',
  },
];

/**
 * What the paper does not tell us. Rendered, not omitted.
 *
 * Someone will ask 「间歇是几分钟」. The answer has to be 「论文正文没写」
 * rather than a plausible number.
 *
 * Both entries are Figure 3, and that is the whole list. A third one
 * used to say the paper never gave a percentage for the 6-minute walk;
 * §3.3 gives it (14%, P = 0.013, Table 2, Fig. 5C) and only the
 * abstract is silent. An invented unknown fails this page the same way
 * an invented number does — the patient re-measures their 6-minute walk
 * at weeks 0/12/24 and is told there is nothing to compare against —
 * so an entry belongs here only after the paper's running text has been
 * checked and found silent.
 */
export const TRIAL_UNKNOWNS: string[] = [
  '每节课的具体分段——间歇的时长、组数、休息比例——画在论文的 Figure 3 里，正文没有写出来，本页也读不出来。所以这一页不给你秒数和组数，请让康复师按你的情况定。',
  '接近最大转速的「组」是几组、每组多久，同样只在 Figure 3 里。',
];

/* ------------------------------------------------------------------ */
/* The substitute intensity scale                                      */
/* ------------------------------------------------------------------ */

export interface ExertionBand {
  id: 'easy' | 'moderate' | 'hard';
  /** 0-10 self-rated exertion. */
  range: string;
  label: string;
  /** What it feels like, in body terms. */
  feel: string;
  /** The talk test — the part that works without any equipment. */
  talkTest: string;
  /** Which part of the week this band is for. */
  useFor: string;
}

/**
 * A 0-10 self-rated exertion scale with plain-language anchors.
 *
 * This is the app's own description, written so that someone with no
 * power meter and no heart-rate strap can pick an intensity and keep
 * it consistent week to week. It is deliberately NOT presented as a
 * conversion from Bankolé's percentages of MAP: no such conversion was
 * measured in that trial, and asserting one would be inventing the
 * single most load-bearing number on this page.
 */
export const EXERTION_BANDS: ExertionBand[] = [
  {
    id: 'easy',
    range: '2–3 / 10',
    label: '轻',
    feel: '呼吸比坐着快一点，身上刚开始热。第二天不会有额外的酸。',
    talkTest: '能完整说话，甚至能唱歌。',
    useFor: '热身、放松，以及任何你拿不准的那一天。',
  },
  {
    id: 'moderate',
    range: '4–6 / 10',
    label: '中等',
    feel: '呼吸明显加深，出汗，但你觉得这样还能再撑二十分钟。',
    talkTest: '能连续说完整句子，但唱不了歌。',
    useFor: '组合课里那段恒定的有氧——对应原研究的「恒定中等强度」那一段。',
  },
  {
    id: 'hard',
    range: '7–9 / 10',
    label: '接近最大',
    feel: '很吃力，只能维持很短的时间，结束后需要真正的休息才能再来一次。',
    talkTest: '只能蹦出几个字。',
    useFor: '组合课末尾的冲刺组，和间歇课的「快」那一段。',
  },
];

export const EXERTION_SCALE_NOTE =
  '这套 0–10 的描述是本页为了让没有功率车的人能开始而写的，不是 Bankolé 2016 用的口径，也没有在那项研究里被验证过和 60% 最大有氧功率是同一个强度。把它当成一个能让你每周保持一致的尺子，不是当成研究结论。';

/* ------------------------------------------------------------------ */
/* The week, and the 24 weeks                                          */
/* ------------------------------------------------------------------ */

export interface SessionType {
  id: 'combined' | 'interval';
  name: string;
  perWeek: number;
  minutes: number;
  /** What the paper says this session contained. */
  fromTrial: string[];
  /** How to run it without a power meter. Tagged substitute. */
  substitute: string[];
  source: string;
}

export const SESSION_TYPES: SessionType[] = [
  {
    id: 'combined',
    name: '组合课（有氧 + 力量）',
    perWeek: 2,
    minutes: 35,
    fromTrial: [
      '恒定中等强度的有氧，强度设在最大有氧功率的 60%。',
      '之后接若干组接近最大转速的冲刺。',
      '（每段多长、几组，只画在论文 Figure 3 里，正文没写。）',
    ],
    substitute: [
      '主体那一段按「中等」（4–6 / 10）踩或走，能说完整句子但唱不了歌。',
      '最后加几组短的、接近最大（7–9 / 10）的加速，每组之间完全恢复再来下一组。',
      '组数和时长请让康复师按你的情况定，别照网上的 HIIT 模板——那些不是给 FSHD 写的。',
    ],
    source: TRIAL_SOURCE,
  },
  {
    id: 'interval',
    name: '间歇课',
    perWeek: 1,
    minutes: 35,
    fromTrial: [
      '论文写明第三次是间歇训练课，具体分段同样只在 Figure 3 里。',
      '作者在讨论里推断：高强度间歇很可能是这套方案里起关键作用的成分。',
    ],
    substitute: [
      '「快」的那一段按「接近最大」（7–9 / 10），「慢」的那一段按「轻」（2–3 / 10）踩到能说话为止再开始下一轮。',
      '同样：轮数和每轮时长由康复师定。',
    ],
    source: TRIAL_SOURCE,
  },
];

export interface ExercisePhase {
  id: string;
  /** Inclusive week range, 1-based. */
  fromWeek: number;
  toWeek: number;
  title: string;
  focus: string;
  /** What the trial did at this point. */
  trialNote: string;
}

/**
 * Four six-week blocks.
 *
 * The block boundaries are not arbitrary: Bankolé assessed at T0, T6,
 * T12, T18 and T24, and adjusted each patient's prescribed intensity
 * off those assessments. Progression in that trial came from
 * re-measuring, not from adding a fixed percentage every week — which
 * is the part worth copying even when the measurement is cruder.
 */
export const EXERCISE_PHASES: ExercisePhase[] = [
  {
    id: 'phase-1',
    fromWeek: 1,
    toWeek: 6,
    title: '第 1–6 周：把三次课固定下来',
    focus:
      '这一段的目标是出勤，不是强度。宁可强度偏低也要三次都做到——原研究 24 周能拿到 91% 的完成率，是整件事成立的前提。',
    trialNote:
      '原研究里，前 5 到 10 次由运动生理学家上门监督。第 6 周做第一次复测，VO2peak 那时已经显著上升。',
  },
  {
    id: 'phase-2',
    fromWeek: 7,
    toWeek: 12,
    title: '第 7–12 周：按第 6 周的复测调一次量',
    focus:
      '如果第 6 周的自测有进步，就把中等强度那一段延长一点，或者把冲刺组的强度往上挪一格——一次只改一样。',
    trialNote:
      '原研究在这个节点根据心率下降或新测的最大有氧功率重新设定个体化强度。第 12 周做第二次肌力和 6 分钟步行复测。',
  },
  {
    id: 'phase-3',
    fromWeek: 13,
    toWeek: 18,
    title: '第 13–18 周：最容易停下来的一段',
    focus: '新鲜感没了，进步也不像前六周那么明显。这一段照原样做完就是成绩。',
    trialNote: '原研究里 VO2peak 和最大有氧功率在第 6 周之后仍在继续上升，一直到第 24 周。',
  },
  {
    id: 'phase-4',
    fromWeek: 19,
    toWeek: 24,
    title: '第 19–24 周：做完，并且做一次完整复测',
    focus:
      '把第 24 周的复测和第 0 周的记录并排看。这一页的价值在这一次对比里，不在中间任何一天的感觉里。',
    trialNote:
      '原研究到第 24 周时：VO2peak +19%、MVC +15%、肌肉耐力 +23%、6 分钟步行距离 +14%、疲劳 −38%、肌纤维横截面积 +34%。',
  },
];

/** 1-based week number → the phase it falls in, or null if outside 1-24. */
export const exercisePhaseForWeek = (week: number): ExercisePhase | null => {
  if (!Number.isInteger(week)) return null;
  return EXERCISE_PHASES.find((phase) => week >= phase.fromWeek && week <= phase.toWeek) ?? null;
};

/** The weeks Bankolé re-assessed on, 1-based and expressed as「第 N 周末」. */
export const REMEASURE_WEEKS = [6, 12, 18, 24] as const;

export const TOTAL_WEEKS = 24;
export const SESSIONS_PER_WEEK = 3;
export const MINUTES_PER_SESSION = 35;
/** 24 × 3 — the same 72 the paper counts adherence against. */
export const TOTAL_SESSIONS = TOTAL_WEEKS * SESSIONS_PER_WEEK;

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

export interface RemeasureItem {
  id: string;
  label: string;
  /** The existing FUNCTION_TEST_TYPES value, where one matches. */
  functionTestType?: 'six_minute_walk' | 'sit_to_stand' | 'ten_meter_walk';
  /** The muscle self-test metricKey, where that is the instrument. */
  selfTestMetricKey?: 'knee_extension' | 'ankle_dorsiflexion';
  why: string;
  every: string;
  source: string;
}

export const REMEASURE_ITEMS: RemeasureItem[] = [
  {
    id: 'six-minute-walk',
    label: '6 分钟步行',
    functionTestType: 'six_minute_walk',
    why: '原研究每 12 周测一次，训练组第 24 周的距离比基线多 14%（P = 0.013），并且和 VO2peak、最大有氧功率、MVC 的变化正相关。这是这套方案里最接近「日常有没有变好」的一项。注意 14% 是原研究那套方案（功率车、实验室定强度、有人上门监督）跑出来的，不是这一页的替代方案的预期值。',
    every: '第 0、12、24 周',
    source: TRIAL_SOURCE,
  },
  {
    id: 'sit-to-stand',
    label: '坐立测试（5 次起坐）',
    functionTestType: 'sit_to_stand',
    why: '不是 Bankolé 的指标，是同一份荷兰指南 5.2 里 Andersen 2015 用来评估功能性活动能力的四项之一。它便宜、在家能做，而且直接对应上厕所和从椅子上起身。',
    every: '每 6 周',
    source: DUTCH_SOURCE,
  },
  {
    id: 'ten-meter-walk',
    label: '10 米步行',
    functionTestType: 'ten_meter_walk',
    // 5.4 splits the ankle two ways and the split is load-bearing:
    // dorsiflexor paresis gets the first-rocker / foot-drag / stumble
    // consequences, and it is *push-off* (calf) weakness that 「will
    // also lead to reduced walking speed, particularly if there is
    // additional weakness of the trunk muscles (Rijken 2015)」. The
    // Chinese translation in the corpus loses this — a page break
    // orphaned「蹬地力量丧失」and the next sentence came out as
    //「踝背屈肌无力还会导致步行速度减慢」— so take this line from the
    // English guideline, not from that PDF. Naming the wrong muscle
    // here also mis-aims the patient at the AFO ladder in
    // orthosis-decision-content.ts, which branches on exactly whether
    // push-off is preserved.
    why: '蹬地力量（小腿）无力和躯干无力都会让步速下降（荷兰指南 5.4 引 Rijken 2015）。踝背屈无力在 5.4 里对应的是另一组后果——落地控制不住、脚尖拖地、绊倒。步速是前两件事的共同出口，测起来只要一段走廊。',
    every: '每 6 周',
    source: '荷兰 FSHD 指南（2019-01-24）5.4（以英文原文为准）',
  },
  {
    id: 'knee-extension',
    label: '肌力自评：坐位伸膝',
    selfTestMetricKey: 'knee_extension',
    why: '原研究测的是股四头肌，用的是实验室的力矩传感器。这里用的是 MRC 自评，粗得多——它抓不到 15% 这个量级的变化，只能抓到大的滑动。',
    every: '每 6 周',
    source: `${TRIAL_SOURCE}；量表口径见本平台「肌力自评」`,
  },
];

export const REMEASURE_NOTE =
  '开始之前先做一次基线，这一点 King 和 Pandya 写得很直接：决定开始运动方案的人，应当在开始之前取得基线肌力测量，之后定期复查。没有基线，24 周之后你手上就只有感觉。';

/* ------------------------------------------------------------------ */
/* The training log                                                    */
/* ------------------------------------------------------------------ */

/**
 * King & Pandya's daily log, as prompts.
 *
 * Their reasoning is that FSHD is heterogeneous enough that no general
 * prescription is warranted, so the only way to find out whether a
 * program helps a particular person is to record what they did and how
 * they felt the next day.
 */
export const LOG_PROMPTS: string[] = [
  '今天做了哪些日常活动（不只是运动——洗头、抱孩子、拎菜也算，它们和训练用的是同一批肌肉）',
  '今天做了什么运动、多长时间、自觉用力程度到几分',
  '第二天的情况：有没有比平时更酸、更痛、更累，力气有没有比平时差',
];

export const LOG_NOTE =
  'King 和 Pandya 的原话大意是：把体力任务（日常的和训练的）连同身体状况（包括疼痛和疲劳）一起记下来，个人才能判断这套方案在短期内到底有没有好处。这份日志也是你去见康复师时最值钱的东西。';

/* ------------------------------------------------------------------ */
/* Strength training, and the two reasons to be careful                */
/* ------------------------------------------------------------------ */

export interface ExerciseGuidanceSection {
  id: string;
  title: string;
  points: string[];
  evidence: ExerciseEvidence;
  source: string;
}

export const EXERCISE_GUIDANCE: ExerciseGuidanceSection[] = [
  {
    id: 'aerobic-first',
    title: '为什么优先有氧',
    points: [
      'King 和 Pandya：有氧运动（骑车、走路、游泳）对肌纤维的机械应力较小，因此肌肉损伤的机会更少，同时能改善整体体能和耐力。',
      '荷兰指南 5.2 的建议：建议 FSHD 患者进行有氧运动训练（骑车或一般性运动）。有氧运动似乎有助于提高有氧能力、体力活动，并减少疲劳。',
      '荷兰指南同时写明：有氧训练可能改善因疲劳和负荷增加而出现的功能性活动障碍和平衡问题，但这一点尚未得到研究。',
    ],
    evidence: 'guideline',
    source: `${PT_GUIDE_SOURCE}；${DUTCH_SOURCE}`,
  },
  {
    id: 'resistance-two-concerns',
    title: '阻力训练：两个要当心的地方',
    points: [
      '第一，FSHD 患者不同肌群之间的强弱差别非常大。想安全地练一块强的或只是轻度受累的肌肉，很难不让同一个动作里那块弱得多的肌肉过用或被拉伤。',
      '第二，取决于无力的程度，有些肌肉光是对抗重力完成日常生活活动就已经在用最大力气了。King 和 Pandya 举的例子是肩胛稳定肌（前锯肌、中斜方肌）——它们要应付洗澡、洗头、梳头就已经吃力，这些肌肉需要的是休息，不是再加阻力训练。',
      '所以「要不要做阻力训练」的答案取决于两件事：各肌群之间的无力程度，以及——他们说这一点最重要——这个人平时的活动量本来有多大。坐办公室、家里没有小孩、不做重家务的人，可能从一套精心挑过的方案里得益；而全职收银或者要抱九个月大婴儿的人，再加阻力训练可能反而是在冒伤到肩肘肌肉的风险。',
    ],
    evidence: 'guideline',
    source: PT_GUIDE_SOURCE,
  },
  {
    id: 'strength-where',
    title: '如果要练力量，练哪里',
    points: [
      '荷兰指南 5.2 的建议：可以考虑力量训练，尤其是在怀疑「失用」（因为缺乏体力活动而导致的肌力和肌肉体积丧失）的情况下。',
      '它给的方向是练受 FSHD 影响较小的保留肌肉——具体点名了髂腰肌和臀大肌——或者练躯干稳定性，用来代偿并优化步态和平衡能力。',
      '指南对这一条加了限定：在神经肌肉疾病专科物理治疗师的指导下进行。',
      'Van der Kooi 2004 的次最大强度力量训练没有造成伤害，也没有引起肌肉损伤或力量下降；但也没有让被训练的肌肉变强。荷兰指南据此认为 FSHD 做肌力训练似乎没有禁忌症，同时要求防止过度训练。',
    ],
    evidence: 'guideline',
    source: DUTCH_SOURCE,
  },
];

/**
 * The evidence level of the Dutch guideline's own conclusions.
 *
 * All four of 5.2's conclusion boxes are graded 低等级, and one of
 * them is negative. Rendering the recommendations without this would
 * make the guideline sound more certain than it is — and the negative
 * one is the one a patient would most want to know before spending six
 * months on this.
 */
export const DUTCH_EVIDENCE_NOTE =
  '荷兰指南 5.2 的四条结论全部标为「低等级」，而且其中一条是负面的：有氧训练不能改善 FSHD 患者的活动能力（Andersen 2015）。指南自己也提醒这个结论要谨慎下——只有 Andersen 那一项研究把功能性活动能力当作结局指标，而且用的是简单的功能测试加问卷。另外三条是：次最大强度训练可以改善肌力、有氧骑行可以提高股四头肌力量、有氧训练可以改善最大摄氧量，都只有「几乎没有迹象」到「很少有迹象」的强度。';

export const DUTCH_EXPERT_OPINION_NOTE =
  '荷兰指南在 5.2 和 5.4 的建议后面都附了同一句注：这些建议是基于专家意见和类似情况的经验，应进一步在 FSHD 中检查和评估。';

/* ------------------------------------------------------------------ */
/* Before you start                                                    */
/* ------------------------------------------------------------------ */

export const BEFORE_YOU_START: string[] = [
  '先做基线：肌力自评、6 分钟步行、坐立测试各记一次。没有基线，后面就没得比。',
  '先问医生：原研究把有心血管疾病史（含心律失常）、临床心血管异常、炎症综合征、糖尿病、凝血异常、体质指数 ≥ 35 的人排除在外。这些情况下这套方案没有被验证过。',
  '找一次康复师：让他们看一次你的动作和起始强度。理想的人选是有 FSHD 经验的物理治疗师；退一步，至少要是熟悉神经肌肉病、并且愿意去了解 FSHD 特点的专业人员。',
  '呼吸和心脏的常规监测走随访计划那一页——那是另一套建议，不在这一页的范围里。',
];

export const HOME_EXERCISE_DISCLAIMER =
  '这一页不开运动处方。它把一项针对 FSHD 的随机对照试验讲清楚，标出哪些部分是实测的、哪些是本页为了可执行而替换掉的，然后建议你带着这些去找康复师。任何一次训练里出现胸痛、明显气促、头晕，或者第二天力气比平时明显下降，都停下来并联系医生。';
