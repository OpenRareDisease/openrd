/**
 * 在家做的计时功能测试 — the protocol cards, the grading rule, and the
 * timestamp arithmetic behind the timer.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * The screen already had one timed test (「连续上 10 级台阶」) and it
 * wrote a bare number. A bare number is not a trend. The same patient
 * measuring down a hallway one week and across a living room the next
 * produces two numbers that cannot be subtracted, and a chart that
 * subtracts them anyway tells them their disease moved when their
 * furniture did. So every test here ships with the conditions that make
 * its number comparable — the space, the starting posture, whether an
 * aid is allowed, the words to say, how many attempts count — and every
 * saved record carries a quality grade that says whether those
 * conditions were actually met.
 *
 * WHAT IS CITED AND WHAT IS OURS
 * ------------------------------
 * Every `ProtocolSection` carries its own `source`, the same shape the
 * anesthesia card / 遗传与生育 / 随访计划 content files use. Three
 * kinds of source appear, and they are deliberately not interchangeable:
 *
 *   SOURCE_DUTCH / SOURCE_RIJKEN / SOURCE_TUG / SOURCE_ATS / SOURCE_30CST
 *       published, named, dated. The Dutch guideline lines are quoted
 *       from the copy in this repo's corpus
 *       (content/medical-kb/source/FSHD_知识库/02.临床管理与治疗/
 *        第一批：2025年3月31日/A.（指南）（全面）Dutch-FSHD-Guideline-English-24012019.pdf,
 *        §5.1 and §5.2).
 *
 *   SOURCE_APP
 *       this app's own home-recording convention. Used wherever a
 *       published protocol assumes a clinic — a 14-step staircase, a
 *       30 m corridor, a 43 cm chair — and we had to choose a home
 *       version. It says so in Chinese, on screen, next to the choice.
 *
 * The rule the repo runs on: never present a guess in the same register
 * as evidence. A fabricated scale anchor or a made-up cut-off would be
 * the worst thing this file could ship, so there are none. There are no
 * normative values anywhere in here — not「正常人 12 秒」, not a
 * red/yellow/green band. Every number these tests produce is compared
 * with the same patient's own previous number and nothing else, because
 * that is the only comparison we can actually justify.
 */

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/** 荷兰 FSHD 多学科指南. Verified against the corpus copy: §5.1
 *  recommends 6MWT / 10-meter walking test / Berg Balance Scale / TUG,
 *  and「Consider using simple anti-gravity tests (sit-to-stand,
 *  stand-to-sit, and step-up, step-down)」, followed by the guideline's
 *  own all-caps note that these recommendations rest on expert opinion. */
export const SOURCE_DUTCH =
  '荷兰 FSHD 多学科指南（Spierziekten Nederland，2018；英文版 2019-01-24）第 5 章「活动能力与平衡」';

/** The anti-gravity tests' primary study, as cited by the guideline's
 *  own reference list (entry 12 of chapter 5). n=19, exploratory, and
 *  the guideline says explicitly that it was therefore not GRADE-graded. */
export const SOURCE_RIJKEN =
  'Rijken NH 等，Arch Phys Med Rehabil，2015（抗重力测试的结构效度与评估者间信度；样本 19 人，探索性研究）';

/** Falls epidemiology, cited by the guideline (chapter 5 reference 2). */
export const SOURCE_HORLINGS =
  'Horlings CG 等，J Neurol Neurosurg Psychiatry. 2009;80(12):1357-1363（经荷兰指南第 5 章引用）';

export const SOURCE_TUG = 'Podsiadlo D, Richardson S. J Am Geriatr Soc. 1991;39(2):142-148';

export const SOURCE_ATS =
  'ATS Statement: Guidelines for the Six-Minute Walk Test. Am J Respir Crit Care Med. 2002;166(1):111-117';

export const SOURCE_30CST =
  'Rikli RE, Jones CJ，1999，Senior Fitness Test 中的 30 秒坐站（30-second chair stand）';

/**
 * Everything we chose ourselves.
 *
 * Named loudly on purpose. A patient deciding whether to show a number
 * to a doctor is entitled to know which parts of the recipe came from a
 * guideline and which parts came from us trying to fit a clinic test
 * into a Chinese apartment.
 */
export const SOURCE_APP = '肌愈通的家庭记录约定 — 不是已发表的量表，只用来和你自己上一次比';

/* ------------------------------------------------------------------ */
/* API vocabulary                                                      */
/* ------------------------------------------------------------------ */

/**
 * The subset of the server's `FUNCTION_TEST_TYPES` this file writes.
 *
 * Mirrored rather than imported: apps/mobile does not depend on
 * apps/api. Adding a value is a THREE-place edit — here,
 * apps/api/src/modules/patient-profile/profile.constants.ts, and the
 * CHECK constraint the migration for that enum carries. Getting one of
 * the three wrong shows up as a 400 the patient reads as「保存失败」.
 *
 * `custom` is doing real work below and it is not laziness: 2 分钟步行,
 * 四项抗重力 and 握力 have no enum value on the server today, and
 * inventing one on the client would produce a body Zod rejects. The
 * `protocol` field (see encodeProtocolField) is what tells those rows
 * apart, and the handoff asks for proper enum values.
 */
export type FunctionTestTypeKey =
  | 'stair_climb'
  | 'ten_meter_walk'
  | 'sit_to_stand'
  | 'six_minute_walk'
  | 'timed_up_and_go'
  | 'custom';

/** Mirror of `FUNCTION_TEST_UNITS` in profile.schema.ts. Same two-place
 *  discipline: the server's enum plus the DB CHECK in migration 015. */
export type FunctionTestUnitKey = 'sec' | 'm' | 'm/s' | 'reps' | 'kg' | 'score';

/* ------------------------------------------------------------------ */
/* Quality grade                                                       */
/* ------------------------------------------------------------------ */

