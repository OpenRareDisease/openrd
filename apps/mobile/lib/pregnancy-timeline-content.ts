/**
 * 孕期时间线 — what the sources say should happen, and roughly when.
 *
 * Reached from 遗传与生育. That page answers 「会不会遗传」 and 「怀孕会
 * 怎么样」; this one answers the question that comes after, from someone
 * who is already pregnant or already decided: what actually gets
 * arranged, with whom, and at which point.
 *
 * Sources, for every clinical sentence below
 * ------------------------------------------
 *  [Ciafaloni] Ciafaloni E. FSHD and Pregnancy (V3). FSHD Society
 *              patient document, in the corpus at 孕期/. Its own
 *              references are Ciafaloni et al., Neurology 2006;
 *              Rudnik-Schöneborn et al., Arch Neurol 1997;54(7):888-94;
 *              and the AAN/AANEM 2015 guideline. The 「Recommendations
 *              ... at the time of Pregnancy and Delivery」 section of
 *              that document is organised Before / During / Labor and
 *              Delivery / After, which is the spine of this file.
 *  [孕期指南]  《FSHD 女性的怀孕指南：从准备到分娩》, 孕期/ in the
 *              corpus — the Chinese write-up of the same Ciafaloni
 *              material. Used for phrasing, not for any claim the
 *              English original does not carry.
 *  [AANA]      Mani A, Jha S, Kumar V, Kumar S. Balancing Risks in
 *              Obstetrics: Anesthesia Management in FSHD With
 *              Scoliosis. AANA J. 2025 Oct. Already summarised in
 *              lib/anesthesia-card.ts; the numbers are not re-derived
 *              here.
 *  [Giardina]  Giardina E, et al. Clin Genet. 2024;106:13-26. Already
 *              summarised in lib/genetics-family-content.ts; the PGT
 *              and prenatal-diagnosis detail stays there and this page
 *              points at it rather than restating it.
 *
 * Three artefacts, one set of numbers
 * -----------------------------------
 * 遗传与生育, the anesthesia card and this page are read by the same
 * person, sometimes in the same afternoon, and two of them are handed
 * to clinicians. Where they overlap they must not drift:
 * pregnancy-timeline-content.test.ts asserts the overlapping claims
 * against GENETICS_SECTIONS itself, so a later edit to either file
 * that changes 「1/4 加重」, 「90% 仍会选择」, 「低出生体重 2500 克」 or
 * 「剖宫产与产钳更多」 on one side goes red rather than shipping two
 * answers to one question.
 *
 * This page does not push, in either direction
 * --------------------------------------------
 * The principle is inherited verbatim from the top of
 * genetics-family-content.ts: 「a rare-disease patient being nudged
 * about whether to have children is being nudged about whether people
 * like them should exist.」 It applies here with one extra edge, because
 * a *timeline* is a shape that implies momentum — it looks like a plan
 * already underway. So nothing below congratulates, encourages,
 * discourages, counts down, or treats reaching a later stage as
 * progress. The stages are a table of contents, and every one of them
 * is readable at any time without entering a date or a status.
 *
 * What this file deliberately does NOT contain
 * --------------------------------------------
 *  - Any threshold that would make the app judge a pregnancy (「FVC
 *    低于 X 就该剖宫产」). Those numbers exist in the literature for
 *    other neuromuscular diseases and not for FSHD, and the one
 *    sentence Ciafaloni is emphatic about is that FSHD by itself is
 *    not an indication for caesarean.
 *  - Anything that infers pregnancy status. See
 *    screens/p-pregnancy/pregnancy-tracker.ts.
 */

/**
 * A stage of the timeline.
 *
 * 'delivery' and 'postpartum' are stages a reader can open, and are
 * NEVER selected for them by a date — see `stageForGestationalWeek`.
 */
export type PregnancyStageKey =
  | 'preconception'
  | 'first'
  | 'second'
  | 'third'
  | 'delivery'
  | 'postpartum';

export interface PregnancyItem {
  id: string;
  title: string;
  detail: string;
  /** Per-item, like every other content module in this app. */
  source: string;
}

