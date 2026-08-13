/**
 * 辅具选择决策流 — the Dutch FSHD guideline's AFO ladder and walking-aid
 * ladder, turned into questions a patient can answer about themselves.
 *
 * The source, for every clinical sentence below:
 *
 *  [荷兰5.4] Spierziekten Nederland. Dutch FSHD Guideline, 24-01-2019.
 *            Module 5, question 5.4「哪些辅助和调整有助于维持或改善
 *            FSHD 患者的活动能力？」— sub-sections 考虑事项 (the
 *            reasoning) and 建议 (the recommendations). Read from the
 *            verified full Chinese translation in the corpus at
 *            content/medical-kb/source/FSHD_知识库/指南共识/. ©2018
 *            Spierziekten Nederland. The guideline's own note on this
 *            question: no papers were found for 5.4, so every
 *            recommendation in it is expert opinion, and it says so.
 *  [康复网络] 《FSHD康复医师网络》, 12.资源库 第二批 (2025-05-15).
 *            The four named clinicians below are quoted from it
 *            verbatim, institution and title included.
 *
 * Why this is a flow and not a list
 * ---------------------------------
 * 5.4 does not have one recommendation, it has a ladder: which AFO
 * depends on whether there is still push-off left in the calf, KAFO
 * only enters at severe quadriceps weakness, a cane goes on the side
 * OPPOSITE the unstable leg, a walker beats two canes when both legs
 * are involved, and Nordic poles are explicitly NOT for carrying load.
 * Rendered as a bulleted list, all of that reads as a menu of things to
 * buy — which, for a population paying out of pocket, is the expensive
 * kind of wrong. The branch variables are things a patient can observe
 * about their own walking, so they are asked.
 *
 * The branch variables and the 0-5 scores
 * ---------------------------------------
 * The guideline branches on ankle dorsiflexion, calf push-off and
 * quadriceps — the same three muscles the product already scores
 * (MUSCLE_GROUPS: tibialis, quadriceps; SELF_TEST_ACTIONS:
 * ankle_dorsiflexion, knee_extension). It does NOT give MRC cut-offs.
 * It describes what the weakness looks like when you walk: the foot
 * slapping down because it can no longer control load after heel
 * strike, the toe catching in swing, push-off gone, the knee buckling
 * in stance. So the questions below ask about walking, and the muscle
 * score is offered as a cross-reference (`selfTestMetricKey`) rather
 * than as the branch. Writing 「胫前肌 ≤ 3 分 → 用后侧 AFO」 would be
 * inventing a threshold the guideline does not contain.
 *
 * The two rules
 * -------------
 * ORTHOSIS_STANDING_RULES ride on every plan this module can produce,
 * including the plan where every answer is 「还好」. They are the two
 * things in 5.4 that are not about which device to pick:
 *
 *  1. try a temporary orthosis before having one custom-made, and
 *  2. an orthosis and a walking aid are prescribed and trained
 *     together, and reviewed periodically.
 *
 * `buildOrthosisPlan` puts them on the returned plan unconditionally.
 * There is a test that walks every reachable answer combination and
 * asserts both are present; delete the spread and it goes red.
 *
 * What this file does NOT do
 * ------------------------
 * It does not prescribe, and it does not pretend the Dutch delivery
 * system exists here — see ORTHOSIS_SYSTEM_CAVEAT. Every path ends at
 * ORTHOSIS_REFERRAL: a list to carry to a rehabilitation clinician.
 */

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export const ORTHOSIS_CONTENT_AS_OF = '2026-08-05';

export const GUIDELINE_SOURCE = '荷兰 FSHD 指南（2019-01-24，中译全文）5.4 考虑事项';
export const GUIDELINE_RECOMMENDATION_SOURCE = '荷兰 FSHD 指南（2019-01-24，中译全文）5.4 建议';
export const REHAB_NETWORK_SOURCE = '《FSHD康复医师网络》，知识库 12.资源库 第二批（2025-05-15）';

export const ORTHOSIS_INTRO =
  '这一页把荷兰 FSHD 指南第 5.4 节里关于矫形器和助行器的分档，拆成几个关于你自己走路的问题。回答完会得到一份清单——清单是拿去和康复师讨论的，不是购物单。';