/**
 * How much the conditions on the card were actually honoured.
 *
 * This is the whole point of the feature. `per_protocol` is the only
 * grade a trend line may plot; the other two are kept, shown, and never
 * subtracted from each other.
 *
 * It is a single explicit answer rather than a four-checkbox audit,
 * because the hand reading this screen may be bracing itself against
 * the other arm — lib/a11y.ts rule 1, size beats precision. The card
 * with the conditions on it is directly above the question.
 */
export type QualityGrade = 'per_protocol' | 'partial' | 'free';

export interface QualityGradeOption {
  key: QualityGrade;
  /** The button. */
  labelZh: string;
  /** What choosing it means for the record. */
  meaningZh: string;
  /** True only for `per_protocol`. Consumers plot on this and nothing
   *  else. */
  trendEligible: boolean;
}

export const QUALITY_GRADES: QualityGradeOption[] = [
  {
    key: 'per_protocol',
    labelZh: '按方案完成',
    meaningZh: '场地、姿势、辅具、口令都和卡片上一样。只有这一档会画进趋势线。',
    trendEligible: true,
  },
  {
    key: 'partial',
    labelZh: '条件不完整',
    meaningZh:
      '做了，但有地方不一样（比如距离不够、用手撑了、中途停了）。会存下来，也会显示，但不会和别的次数放在一条趋势线上比。',
    trendEligible: false,
  },
  {
    key: 'free',
    labelZh: '自由记录',
    meaningZh: '没照卡片做，随手记一个。同样是你的数据，同样不进趋势线。',
    trendEligible: false,
  },
];

export const gradeOption = (grade: QualityGrade): QualityGradeOption =>
  QUALITY_GRADES.find((option) => option.key === grade) ?? QUALITY_GRADES[2];

/* ------------------------------------------------------------------ */
/* The protocol cards                                                  */
/* ------------------------------------------------------------------ */

export type TimedTestId =
  | 'sit_to_stand_30s'
  | 'sit_to_stand_5x'
  | 'ten_meter_walk'
  | 'timed_up_and_go'
  | 'stair_four_step'
  | 'anti_gravity_four'
  | 'two_minute_walk'
  | 'six_minute_walk'
  | 'grip_strength';

/**
 * How the number is produced.
 *
 *  stopwatch  — the patient (or a helper) presses 停. Seconds.
 *  countdown  — the app times a fixed window; the patient enters what
 *               they achieved inside it (reps, metres).
 *  three_state— no timer at all; each item is 能/勉强/做不到.
 *  manual     — a reading off a device. No timer.
 */
export type MeasureKind = 'stopwatch' | 'countdown' | 'three_state' | 'manual';

export type ProtocolSectionKey =
  | 'space'
  | 'posture'
  | 'aid'
  | 'command'
  | 'attempts'
  | 'scoring'
  | 'safety';

export interface ProtocolSection {
  key: ProtocolSectionKey;
  titleZh: string;
  linesZh: string[];
  /** Never empty, never a guess. See the file header. */
  source: string;
}

export interface TimedTestProtocol {
  id: TimedTestId;
  nameZh: string;
  /** One line under the title: what this number is for. */
  purposeZh: string;
  measure: MeasureKind;
  /** Only for `countdown`. */
  countdownMs?: number;
  /** Label above the number field, for countdown / manual tests. */
  valueLabelZh?: string;
  /** How the value reads to a human. */
  valueUnitZh: string;
  testType: FunctionTestTypeKey;
  unit: FunctionTestUnitKey;
  /** The patient has to be on their feet. Everything here is true except
   *  握力 — and that exception is why the flag exists rather than a
   *  blanket rule. */
  requiresStanding: boolean;
  /** A walking test long enough that a fall during it is a fall far from
   *  a chair. Gated on the fall history. */
  longWalk: boolean;
  /** Needs a space most homes do not have; offered as「有条件时」. */
  conditional: boolean;
  sections: ProtocolSection[];
}

/**
 * 「怎么量出 10 米」.
 *
 * Separated from the walk protocol because it is a one-time job with a
 * different shape — you do it once, with a tape measure, and then never
 * again — and because getting it wrong silently poisons every 10 米步行
 * record afterwards.
 *
 * Floor tiles are the instrument on purpose. Almost nobody in a Chinese
 * apartment owns a 10 m tape; almost everybody has a tiled or
 * plank floor whose unit repeats exactly.
 */
export const TEN_METER_MEASURE_CARD = {
  titleZh: '怎么量出 10 米',
  introZh: '量一次就够了，以后每次都走同一条。',
  stepsZh: [
    '找一块地砖（或一块地板条），量出它的边长。手边没有尺子的话：A4 纸的长边正好 29.7 厘米，横着摆几张就能量出一块砖。',
    '10 米 ÷ 边长 = 要数几块。常见的：边长 0.6 米要 16.7 块，0.8 米要 12.5 块，1.0 米要 10 块。数到不是整数的时候，宁可少半块也不要多。',
    '起点和终点各贴一条胶带，或者各放一只鞋。',
    '把这条路记下来 —— 哪条走廊、从哪块砖到哪块砖。下面的「测量地点」栏就是给这个用的，下次它会显示上一次写的是什么。',
  ],
  cautionZh:
    '家里实在凑不出 10 米，就别把 8 米当成 10 米填。选「自由记录」，或者改做 5 次起坐、四项抗重力 —— 这两项不需要长距离。一个凑出来的距离会让以后每一次比较都是错的。',
  source: SOURCE_APP,
} as const;

/* ------------------------------------------------------------------ */
/* 抗重力四项                                                          */
/* ------------------------------------------------------------------ */

/**
 * The Dutch guideline's four anti-gravity items.
 *
 * The guideline's argument for them, paraphrased from §5.1: the
 * conventional tests (6MWT, 10-meter walk, Berg, TUG) let the body
 * compensate, because they do not load the trunk, pelvis and legs hard
 * enough — so they overestimate. The anti-gravity items correlate more
 * strongly with disease severity. That matters especially in FSHD,
 * where trunk involvement is central.
 *
 * WHAT THE GUIDELINE DOES **NOT** GIVE US is a scoring scale. It says
 *「consider using」 and names the four movements; Rijken's construct
 * validity work is behind it with n=19. So the three states below are
 * ours, they say so on screen, and they are written as observations a
 * patient can answer without judgement rather than as a graded scale
 * with clinical anchors we would be inventing.
 */