export interface PregnancyStage {
  key: PregnancyStageKey;
  title: string;
  /** Human label for the tab, e.g. 「孕早期」. */
  shortTitle: string;
  /** What the reader sees for timing, or null where there is no week
   *  number to give. Kept as text because 孕前 and 产后 have none. */
  weeksLabel: string | null;
  /**
   * The gestational weeks this stage covers, half-open [from, to).
   * null for the stages that are not a position in a pregnancy.
   * Only used to highlight a stage when the reader has typed a due
   * date themselves.
   */
  weekRange: { from: number; to: number } | null;
  lede: string;
  items: PregnancyItem[];
}

const CIAFALONI = 'Ciafaloni E. 《FSHD and Pregnancy》(FSHD Society)；原始队列见 Neurology 2006';
const CIAFALONI_ONLY = 'Ciafaloni E. 《FSHD and Pregnancy》(FSHD Society)';
const AANA = 'Mani A 等. AANA Journal. 2025年10月';
const GIARDINA = 'Giardina 等, Clinical Genetics 2024;106:13-26';

/** Where 遗传与生育 lives. The PGT / 产前诊断 detail stays on that page. */
export const GENETICS_HREF = '/p-genetics_family';
/** Where the anesthesia card is generated. */
export const ANESTHESIA_CARD_HREF = '/p-clinical_passport';
/** The AAN/AANEM surveillance page — the pulmonary rows overlap. */
export const SURVEILLANCE_HREF = '/p-surveillance';

