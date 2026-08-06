/**
 * 残疾评定准备包 — the content, as data.
 *
 * Every criterion quoted below was read out of the standards themselves,
 * not recalled:
 *
 *  [GB/T]  GB/T 26341—2010《残疾人残疾分类和分级》. 2011-01-14 发布,
 *          2011-05-01 实施. 全国残疾人康复和专用设备标准化技术委员会
 *          (SAC/TC 148) 归口. Clauses 4.5 (肢体残疾), 5.5.1–5.5.5.
 *  [办法]  《中华人民共和国残疾人证管理办法》. 中国残疾人联合会、
 *          国家卫生和计划生育委员会. 2017-05-27 发布, 2018-01-01 施行.
 *          第二条、第三条、第六条至第十一条、第十七条、第十九条、
 *          第二十二条、第二十五条.
 *  [实用]  《中国残疾人实用评定标准》. The earlier standard, and the
 *          source of the eight-activity 1 / 0.5 / 0 scoring below. It is
 *          NOT the standard a 残疾人证 is graded under — 办法第二条 names
 *          GB/T 26341—2010 for that. See ADL_SCORE_DISCLAIMER.
 *
 * Why this page exists
 * --------------------
 * GB/T 26341—2010's 肢体残疾 grades read, item after item, as amputation
 * and paralysis: 双小腿缺失, 单前臂及其以上缺失, 偏瘫, 截瘫. A patient
 * who cannot wash their own hair but who walked into the room unaided
 * reads that list, finds nothing that describes them, and concludes they
 * do not qualify. The clause written for exactly them — 三级 f)
 * 「一肢功能重度障碍或二肢功能中度障碍」— is the LAST item of the grade,
 * after five items about missing limbs. Same shape in 四级: j)
 * 「一肢功能中度障碍或两肢功能轻度障碍」, second from the end.
 *
 * So the grade blocks below carry `functional: true` on those clauses and
 * the screen lifts them out of the list. The full list is still rendered
 * verbatim and in the standard's own order — the point is not to hide the
 * amputation items, it is to stop the functional one being the thing you
 * give up before reaching.
 *
 * The hard line
 * -------------
 * Nothing here predicts a grade, and nothing here may ever say
 *「你应该能评上三级」. 评定 is a physician's judgement at a
 * province-designated institution (办法第六条), the standard leaves
 *「重度/中度障碍」undefined (see the 'no-degree-definition' section below), and telling
 * someone with FSHD they will qualify — when reaching a 评定 appointment
 * may itself be a hard journey for them — and being wrong is its own
 * harm. This page states the criteria, helps a patient describe their own
 * function accurately, and stops there.
 */

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything in this module is province- and time-dependent in its
 * application even where the national text is not, so the date rides on
 * the page rather than in a commit message.
 */
export const DISABILITY_CONTENT_AS_OF = '2026-08-05';

export const DISABILITY_LOCALITY_NOTE =
  '国家标准和《残疾人证管理办法》全国统一，但受理窗口、指定评定机构、预约方式、评定费用和地方补贴各省各市不同，也会变。跑一趟前请先打你户口所在地的县（区）残联电话问清楚 —— 一次白跑的路，对很多人来说不是「再来一次」那么简单。';

/* ------------------------------------------------------------------ */
/* The criteria, verbatim                                              */
/* ------------------------------------------------------------------ */

export type GradeItem = {
  /** The standard's own list marker: a), b), c)… */
  marker: string;
  /** Verbatim clause text. */
  text: string;
  /**
   * True for the 功能障碍 clauses — the ones written for a disease that
   * takes function without taking a limb, and the ones sitting last.
   */
  functional: boolean;
};

export type GradeCriterion = {
  id: string;
  /** e.g. 肢体残疾三级 */
  grade: string;
  /** The standard's own clause number, e.g. 5.5.4 */
  clause: string;
  /** The standard's own one-line head for the grade. */
  headline: string;
  items: GradeItem[];
};

/**
 * 5.5.2 – 5.5.5, quoted in full and in order.
 *
 * All four grades, not just the two an FSHD patient is most likely to
 * land in. A page that showed only 三级 and 四级 would be making the
 * prediction this page refuses to make.
 */