export const ANTI_GRAVITY_ITEMS: Array<{
  key: string;
  nameZh: string;
  /** The English name in the guideline, so a clinician reading the
   *  passport can match it to the literature. */
  nameEn: string;
  howZh: string;
}> = [
  {
    key: 'sit_to_stand',
    nameZh: '坐 → 站',
    nameEn: 'sit-to-stand',
    howZh: '从那把椅子上站起来。',
  },
  {
    key: 'stand_to_sit',
    nameZh: '站 → 坐',
    nameEn: 'stand-to-sit',
    howZh: '从站着慢慢坐回椅子，不是让自己掉下去。',
  },
  {
    key: 'step_up',
    nameZh: '上一级台阶',
    nameEn: 'step-up',
    howZh: '上一级台阶（楼梯最下面一级，或者一个稳固的踏台）。',
  },
  {
    key: 'step_down',
    nameZh: '下一级台阶',
    nameEn: 'step-down',
    howZh: '从那一级台阶下来。',
  },
];

/**
 * Three states, 2 / 1 / 0.
 *
 * The wording is the scale. A patient who reads「1 分」sees nothing; a
 * patient who reads「要用手撑腿或扶东西才能完成」knows exactly whether
 * that was them today, and so does whoever reads it later. Numbers exist
 * only because the column is numeric.
 */
export const ANTI_GRAVITY_STATES: Array<{
  value: 0 | 1 | 2;
  labelZh: string;
}> = [
  { value: 2, labelZh: '不用手撑、不用扶，一次就完成' },
  { value: 1, labelZh: '要用手撑腿、扶扶手或者借一下惯性才能完成' },
  { value: 0, labelZh: '今天做不了' },
];

export const antiGravityStateLabel = (value: number): string =>
  ANTI_GRAVITY_STATES.find((state) => state.value === value)?.labelZh ?? '未记录';

/* ------------------------------------------------------------------ */
/* Protocols                                                           */
/* ------------------------------------------------------------------ */

const AID_RECORD_RULE =
  '不管用了什么（AFO、手杖、扶栏杆、有人虚扶），都要在下面的「这次用了什么」里点上。以后每次都要一样 —— 换了辅具，两次就不是同一个数。';