export const PREGNANCY_STAGES: PregnancyStage[] = [
  {
    key: 'preconception',
    title: '孕前',
    shortTitle: '孕前',
    weeksLabel: null,
    weekRange: null,
    lede: '这一段的内容对「还在考虑」和「已经在准备」的人是一样的。如果你已经怀孕了，跳过它不会漏掉什么 —— 下面每一段里都写了补做的时机。',
    items: [
      {
        id: 'confirm_diagnosis',
        title: '把诊断落实成一份基因报告',
        detail:
          '如果还没做过基因检测，或者做过但报告不在手上，这是最先要补的一件事 —— 后面几乎每一步（遗传咨询、要不要做 PGT、产前诊断怎么做）都从这份报告开始。报告上的 D4Z4 重复数在群体层面和发病早晚、轻重相关，重复数越短总体上越早越重；但这是趋势，不是对某一个孩子的预测，8–10 这个区间尤其预测不了。',
        source: `${CIAFALONI_ONLY}；重复数不预测个体严重程度见 ${GIARDINA}`,
      },
      {
        id: 'genetic_counseling',
        title: '遗传咨询：把所有选项一次摊开',
        detail:
          'Ciafaloni 的文件把可谈的选择列全了：不做检测直接怀、胚胎植入前遗传学检测（PGT）、孕期产前诊断、使用他人的配子、收养。这里只把清单列出来 —— 每一项的具体限制（PGT 对 FSHD 的误判风险有多大、为什么做完还建议再做一次产前诊断）写在「遗传与生育」那一页。本页一个数字都不复述：同一个概率出现在两页上，就是两个会各自漂移的地方。',
        source: `${CIAFALONI_ONLY}；各选项细节见 ${GIARDINA}`,
      },
      {
        id: 'baseline_fvc',
        title: '一次肺功能基线：坐位和仰卧位都要',
        detail:
          '两个体位都做，不是做两遍同一件事。坐着测正常、躺下明显掉，是膈肌无力的表现 —— 而仰卧位这一项恰恰是最常被省掉的那个。趁还没怀孕先留一个基线，后面每次复查才有东西可比。',
        source: `${CIAFALONI_ONLY}（Respiratory function, Forced Vital Capacity sitting and supine）`,
      },
      {
        id: 'baseline_bmi',
        title: '营养门诊：先量一个 BMI 基线，谈孕期增重目标',
        detail:
          '写进推荐里的理由很具体：孕期增重过多加上重心前移，会增加跌倒，也可能让本来还能独立走路的人失去这个能力。这是给你和营养科一起定目标用的，不是让你控制体重。',
        source: CIAFALONI_ONLY,
      },
    ],
  },
  {
    key: 'first',
    title: '孕早期',
    shortTitle: '孕早期',
    weeksLabel: '约 0–13 周',
    weekRange: { from: 0, to: 14 },
    lede: '这一段主要是把人凑齐。FSHD 少见，产科医生不一定见过，需要有人从神经科那边把情况讲清楚。',
    items: [
      {
        id: 'team',
        title: '组队：产科 + 神经科（最好是神经肌肉方向）',
        detail:
          'Ciafaloni 的文件把这件事写成神经科医生的责任：由你的神经肌肉科医生去和产科以及其他参与分娩的科室沟通、说明 FSHD 的具体情况。文件里跟着的那句话是 —— 「了解自己疾病的患者更健康」。挂号时把临床护照 PDF 带上，能省掉重新讲一遍病史。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'fvc_first',
        title: '肺功能：坐位 + 仰卧位（孕前没做的话，现在补）',
        detail:
          '整个孕期都要复查，不是只在孕晚期查一次。这一次的作用是基线：后面的每一次都和它比。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'cvs',
        title: '如果打算做产前诊断：绒毛取样约在 10–13 周',
        detail:
          '时间窗在这一段里，所以放在这里提醒一次。做不做、怎么做，以及羊水穿刺和绒毛的差别，在「遗传与生育」那一页写得更完整。',
        source: GIARDINA,
      },
      {
        id: 'pt_baseline',
        title: '康复科评估一次：肩、下肢、躯干，加上步行和跌倒风险',
        detail:
          '推荐里写的是物理治疗评估上肢和肩部无力的程度、行走状态、是否需要辅具或支具，并在整个孕期持续跟踪功能变化。现在做的这一次是用来对比的那一个。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'pain_first',
        title: '疼痛要被当成一项来管',
        detail:
          '疼痛评估和处理是这份推荐里单独列出的一条。孕期能用的止痛方式受限，越早和医生谈越有腾挪空间。',
        source: CIAFALONI_ONLY,
      },
    ],
  },
  {
    key: 'second',
    title: '孕中期',
    shortTitle: '孕中期',
    weeksLabel: '约 14–27 周',
    weekRange: { from: 14, to: 28 },
    lede: '身体开始明显变化的一段。对 FSHD 来说，这里最值得盯的不是产科指标，是跌倒。',
    items: [
      {
        id: 'falls',
        title: '重心变了，跌倒风险跟着变',
        detail:
          '推荐里把话说得很直：孕期增重和重心改变可能增加跌倒，并可能促使一个人失去独立行走的能力。FSHD 本来就是一个高跌倒率的病，这一段是重新看一次家里和通勤路上哪些地方要改的时候 —— 扶手、浴室、台阶、鞋。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'assistive',
        title: '辅具重新评估一次',
        detail:
          '孕期的功能状态是会变的，所以推荐里写的是「在整个孕期持续评估辅具和支具的需要」，而不是评估一次就定下来。孕早期不需要的东西，现在可能需要。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'fvc_second',
        title: '肺功能复查：还是坐位 + 仰卧位',
        detail: '和基线比。要看的是趋势，尤其是仰卧位那一栏有没有往下走。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'amnio',
        title: '如果做羊水穿刺：约在 15–17 周',
        detail: '没有做绒毛、又想做产前诊断的话，这是时间窗。细节同样在「遗传与生育」那一页。',
        source: GIARDINA,
      },
      {
        id: 'cardiac_symptom',
        title: '心脏：有症状才查，没有症状不需要常规筛',
        detail:
          'FSHD 不需要常规心脏筛查。但出现心悸、胸闷、胸痛或不寻常的气短时，应该去做心电图或心脏超声 —— 孕期这些症状容易被归到「怀孕本来就这样」，所以值得说出来让医生判断。',
        source: `${CIAFALONI_ONLY}；同 AAN/AANEM 2015 指南`,
      },
    ],
  },
  {
    key: 'third',
    title: '孕晚期',
    shortTitle: '孕晚期',
    weeksLabel: '约 28 周至分娩',
    weekRange: { from: 28, to: 41 },
    lede: '这一段有两件事是这一整页的重点：仰卧位肺活量，和一次把所有科室凑到一起的会。',
    items: [
      {
        id: 'supine_fvc',
        title: '仰卧位肺活量 —— 孕晚期最不该省的一项',
        detail:
          '推荐里点名了孕晚期：这时候增重会影响膈肌功能，而影响在仰卧位时最明显。只测坐位可能完全正常，躺下才看得出来。这一项的结果直接影响后面麻醉和分娩方式的讨论，所以要在开联席会之前拿到。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'mdt',
        title: '第三孕期开一次联席会：产科 + 神经科 + 麻醉科（必要时呼吸科）',
        detail:
          '这是 Ciafaloni 推荐里写得最具体的一条：分娩方式、在哪家医院生（三级中心还是本地医院）、用什么镇痛药和用多少，都应该在孕晚期由这几个科室一起过一遍全部资料后定下来。如果计划顺产，团队要预先准备好可能需要器械助产。把这次会当成一个要主动去约的事项，它不会自己发生。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'anesthesia',
        title: '麻醉：椎管内通常是首选，提前见一次麻醉科',
        detail:
          '文献里对神经肌肉病一般首选硬膜外/椎管内麻醉。同一份文件也写了：没有数据提示 FSHD 会增加全身麻醉的风险 —— 这和麻醉卡上「避免吸入麻醉药、避免琥珀胆碱」并不矛盾，前者说的是总体风险没有升高，后者说的是真要全麻时具体选哪些药。另外，脊柱前凸和侧弯在 FSHD 里常见，会让椎管内穿刺变难、阻滞平面不好预测，这是提前见麻醉科而不是临产才见的理由。',
        source: `${CIAFALONI_ONLY}；穿刺与阻滞的细节见 ${AANA}`,
      },
      {
        id: 'not_indication',
        title: 'FSHD 本身不是剖宫产指征',
        detail:
          '这句话是原文的意思：有 FSHD 不构成剖宫产的指征，剖宫产应当只在有产科指征时（胎儿过大、胎位等），或者在 FSHD 肌无力程度严重、有呼吸功能不全或其他合并症时才计划。也就是说，「因为你有 FSHD 所以剖」不是一个理由；「因为你的呼吸功能到了这个程度」才是。值得在联席会上把这一条摆出来问。',
        source: CIAFALONI_ONLY,
      },
    ],
  },
  {
    key: 'delivery',
    title: '分娩',
    shortTitle: '分娩',
    weeksLabel: null,
    weekRange: null,
    lede: '这一段是已知的事实，不是对你这一次会怎样的预测。',
    items: [
      {
        id: 'stages_of_labor',
        title: '第一产程一般不受影响；第二产程可能变慢',
        detail:
          '原文写的是：FSHD 不影响第一产程；第二产程（用力的那一段）常因腹壁肌无力而进展变慢，可能需要胎吸或产钳助产。知道这一点的用处是：产程慢下来时它是可以预期的，不是出了意外。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'assisted_rates',
        title: '剖宫产和产钳助产比普通人群多',
        detail:
          '这是队列数据，不是建议：FSHD 女性的剖宫产率和产钳助产率高于普通人群，原因可能就是腹壁肌无力。和上面那条放在一起看 —— 更常发生，但仍然不是「因为 FSHD 所以要剖」。',
        source: CIAFALONI,
      },
      {
        id: 'outcomes',
        title: '结局：整体是好的，只有一项确实增加',
        detail:
          '流产、早产、胎儿窘迫、新生儿死亡都没有增加；子痫前期、羊水过多、胎膜早破、妊娠糖尿病、出生缺陷的风险也都没有增加。确实增加的是低出生体重（低于 2500 克）在 FSHD 母亲的孩子中更常见，这一项需要产科提前知道。',
        source: CIAFALONI,
      },
    ],
  },
  {
    key: 'postpartum',
    title: '产后',
    shortTitle: '产后',
    weeksLabel: null,
    weekRange: null,
    lede: '这一段最容易被整个跳过，而它恰好是 FSHD 特有的风险集中的地方。',
    items: [
      {
        id: 'longer_stay',
        title: '争取多住几天',
        detail:
          '原文用的词是「advocate」—— 主动要求延长住院观察，为的是有人评估运动功能有没有下降、疼痛有没有加重。出院太快，这两件事没人会回头查。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'ot_lactation',
        title: '康复科 / 作业治疗 + 哺乳咨询：照顾新生儿是一项日常活动',
        detail:
          '推荐把带孩子明确算作一项日常生活活动来评估。抱、托、换尿布、夜里起身，用的正好是 FSHD 最先拿走的那些动作。辅具的需要要重新评估一次，因为孕期和分娩之后运动功能可能已经和之前不一样了。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'ppd',
        title: '产后抑郁筛查：这一条对有功能受限的人风险更高',
        detail:
          '原文写得很直接：有功能受限的女性比没有残疾的女性更容易出现产后抑郁。所以这不是走流程的一项，是需要有人定期问的一项。',
        source: CIAFALONI_ONLY,
      },
      {
        id: 'progression',
        title: '怀孕会不会让病加重 —— 两半都在这里',
        detail:
          '大约每 4 个人里有 1 个，怀孕会让 FSHD 症状加重，而且这种加重多数在生产之后不会恢复；最常见的是整体无力加重、更容易跌倒、因为肩部或腿部无力抱不动孩子、疼痛加重或新出现疼痛。同一份研究里，90% 的女性表示如果重来一次她们仍然会选择怀孕。这两句必须一起读：只留前一句是在劝退，只留后一句是在粉饰。',
        source: CIAFALONI,
      },
      {
        id: 'menopause',
        title: '绝经的影响：目前不清楚',
        detail: '还没有研究回答这个问题。写在这里是因为「不知道」也是一个答案，比编一个好。',
        source: CIAFALONI_ONLY,
      },
    ],
  },
];