/**
 * The honesty note that has to sit above the flow rather than under it.
 *
 * 5.4 assumes orthotists, loanable trial orthoses, instrumented (3D)
 * gait analysis and an FSHD expert centre to refer to. Presenting the
 * ladder without saying so would tell a patient in a city with one
 * 康复科 that they are one appointment away from a fitted device.
 */
export const ORTHOSIS_SYSTEM_CAVEAT =
  '这份分档出自荷兰的指南，它默认的条件是：有矫形器师（orthotist）做取型和适配，有可以先借来试一段时间的临时矫形器，有能做仪器化（3D）步态分析的中心，还有 FSHD 专科中心可以转诊。国内不是每个地方都有这条路——成品支具和定制支具的渠道、能不能先试一副再决定、费用能不能报销，各地差别很大。所以这一页给你的是「该问什么、该比较什么」，不是「照着买什么」。';

export const ORTHOSIS_EVIDENCE_NOTE =
  '指南自己写明：5.4 这个问题检索全文后没有找到可用的研究文献，所以下面每一条都是专家意见和类似情况的经验，指南原文的注也是这么说的。它是目前最像样的参考，但它不是被试验证明过的处方。';

export const ORTHOSIS_DISCLAIMER =
  '这一页不开处方，也不预测你需要哪一件。矫形器的取型、助行器的高度和型号、要不要用、什么时候用，都要由当面看过你走路的康复医生或物理治疗师决定。';

/* ------------------------------------------------------------------ */
/* The two rules that run through the whole flow                       */
/* ------------------------------------------------------------------ */

export interface OrthosisRule {
  id: 'trial-first' | 'prescribe-and-train-together';
  title: string;
  body: string;
  source: string;
}

/**
 * Both rules, on every plan, always.
 *
 * The scope of each is stated inside its own text rather than
 * flattened: 5.4 says 「先试用再定制」 about leg orthoses and the
 * thoraco-lumbar brace specifically (those are the custom-made,
 * expensive ones), and says 「按处方使用并接受培训」 about walking aids
 * AND orthoses together. Widening the first one to cover canes would
 * be putting words in the guideline's mouth; dropping it from the
 * plan when no orthosis was matched would be dropping the rule that
 * stops someone paying for a device they never tried.
 */
export const ORTHOSIS_STANDING_RULES: OrthosisRule[] = [
  {
    id: 'trial-first',
    title: '先试用，再定制',
    body: '指南说：在提供腿部矫形器或胸腰支具时，尽可能先用临时（试用）矫形器过一个测试期，然后再决定要不要做定制件。定制辅具相对昂贵，而且它对哪些日常活动真的有用、值不值得做，是要在试用期里看出来的，不是在店里量出来的。',
    source: GUIDELINE_SOURCE,
  },
  {
    id: 'prescribe-and-train-together',
    title: '矫形器和助行器要一起开、一起练',
    body: '指南说：助行器和／或矫形器应始终按处方使用，并且应接受培训——前方支撑的 AFO 尤其要练。选哪一件、怎么用、什么场合用，都要定期和治疗康复医生或物理治疗师一起复核，按你自己的情况和意愿调整。两件东西是配套的：肩部无力会让手臂摆动减少、姿势改变，也会削弱你使用助行器的能力，所以只配矫形器不管助行器（或者反过来）会漏掉一半。',
    source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
  },
];

/* ------------------------------------------------------------------ */
/* The questions                                                       */
/* ------------------------------------------------------------------ */

export type OrthosisQuestionId = 'ankle' | 'calf' | 'quadriceps' | 'trunk' | 'stability' | 'walker';

export interface OrthosisChoice {
  id: string;
  label: string;
  /** The guideline's own description of this presentation, when it has
   *  one. Shown under the choice so the patient can recognise
   *  themselves in it rather than guessing which bucket they are. */
  detail?: string;
}

export interface OrthosisQuestion {
  id: OrthosisQuestionId;
  title: string;
  prompt: string;
  /** Why the guideline branches here. Rendered — a fork whose reason
   *  is hidden is a fork the patient answers to please the app. */
  why: string;
  /**
   * The muscle self-test that measures the same thing, when one
   * exists. A cross-reference for the patient's own memory, NOT the
   * branch: see the file header.
   */
  selfTestMetricKey?: 'ankle_dorsiflexion' | 'knee_extension';
  selfTestHint?: string;
  choices: OrthosisChoice[];
  source: string;
}