export const LIMB_GRADE_CRITERIA: GradeCriterion[] = [
  {
    id: 'grade-1',
    grade: '肢体残疾一级',
    clause: 'GB/T 26341—2010 5.5.2',
    headline: '不能独立实现日常生活活动，并具备下列状况之一：',
    items: [
      { marker: 'a)', text: '四肢瘫：四肢运动功能重度丧失；', functional: false },
      { marker: 'b)', text: '截瘫：双下肢运动功能完全丧失；', functional: false },
      { marker: 'c)', text: '偏瘫：一侧肢体运动功能完全丧失；', functional: false },
      { marker: 'd)', text: '单全上肢和双小腿缺失；', functional: false },
      { marker: 'e)', text: '单全下肢和双前臂缺失；', functional: false },
      { marker: 'f)', text: '双上臂和单大腿（或单小腿）缺失；', functional: false },
      { marker: 'g)', text: '双全上肢或双全下肢缺失；', functional: false },
      {
        marker: 'h)',
        text: '四肢在手指掌指关节（含）和足跗跖关节（含）以上不同部位缺失；',
        functional: false,
      },
      { marker: 'i)', text: '双上肢功能极重度障碍或三肢功能重度障碍。', functional: true },
    ],
  },
  {
    id: 'grade-2',
    grade: '肢体残疾二级',
    clause: 'GB/T 26341—2010 5.5.3',
    headline: '基本上不能独立实现日常生活活动，并具备下列状况之一：',
    items: [
      { marker: 'a)', text: '偏瘫或截瘫，残肢保留少许功能（不能独立行走）；', functional: false },
      { marker: 'b)', text: '双上臂或双前臂缺失；', functional: false },
      { marker: 'c)', text: '双大腿缺失；', functional: false },
      { marker: 'd)', text: '单全上肢和单大腿缺失；', functional: false },
      { marker: 'e)', text: '单全下肢和单上臂缺失；', functional: false },
      {
        marker: 'f)',
        text: '三肢在手指掌指关节（含）和足跗跖关节（含）以上不同部位缺失（一级中的情况除外）；',
        functional: false,
      },
      { marker: 'g)', text: '二肢功能重度障碍或三肢功能中度障碍。', functional: true },
    ],
  },
  {
    id: 'grade-3',
    grade: '肢体残疾三级',
    clause: 'GB/T 26341—2010 5.5.4',
    headline: '能部分独立实现日常生活活动，并具备下列状况之一：',
    items: [
      { marker: 'a)', text: '双小腿缺失；', functional: false },
      { marker: 'b)', text: '单前臂及其以上缺失；', functional: false },
      { marker: 'c)', text: '单大腿及其以上缺失；', functional: false },
      { marker: 'd)', text: '双手拇指或双手拇指以外其他手指全缺失；', functional: false },
      {
        marker: 'e)',
        text: '二肢在手指掌指关节（含）和足跗跖关节（含）以上不同部位缺失（二级中的情况除外）；',
        functional: false,
      },
      { marker: 'f)', text: '一肢功能重度障碍或二肢功能中度障碍。', functional: true },
    ],
  },
  {
    id: 'grade-4',
    grade: '肢体残疾四级',
    clause: 'GB/T 26341—2010 5.5.5',
    headline: '基本上能独立实现日常生活活动，并具备下列状况之一：',
    items: [
      { marker: 'a)', text: '单小腿缺失；', functional: false },
      { marker: 'b)', text: '双下肢不等长，差距大于或等于 50 mm；', functional: false },
      { marker: 'c)', text: '脊柱强（僵）直；', functional: false },
      { marker: 'd)', text: '脊柱畸形，后凸大于 70° 或侧凸大于 45°；', functional: false },
      { marker: 'e)', text: '单手拇指以外其他四指全缺失；', functional: false },
      { marker: 'f)', text: '单手拇指全缺失；', functional: false },
      { marker: 'g)', text: '单足跗跖关节以上缺失；', functional: false },
      { marker: 'h)', text: '双足趾完全缺失或失去功能；', functional: false },
      { marker: 'i)', text: '侏儒症（身高小于或等于 1 300 mm 的成年人）；', functional: false },
      { marker: 'j)', text: '一肢功能中度障碍或两肢功能轻度障碍；', functional: true },
      { marker: 'k)', text: '类似上述的其他肢体功能障碍。', functional: true },
    ],
  },
];