/**
 * The page's own framing, kept beside the content so the same tests
 * cover it. This paragraph is the one that has to survive an edit that
 * is only trying to fix layout.
 */
export const PREGNANCY_INTRO =
  '下面是 FSHD 女性在孕前、孕期、分娩和产后可能需要安排的事，按时间排开，每一条都写了出处。\n\n这一页不劝你怀孕，也不劝你不怀 —— 生不生、怎么生，是你和家人的决定，不是一个应用该给意见的事。它不会记录你有没有怀孕，也不会从你填过的任何东西去推断。六个阶段随时都能翻，不需要先说明你在哪一段。';

export const PREGNANCY_DISCLAIMER =
  '本页内容来自公开发表的患者指导文件与研究，供你了解和准备提问，不能替代产科、神经科与麻醉科医师针对你本人的评估。文中没有任何一条是按你的检查结果算出来的判断。';

/** Shown above the optional due-date control. */
export const PREGNANCY_TRACKER_TITLE = '把时间线对到你的孕周（可选）';

export const PREGNANCY_TRACKER_EXPLAINER =
  '如果你愿意，可以填一个预产期，这一页就会自动展开你现在所处的那一段。不填也能看全部内容 —— 这只是省掉每次自己找的一步。';

/**
 * The Art. 29 单独同意 text for this one field.
 *
 * 是否怀孕、预产期属于《个人信息保护法》第 28 条的医疗健康类敏感个人信息，
 * so it needs consent obtained separately for this purpose — not
 * carried over from the profile-wide consent the patient gave at
 * registration, which said nothing about pregnancy.
 */