export const ORTHOSIS_QUESTIONS: OrthosisQuestion[] = [
  {
    id: 'ankle',
    title: '脚踝：勾脚背',
    prompt: '走路的时候，你的脚是怎么落地的？',
    why: '踝背屈无力在 FSHD 病程早期就会出现，一开始只在走远路时明显，之后每一步都有。轻的时候，脚跟着地以后脚已经控制不住负荷，前脚掌会被「放」得很快；重的时候，迈步过程中脚尖会拖地或几乎拖地，绊倒风险跟着上来。指南整条 AFO 分档都是从这里开始的。',
    selfTestMetricKey: 'ankle_dorsiflexion',
    selfTestHint:
      '如果你在「肌力自评」里记过「勾脚背」，可以拿那一次的印象对照着答，但指南分档看的是走路的样子，不是那个分数。',
    choices: [
      {
        id: 'ankle-controlled',
        label: '脚是我自己控制着放下去的，不拍地也不拖地',
      },
      {
        id: 'ankle-slap',
        label: '脚跟着地以后，前脚掌控制不住地拍下去',
        detail: '走远路、走久了更明显。指南描述的「轻度麻痹」就是这一种。',
      },
      {
        id: 'ankle-drag',
        label: '迈步的时候脚尖会拖地，绊过或差一点绊倒',
        detail: '指南描述的「重度麻痹」：摆动期脚趾触地或几乎触地，拖动的脚会增加绊倒的风险。',
      },
    ],
    source: GUIDELINE_SOURCE,
  },
  {
    id: 'calf',
    title: '小腿：蹬地的力气',
    prompt:
      '用前脚掌往后蹬地（踮脚、上坡、想加快步速把身体往前送）还有力吗？站着支撑的时候膝盖会不会突然发软？',
    why: '这是指南选哪一种 AFO 的分界线。小腿还有蹬地力时，要尽量用轻便、动态的后侧 AFO，把踝关节的活动性和这点残余蹬地力保住。只有在小腿肌被削弱到几乎没有任何主动蹬地、而且支撑期膝关节屈曲的风险正在上升时，才换成提供前向腿部支持的、更硬的 AFO（利用能量守恒原理），目的是尽量保住步态中的能量。',
    choices: [
      {
        id: 'calf-preserved',
        label: '蹬地还有力，站着的时候膝盖是稳的',
      },
      {
        id: 'calf-lost',
        label: '蹬地几乎使不上劲了，或者站着的时候膝盖会发软、往前打弯',
      },
    ],
    source: GUIDELINE_SOURCE,
  },
  {
    id: 'quadriceps',
    title: '大腿前侧：股四头肌',
    prompt: '从椅子上站起来、上楼、蹲下后起身，现在是什么情况？',
    why: '指南只在「大腿肌肉严重无力（尤其是股四头肌）」这一档才提到可以考虑膝踝矫形器（KAFO），并且要求它尽可能轻便、最好配备可移动膝铰链和支撑相稳定功能。它没有为「有点吃力」这一档写具体的矫形器建议。',
    selfTestMetricKey: 'knee_extension',
    selfTestHint: '对应「肌力自评」里的「坐位伸膝」。同样，这里问的是日常动作，不是那个分数。',
    choices: [
      {
        id: 'quad-ok',
        label: '能自己站起来、能上楼，不用撑扶手',
      },
      {
        id: 'quad-effortful',
        label: '要用手撑着膝盖或扶东西才站得起来，上楼得拉扶手',
      },
      {
        id: 'quad-severe',
        label: '基本站不起来，或者站着的时候腿撑不住',
      },
    ],
    source: GUIDELINE_SOURCE,
  },
  {
    id: 'trunk',
    title: '躯干：上半身撑不撑得住',
    prompt: '坐着或站着的时候，上半身能撑得住吗？',
    why: '指南：对因躯干肌力减弱而严重受限的 FSHD 患者，动态胸腰支具可以改善姿势和平衡，尤其能在日常简单活动中增强躯干稳定性（引 Rijken 2014；King 和 Kissel 2013）。但它同时写了限制：活动自由度会降低，转身、弯腰、伸手这类更复杂的动作受影响最大，而且这是一件相对昂贵的定制辅具，所以要连「它对哪些活动真的有用」一起权衡。指南建议这一档最好在 FSHD 专家中心评估，或者和专家中心一起评估。',
    choices: [
      {
        id: 'trunk-ok',
        label: '撑得住，坐姿站姿没有明显问题',
      },
      {
        id: 'trunk-limited',
        label: '上半身撑不住，已经明显影响到日常（站久了塌下去、走路时上身晃）',
      },
    ],
    source: GUIDELINE_SOURCE,
  },
  {
    id: 'stability',
    title: '走路的稳定和平衡',
    prompt: '走路不稳的问题，主要是什么样的？',
    why: '指南的助行器分档：单侧腿不稳（例如一侧髋部无力）用单根手杖，而且拄在不稳那条腿的对侧；双侧腿不稳或严重平衡问题时，助行器往往比两根手杖更合适，因为借助行器可以携带物品，带座位和稳固刹车的还能停下来休息。北欧步行杖是另一类：它几乎总是双侧使用，主要用来提供平衡支撑，不用来在腿部肌肉无力时承重。',
    choices: [
      {
        id: 'stability-none',
        label: '走路不稳的问题还不明显',
      },
      {
        id: 'stability-unilateral',
        label: '主要是一条腿不稳',
      },
      {
        id: 'stability-bilateral',
        label: '两条腿都不稳，或者平衡问题已经比较重',
      },
      {
        id: 'stability-balance-only',
        label: '腿的力气还行，主要是平衡差，地面不平就没底',
      },
    ],
    source: GUIDELINE_SOURCE,
  },
  {
    id: 'walker',
    title: '用助行器时的姿势',
    prompt: '推助行器走的时候，你会不会不自觉地把上半身往前倾？（没试过也可以选「没试过」）',
    why: '指南点了助行器的缺点：人们倾向于前倾躯干行走，这可能会感到不适且疲劳，因为背部和躯干肌肉承受的压力不同。在这种情况下，可以考虑使用后置助行器。',
    choices: [
      {
        id: 'walker-upright',
        label: '不会 / 没试过',
      },
      {
        id: 'walker-forward-lean',
        label: '会前倾着走，走一会儿背和腰就累',
      },
    ],
    source: GUIDELINE_SOURCE,
  },
];