export const GRADE_CRITERIA_SOURCE =
  'GB/T 26341—2010《残疾人残疾分类和分级》5.5.2–5.5.5（2011-05-01 实施）';

/* ------------------------------------------------------------------ */
/* The prose sections                                                  */
/* ------------------------------------------------------------------ */

export type DisabilitySection = {
  id: string;
  title: string;
  lede?: string;
  points: string[];
  /**
   * Required, no exceptions. Where a point is this page's own wording
   * rather than a quotation, the source says so in those words — a
   * plausible-looking citation on an uncited sentence is worse than an
   * honest 「本页编写」.
   */
  source: string;
};

export const DISABILITY_SECTIONS: DisabilitySection[] = [
  {
    id: 'why-it-reads-wrong',
    title: '为什么这份标准看上去「不像在说我」',
    lede: '这是这一页存在的全部理由。',
    points: [
      '标准把肢体残疾定义为「人体运动系统的结构、功能损伤造成的四肢残缺或四肢、躯干麻痹（瘫痪）、畸形等导致人体运动功能不同程度丧失以及活动受限与参与的局限」，其中第一类就是「上肢或下肢因伤、病或发育异常所致的缺失、畸形或功能障碍」—— 因病导致的功能障碍，从定义那一句起就在范围里。',
      '但分级条文里，缺失类的条款占了绝大多数，功能障碍那一条被放在每一级的最后。三级一共六项，功能障碍是第六项；四级一共十一项，功能障碍是第十项和第十一项。',
      '于是常见的情形是：一个自己洗不了头、抬不起胳膊、上不了公交台阶的人，从头读到「双手拇指全缺失」就合上了，认为这份标准跟自己无关。这一页把那几条功能障碍的条款单独拎出来，不是替你下判断，是让你至少读到它。',
    ],
    source: 'GB/T 26341—2010 4.5、5.5.4、5.5.5；「常见情形」一句为本页的说明性文字，不是标准条文',
  },
  {
    id: 'no-degree-definition',
    title: '标准没有说清楚「重度障碍」是多重',
    lede: '这一点很重要，而且不是我们在回避 —— 是标准本身留白。',
    points: [
      '把 GB/T 26341—2010 从头读到尾：第 3 章「术语和定义」有 17 条定义，包括最佳矫正视力、平均听力损失、语音清晰度、适应行为，没有一条定义肢体的「极重度／重度／中度／轻度功能障碍」。第 5.5 节只给了肢体部位的划分（全上肢、上臂、前臂、全下肢、大腿、小腿等），也没有给功能障碍的判定尺度。全文没有附录。',
      '相比之下，智力残疾那一节给了 DQ、IQ、WHO-DAS Ⅱ 分值区间和适应行为表现的文字说明；听力残疾给了分贝区间。肢体的功能障碍程度没有对应的量表。',
      '所以「一肢功能重度障碍」到底算不算，是评定医师结合检查和你的描述作出的判断。这就是为什么把自己的功能说准确，比在网上找一个换算表有用得多 —— 换算表并不存在。',
    ],
    source: 'GB/T 26341—2010 第 3 章、5.5.1、5.6、表 2、5.3；全文无附录（2011-05-01 实施版）',
  },
  {
    id: 'no-devices',
    title: '评定时不戴辅具',
    lede: '这一条容易被忽略，而忽略它可能直接改变结论。',
    points: [
      '标准写明，肢体残疾「按人体运动功能丧失、活动受限、参与局限的程度分级（不配戴假肢、矫形器及其他辅助器具）」。',
      '也就是说，评定的是你不借助器具时的功能。如果你平时穿踝足矫形器（AFO）走路、用护腰、用手杖，评定当天穿戴整齐走进去、走得挺稳，那不是标准要求的观察条件。',
      '把这件事在现场说出来：「我平时靠 AFO 才能这样走，脱掉之后是这样。」不必自己脱鞋演示 —— 说明情况，由评定医师决定怎么查。',
    ],
    source: 'GB/T 26341—2010 5.5.1；第三点的具体说法为本页建议的表达方式，不是标准条文',
  },
  {
    id: 'process',
    title: '办证的流程和时限',
    points: [
      '向户口所在地的县级残联提出申请。《残疾人证管理办法》第三条：「残疾人证坚持申领自愿、属地管理原则。」第七条：县级残联负责残疾人证的申办受理、核发管理等工作。',
      '评定由指定机构做，不是残联做。第六条：各地以省（自治区、直辖市）为单位，由卫生计生委、残联等共同下文，指定本地区具备残疾评定资质的医院或专业机构，报中国残联备案。所以「去哪家医院评」这件事，要问当地残联，不是自己挑一家三甲。',
      '评定结论符合残疾标准的，要在申请人所在的村（社区）公示五个工作日；县级残联对材料、受理程序、评定结论和公示结果审核，在十个工作日内审核完毕。',
      '评定结论不符合残疾标准的，不予办理 —— 标准原话如此。这也是这一页不预测等级的原因之一。',
      '残疾评定标准用的是 GB/T 26341—2010。这是《残疾人证管理办法》第二条直接写明的，所以上面引的那几条条文就是评定当天真正在用的那一份。',
    ],
    source:
      '《中华人民共和国残疾人证管理办法》第二条、第三条、第六条、第七条、第九条（2018-01-01 施行）',
  },
  {
    id: 'home-visit-and-cost',
    title: '出不了门、掏不出评定费的时候',
    lede: '这两条写在办法里，但基本没人主动告诉你。',
    points: [
      '第十一条：「有条件的地方应上门开展残疾评定和办证服务。」如果你现在出门困难，先问当地残联能不能上门 —— 这是办法里的「应」，不是人情。',
      '第十七条：办理残疾人证不收取工本费。指定机构评定残疾类别、等级的费用以及照片等费用，原则上由申请人个人自理；有条件的地方可由当地财政予以补贴，对特殊困难的申请人应协调有关部门予以减免。',
      '也就是说：证本身免费，评定检查费一般自己出，困难的可以申请减免。减免不是自动的，要开口问。',
    ],
    source: '《中华人民共和国残疾人证管理办法》第十一条、第十七条',
  },
  {
    id: 'later',
    title: '评完之后：换证、重评、有异议怎么办',
    lede: 'FSHD 是进展性的，所以这一节和评定当天一样重要。',
    points: [
      '第十九条：残疾人证有效期十年，期满可到批准残联免费换领。',
      '第二十二条：残疾类别或残疾等级发生变化的，本人提出申请，经批准残联同意，可到指定机构重新进行残疾评定。等级不是一辈子锁死的 —— 病情变化时可以申请重评。',
      '第二十五条：对评定结论有异议的，可在十个工作日内向所在地市级残联申请重新评定，经市级残联同意后到指定的医院或专业机构进行评定；如仍有异议，可向省级残联提出申请，由省级残疾评定专家委员会组织专家进行评定，该评定结论为最终结论。',
      '注意第二十五条那个十个工作日 —— 这是异议的时限，错过就要走别的路子了。',
    ],
    source: '《中华人民共和国残疾人证管理办法》第十九条、第二十二条、第二十五条',
  },
];