export const TIMED_TESTS: TimedTestProtocol[] = [
  {
    id: 'sit_to_stand_30s',
    nameZh: '30 秒坐站',
    purposeZh: '30 秒里能完整站起坐下几次。测的是大腿和臀部在重力下的耐力。',
    measure: 'countdown',
    countdownMs: 30_000,
    valueLabelZh: '30 秒内完成了几次',
    valueUnitZh: '次',
    testType: 'sit_to_stand',
    unit: 'reps',
    requiresStanding: true,
    longWalk: false,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: [
          '一把不带扶手的直背椅，靠墙放 —— 靠墙是为了它不会往后滑。',
          '以后每次都用同一把椅子。椅子高一点低一点，站起来的费力程度差很多。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['坐正，背贴椅背，双脚平放在地上。', '双手交叉抱在胸前，不扶腿也不扶椅子。'],
        source: SOURCE_30CST,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: [
          '这一项要求双手抱胸，所以按方案是不能用手撑的。鞋和 AFO 照平时穿。',
          '不用手撑就起不来 —— 那不是失败。照样做，然后选「条件不完整」，这条记录一样有用。',
          AID_RECORD_RULE,
        ],
        source: SOURCE_30CST,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: ['开始前：「预备 —— 开始。」', '30 秒到：「停。」'],
        source: SOURCE_APP,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: ['只做一次。这个测试本身就会把人做累，第二次的数字没法和第一次比。'],
        source: SOURCE_APP,
      },
      {
        key: 'scoring',
        titleZh: '怎么数',
        linesZh: [
          '数 30 秒内完整站起来又坐下的次数。',
          '计时结束的那一下，如果已经站起来超过一半，算一次。',
        ],
        source: SOURCE_30CST,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: [
          '开始之前先确认旁边有人。',
          '累了随时停，停下来也要把已经完成的次数填上 —— 那也是今天的实情。',
        ],
        source: SOURCE_APP,
      },
    ],
  },

  {
    id: 'sit_to_stand_5x',
    nameZh: '5 次起坐',
    purposeZh: '连续站起坐下五次要多久。比 30 秒坐站短，累得少，适合状态一般的日子。',
    measure: 'stopwatch',
    valueUnitZh: '秒',
    testType: 'sit_to_stand',
    unit: 'sec',
    requiresStanding: true,
    longWalk: false,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: ['和 30 秒坐站用同一把椅子，同样靠墙放稳。'],
        source: SOURCE_APP,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['坐正，背贴椅背，双脚平放。', '双手交叉抱在胸前。'],
        source: SOURCE_APP,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: ['按方案是双手抱胸、不用手撑。用了手撑就选「条件不完整」。', AID_RECORD_RULE],
        source: SOURCE_APP,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: [
          '「预备 —— 开始。按你能做到的速度，站起来、坐下，做五次。」',
          '第五次坐下、身体停稳的那一刻按「停」。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: ['一次。'],
        source: SOURCE_APP,
      },
      {
        key: 'scoring',
        titleZh: '这项测试的出处',
        linesZh: [
          '荷兰指南第 5.2 节在评价有氧训练时，用「5 次起坐」作为衡量活动能力的指标之一（引 Andersen 2015）。',
          '指南没有写家庭版怎么做，上面的椅子和姿势是我们定的。',
        ],
        source: SOURCE_DUTCH,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: ['旁边要有人。中途站不稳就坐下来，然后选「条件不完整」。'],
        source: SOURCE_APP,
      },
    ],
  },

  {
    id: 'ten_meter_walk',
    nameZh: '10 米步行',
    purposeZh: '按平时的速度走 10 米要多久。指南点名推荐的常规测试之一。',
    measure: 'stopwatch',
    valueUnitZh: '秒',
    testType: 'ten_meter_walk',
    unit: 'sec',
    requiresStanding: true,
    longWalk: false,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: [
          '一条直路：前 2 米加速、中间 10 米计时、后 2 米减速，一共 14 米。',
          '家里凑不出 14 米，就只量 10 米，站着起步、到线停 —— 但两种摆法不能混着比，选定一种就一直用。',
          '怎么用地砖量出 10 米，见上面那张卡片。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['站在起点线后面，鞋子和平时一样。'],
        source: SOURCE_APP,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: [
          '可以用你平时用的手杖、助行器、AFO —— 用了不算「条件不完整」，不记才算。',
          AID_RECORD_RULE,
        ],
        source: SOURCE_DUTCH,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: ['「预备 —— 开始，按你平时走路的速度走到那头。」', '脚过终点线时按「停」。'],
        source: SOURCE_APP,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: [
          '走 2 到 3 趟，取最快的一趟。',
          '今天只走得动一趟就走一趟，然后选「条件不完整」—— 一趟和三趟取最快，本来就不是一个数。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: [
          '旁边要有人，走道两边不要有绊脚的东西。',
          'FSHD 患者往前摔的多，所以终点前面别放硬家具。',
        ],
        source: SOURCE_DUTCH,
      },
    ],
  },

  {
    id: 'timed_up_and_go',
    nameZh: '起立行走计时（TUG，3 米）',
    purposeZh: '从坐着到站起、走 3 米、转身、走回来、坐下，一共多久。',
    measure: 'stopwatch',
    valueUnitZh: '秒',
    testType: 'timed_up_and_go',
    unit: 'sec',
    requiresStanding: true,
    longWalk: false,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: [
          '一把有扶手的椅子。从椅子前腿量出 3 米，地上贴一条胶带。',
          '转身的地方要空出来，别贴着墙。',
        ],
        source: SOURCE_TUG,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['坐正靠着椅背，双手放在扶手上。', '穿平时穿的鞋。'],
        source: SOURCE_TUG,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: ['原始方案就允许用平时用的助行器具，所以用了不扣分。', AID_RECORD_RULE],
        source: SOURCE_TUG,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: [
          '「预备 —— 走。」听到「走」就开始计时。',
          '站起来 → 走到胶带那儿 → 转身 → 走回来 → 坐下。屁股坐稳的那一刻按「停」。',
        ],
        source: SOURCE_TUG,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: ['先不计时练一趟，再正式做一次计时的。'],
        source: SOURCE_TUG,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: ['转身是最容易失去平衡的一步，旁边一定要有人。'],
        source: SOURCE_APP,
      },
    ],
  },

  {
    id: 'stair_four_step',
    nameZh: '四级台阶上下',
    purposeZh: '上四级台阶再下来要多久。',
    measure: 'stopwatch',
    valueUnitZh: '秒',
    testType: 'stair_climb',
    unit: 'sec',
    requiresStanding: true,
    longWalk: false,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: [
          '家里或楼道里同一段楼梯的 4 级，有扶手的那段更安全。',
          '把是哪一段记下来（下面的「测量地点」栏）。不同楼梯的台阶高度差得很多。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['双脚站在第一级下面的平地上。'],
        source: SOURCE_APP,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: ['可以扶扶手。扶了要记下来，而且以后每次都要扶（或者都不扶）。', AID_RECORD_RULE],
        source: SOURCE_APP,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: [
          '「预备 —— 开始，按你平时上楼的方式上四级，再下来。」',
          '下到平地、双脚站稳时按「停」。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: ['一次。'],
        source: SOURCE_APP,
      },
      {
        key: 'scoring',
        titleZh: '为什么是四级，不是文献里的级数',
        linesZh: [
          '荷兰指南引用的版本是 14 级（Andersen 2015 的 14-step-stair test）。家里的楼梯常常找不到连续 14 级，四级更容易每次找到同一段。',
          '所以这个秒数只能和你自己的四级比，不能拿去和文献里 14 级的数字对照。',
        ],
        source: SOURCE_DUTCH,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: [
          '一定要有人在旁边，站在你下方那一侧。',
          '下楼比上楼更容易摔。今天腿抖就别做这一项，做「四项抗重力」里的上下一级就够。',
        ],
        source: SOURCE_APP,
      },
    ],
  },

  {
    id: 'anti_gravity_four',
    nameZh: '四项抗重力',
    purposeZh:
      '坐→站、站→坐、上一级、下一级，每项三档。不计时，做不动的日子也能记，而且指南认为它比常规测试更能看出病情。',
    measure: 'three_state',
    valueUnitZh: '档',
    testType: 'custom',
    unit: 'score',
    requiresStanding: true,
    longWalk: false,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: ['那把椅子，加一级台阶（楼梯最下面一级，或者一个稳固的踏台）。'],
        source: SOURCE_APP,
      },
      {
        key: 'posture',
        titleZh: '四个动作',
        linesZh: ANTI_GRAVITY_ITEMS.map((item) => `${item.nameZh}：${item.howZh}`),
        source: SOURCE_DUTCH,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: [
          '这四项不是「不许扶」，而是「扶了就记在第 1 档」—— 扶与不扶本身就是这一项要看的东西。',
          '穿 AFO、穿平时的鞋都可以，照样在下面点上。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: [
          '每一项开始前：「按你自己的方式做一次，别赶时间。」',
          '不计时，所以做完再回来点档位就行，手机不用拿在手上。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'scoring',
        titleZh: '为什么指南推荐这四项',
        linesZh: [
          '指南第 5.1 节的原话是「可以考虑使用简单的抗重力测试（坐→站、站→坐、上一级、下一级）」。',
          '理由：6 分钟步行、10 米步行这类常规测试允许身体用代偿动作，对躯干、骨盆和腿的负荷不够，结果会高估能力；抗重力测试和病情严重程度的相关性更强。',
          '同时要说清楚：这条建议基于 19 人的探索性研究，指南自己标明属于专家意见，还需要更多研究。',
        ],
        source: SOURCE_RIJKEN,
      },
      {
        key: 'attempts',
        titleZh: '三档怎么分',
        linesZh: [
          ...ANTI_GRAVITY_STATES.map((state) => `${state.value}：${state.labelZh}`),
          '这三档的说法是我们定的，指南只给了四个动作、没有给评分标准。所以它只能和你自己上一次比，不要当成门诊用的分数。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: ['上下台阶那两项一定要有人在旁边，最好扶着扶手。'],
        source: SOURCE_APP,
      },
    ],
  },

  {
    id: 'two_minute_walk',
    nameZh: '2 分钟步行',
    purposeZh: '2 分钟能走多远。指南推荐的是 6 分钟版，但 6 分钟要 30 米直廊，家里多半没有。',
    measure: 'countdown',
    countdownMs: 120_000,
    valueLabelZh: '2 分钟一共走了多少米',
    valueUnitZh: '米',
    testType: 'custom',
    unit: 'm',
    requiresStanding: true,
    longWalk: true,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: [
          '一条能来回走的通道。先量出单程有多少米，记下来。',
          '总距离 = 单程米数 × 走完的趟数 + 最后没走完那一趟的米数。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['站在起点，鞋子和平时一样。'],
        source: SOURCE_APP,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: ['可以用平时用的助行器具，用了不扣分，不记才扣。', AID_RECORD_RULE],
        source: SOURCE_DUTCH,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: [
          '「预备 —— 开始，尽你能坚持的速度来回走，走到我说停。」',
          '累了可以停下来休息，休息的时间算在 2 分钟里，不要停表。',
        ],
        source: SOURCE_ATS,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: ['一次。同一天不要做第二趟 —— 第二趟一定更慢，那是累出来的，不是病情。'],
        source: SOURCE_ATS,
      },
      {
        key: 'scoring',
        titleZh: '这个 2 分钟是哪来的',
        linesZh: [
          '荷兰指南推荐的是 6 分钟步行。2 分钟是我们为家庭场景选的短版替代。',
          '我们手上没有 FSHD 专门的 2 分钟步行参考值，所以这个数字不要和任何「正常范围」对照，只和你自己上一次比。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: ['旁边要有人全程跟着。头晕、胸闷、腿发软，立刻停。'],
        source: SOURCE_ATS,
      },
    ],
  },

  {
    id: 'six_minute_walk',
    nameZh: '6 分钟步行（有条件时）',
    purposeZh:
      '指南点名推荐的测试，但要一条 30 米的直走廊。够得着场地的时候做，够不着就做 2 分钟版。',
    measure: 'countdown',
    countdownMs: 360_000,
    valueLabelZh: '6 分钟一共走了多少米',
    valueUnitZh: '米',
    testType: 'six_minute_walk',
    unit: 'm',
    requiresStanding: true,
    longWalk: true,
    conditional: true,
    sections: [
      {
        key: 'space',
        titleZh: '场地与标记',
        linesZh: [
          '一条 30 米的直走廊，两端各放一个标志物（雪糕筒、椅子都行）。',
          '不要在跑步机上做 —— 跑步机上的结果和走廊上的不是一回事。',
          '小区连廊、医院走廊、学校室内走道通常够长。走廊长度不是 30 米就在下面记下来，并选「条件不完整」。',
        ],
        source: SOURCE_ATS,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['站在起点标志旁，开始前先安静坐 10 分钟。'],
        source: SOURCE_ATS,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: ['可以用平时用的助行器具。', AID_RECORD_RULE],
        source: SOURCE_ATS,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: [
          '「预备 —— 开始，在这 6 分钟里尽量走远，来回走。累了可以放慢、可以停下来靠着休息，但表不停，能走了就继续走。」',
        ],
        source: SOURCE_ATS,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: ['一次。同一天不要做第二趟。'],
        source: SOURCE_ATS,
      },
      {
        key: 'safety',
        titleZh: '安全',
        linesZh: [
          '必须有人全程陪着，而且路线上要有能随时坐下的地方。',
          '胸痛、难以忍受的气短、腿抽筋、脸色发白、冒冷汗 —— 任何一样出现就立刻停止。',
        ],
        source: SOURCE_ATS,
      },
    ],
  },

  {
    id: 'grip_strength',
    nameZh: '握力（选做）',
    purposeZh: '有一只几十块钱的电子握力计就能做。坐着做，不用站起来。',
    measure: 'manual',
    valueLabelZh: '这只手三次里最大的一次',
    valueUnitZh: '公斤',
    testType: 'custom',
    unit: 'kg',
    requiresStanding: false,
    longWalk: false,
    conditional: false,
    sections: [
      {
        key: 'space',
        titleZh: '器材',
        linesZh: [
          '一只普通电子握力计。以后每次都用同一只 —— 不同握力计之间的读数不能直接比。',
          '换了握力计就等于换了尺子，请在「测量地点」里写明换了，并选「条件不完整」。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'posture',
        titleZh: '起始姿势',
        linesZh: ['坐着，上臂贴住身体，手肘弯成大约 90 度，手腕放中立位。', '另一只手放在腿上。'],
        source: SOURCE_APP,
      },
      {
        key: 'aid',
        titleZh: '辅具怎么算',
        linesZh: [
          '这一项坐着做，不涉及支具或助行器。',
          '但不要用另一只手帮忙、不要靠肩膀带 —— 那样握的就不只是手了。用了就在下面点「有人虚扶」或选「条件不完整」。',
        ],
        source: SOURCE_APP,
      },
      {
        key: 'command',
        titleZh: '口令（照着念）',
        linesZh: ['「用力握 —— 握满三秒 —— 放松。」'],
        source: SOURCE_APP,
      },
      {
        key: 'attempts',
        titleZh: '做几次',
        linesZh: ['每只手做三次，中间至少歇 15 秒，记最大的一次。左右手分开记。'],
        source: SOURCE_APP,
      },
      {
        key: 'scoring',
        titleZh: '握力看不出什么',
        linesZh: [
          'FSHD 最先受累的是面部、肩胛和上臂，手的握力往往很晚才受影响。握力没变，不代表病情没进展。',
          '我们不提供参考值：不同握力计、不同姿势之间没有可比性。',
        ],
        source: SOURCE_APP,
      },
    ],
  },
];