const QUESTION_BY_ID = new Map(ORTHOSIS_QUESTIONS.map((question) => [question.id, question]));

export const orthosisQuestion = (id: OrthosisQuestionId): OrthosisQuestion => {
  const question = QUESTION_BY_ID.get(id);
  if (!question) throw new Error(`unknown orthosis question: ${id}`);
  return question;
};

export type OrthosisAnswers = Partial<Record<OrthosisQuestionId, string>>;

/**
 * Which questions are worth asking given the answers so far, in order.
 *
 * Two of the six are conditional, and both conditions come from the
 * guideline rather than from screen real estate:
 *
 *  - `calf` decides posterior-dynamic vs anterior-rigid AFO. With no
 *    dorsiflexion weakness there is no AFO to choose between, so the
 *    question has no branch to feed.
 *  - `walker` is about the drawback of a walker. It only has an answer
 *    that changes anything once a walker is on the table.
 *
 * Everything else is always asked: quadriceps, trunk and stability are
 * independent ladders in 5.4, and hiding one because an earlier answer
 * was reassuring would drop a recommendation the guideline makes.
 */
export const visibleOrthosisQuestions = (answers: OrthosisAnswers): OrthosisQuestion[] => {
  const ankleWeak = answers.ankle === 'ankle-slap' || answers.ankle === 'ankle-drag';
  const walkerOnTable = answers.stability === 'stability-bilateral';

  return ORTHOSIS_QUESTIONS.filter((question) => {
    if (question.id === 'calf') return ankleWeak;
    if (question.id === 'walker') return walkerOnTable;
    return true;
  });
};

/** Questions currently on screen that have no answer yet. */
export const unansweredOrthosisQuestions = (answers: OrthosisAnswers): OrthosisQuestionId[] =>
  visibleOrthosisQuestions(answers)
    .filter((question) => !answers[question.id])
    .map((question) => question.id);

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

