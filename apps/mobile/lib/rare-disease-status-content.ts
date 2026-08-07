import type { AnesthesiaCardModel } from './anesthesia-card';

/**
 * 罕见病身份与权益说明卡 — the content, as data.
 *
 * FSHD is item 25 of 《第二批罕见病目录》. Every claim below traces to a
 * document number, and each was opened and read rather than recalled:
 *
 *  [目录]  《第二批罕见病目录》. 国家卫生健康委、科技部、工业和信息化部、
 *          国家药监局、国家中医药局、中央军委后勤保障部卫生局.
 *          国卫医政发〔2023〕26号, 2023-09-18. 序号 25：面肩肱型肌营养
 *          不良症 / Facioscapulohumeral muscular dystrophy.
 *          (Read from the .doc attachment on nhc.gov.cn, not from a
 *          secondary write-up — several of those reprint the list with
 *          the numbering dropped.)
 *  [协作网] 《国家卫生健康委办公厅关于建立全国罕见病诊疗协作网的通知》.
 *          国卫办医函〔2019〕157号, 2019-02-12.
 *  [医保]  国家医疗保障局《@慢特病患者 看病就医前您需要了解这些，医保
 *          小知识→》, 2024-11-11. (In the repo corpus at
 *          content/medical-kb/source/FSHD_知识库/06.政策与倡导教育/.)
 *  [注册]  《药品注册管理办法》第六十八条（优先审评审批的适用范围）
 *          与第七十条（该程序给予的时限）. 这两条不相邻——中间隔着
 *          第六十九条（申请前的沟通交流和提出申请的时点）——所以不能
 *          按「第六十八条及下一条」引用：被引号括起来的那句罕见病用药
 *          范围出自第六十八条，130/70 日的时限出自第七十条。相邻的
 *          第六十七条是附条件批准药品逾期未完成研究的注销条款，和罕见
 *          病无关；报错条号的患者会被窗口翻到那一条。患者拿错条号去
 *          窗口，正是这一页要避免的事。
 *  [基金会] 北京病痛挑战公益基金会「罕见病医疗援助工程」项目七期启动公告,
 *          2024-07. 与中华社会救助基金会合作.
 *
 * Why the fourth section exists
 * -----------------------------
 * The first three sections of a card like this are the ones an advocacy
 * page would stop at, and stopping there is how a patient ends up at a
 * 医保 window quoting a catalogue that has no bearing on the window they
 * are standing at. Being on the 罕见病目录 is a clinical-and-regulatory
 * designation. It is not 门诊慢特病 (set 统筹地区 by 统筹地区), and the
 * drug pathways it unlocks — priority review, the imported-urgent-need
 * route — accelerate approvals, and there is no disease-modifying
 * therapy for FSHD anywhere in the world for them to accelerate.
 * Losmapimod, the one that reached phase 3, missed its primary endpoint
 * in REACH and the programme was suspended in September 2024.
 *
 * Saying that plainly costs nothing a patient did not already lose, and
 * the alternative — letting someone believe the catalogue got them a
 * drug — costs them a trip and a conversation with a pharmacist who has
 * to be the one to tell them.
 */

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export const RARE_DISEASE_CONTENT_AS_OF = '2026-08-05';

export const RARE_DISEASE_LOCALITY_NOTE =
  '目录和上面几份国家文件全国统一，但医保待遇、门诊慢特病病种、地方专项救助和协作网医院名单都按省市和年度调整。凭这张卡去办事之前，请先按卡上写的文号自己核一遍当地最新规定 —— 一条过期的权益说法，换来的是一趟白跑的路。';

/* ------------------------------------------------------------------ */
/* The four sections                                                   */
/* ------------------------------------------------------------------ */

export type RareDiseaseSection = {
  id: string;
  title: string;
  lede?: string;
  points: string[];
  /** Required. A document number, or an explicit statement that the
   *  sentence is this page's own wording. */
  source: string;
};