export const findTimedTest = (id: string): TimedTestProtocol | null =>
  TIMED_TESTS.find((test) => test.id === id) ?? null;

/* ------------------------------------------------------------------ */
/* Safety gate                                                         */
/* ------------------------------------------------------------------ */

/** 今天旁边有人吗. Asked every time the screen opens; deliberately not
 *  persisted, because yesterday's answer is not today's household. */
export type CompanionAnswer = 'unknown' | 'present' | 'alone';

/**
 * How recent a fall has to be to change what this screen offers.
 *
 * 90 days rather than 30: the guideline's own risk threshold is「>1 fall
 * per year and/or difficulty walking」, so a fall six weeks ago is
 * squarely inside the window it cares about. Rounding down to 30 days
 * would have let the majority of this cohort's falls expire before the
 * next monthly record.
 */
export const RECENT_FALL_WINDOW_DAYS = 90;

export interface FallLike {
  eventType: string;
  occurredAt?: string | null;
}

/** The most recent fall inside the window, or null. Returns the event so
 *  the banner can name the date — 「你 3 月 12 日记过一次跌倒」 is a
 *  reason, 「有跌倒史」 is an accusation. */
export const recentFall = <T extends FallLike>(
  events: T[] | null | undefined,
  now: number,
): T | null => {
  if (!events) return null;
  const day = 24 * 60 * 60 * 1000;
  const cutoff = now - RECENT_FALL_WINDOW_DAYS * day;
  // A fall is stored as a bare 'YYYY-MM-DD', which Date parses as UTC
  // midnight. In UTC+8 a fall logged this morning is therefore stamped
  // up to 8 hours in this device's future, and a strict `time > now`
  // guard would silently drop the most alarming record on the screen.
  // One day of slack; anything further ahead is a bad clock or bad data.
  const horizon = now + day;
  let latest: T | null = null;
  let latestTime = -Infinity;
  for (const event of events) {
    if (event.eventType !== 'fall' || !event.occurredAt) continue;
    const time = new Date(event.occurredAt).getTime();
    if (!Number.isFinite(time) || time < cutoff || time > horizon) continue;
    if (time > latestTime) {
      latestTime = time;
      latest = event;
    }
  }
  return latest;
};