/**
 * 'device'      — the guideline names a device for this answer.
 * 'not-yet'     — the guideline's rung does not apply to this answer.
 *                 Said out loud rather than omitted, so the reader can
 *                 tell 「指南这一条现在对不上」 from 「这一页没查」.
 * 'no-guidance' — the answer sits between two rungs and 5.4 does not
 *                 name a device for it. The most dangerous state to
 *                 render silently: an empty section reads as「没事」.
 */
export type OrthosisItemKind = 'device' | 'not-yet' | 'no-guidance';

export type OrthosisTrack = 'orthosis' | 'walking-aid' | 'other';

export interface OrthosisItem {
  id: string;
  track: OrthosisTrack;
  kind: OrthosisItemKind;
  title: string;
  /** The guideline's content for this rung, in Chinese. */
  body: string;
  /** 因为你选了 — which answer put this on the list, quoted back. */
  because: string;
  /** Rung-specific cautions. The two standing rules are NOT repeated
   *  here; they live on the plan and the screen renders them with
   *  every endpoint. */
  cautions: string[];
  source: string;
}

export interface OrthosisReferralClinician {
  /** Verbatim from 《FSHD康复医师网络》 — institution, department,
   *  title and name, in the order that document lists them. */
  institution: string;
  department: string;
  title: string;
  name: string;
}

export const REHAB_CLINICIANS: OrthosisReferralClinician[] = [
  {
    institution: '复旦大学附属华山医院',
    department: '运动医学康复中心',
    title: '主管康复师',
    name: '孙杨',
  },
  {
    institution: '江苏省人民医院',
    department: '康复医学中心',
    title: '副主任技师、儿童组组长',
    name: '范亚蓓',
  },
  {
    institution: '北京协和医院',
    department: '物理康复科',
    title: '康复师',
    name: '张光宇',
  },
  {
    institution: '西安交通大学第一附属医院',
    department: '康复科门诊',
    title: '副主任医师',
    name: '邓景元',
  },
];

/** What every path ends at. */
export const ORTHOSIS_REFERRAL = {
  title: '带这份清单去找康复师',
  lede: '上面这些是指南的分档，不是给你的处方。哪一档对得上、具体做哪一件、高度和硬度怎么定，要由当面看你走路的人决定。下面是知识库《FSHD康复医师网络》里记录的四位康复医师／康复师。',
  bring: [
    '这份清单（可以复制成文字发出去）',
    '你最近一次的「肌力自评」和计时测试记录',
    '你现在已经在用的支具、鞋垫、手杖或助行器（把实物带上，不要只带照片）',
    '一双你平时最常穿的鞋——矫形器是要装进鞋里的',
    '如果摔过：摔在什么场合、什么地面、当时在做什么',
  ],
  clinicians: REHAB_CLINICIANS,
  source: REHAB_NETWORK_SOURCE,
} as const;

export interface OrthosisPlan {
  items: OrthosisItem[];
  /** Always both rules. Never conditional — see the file header. */
  standingRules: OrthosisRule[];
  referral: typeof ORTHOSIS_REFERRAL;
  /** Visible questions still unanswered, so the screen can say the
   *  list is partial instead of showing a short list as a finished
   *  one. */
  unanswered: OrthosisQuestionId[];
  /** True once every visible question has an answer. */
  complete: boolean;
}

const choiceLabel = (questionId: OrthosisQuestionId, choiceId: string | undefined): string => {
  if (!choiceId) return '（未填）';
  const choice = orthosisQuestion(questionId).choices.find((item) => item.id === choiceId);
  return choice ? choice.label : '（未填）';
};

const because = (questionId: OrthosisQuestionId, answers: OrthosisAnswers): string =>
  `你在「${orthosisQuestion(questionId).title}」选了：${choiceLabel(questionId, answers[questionId])}`;