export const PREGNANCY_CONSENT_TITLE = '这一项是敏感个人信息';

export const PREGNANCY_CONSENT_BODY =
  '预产期会暴露你是否怀孕，依《个人信息保护法》第 28 条属于医疗健康类敏感个人信息，需要你单独同意才能保存。\n\n· 只存在这台设备的浏览器里，不会上传到服务器，不会进入你的档案、临床护照、分享链接或 AI 问答。\n· 随时可以一键删除，删除后这一页不再显示任何和日期有关的内容。\n· 你不填，本页的全部内容照样可以看。';

export const PREGNANCY_CONSENT_CHECKBOX_LABEL = '我已了解上述说明，同意把预产期保存在这台设备上';

/** The one-tap withdrawal. Its label is asserted by the tests. */
export const PREGNANCY_TRACKER_CLEAR_LABEL = '关闭并删除预产期';

/**
 * What the page says immediately after the one tap.
 *
 * No 「确定要关闭吗」, no 「可惜」, no reason field, and no offer to turn
 * it back on in the same breath. The most likely person tapping this
 * button is someone whose pregnancy has just ended, and every extra
 * step between them and silence is a step taken while reading about
 * 产后抑郁筛查.
 */
export const PREGNANCY_TRACKER_CLEARED_NOTICE =
  '已删除。这台设备上不再保存任何和日期有关的内容，这一页的其余部分不受影响。';