export const RARE_DISEASE_SECTIONS: RareDiseaseSection[] = [
  {
    id: 'identity',
    title: '你在目录上，第 25 项',
    lede: '这是四份文件里唯一一件已经落定、不随省份变化的事。',
    points: [
      '《第二批罕见病目录》序号 25：面肩肱型肌营养不良症（Facioscapulohumeral muscular dystrophy）。',
      '发文单位是国家卫生健康委、科技部、工业和信息化部、国家药监局、国家中医药局、中央军委后勤保障部卫生局六部门，文号国卫医政发〔2023〕26号，2023 年 9 月 18 日印发。第二批共 86 种，加上 2018 年第一批的 121 种，目录共 207 种。',
      '这个文号是你在任何窗口的起点。对方说「没听过这个病」的时候，能报出文号和序号，比解释病理有用。',
    ],
    source: '《第二批罕见病目录》国卫医政发〔2023〕26号（2023-09-18），序号 25',
  },
  {
    id: 'network',
    title: '罕见病诊疗协作网欠你什么',
    lede: '2019 年那份通知写了协作网医院要做的事，这几条是可以直接引用的。',
    points: [
      '建立诊疗协作机制：《国家卫生健康委办公厅关于建立全国罕见病诊疗协作网的通知》（国卫办医函〔2019〕157号）要求「建立完善协作网医院之间双向转诊、专家巡诊、远程会诊的相关标准和管理制度」，目标是罕见病患者在筛查、诊断、治疗、康复的就医全过程都有连续诊疗服务。双向转诊是双向的 —— 转上去，也转回来。',
      '相对集中诊疗：成员医院要「及时将疑难危重罕见病患者转诊至牵头医院，并按照牵头医院制订的随访治疗方案做好患者的接续管理工作」。也就是说，在牵头医院定好方案之后，回本地随访是成员医院的活，不是你自己每次都要跑省城。',
      '病例登记：「协作网医院要及时将诊治的罕见病患者相关信息录入登记系统。」你被录入国家罕见病诊疗服务信息系统，是医院的义务，不是给你的恩惠。',
      '协作网医院名单由国家卫生健康委公布并会调整：2019 年首批 324 家，2024 年 3 月调整后为 419 家（1 家国家级牵头医院、32 家省级牵头医院、386 家成员医院）。就诊前请以国家卫生健康委最新公布的名单为准。',
    ],
    source:
      '《国家卫生健康委办公厅关于建立全国罕见病诊疗协作网的通知》国卫办医函〔2019〕157号（2019-02-12）；医院家数见国家卫生健康委 2024 年协作网成员医院调整通知',
  },
  {
    id: 'assistance',
    title: '罕见病医疗援助工程',
    lede: '一个公益基金，不是医保，条件按期次公布。',
    points: [
      '由北京病痛挑战公益基金会与中华社会救助基金会合作运作，2018 年 2 月启动，是目前面向全国罕见病患者的主要个案医疗救助渠道之一。',
      '项目七期（2024 年 7 月启动）公开的申请条件是：由国家卫生健康委认定的全国罕见病诊疗协作网医院明确诊断；确诊病种属于国家罕见病目录中所列病种；个人承担的医疗费用超过家庭年可支配收入 40%，或符合所在省市的困难情形标准；并依据医院治疗方案就本病种治疗、已产生费用。',
      '七期公布的资助上限为每个个案 10 000 元，可覆盖对症治疗的药费、住院费、康复费或辅具适配费用，最终金额由项目审核委员会确认。对 FSHD 来说，康复费和辅具适配这两项通常比药费更用得上。',
      '重要：期次、条件、额度都会变，七期的条件不等于你申请时的条件。基金会官网 chinaicf.org，服务热线 4000408772 转 801；申请前以基金会当期公告为准。',
    ],
    source:
      '北京病痛挑战公益基金会「罕见病医疗援助工程」项目七期启动公告（2024-07）；条件与额度为该期公告内容，非长期承诺',
  },
  {
    id: 'not-chronic-benefit',
    title: '进目录 ≠ 进门诊慢特病',
    lede: '这两件事由两个部门管，很多人在窗口才知道。',
    points: [
      '罕见病目录是国家卫生健康委等六部门发的，管的是诊疗、协作网、登记和药物研发方向。门诊慢特病是医保部门的待遇政策，两条线不交叉。',
      '国家医保局说得很直接：「由于疾病谱和诊疗能力还有差异，当前门诊慢特病的细分种类和诊断认定标准等规定全国各地还不尽统一，须按照参保所在统筹地区有关规定执行。」病种范围由你参保的统筹地区定，不是全国一张表。',
      '也就是说：FSHD 在你所在的市能不能按门诊慢特病报销，只能问当地医保局或医保经办机构，谁都替不了你查。目录上的文号在这个问题上不构成依据。',
      '如果当地确实有对应病种：认定材料一般是《门诊慢特病病种待遇认定申请表》加病历资料或检查资料，多数地区除线下窗口外还有 APP、公众号等线上申请渠道。',
      '另外，跨省直接结算只是结算方式的变化，不改变参保地原有的门诊慢特病病种范围 —— 在外地就医不会让你多出一个病种。',
    ],
    source:
      '国家医疗保障局《@慢特病患者 看病就医前您需要了解这些，医保小知识→》（2024-11-11）；《国家医保局办公室 财政部办公厅关于稳妥有序扩大跨省直接结算门诊慢特病病种范围的通知》政策解读（2024-09-13）',
  },
  {
    id: 'what-it-does-not-get-you',
    title: '目录目前给不了你什么',
    lede: '这一节写出来会让人失望，但漏掉它会让人白跑一趟。',
    points: [
      '目录最实在的一项作用是药品通道：《药品注册管理办法》第六十八条把「防治重大传染病和罕见病等疾病的创新药和改良型新药」列入优先审评审批的适用范围，第七十条给出时限：上市许可申请审评时限一百三十日；临床急需的境外已上市境内未上市的罕见病药品，审评时限七十日。',
      '但这些通道加速的是审批。FSHD 目前在全世界都没有能改变病程的药 —— 走到三期的 losmapimod 在 REACH 试验中未达主要终点，该项目于 2024 年 9 月暂停。没有药可以被加速，这条通道对 FSHD 现在是空的。',
      '所以进目录不等于有药、不等于有报销、不等于自动获得任何补助。它现在真正给你的，是上一节那些诊疗协作义务、被登记进国家系统的资格，以及在申请救助和跟不熟悉这个病的医生沟通时，一个可以报出来的国家文号。',
      '这些不是小事，但它们不是药。把这一条也写在卡上，是为了你在窗口不会因为「我是目录病种」而期待一个对方给不了的答复。',
    ],
    source:
      '《药品注册管理办法》第六十八条、第七十条；losmapimod 三期 REACH 结果与项目暂停见 Fulcrum Therapeutics 2024-09-12 公告',
  },
];