/* ------------------------------------------------------------------ */
/* 八项日常生活活动自述                                                 */
/* ------------------------------------------------------------------ */

export type AdlItem = {
  id: string;
  /** The activity, named exactly as 《中国残疾人实用评定标准》 names it. */
  label: string;
  /**
   * What to say out loud about this activity. These are prompts written
   * for FSHD's own pattern — shoulder girdle and proximal arm first, so
   * anything overhead or sustained goes early while walking into the
   * room still looks fine. They are NOT criteria and carry no score.
   */
  prompts: string[];
};

export const ADL_ITEMS: AdlItem[] = [
  {
    id: 'sit',
    label: '端坐',
    prompts: ['坐直能坚持多久，需不需要靠背', '坐着的时候腰会不会往前塌、要不要用手撑'],
  },
  {
    id: 'stand',
    label: '站立',
    prompts: ['站着不动能坚持多久', '从椅子上站起来要不要用手撑、要不要人拉'],
  },
  {
    id: 'walk',
    label: '行走',
    prompts: ['平地一次能走多远', '上下楼梯、上公交台阶怎么样', '一年内摔过几次、在什么情况下摔的'],
  },
  {
    id: 'dress',
    label: '穿衣',
    prompts: ['套头的上衣能不能自己套上去', '扣扣子、拉后背的拉链怎么样', '袜子和鞋能不能自己穿'],
  },
  {
    id: 'wash',
    label: '洗漱',
    prompts: ['能不能自己洗头（手要举过肩）', '刷牙时胳膊抬到嘴边费不费力', '洗澡要不要人帮'],
  },
  {
    id: 'eat',
    label: '进餐',
    prompts: ['端碗、举筷子到嘴边能坚持多久', '一顿饭吃到后面手会不会抬不动', '拧瓶盖怎么样'],
  },
  {
    id: 'toilet',
    label: '入厕',
    prompts: ['蹲下、起身怎么样', '有没有装扶手，没有扶手能不能完成', '事后清洁时手够不够得到'],
  },
  {
    id: 'write',
    label: '写字',
    prompts: ['能不能写、写多久手会累', '签自己的名字清不清楚', '手机打字怎么样'],
  },
];