/** The AFO / KAFO / brace ladder. */
const orthosisTrackItems = (answers: OrthosisAnswers): OrthosisItem[] => {
  const items: OrthosisItem[] = [];
  const ankleWeak = answers.ankle === 'ankle-slap' || answers.ankle === 'ankle-drag';

  if (answers.ankle === 'ankle-controlled') {
    items.push({
      id: 'afo-not-yet',
      track: 'orthosis',
      kind: 'not-yet',
      title: '现在还没到 AFO 这一档',
      body: '指南给 AFO 的适应证是补偿踝背屈无力。你现在描述的落地方式对不上这一条，所以这一页不给你 AFO 的建议。但指南也写了，踝背屈无力一开始「主要在长距离行走时显现」，之后才出现在每一次行走动作里——所以走远路那天的样子，比在家里走几步更能说明问题。',
      because: because('ankle', answers),
      cautions: ['下一次走远路或走久了以后，重新看一次脚是怎么落地的。这一条会变。'],
      source: GUIDELINE_SOURCE,
    });
  }

  if (ankleWeak && answers.calf === 'calf-preserved') {
    items.push({
      id: 'afo-posterior-dynamic',
      track: 'orthosis',
      kind: 'device',
      title: '轻便、动态的后侧 AFO（踝足矫形器）',
      body: '指南的第一条建议：FSHD 中用踝足矫形器（AFO）来补偿踝背屈无力，尽量使用轻型、动态的后侧 AFO，以尽可能保留推离（蹬地）力。这里的重点在「轻」和「动态」——目的是保住踝关节的活动性和你还剩的那点蹬地力，不是把踝关节固定死。',
      because: because('calf', answers),
      cautions: [
        '和康复师确认它是不是「动态」的：一副把踝关节锁死的硬支具会把你现在还有的蹬地力一起拿走。',
        '除了走路，还要一起考虑上下楼、蹲、跪、骑车、开车、运动和工作——指南要求把这些活动一并纳入选择。',
      ],
      source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
    });
  }

  if (ankleWeak && answers.calf === 'calf-lost') {
    items.push({
      id: 'afo-anterior-rigid',
      track: 'orthosis',
      kind: 'device',
      title: '前方支撑的、更硬的 AFO（能量储存型）',
      body: '指南：如果小腿肌肉严重无力，考虑使用前部支撑的更硬 AFO，利用能量保存原理。它对应的情况就是你选的这一档——几乎没有主动蹬地了，而且支撑期膝关节屈曲（发软）的风险在上升。这类 AFO 的作用是把步态里的能量尽量留住，同时在支撑期替你顶住膝盖。',
      because: because('calf', answers),
      cautions: [
        '指南在「培训」这一条里专门点了前方支撑的 AFO：它尤其需要接受使用训练。拿到之后不练就用，走起来和你现在的步态不是一回事。',
        '它比动态后侧 AFO 硬，会牺牲一部分踝关节活动性——这是拿活动度换稳定，值不值得要连日常活动一起算。',
      ],
      source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
    });
  }

  if (answers.quadriceps === 'quad-severe') {
    items.push({
      id: 'kafo',
      track: 'orthosis',
      kind: 'device',
      title: '可以考虑 KAFO（膝踝矫形器）',
      body: '指南：对于大腿肌肉严重无力的情况（尤其是股四头肌），可以考虑膝踝矫形器（KAFO）。该矫形器应尽可能轻便，并最好配备可移动膝铰链和支撑相稳定功能。指南还提到，为了确定最佳矫形器并做功能评估，仪器化（3D）步态分析会有帮助——不是每个地方都有，能约到就问一下。',
      because: because('quadriceps', answers),
      cautions: [
        'KAFO 比 AFO 重得多，也更影响坐下、上车和上厕所。指南写得很明白：最终选择总是基于患者的经验和需求，在与患者协商后做出。',
        '「尽可能轻便」「可移动膝铰链」「支撑相稳定」是三个可以直接问出口的规格，不要只问「有没有膝踝支具」。',
      ],
      source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
    });
  }

  if (answers.quadriceps === 'quad-effortful') {
    items.push({
      id: 'quad-between-rungs',
      track: 'orthosis',
      kind: 'no-guidance',
      title: '这一档指南没有写对应的矫形器',
      body: '你选的是「要撑着才站得起来、上楼要拉扶手」。指南在 5.4 里只为「大腿肌肉严重无力」这一档写了 KAFO，没有为中间这一档写任何矫形器建议。这里不替它补一条。',
      because: because('quadriceps', answers),
      cautions: [
        '这不等于「不用管」。把这条写进清单，让康复师当面判断——他们能做的评估（包括步态分析）比一页问答多得多。',
        '指南在另一处（5.2）提到：可以考虑对受累较轻的保留肌肉或躯干稳定性做力量训练来代偿，这属于运动那一页的内容。',
      ],
      source: GUIDELINE_SOURCE,
    });
  }

  if (answers.trunk === 'trunk-limited') {
    items.push({
      id: 'dynamic-tlso',
      track: 'orthosis',
      kind: 'device',
      title: '评估动态胸腰支具的效用（最好在 FSHD 专家中心）',
      body: '指南：如果存在致残性躯干肌肉无力，评估动态胸腰椎支具的效用，最好在（或与）FSHD 专家中心进行。它可以改善姿势和平衡，尤其能在日常简单活动中增强躯干稳定性。',
      because: because('trunk', answers),
      cautions: [
        '指南同时写了它的代价：活动自由度会降低，转身、弯腰、伸手这类复杂动作受影响最大。要权衡它对哪些活动有用。',
        '这是一件相对昂贵的定制辅具——「先试用再定制」这条对它尤其适用。',
      ],
      source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
    });
  }

  return items;
};