export type TestGate =
  | { state: 'open' }
  /** Offered, but only once someone is beside them. */
  | { state: 'needs_companion'; reasonZh: string }
  /** Not offered today at all. */
  | { state: 'withheld'; reasonZh: string };

export interface GateContext {
  companion: CompanionAnswer;
  /** True when `recentFall` found one. */
  hasRecentFall: boolean;
}

/**
 * What this patient may be offered right now.
 *
 * Two rules, in this order.
 *
 * 1. **Nothing that puts them on their feet while they are alone.** The
 *    guideline cites Horlings 2009: people with FSHD fall six times as
 *    often as controls, 65% at least once a year and 30% more than once
 *    a month, and they tend to fall forward. A screen that says「站起来
 *    做 30 秒坐站」 to someone home alone is issuing that instruction on
 *    its own authority.
 *
 * 2. **A recent fall closes the long walks.** 6MWT is withheld outright:
 *    it is six minutes of walking away from any chair, in a 30 m
 *    corridor, and「有条件时」 already made it the optional one. 2MWT
 *    stays available with a companion, because withdrawing every
 *    walking measure from the patients who are declining fastest is how
 *    a record goes quiet exactly when it matters — which is the failure
 *    the whole 「今天做不了」 design in this screen exists to avoid.
 */
export const gateFor = (test: TimedTestProtocol, context: GateContext): TestGate => {
  // Withheld first. It is a statement about the record, not about who
  // happens to be in the room, so it must not be masked by the
  // companion answer — a patient who taps「有人」 to unlock the screen
  // would otherwise see 6MWT appear and never learn why it had been
  // missing.
  if (context.hasRecentFall && test.longWalk && test.conditional) {
    return {
      state: 'withheld',
      reasonZh:
        '你最近记过跌倒，所以 6 分钟步行今天不提供。它要在 30 米走廊上连走 6 分钟，中途离椅子最远。3 个月内没有新的跌倒记录之后它会自己回来；在那之前想做，请先和你的康复科医生说一声。',
    };
  }

  if (test.requiresStanding && context.companion !== 'present') {
    return {
      state: 'needs_companion',
      reasonZh:
        '这一项要站起来。先回答上面「今天旁边有人吗」，有人在旁边的时候再做 —— FSHD 患者跌倒的概率是常人的六倍，65% 的人一年至少跌一次。',
    };
  }

  return { state: 'open' };
};

/** The advisory line shown above a long walk when a fall is on record.
 *  Not a block — a reason. */
export const recentFallNoticeZh = (occurredAt: string | null | undefined): string => {
  const date = occurredAt ? occurredAt.slice(0, 10) : null;
  return date
    ? `档案里记着 ${date} 的一次跌倒。走的这两项请务必有人全程跟着，路线上要有能随时坐下的地方。`
    : '档案里记着最近的一次跌倒。走的这两项请务必有人全程跟着，路线上要有能随时坐下的地方。';
};

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

/**
 * A run of the timer.
 *
 * THE ONE RULE THIS TYPE EXISTS TO ENFORCE: elapsed time is
 * `end - start`, computed from two wall-clock stamps. It is never
 * accumulated by adding an interval's period on each tick.
 *
 * This is not a style preference. This product ships as a web export
 * and is opened, more often than not, inside WeChat's in-app browser.
 * That webview throttles and then suspends timers when the page is
 * backgrounded or the screen locks — and「按开始，把手机放下，做测试」
 * is literally the instruction on the card above. An accumulating timer
 * would under-count by exactly the time the patient spent performing,
 * and would under-count MORE the slower they got, which is the opposite
 * of the signal this feature exists to capture. Ticks below drive
 * re-renders only; they never contribute to the value.
 */