export type AdlAnswer = 'able' | 'difficult' | 'unable';

/** 能实现一项算 1 分，实现困难算 0.5 分，不能实现的算 0 分。[实用] */
export const ADL_ANSWER_SCORE: Record<AdlAnswer, number> = {
  able: 1,
  difficult: 0.5,
  unable: 0,
};

export const ADL_ANSWER_LABEL: Record<AdlAnswer, string> = {
  able: '能实现',
  difficult: '实现困难',
  unable: '不能实现',
};

export const ADL_ANSWER_ORDER: AdlAnswer[] = ['able', 'difficult', 'unable'];

export type AdlAnswers = Partial<Record<string, AdlAnswer>>;

export type AdlTally = {
  /**
   * The total, or null while any of the eight is unanswered.
   *
   * Deliberately null rather than a running subtotal. A partial sum is a
   * number that looks like a result, on a page whose whole discipline is
   * that no number here is a result.
   */
  total: number | null;
  answeredCount: number;
  itemCount: number;
};

export const tallyAdl = (answers: AdlAnswers): AdlTally => {
  let total = 0;
  let answeredCount = 0;
  for (const item of ADL_ITEMS) {
    const answer = answers[item.id];
    if (!answer) continue;
    answeredCount += 1;
    total += ADL_ANSWER_SCORE[answer];
  }
  return {
    total: answeredCount === ADL_ITEMS.length ? total : null,
    answeredCount,
    itemCount: ADL_ITEMS.length,
  };
};

export const ADL_INTRO =
  '下面这八项活动来自《中国残疾人实用评定标准》。填它不是为了算出一个等级 —— 是为了在评定那天，你能把「我哪些事做不了」说得具体、说得完整，而不是在诊室里临时回想。';

/**
 * The sentence that keeps the score honest.
 *
 * The eight-activity 1 / 0.5 / 0 scoring belongs to 《中国残疾人实用
 * 评定标准》, which grades 肢体残疾 into three levels by score band.
 * 《残疾人证管理办法》第二条 names GB/T 26341—2010 as the evaluation
 * standard, and GB/T 26341—2010 has FOUR grades and contains no
 * eight-activity score anywhere in it. The two do not convert. A patient
 * who adds up 6.5 and reads「轻度（三级）」off the older standard has
 * computed nothing about the certificate they are applying for.
 */
export const ADL_SCORE_DISCLAIMER =
  '这个分数不能换算成残疾等级，也不是评定结果。八项计分出自《中国残疾人实用评定标准》，那是更早的一份标准，把肢体残疾分成三级；而办残疾人证用的是 GB/T 26341—2010，分四级，全文里没有这套八项计分。两者对不上号。分数在这里唯一的用处，是让你看见自己在哪几项上打了折扣。';

export const ADL_SOURCE =
  '《中国残疾人实用评定标准》肢体残疾分级：「以残疾者在无辅助器具帮助下，对日常生活活动的能力进行评价计分。日常生活活动分为八项，即：端坐、站立、行走、穿衣、洗漱、进餐、入厕、写字。能实现一项算 1 分，实现困难算 0.5 分，不能实现的算 0 分。」提示语（每项下面的小字）为本页编写，不是标准条文。';

