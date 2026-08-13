import type {
  InstrumentDefinition,
  InstrumentItem,
  InstrumentItemResponse,
  InstrumentScoringOutcome,
} from './instrument.types.js';
import { scoreSingleOrdinalItem } from './ordinal-scoring.js';

/**
 * Brooke upper-extremity functional grade, 1-6, as PATIENT
 * SELF-ASSESSMENT.
 *
 * WHY THIS SCALE, FOR THIS DISEASE
 *
 * FSHD takes the shoulder girdle and upper arm early and hard.
 * Reaching a shelf, washing hair, holding a phone up to your face —
 * the app already asks about all three in its own private vocabulary
 * (DAILY_IMPACT_KEYS). Brooke asks the same territory in a vocabulary
 * that every neuromuscular clinic and every trial protocol already
 * reads.
 *
 * WHY A PATIENT MAY ANSWER IT
 *
 * The French National Registry of FSHD paired a specialist's clinical
 * evaluation form against the patient's own self-report questionnaire
 * for 281 patients, completed within at most three months of each
 * other (same day for 77.6%), and measured the agreement item by item.
 * Brooke came out at ICC 0.66 [95% CI 0.58-0.72] and the registry
 * moved it to patient entry on that basis.
 *   Sanson B, Stalens C, Guien C, Villa L, Eng C, Rabarimeriarijaona S,
 *   et al. Convergence of patient- and physician-reported outcomes in
 *   the French National Registry of Facioscapulohumeral Dystrophy.
 *   Orphanet J Rare Dis. 2022 Mar 2;17:96. doi:10.1186/s13023-021-01793-6
 *
 * 0.66 is moderate, not excellent, and its lower bound sits at 0.58.
 * That is a materially weaker result than the same study's Vignos
 * figure (0.86), and the difference is carried through to the patient
 * in `selfReportEvidenceZh` instead of being flattened into
 * 「经过验证」. A patient deciding whether to show this number to a
 * doctor is entitled to know which of their two scores is the sturdier
 * one.
 *
 *
 * ============================================================
 * THE ANCHOR WORDING IS FROZEN AT v1. DO NOT EDIT IT.
 * ============================================================
 *
 * The wording IS the measurement. 「能把一杯约 240 毫升的水端到嘴边」
 * is not a description of grade 3, it is the definition of grade 3,
 * and every administration ever stored against this version was
 * answered by a person reading exactly these words.
 *
 * Rewording an anchor — even to make it clearer, even to fix a typo
 * that bothers you — silently changes what every prior score means,
 * and there is no way to tell afterwards which rows were answered
 * against which text. The scores do not become wrong in a way anything
 * can detect. They become uncomparable in a way nothing can detect,
 * which is worse.
 *
 * If an anchor must change: add a NEW definition with version 'v2',
 * add its catalogue row to a new migration, leave this one in place,
 * and let old administrations keep pointing at 'v1'. That is what
 * `instrument_version` on `instrument_administrations` is for.
 *
 * TRANSLATION PROVENANCE. Every `labelZh` below is a translation of
 * the `sourceEn` beside it, which is reproduced verbatim from Table 1
 * of Lu Y-M, Lue Y-J. "Strength and Functional Measurement for
 * Patients with Muscular Dystrophy", in: Hegde M (ed), Muscular
 * Dystrophy, IntechOpen, 2012 (open access, CC BY 3.0) — itself the
 * grading published with the protocol in Brooke MH, Griggs RC, Mendell
 * JR, Fenichel GM, Shumate JB, Pellegrino RJ. "Clinical trial in
 * Duchenne dystrophy. I. The design of the protocol." Muscle Nerve.
 * 1981;4(3):186-97.
 *
 * The one liberty taken in translation is the glass: the source says
 * "an 8-oz glass of water", and 8 fl oz is not a unit anyone in China
 * pours by. It is rendered as 「约 240 毫升（8 盎司）」 — both units,
 * so the patient can picture it and a clinician can see it is the
 * standard item. 8 US fl oz is 236.6 ml. Nothing else was localised;
 * where the source is specific ("hold a pen or pick up pennies"), the
 * translation stays specific, because that specificity is what makes
 * two people grade themselves the same way.
 */

export const BROOKE_KEY = 'brooke_upper_extremity';
export const BROOKE_VERSION = 'v1';
export const BROOKE_ITEM_CODE = 'brooke_grade';
export const BROOKE_SCORING_METHOD = 'brooke_v1_single_grade';