export interface TimerRun {
  /** Date.now() when 开始 was pressed. */
  startedAt: number;
  /** Date.now() when 停 was pressed, or the countdown resolved. */
  stoppedAt: number | null;
  /** The page went hidden at some point during the run. For a stopwatch
   *  this is harmless — the arithmetic above is immune. For a countdown
   *  it means the patient could not have heard or seen the end, so the
   *  form refuses to call that run 按方案完成. */
  interrupted: boolean;
}

export const startRun = (now: number): TimerRun => ({
  startedAt: now,
  stoppedAt: null,
  interrupted: false,
});

export const runElapsedMs = (run: TimerRun, now: number): number =>
  Math.max(0, (run.stoppedAt ?? now) - run.startedAt);

export const countdownRemainingMs = (run: TimerRun, now: number, durationMs: number): number =>
  Math.max(0, durationMs - runElapsedMs(run, now));

export const isCountdownDone = (run: TimerRun, now: number, durationMs: number): boolean =>
  runElapsedMs(run, now) >= durationMs;

/**
 * Past this, the run is not a measurement — it is a forgotten timer.
 *
 * The concrete failure: patient presses 开始, the phone locks mid-test,
 * they put it in a pocket and open the app again after dinner. Without
 * this the form would happily offer to save「1847.3 秒」 as a 5-times
 * sit-to-stand. 20 minutes is comfortably longer than the longest test
 * here (6 minutes) plus any plausible fumbling.
 */
export const MAX_RUN_MS = 20 * 60 * 1000;

export const isImplausibleRun = (run: TimerRun, now: number): boolean =>
  runElapsedMs(run, now) > MAX_RUN_MS;

/** '12.4' — one decimal, the resolution a thumb on a stop button can
 *  actually justify. */
export const formatSeconds = (ms: number): string => (Math.max(0, ms) / 1000).toFixed(1);

/** '0:12.4'. Used on the big running display, where minutes matter for
 *  the 2- and 6-minute walks. */