/**
 * Turns the answers into text the patient can copy into a message or
 * read off a phone at the desk.
 *
 * Text, not a score card. What the evaluating physician has to decide is
 * whether this person's arm is 「重度障碍」, with no numeric definition to
 * lean on (see the 'no-degree-definition' section). The useful artefact is therefore a
 * plain, first-person account of the eight activities — the answer plus
 * room for the patient's own sentence — and not a total.
 */
export const buildAdlNarrative = (answers: AdlAnswers): string[] => {
  const lines: string[] = ['我的日常生活活动自述（不使用辅助器具的情况下）：'];
  for (const item of ADL_ITEMS) {
    const answer = answers[item.id];
    lines.push(`${item.label}：${answer ? ADL_ANSWER_LABEL[answer] : '（未填）'}`);
  }
  lines.push('以上为本人自述，供评定时说明情况参考，不是评定结论。');
  return lines;
};

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

export type MaterialItem = {
  id: string;
  label: string;
  detail: string;
  /**
   * True only where 《残疾人证管理办法》第九条 lists the item. Everything
   * else is this page's suggestion and says so — a checklist that
   * presents a helpful idea in the same register as a regulation is the
   * thing that gets someone turned away at a window for the wrong
   * reason, or lugging paperwork nobody asked for.
   */
  required: boolean;
};

export const ASSESSMENT_MATERIALS: MaterialItem[] = [
  {
    id: 'id-card',
    label: '本人居民身份证',
    detail: '办法第九条（一）列明：第一次申办残疾人证需持申请人居民身份证。',
    required: true,
  },
  {
    id: 'hukou',
    label: '户口本',
    detail: '办法第九条（一）同条列明。属地管理：向户口所在地县级残联申请（第三条）。',
    required: true,
  },
  {
    id: 'photos',
    label: '3 张两寸近期免冠白底彩照',
    detail: '办法第九条（一）写明张数、尺寸和底色。',
    required: true,
  },
  {
    id: 'guardian',
    label: '法定监护人的证明材料（仅未成年人）',
    detail:
      '只在未成年人申请时需要（办法第九条（一）；智力、精神类残疾人证同此要求）。成年人申请肢体残疾评定不需要。',
    required: true,
  },
  {
    id: 'diagnosis',
    label: '基因检测报告或确诊病历',
    detail:
      '办法没有把它列为必交材料 —— 但评定医师要判断的是「因病所致的功能障碍」，手上有 FSHD 的确诊依据，比现场口述省事得多。本页建议带。',
    required: false,
  },
  {
    id: 'records',
    label: '近几年的门诊病历、出院记录、肌电图或肌肉 MRI 报告',
    detail:
      '同样不是必交材料。它们能说明这是一个长期、进展性的过程，而不是一次偶发的不适。本页建议带。',
    required: false,
  },
  {
    id: 'passport',
    label: '本应用的临床护照 PDF',
    detail:
      '把诊断、影像、检查结果和时间轴汇总成一份可以直接递过去的纸，省掉重新讲一遍病史的时间。在「FSHD 临床护照」里生成。本页建议带。',
    required: false,
  },
  {
    id: 'own-words',
    label: '写好的八项日常生活活动自述',
    detail: '就是这一页下面那份。诊室里被问到时能照着说，比临时回想准确。本页建议带。',
    required: false,
  },
];

export const MATERIALS_SOURCE =
  '标「办法要求」的四项出自《中华人民共和国残疾人证管理办法》第三条、第九条（一）；标「本页建议」的四项是本页给的建议，不是规定，各地窗口也可能另有要求。';

/* ------------------------------------------------------------------ */
/* Framing                                                             */
/* ------------------------------------------------------------------ */

export const DISABILITY_INTRO =
  '这一页帮你为残疾评定做准备：把评定当天真正在用的那份国家标准原文摆出来，把最容易被漏读的功能障碍条款拎到前面，再帮你把自己的情况说清楚。';

/**
 * Load-bearing, and the sentence most likely to be softened by an edit
 * that is only trying to fix spacing.
 */
export const DISABILITY_DISCLAIMER =
  '这一页不预测评定结果，任何等级都不预测。残疾等级由指定评定机构的医师依据国家标准判断，本应用没有这个资格；猜错的代价是一趟白跑的路和一次落空的期待，要你来承担。这里只做两件事：把标准原文给你，帮你把自己的功能说准确。';