/** Full-term reference point. 预产期 = 末次月经后 280 天 = 40 周. */
export const TERM_DAYS = 280;

const MS_PER_DAY = 86_400_000;

/** Local-midnight parse of YYYY-MM-DD. Deliberately not `new Date(s)`:
 *  that parses a bare date string as UTC, which shifts the answer by a
 *  day for every patient in China (UTC+8) and would print a gestational
 *  week that is off by one at the boundary. */
const parseLocalDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects 2025-02-30, which the Date constructor would roll forward
  // to March 2 rather than refuse.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
};

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Is this a due date the page is willing to work with?
 *
 * A due date more than 280 days away is not a due date, and one in the
 * past is a date this page must not reason from — see
 * `describeGestation`. Both are refused at the input rather than
 * silently producing a week number.
 */
export const isPlausibleDueDate = (value: string, today: Date): boolean => {
  const due = parseLocalDate(value);
  if (!due) return false;
  const days = Math.round((due.getTime() - startOfLocalDay(today).getTime()) / MS_PER_DAY);
  return days >= 0 && days <= TERM_DAYS;
};

export interface Gestation {
  /** Completed weeks since the notional last menstrual period. */
  weeks: number;
  /** Days into the current week, 0–6. */
  days: number;
  /** Days remaining until the due date. Never negative. */
  daysUntilDue: number;
}

/**
 * Gestational age from a due date, or null.
 *
 * Null on a malformed date, on a date more than 280 days out, and —
 * importantly — on any date that has already passed.
 *
 * Past the due date this function refuses to answer rather than
 * counting up, because there is exactly one thing the app knows at
 * that point: nothing. It does not know whether the baby was born,
 * whether the pregnancy ended earlier, or whether the date was ever
 * right. A screen that kept rendering 「孕 41 周」 to someone whose
 * pregnancy ended at 19 is the single worst thing this feature could
 * do, and refusing here is what makes that unreachable rather than
 * merely unlikely.
 */
export const describeGestation = (dueDate: string, today: Date): Gestation | null => {
  const due = parseLocalDate(dueDate);
  if (!due) return null;
  const daysUntilDue = Math.round((due.getTime() - startOfLocalDay(today).getTime()) / MS_PER_DAY);
  if (daysUntilDue < 0 || daysUntilDue > TERM_DAYS) return null;
  const totalDays = TERM_DAYS - daysUntilDue;
  return {
    weeks: Math.floor(totalDays / 7),
    days: totalDays % 7,
    daysUntilDue,
  };
};

/**
 * Which stage a gestational week falls in, or null.
 *
 * Only ever returns the three in-pregnancy stages. 分娩 and 产后 are
 * reachable by tapping and never by arithmetic: a date cannot tell
 * this app that a birth happened, and auto-opening 产后 — which leads
 * with 产后抑郁筛查 — on the strength of a calendar would be the app
 * announcing an outcome it has no knowledge of.
 */
export const stageForGestationalWeek = (weeks: number): PregnancyStageKey | null => {
  if (!Number.isFinite(weeks) || weeks < 0) return null;
  const stage = PREGNANCY_STAGES.find(
    (entry) => entry.weekRange && weeks >= entry.weekRange.from && weeks < entry.weekRange.to,
  );
  return stage ? stage.key : null;
};

export const getStage = (key: PregnancyStageKey): PregnancyStage | undefined =>
  PREGNANCY_STAGES.find((stage) => stage.key === key);

/** 「孕 22 周 +3 天」. Plain statement of position; no countdown, no
 *  「还有 N 天」, because a countdown is a promise about an outcome. */
export const formatGestation = (gestation: Gestation): string =>
  gestation.days === 0
    ? `孕 ${gestation.weeks} 周`
    : `孕 ${gestation.weeks} 周 +${gestation.days} 天`;