/** The cane / walker / Nordic-pole ladder. */
const walkingAidTrackItems = (answers: OrthosisAnswers): OrthosisItem[] => {
  const items: OrthosisItem[] = [];

  if (answers.stability === 'stability-none') {
    items.push({
      id: 'walking-aid-not-yet',
      track: 'walking-aid',
      kind: 'not-yet',
      title: '现在还没到助行器这一档',
      body: '指南给助行器的适应证是平衡问题和腿部肌肉无力。你现在描述的情况对不上，所以这一页不给你助行器的建议。',
      because: because('stability', answers),
      cautions: [
        '如果开始摔跤、或者在不平的地面上明显没底，就重新答一次这一题——助行器是用来提高安全性和增加行走距离的，不是走不动了才拿的。',
      ],
      source: GUIDELINE_SOURCE,
    });
  }

  if (answers.stability === 'stability-unilateral') {
    items.push({
      id: 'cane-contralateral',
      track: 'walking-aid',
      kind: 'device',
      title: '单根手杖，拄在不稳那条腿的对侧',
      body: '指南：通常单侧使用手杖来解决平衡问题，以补偿一条腿的不稳定（例如髋部无力）。如果存在腿部不稳，则在身体的对侧使用手杖。也就是说：左腿不稳，手杖拄右手。',
      because: because('stability', answers),
      cautions: [
        '拄错侧是最常见的错误，而且拄错侧的手杖帮不上忙。这一条值得当面让治疗师看一次你走。',
        'FSHD 的肩部无力会削弱你使用助行器具的能力——如果举手过头或提东西已经吃力，手杖能承的力也有限，要把这一点一起说。',
      ],
      source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
    });
  }

  if (answers.stability === 'stability-bilateral') {
    items.push({
      id: 'rollator',
      track: 'walking-aid',
      kind: 'device',
      title: '助行器（优先带座位和稳固刹车的那种）',
      body: '指南：对于双侧腿部不稳或严重的平衡问题，使用助行器往往比使用两根手杖更合适，因为借助助行器可以携带物品，甚至可以在有座位和稳固刹车的情况下休息。「能坐下休息」在指南里是被当成理由写出来的，不是附加功能。',
      because: because('stability', answers),
      cautions: [
        '带东西这件事对 FSHD 尤其要紧：肩部和上臂无力的时候，手里还拎着东西走本身就是一个平衡问题。',
        '刹车要「稳固」——手的握力如果已经在退，试的时候就要按着刹车走一段，不要只在店里捏两下。',
      ],
      source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
    });
  }

  if (answers.stability === 'stability-bilateral' && answers.walker === 'walker-forward-lean') {
    items.push({
      id: 'reverse-walker',
      track: 'walking-aid',
      kind: 'device',
      title: '可以考虑后置助行器',
      body: '指南：助行器的缺点是人们倾向于前倾躯干行走，这可能会感到不适且疲劳，因为背部和躯干肌肉承受的压力不同。在这种情况下，可以考虑使用后置助行器。',
      because: because('walker', answers),
      cautions: [
        '后置助行器把人「拉直」，对躯干肌已经吃力的人差别可能很大——但它的转向和过窄门的方式和前置的不一样，要先试。',
      ],
      source: GUIDELINE_SOURCE,
    });
  }

  if (answers.stability === 'stability-balance-only') {
    items.push({
      id: 'nordic-poles',
      track: 'walking-aid',
      kind: 'device',
      title: '北欧步行杖（双侧使用，只用来平衡）',
      body: '指南：北欧步行杖几乎总是双侧使用的，主要用于平衡支撑，而不是在腿部肌肉无力时承重。它们允许更活跃的步伐，适合在不规则地形上行走（例如林地）。最佳长度需要按个人情况评估，通常比健康人用的短——因为在 FSHD 里它主要用于平衡目的，不是推进支持。',
      because: because('stability', answers),
      cautions: [
        '指南在建议里明确写了：助行器也可用于补偿腿部肌肉无力，但北欧助行杖不适合此目的。如果以后腿的力气也退了，这一条要重新评。',
        '长度不要照网上的公式算，那是给健康人算推进的。让治疗师按你的用途定。',
      ],
      source: `${GUIDELINE_SOURCE}；${GUIDELINE_RECOMMENDATION_SOURCE}`,
    });
  }

  return items;
};