export const formatClock = (ms: number): string => {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  const seconds = (safe % 60_000) / 1000;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds.toFixed(1)}`;
};

/* ------------------------------------------------------------------ */
/* The protocol field                                                  */
/* ------------------------------------------------------------------ */

/** Bumped if the layout below ever changes, so an old row is still
 *  decodable rather than silently mis-read. */
const PROTOCOL_PREFIX = 'tt1';

/**
 * Pack the test identity and the quality grade into `function_tests.protocol`.
 *
 * Why here and not a new column: `protocol` is `varchar(120)` and
 * already exists; adding a column is a migration in a lane this change
 * does not own. The format is machine-first but stays readable, because
 * this string is the only thing a human debugging a row will see:
 *
 *   tt1|ten_meter_walk|per_protocol|10 米步行·按方案完成
 *
 * The trailing Chinese is redundant by design — if the parser is ever
 * dropped, the row still says what it is.
 */
export const encodeProtocolField = (testId: TimedTestId, grade: QualityGrade): string => {
  const test = findTimedTest(testId);
  const label = `${test?.nameZh ?? testId}·${gradeOption(grade).labelZh}`;
  const encoded = `${PROTOCOL_PREFIX}|${testId}|${grade}|${label}`;
  // The server rejects >120 with a 400 the patient reads as「保存失败」.
  // Truncating the human tail is lossless for the parser, which only
  // needs the first three segments.
  return encoded.length <= 120 ? encoded : encoded.slice(0, 120);
};

export interface DecodedProtocol {
  testId: TimedTestId;
  grade: QualityGrade;
}

/** null for anything this file did not write — including the older
 *  「连续上 10 级台阶」 rows the daily-record form still produces. */
export const decodeProtocolField = (value: string | null | undefined): DecodedProtocol | null => {
  if (!value) return null;
  const parts = value.split('|');
  if (parts.length < 3 || parts[0] !== PROTOCOL_PREFIX) return null;
  const test = findTimedTest(parts[1]);
  const grade = QUALITY_GRADES.find((option) => option.key === parts[2]);
  if (!test || !grade) return null;
  return { testId: test.id, grade: grade.key };
};

export const isTimedTestRecord = (value: string | null | undefined): boolean =>
  decodeProtocolField(value) !== null;

/**
 * The rule a trend line should apply.
 *
 * Stated as an exclusion rather than「plot only per_protocol」 on
 * purpose. Rows written before this feature — every 连续上 10 级台阶
 * record in production — decode to null, and a consumer that plotted
 * only `per_protocol` would erase them from the chart. Nothing this
 * round removes anything a patient already had.
 */
export const shouldExcludeFromTrend = (value: string | null | undefined): boolean => {
  const decoded = decodeProtocolField(value);
  return decoded !== null && !gradeOption(decoded.grade).trendEligible;
};

/* ------------------------------------------------------------------ */
/* Aids                                                                */
/* ------------------------------------------------------------------ */

/**
 * A fixed set, never free text.
 *
 * `deviceUsed` is a patient-supplied column that reaches the AI
 * followup retriever; the schema's own comment about `unit` explains why
 * unconstrained free text on such a column is the thing this repo got
 * bitten by. Chips also happen to be far cheaper than typing for the
 * hand reading this screen.
 */
export const AID_OPTIONS: Array<{ key: string; labelZh: string; meansHelp?: boolean }> = [
  { key: 'none', labelZh: '什么都没用' },
  { key: 'afo', labelZh: 'AFO 踝足矫形器' },
  { key: 'cane', labelZh: '手杖' },
  { key: 'walker', labelZh: '助行器 / 四脚架' },
  { key: 'handrail', labelZh: '扶扶手' },
  { key: 'wall', labelZh: '扶墙或家具' },
  { key: 'person', labelZh: '有人虚扶', meansHelp: true },
];

export const aidLabels = (keys: string[]): string[] =>
  AID_OPTIONS.filter((option) => keys.includes(option.key)).map((option) => option.labelZh);

/** `assistanceRequired` on the API row: a person was physically helping,
 *  as opposed to a person merely standing by (which the safety gate
 *  requires of everyone and is therefore not a property of the
 *  measurement). */
export const aidsMeanHumanHelp = (keys: string[]): boolean =>
  AID_OPTIONS.some((option) => option.meansHelp && keys.includes(option.key));

/** '手杖、扶扶手', capped at the column's 120. */
export const encodeDeviceUsed = (keys: string[]): string | null => {
  const labels = aidLabels(keys.filter((key) => key !== 'none'));
  if (labels.length === 0) {
    return keys.includes('none') ? '无' : null;
  }
  const joined = labels.join('、');
  return joined.length <= 120 ? joined : joined.slice(0, 120);
};

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

export interface TimedTestSaveInput {
  test: TimedTestProtocol;
  grade: QualityGrade;
  /** null when the patient marked 今天做不了. */
  measuredValue: number | null;
  notApplicable: boolean;
  aidKeys: string[];
  /** 「家里客厅东西向」. Patient free text, capped. Never sent anywhere
   *  but `notes`, which the AI retriever deliberately does not read. */
  venueNote: string;
  submissionId: string;
  /** Grip strength only. */
  side?: 'left' | 'right';
  /** 四项抗重力 only: the per-item state, 0-2. */
  antiGravityItemKey?: string;
}

/**
 * One `POST /profiles/me/function-tests` body.
 *
 * Note what is NOT in `notes`: no aid list (that is `deviceUsed`), no
 * grade (that is `protocol`). Duplicating a typed field into free text
 * is how the older 「今天做不了」 ended up living in `notes` where the
 * one consumer that needed it could not see it.
 */
export const buildFunctionTestPayload = (input: TimedTestSaveInput): Record<string, unknown> => {
  const { test } = input;
  const item = input.antiGravityItemKey
    ? ANTI_GRAVITY_ITEMS.find((entry) => entry.key === input.antiGravityItemKey)
    : null;

  const noteParts: string[] = [];
  if (item) {
    // The item name has to be in the row somewhere: four anti-gravity
    // items share one testType and one protocol string, so without this
    // 坐→站 and 下一级 are indistinguishable after the fact.
    noteParts.push(`抗重力项目：${item.nameZh}（${item.nameEn}）`);
    if (input.measuredValue !== null) {
      noteParts.push(antiGravityStateLabel(input.measuredValue));
    }
  }
  const venue = input.venueNote.trim().slice(0, 120);
  if (venue) {
    noteParts.push(`测量地点：${venue}`);
  }
  if (input.notApplicable) {
    noteParts.push('本次标记为今天做不了');
  }

  return {
    submissionId: input.submissionId,
    testType: test.testType,
    measuredValue: input.notApplicable ? null : input.measuredValue,
    notApplicable: input.notApplicable,
    unit: input.notApplicable ? null : test.unit,
    side: input.side ?? null,
    protocol: encodeProtocolField(test.id, input.grade),
    deviceUsed: encodeDeviceUsed(input.aidKeys),
    assistanceRequired: aidsMeanHumanHelp(input.aidKeys),
    notes: noteParts.length > 0 ? noteParts.join('；') : null,
  };
};

/* ------------------------------------------------------------------ */
/* Reading history back                                                */
/* ------------------------------------------------------------------ */

export interface FunctionTestLike {
  testType: string;
  measuredValue: number | null;
  protocol?: string | null;
  deviceUsed?: string | null;
  notes?: string | null;
  performedAt: string;
}

export interface PreviousReading {
  value: number | null;
  performedAt: string;
  grade: QualityGrade;
  deviceUsed: string | null;
  /** Parsed back out of `notes`. Best-effort: it is free text, and a
   *  patient may have typed nothing. */
  venueNote: string | null;
}

const VENUE_PREFIX = '测量地点：';

/**
 * The most recent record of THIS test, whatever its grade.
 *
 * Deliberately not filtered to `per_protocol`: the previous line on the
 * form exists so the patient can reproduce last time's conditions, and
 * 「上次条件不完整」 is exactly the case where seeing it matters most.
 * Whether the two numbers may be compared is the grade's job, and the
 * form says so beside the value.
 */
export const previousReadingFor = (
  testId: TimedTestId,
  records: FunctionTestLike[] | null | undefined,
): PreviousReading | null => {
  if (!records) return null;
  let best: FunctionTestLike | null = null;
  let bestTime = -Infinity;
  let bestGrade: QualityGrade = 'free';

  for (const record of records) {
    const decoded = decodeProtocolField(record.protocol);
    if (!decoded || decoded.testId !== testId) continue;
    const time = new Date(record.performedAt).getTime();
    if (!Number.isFinite(time) || time <= bestTime) continue;
    bestTime = time;
    best = record;
    bestGrade = decoded.grade;
  }

  if (!best) return null;

  const venueSegment = (best.notes ?? '')
    .split('；')
    .find((segment) => segment.startsWith(VENUE_PREFIX));

  return {
    value: best.measuredValue,
    performedAt: best.performedAt,
    grade: bestGrade,
    deviceUsed: best.deviceUsed ?? null,
    venueNote: venueSegment ? venueSegment.slice(VENUE_PREFIX.length) : null,
  };
};

/**
 * 「上次用的是手杖，这次没点」.
 *
 * The single most likely way a home trend goes wrong after the distance
 * problem: the same corridor, the same patient, but a cane one month and
 * not the next. Advisory, not a block — the patient may genuinely have
 * stopped needing it, and that is itself the finding.
 */
export const aidChangeNoticeZh = (
  previous: PreviousReading | null,
  aidKeys: string[],
): string | null => {
  if (!previous) return null;
  const current = encodeDeviceUsed(aidKeys);
  if (previous.deviceUsed == null || current == null) return null;
  if (previous.deviceUsed === current) return null;
  return `上次记的是「${previous.deviceUsed}」，这次是「${current}」。两次条件不一样，放在一条线上比会看错 —— 如果确实换了，建议选「条件不完整」。`;
};