export const RARE_DISEASE_INTRO =
  '面肩肱型肌营养不良症是《第二批罕见病目录》第 25 项。这一页把「因此你有什么、没有什么」四件事按文号写清楚，并可以生成一张能举给窗口看的卡片。';

export const RARE_DISEASE_DISCLAIMER =
  '本页内容来自公开的国家文件与基金会公告，供你了解和准备提问。具体待遇以你参保地、户籍地和就诊医院的现行规定为准，本应用不能代替任何一方作出承诺。';

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

/**
 * The model handed to `renderAnesthesiaCardPng`.
 *
 * Reusing that renderer, and therefore its type, deliberately: it is the
 * only canvas path in the app that resolves the document's own CJK fonts
 * (an SVG through an <img> is font-isolated, and this card is entirely
 * Chinese), and it already solved the two problems this card has — the
 * height is not knowable until the text wraps, and it must survive being
 * long-pressed into a photo roll and shown with no network.
 *
 * The field names come from that renderer's first caller, not from this
 * content: `patientName` is the card's bold second line and here it
 * carries the catalogue entry, `patientLines` the document numbers. They
 * are not patient data — nothing on this card is personal, which is also
 * why it can be generated without a passport and shown to a stranger at
 * a window.
 */
export type RareDiseaseCardModel = AnesthesiaCardModel;