/** Alternative aids — the paragraph 5.4 puts after the two ladders. */
const otherTrackItems = (answers: OrthosisAnswers): OrthosisItem[] => {
  const mobilityLimited =
    answers.stability === 'stability-unilateral' ||
    answers.stability === 'stability-bilateral' ||
    answers.stability === 'stability-balance-only' ||
    answers.quadriceps === 'quad-severe';

  if (!mobilityLimited) return [];

  return [
    {
      id: 'alternative-aids',
      track: 'other',
      kind: 'device',
      title: '也问一句别的辅具',
      body: '指南：根据具体情况，除了助行器和／或矫形器外，还可以考虑使用替代辅助工具以确保在家内外安全移动，例如三轮车、轮椅、步行自行车或代步车。与患者共同做出这些选择非常重要，目的是防止不必要的风险和／或在行走时的能量损失。',
      because: '你上面的回答里已经有行动受限的部分。',
      cautions: [
        '「行走时的能量损失」是指南自己写的理由。为了省下走那两百米的力气而用代步车，不是放弃走路——是把力气留给到了地方以后要做的事。',
      ],
      source: GUIDELINE_SOURCE,
    },
  ];
};

/**
 * Turn answers into the list to carry to a clinician.
 *
 * The standing rules and the referral are spread in unconditionally.
 * Every endpoint of this flow — including the one where the patient
 * answered 「还好」 to all six questions — carries both rules and ends
 * at ORTHOSIS_REFERRAL.
 */
export const buildOrthosisPlan = (answers: OrthosisAnswers): OrthosisPlan => {
  const unanswered = unansweredOrthosisQuestions(answers);

  return {
    items: [
      ...orthosisTrackItems(answers),
      ...walkingAidTrackItems(answers),
      ...otherTrackItems(answers),
    ],
    standingRules: ORTHOSIS_STANDING_RULES,
    referral: ORTHOSIS_REFERRAL,
    unanswered,
    complete: unanswered.length === 0,
  };
};

/**
 * The plan as copyable text.
 *
 * Same purpose as the 残疾评定 narrative: something a patient can paste
 * into WeChat or read out loud. The two standing rules are in it,
 * because the text is what actually reaches the clinician — a rule
 * that only exists in the app's chrome does not survive the copy.
 */
export const buildOrthosisNarrative = (answers: OrthosisAnswers): string[] => {
  const plan = buildOrthosisPlan(answers);
  const lines: string[] = ['我的辅具问题清单（据荷兰 FSHD 指南 5.4 整理）'];

  lines.push('');
  lines.push('我的情况：');
  visibleOrthosisQuestions(answers).forEach((question) => {
    lines.push(`· ${question.title}：${choiceLabel(question.id, answers[question.id])}`);
  });

  lines.push('');
  lines.push('指南对应的条目：');
  if (plan.items.length === 0) {
    lines.push('· （还没有填够问题，暂时对不上任何一条）');
  } else {
    plan.items.forEach((item) => {
      lines.push(`· ${item.title}`);
    });
  }

  lines.push('');
  lines.push('无论选哪一件，这两条都适用：');
  plan.standingRules.forEach((rule) => {
    lines.push(`· ${rule.title}：${rule.body}`);
  });

  lines.push('');
  lines.push(`${plan.referral.title}。以上是指南的分档，不是处方，具体请当面评估。`);

  return lines;
};