const brookeItem: InstrumentItem = {
  code: BROOKE_ITEM_CODE,
  version: 'v1',
  promptZh: '请选择最符合你目前上肢/手臂情况的一条（按你大多数日子的状态，不是最好的那天）',
  levels: [
    {
      value: 1,
      labelZh:
        '双臂自然垂在身体两侧时，能把手臂沿着一个完整的圆弧向外向上抬起，直到两手在头顶上方碰到一起。',
      sourceEn:
        'Starting with arms at the sides, the patient can abduct the arms in a full circle until they touch above the head',
    },
    {
      value: 2,
      labelZh:
        '只有先把手肘弯起来（把动作的弧线缩短），或者借助其他部位代偿发力，才能把手举过头顶。',
      sourceEn:
        'Can raise arms above head only by flexing the elbow (shortening the circumference of the movement) or using accessory muscles',
    },
    {
      value: 3,
      labelZh: '手举不到头顶上方，但能把一杯约 240 毫升（8 盎司）的水端到嘴边。',
      sourceEn: 'Cannot raise hands above head, but can raise an 8-oz glass of water to the mouth',
    },
    {
      value: 4,
      labelZh: '能把手举到嘴边，但端不动那杯约 240 毫升（8 盎司）的水。',
      sourceEn:
        'Can raise hands to the mouth, but cannot raise an 8-oz glass of water to the mouth',
    },
    {
      value: 5,
      labelZh: '手举不到嘴边，但还能用手握住笔，或者从桌面上捡起硬币。',
      sourceEn:
        'Cannot raise hands to the mouth, but can use hands to hold a pen or pick up pennies from the table',
    },
    {
      value: 6,
      labelZh: '手举不到嘴边，手也已经没有可用的功能。',
      sourceEn: 'Cannot raise hands to the mouth and has no useful function of hands',
    },
  ],
};

/**
 * Score one Brooke administration. Pure.
 *
 * The name is the contract: it is written into
 * `instrument_administrations.scoring_method` on every row, so if this
 * rule is ever found to be wrong, the rows it produced can be selected
 * exactly. Changing what this function computes without changing its
 * name would make that impossible — add `scoreBrookeV2` instead.
 */
export const scoreBrookeV1 = (
  responses: readonly InstrumentItemResponse[],
): InstrumentScoringOutcome => scoreSingleOrdinalItem(brookeItem, responses, BROOKE_SCORING_METHOD);

export const brookeUpperExtremityV1: InstrumentDefinition = {
  key: BROOKE_KEY,
  version: BROOKE_VERSION,
  nameZh: 'Brooke 上肢功能分级',
  // The 1981 protocol paper describes the grading in its text and
  // asserts no reserved rights over it; the wording used here is taken
  // from an open-access CC BY 3.0 reproduction, which requires
  // attribution. Hence 'free_with_attribution' rather than
  // 'public_domain': the weaker claim is the one we can actually
  // support, and `sourceCitation` travels with every catalogue read so
  // the attribution is never separated from the text.
  licenceStatus: 'free_with_attribution',
  sourceCitation:
    'Brooke MH, Griggs RC, Mendell JR, Fenichel GM, Shumate JB, Pellegrino RJ. Clinical trial in Duchenne dystrophy. I. The design of the protocol. Muscle Nerve. 1981;4(3):186-97. 分级措辞转录自 Lu Y-M, Lue Y-J. Strength and Functional Measurement for Patients with Muscular Dystrophy. In: Hegde M, editor. Muscular Dystrophy. IntechOpen; 2012, Table 1 (CC BY 3.0)。',
  scoreMin: 1,
  scoreMax: 6,
  higherIsWorse: true,
  recallPeriod: 'current',
  adminMinutes: 2,
  descriptionZh:
    '一个国际通用的上肢功能分级，从 1 到 6，数字越大表示手臂能做的事越少。神经内科医生和临床试验用的是同一套分级，所以这个数字可以直接给医生看。',
  limitationsZh: [
    '这个分级最初是为杜氏肌营养不良（DMD）设计的。在进展较慢的类型（包括 FSHD）里，很多人会长期停在同一个等级，几年都不变——分数没动不等于病情没动，日常生活的变化要靠其他记录来体现。',
    '一项多中心研究发现，在进展缓慢的肌营养不良人群中，Brooke 分级的「地板效应」明显（大量患者集中在最好的等级），对轻中度差异分辨力不足（Lue Y, Lin R, Chen S. Kaohsiung J Med Sci. 2009;25(6):325-33）。',
    '6 个等级只描述手臂抬举和抓握，不包含面部、肩胛稳定性、疼痛和疲劳——而这些恰恰是 FSHD 患者日常最常提到的问题。',
  ],
  selfReportEvidenceZh:
    '法国 FSHD 国家登记处比对了 281 位患者的自评问卷与神经科医生的评估（两份表格最多相隔 3 个月，77.6% 为同一天），Brooke 分级的一致性为 ICC 0.66（95% CI 0.58-0.72），属于中等一致；同一研究中 Vignos 下肢分级为 0.86，明显更高。登记处据此把这两个分级都改为由患者填写。（Sanson B, et al. Orphanet J Rare Dis. 2022;17:96）',
  items: [brookeItem],
  scoringMethod: BROOKE_SCORING_METHOD,
  score: scoreBrookeV1,
};
