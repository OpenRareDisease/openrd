import type { AmbulationState } from '../profile.constants.js';
import type {
  InstrumentDefinition,
  InstrumentItem,
  InstrumentItemResponse,
  InstrumentScoringOutcome,
} from './instrument.types.js';
import { scoreSingleOrdinalItem } from './ordinal-scoring.js';

/**
 * Vignos lower-extremity functional grade, 1-10, as PATIENT
 * SELF-ASSESSMENT.
 *
 * WHY A PATIENT MAY ANSWER IT
 *
 * The same French National Registry study behind brooke.ts measured
 * Vignos self-report against a neuromuscular specialist's grade for
 * 281 patients within at most three months (same day for 77.6%) and
 * got ICC 0.86 [95% CI 0.82-0.89] — the strongest agreement of the two
 * scales shipping here, and the reason the registry moved it to
 * patient entry.
 *   Sanson B, Stalens C, Guien C, Villa L, Eng C, Rabarimeriarijaona S,
 *   et al. Convergence of patient- and physician-reported outcomes in
 *   the French National Registry of Facioscapulohumeral Dystrophy.
 *   Orphanet J Rare Dis. 2022 Mar 2;17:96. doi:10.1186/s13023-021-01793-6
 *
 *
 * ============================================================
 * THE ANCHOR WORDING IS FROZEN AT v1. DO NOT EDIT IT.
 * ============================================================
 *
 * Same rule, same reason as brooke.ts: the wording IS the measurement.
 * Every administration stored against 'v1' was answered by someone
 * reading exactly these words, and rewording an anchor makes every
 * prior score uncomparable in a way nothing downstream can detect. A
 * changed anchor is a NEW version row, never an edit.
 *
 * TRANSLATION PROVENANCE. Every `labelZh` is a translation of the
 * `sourceEn` beside it, reproduced verbatim from Table 2 of Lu Y-M,
 * Lue Y-J. "Strength and Functional Measurement for Patients with
 * Muscular Dystrophy", in: Hegde M (ed), Muscular Dystrophy,
 * IntechOpen, 2012 (open access, CC BY 3.0) — the grading originally
 * published in Vignos PJ Jr, Spencer GE Jr, Archibald KC. "Management
 * of progressive muscular dystrophy of childhood." JAMA.
 * 1963;184:89-96.
 *
 * A NOTE ON GRADES 6-8, WHICH ARE A KNOWN PROBLEM AND ARE KEPT ANYWAY.
 * All three are defined in terms of long leg braces (KAFOs). The
 * multi-centre study that measured this scale's behaviour across
 * dystrophy types found those grades "inapplicable, because some cases
 * did not use long leg braces" (Lue Y, Lin R, Chen S. Kaohsiung J Med
 * Sci. 2009;25(6):325-33) — and long leg bracing is uncommon in adult
 * FSHD care in China, where an AFO for foot drop is the usual device.
 * A patient who needs help to walk but has never worn a KAFO can find
 * no honest home in 6-8.
 *
 * The wording is NOT softened to fix this. Rewriting 「戴长腿支具」 as
 * 「使用辅具」 would produce a scale that reads better and is no longer
 * Vignos: the whole reason for using a published instrument is that
 * this app's grade 7 and a Marseille clinic's grade 7 mean the same
 * thing. The gap is disclosed to the patient in `limitationsZh`
 * instead, and 「不适用」 stays available on the item so nobody is
 * forced to claim a brace they do not own.
 */

export const VIGNOS_KEY = 'vignos_lower_extremity';
export const VIGNOS_VERSION = 'v1';
export const VIGNOS_ITEM_CODE = 'vignos_grade';
export const VIGNOS_SCORING_METHOD = 'vignos_v1_single_grade';

const vignosItem: InstrumentItem = {
  code: VIGNOS_ITEM_CODE,
  version: 'v1',
  promptZh: '请选择最符合你目前行走情况的一条（按你大多数日子的状态，不是最好的那天）',
  levels: [
    {
      value: 1,
      labelZh: '走路和上楼梯都不需要任何帮助。',
      sourceEn: 'Walks and climbs stairs without assistance',
    },
    {
      value: 2,
      labelZh: '能走路；上楼梯要扶着扶手。',
      sourceEn: 'Walks and climbs stair with aid of railing',
    },
    {
      value: 3,
      labelZh: '能走路；扶着扶手上楼梯很慢（上八级标准台阶超过 25 秒）。',
      sourceEn:
        'Walks and climbs stairs slowly with aid of railing (over 25 seconds for eight standard steps)',
    },
    {
      value: 4,
      labelZh: '能自己走路，也能自己从椅子上站起来，但上不了楼梯。',
      sourceEn: 'Walks unassisted and rises from chair but cannot climb stairs',
    },
    {
      value: 5,
      labelZh: '能自己走路，但没办法自己从椅子上站起来，也上不了楼梯。',
      sourceEn: 'Walks unassisted but cannot rise from chair or climb stairs',
    },
    {
      value: 6,
      labelZh: '需要别人搀扶才能走；或者戴上长腿支具（KAFO）后能自己走。',
      sourceEn: 'Walks only with assistance or walks independently with long leg braces',
    },
    {
      value: 7,
      labelZh: '戴长腿支具（KAFO）能走，但需要别人帮忙才能保持平衡。',
      sourceEn: 'Walks in long leg braces but requires assistance for balance',
    },
    {
      value: 8,
      labelZh: '戴长腿支具（KAFO）能站立，但即使有人帮忙也走不了。',
      sourceEn: 'Stands in long leg braces but unable to walk even with assistance',
    },
    {
      value: 9,
      labelZh: '使用轮椅。',
      sourceEn: 'Is in a wheelchair',
    },
    {
      value: 10,
      labelZh: '长期卧床。',
      sourceEn: 'Is confined to a bed',
    },
  ],
};