/**
 * Section titles the card omits, and why.
 *
 * The card is the held-up-at-a-window artefact: a clerk reads it
 * standing, in a queue, over a counter. So it carries the four things a
 * counter conversation turns on — the catalogue entry, what the
 * 协作网 owes, that 门诊慢特病 is a separate local decision, and that
 * there is no drug — and drops the 基金会 application terms, which are a
 * form to fill in at home rather than something to argue at a desk, and
 * which change per 期次 (a printed card outliving its 期次 is exactly the
 * stale-entitlement failure this module is trying to avoid).
 */
const CARD_SECTION_IDS = ['identity', 'network', 'not-chronic-benefit', 'what-it-does-not-get-you'];

const CARD_LINES: Record<string, string[]> = {
  identity: [
    '面肩肱型肌营养不良症（FSHD）是《第二批罕见病目录》序号 25 的病种。',
    '目录由国家卫生健康委等六部门印发，文号国卫医政发〔2023〕26号，2023 年 9 月 18 日。',
  ],
  network: [
    '国卫办医函〔2019〕157号要求协作网医院之间建立双向转诊、专家巡诊、远程会诊的标准和管理制度。',
    '成员医院应将疑难危重罕见病患者转诊至牵头医院，并按牵头医院方案做好接续管理。',
    '协作网医院应及时将诊治的罕见病患者信息录入登记系统。',
  ],
  'not-chronic-benefit': [
    '列入罕见病目录不等于列入门诊慢特病。门诊慢特病病种范围与认定标准由参保所在统筹地区规定，全国不统一。',
    '本人是否符合当地门诊慢特病病种，请以参保地医保经办机构的答复为准。',
  ],
  'what-it-does-not-get-you': [
    'FSHD 目前无改变病程的治疗药物，目录的药品优先审评通道对本病暂无可加速对象。',
    '持卡人不因列入目录而自动获得药品、报销或补助资格。',
  ],
};

/**
 * Builds the printable card.
 *
 * `asOf` is a parameter rather than `new Date()` inside: the card states
 * a 资料截至 date, and a card whose date is「today」regardless of when the
 * content was last checked is a card that lies more convincingly the
 * longer it sits unmaintained. The caller passes
 * RARE_DISEASE_CONTENT_AS_OF, which is edited by hand when the sources
 * are re-read.
 */
export const buildRareDiseaseCard = (
  asOf: string = RARE_DISEASE_CONTENT_AS_OF,
): RareDiseaseCardModel => {
  const sections = CARD_SECTION_IDS.map((id) => {
    const section = RARE_DISEASE_SECTIONS.find((entry) => entry.id === id);
    return {
      title: section?.title ?? id,
      lines: CARD_LINES[id] ?? [],
    };
  });

  return {
    title: '罕见病身份与权益说明卡',
    patientName: '《第二批罕见病目录》序号 25 · 面肩肱型肌营养不良症',
    patientLines: [
      '国卫医政发〔2023〕26号（2023-09-18）',
      '国卫办医函〔2019〕157号（2019-02-12）',
      `资料截至：${asOf}`,
    ],
    sections,
    sources: [
      '《第二批罕见病目录》国卫医政发〔2023〕26号，序号 25。',
      '《国家卫生健康委办公厅关于建立全国罕见病诊疗协作网的通知》国卫办医函〔2019〕157号。',
      '国家医疗保障局《@慢特病患者 看病就医前您需要了解这些》2024-11-11。',
    ],
    // Load-bearing on a card that will be shown to people who make
    // decisions about money and appointments.
    disclaimer:
      '本卡为国家公开文件要点摘录，用于说明病种身份与依据文号；具体待遇以当地现行规定和经办机构答复为准，不构成任何权益承诺。',
  };
};