/**
 * Score one Vignos administration. Pure. See `scoreBrookeV1` for why
 * the function name is part of the contract.
 */
export const scoreVignosV1 = (
  responses: readonly InstrumentItemResponse[],
): InstrumentScoringOutcome => scoreSingleOrdinalItem(vignosItem, responses, VIGNOS_SCORING_METHOD);

/**
 * Vignos grade -> the baseline's three-state 「当前行走」.
 *
 * This is the wiring between the instrument and
 * AMBULATION_STATES / FOLLOWUP_EVENT_TYPES.started_wheelchair, and it
 * is derived strictly from the anchor wording above — no clinical
 * judgement is being added here, because none may be:
 *
 *   1-5  every one of these anchors says the patient walks, and 4 and
 *        5 say "walks unassisted" outright. Grades 2 and 3 qualify
 *        only STAIR climbing with a handrail, not walking, so they are
 *        'independent' too. -> independent
 *   6-7  "walks only with assistance", "requires assistance for
 *        balance". -> assisted
 *   8-10 "unable to walk even with assistance", wheelchair, bed.
 *        -> unable
 *
 * Grade 8 maps to 'unable' but is NOT wheelchair evidence: its wording
 * says standing in braces, and it says nothing about a wheelchair.
 * Grade 10 is bed confinement, which is past the wheelchair rather
 * than the moment of reaching it. So `impliesWheelchairStart` is true
 * for grade 9 alone — the one anchor whose own text is "is in a
 * wheelchair". Widening it to 8 or 10 would be the app inventing a
 * clinical event the patient never reported.
 */
export const ambulationStateFromVignosGrade = (grade: number): AmbulationState | null => {
  if (!Number.isInteger(grade) || grade < 1 || grade > 10) return null;
  if (grade <= 5) return 'independent';
  if (grade <= 7) return 'assisted';
  return 'unable';
};

/** True only for grade 9, whose published wording is "Is in a wheelchair". */
export const vignosGradeImpliesWheelchair = (grade: number): boolean => grade === 9;

export const vignosLowerExtremityV1: InstrumentDefinition = {
  key: VIGNOS_KEY,
  version: VIGNOS_VERSION,
  nameZh: 'Vignos 下肢功能分级',
  // Same reasoning as brooke.ts: the wording used here comes from a
  // CC BY 3.0 reproduction, so attribution is required and
  // 'public_domain' would be a stronger claim than we can support.
  licenceStatus: 'free_with_attribution',
  sourceCitation:
    'Vignos PJ Jr, Spencer GE Jr, Archibald KC. Management of progressive muscular dystrophy of childhood. JAMA. 1963;184:89-96. 分级措辞转录自 Lu Y-M, Lue Y-J. Strength and Functional Measurement for Patients with Muscular Dystrophy. In: Hegde M, editor. Muscular Dystrophy. IntechOpen; 2012, Table 2 (CC BY 3.0)。',
  scoreMin: 1,
  scoreMax: 10,
  higherIsWorse: true,
  recallPeriod: 'current',
  adminMinutes: 2,
  descriptionZh:
    '一个国际通用的下肢功能分级，从 1 到 10，数字越大表示行走能力越受限。神经内科医生和临床试验用的是同一套分级，所以这个数字可以直接给医生看。',
  limitationsZh: [
    '第 6、7、8 级都是用「长腿支具（KAFO）」来定义的。国内成年 FSHD 患者更常用的是踝足矫形器（AFO），很多人从来没戴过长腿支具——如果你走路需要帮助但没有长腿支具，这三级可能都对不上，可以先选「不适用」并在随访记录里补充说明。这是这个量表公认的缺陷（Lue Y, Lin R, Chen S. Kaohsiung J Med Sci. 2009;25(6):325-33）。',
    '同一项研究里，FSHD 人群有约 50% 集中在最好的等级（地板效应）。也就是说在病程较早的阶段，这个分数可能几年都不变——分数没动不代表没有变化，腿部力量、疲劳和跌倒次数要看别的记录。',
    '这个分级最初是为杜氏肌营养不良（DMD）儿童设计的，条目里没有 FSHD 常见的足下垂、骨盆带无力导致的步态摇摆等描述。',
  ],
  selfReportEvidenceZh:
    '法国 FSHD 国家登记处比对了 281 位患者的自评问卷与神经科医生的评估（两份表格最多相隔 3 个月，77.6% 为同一天），Vignos 分级的一致性为 ICC 0.86（95% CI 0.82-0.89），是该研究中一致性最高的量表之一。登记处据此把它改为由患者填写。（Sanson B, et al. Orphanet J Rare Dis. 2022;17:96）',
  items: [vignosItem],
  scoringMethod: VIGNOS_SCORING_METHOD,
  score: scoreVignosV1,
};
