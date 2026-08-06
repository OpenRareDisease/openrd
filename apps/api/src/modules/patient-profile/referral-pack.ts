import {
  buildClinicalPassportSummary,
  type ClinicalPassportSummaryDTO,
  type PassportDiagnosisConfirmation,
} from './profile.passport.js';
import type { PatientFollowupEventDTO, PatientProfileDTO } from './profile.service.js';

/**
 * 罕见病诊疗协作网转诊资料 — the passport, serialised for a neurologist.
 *
 * WHY A SECOND SERIALISATION AND NOT A FLAG ON THE FIRST
 * -----------------------------------------------------
 * `buildClinicalPassportExport` writes a summary for the patient's own
 * use: module readiness, completion score, 待补项. Half of that is about
 * the app ("上传一份 MRI 报告可以让护照更完整") and means nothing across
 * a desk. The reader here is a 协作网 hospital neurologist who may have
 * seen three FSHD patients in a career, has fifteen minutes, and needs
 * four things this app happens to hold: what backs the diagnosis, how
 * the function tests have moved, what the patient walks and breathes
 * with today, and which of the three monitoring slots actually have a
 * report behind them.
 *
 * So: same input, different document. Both are built from
 * `PatientProfileDTO`, and this one takes the profile rather than a
 * ready-made `ClinicalPassportSummaryDTO` on purpose — the pack needs
 * `functionTests`, `followupEvents` and `baseline`, none of which
 * survive into the summary, and accepting a summary *and* a profile
 * would let a caller pass a pair built from two different patients.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It is not a medical record and it does not claim to be one. Every
 * value in it was either typed by the patient or read by an OCR
 * pipeline out of a photograph of a report. The header the markdown
 * prints says exactly that, and it is not optional decoration: a
 * well-typeset page handed to a busy clinician is believed at the
 * weight of its typesetting.
 *
 * THREE STATES, NOT TWO — EVERYWHERE
 * ----------------------------------
 * `profile.passport.ts` carries a long comment on `PassportMonitoringItemDTO.state`
 * explaining why collapsing 「上传了但读不出」 into 「没上传」 is dangerous
 * on the anesthesia card. This pack goes to the doctor who decides what
 * to order next, so the same reasoning applies at least as strongly, and
 * it applies to three more fields than the monitoring slots:
 *
 *   - a function test row is 「测到了 X」, 「当天做不了」 (migration 017's
 *     `notApplicable`, a clinical observation) or absent. The middle one
 *     is the most informative row on the page and is the one a two-state
 *     model deletes.
 *   - the assistive-device list is 「列了这些」, 「基线问卷里一个都没勾」
 *     or 「这一节从来没填过」. Printing 「无辅具」 for the third is a
 *     false statement about a patient's body, made to the one reader who
 *     cannot check it against them.
 *   - a monitoring slot is present / unreadable / absent, carried
 *     straight through from the passport, with 「不等于没做过」 spelled
 *     out for `absent` rather than left to the reader's charity.
 */

/* ------------------------------------------------------------------ */
/* The catalogue entry                                                 */
/* ------------------------------------------------------------------ */

/**
 * FSHD's entry in 《第二批罕见病目录》.
 *
 * The pack leads with it because it is the line that gets a patient
 * taken seriously at a hospital that does not know the disease, and
 * because a 协作网 hospital's obligations attach to catalogue diseases.
 *
 * Read from the .doc attachment on nhc.gov.cn, not from a secondary
 * write-up — several of those reprint the list with the numbering
 * dropped. The same reference, with the full policy discussion, is in
 * `apps/mobile/lib/rare-disease-status-content.ts`; it is restated here
 * rather than imported because the API cannot import from the mobile
 * package, and the two must not drift — if one is corrected, correct
 * both.
 */
export interface ReferralCatalogueRefDTO {
  catalogue: string;
  documentNumber: string;
  issuedOn: string;
  itemNumber: number;
  diseaseNameZh: string;
  diseaseNameEn: string;
  source: string;
}

export const REFERRAL_CATALOGUE_REF: ReferralCatalogueRefDTO = {
  catalogue: '《第二批罕见病目录》',
  documentNumber: '国卫医政发〔2023〕26号',
  issuedOn: '2023-09-18',
  itemNumber: 25,
  diseaseNameZh: '面肩肱型肌营养不良症',
  diseaseNameEn: 'Facioscapulohumeral muscular dystrophy',
  source:
    '《第二批罕见病目录》国卫医政发〔2023〕26号（2023-09-18），序号 25；协作网义务见《国家卫生健康委办公厅关于建立全国罕见病诊疗协作网的通知》国卫办医函〔2019〕157号',
};

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

export interface ReferralDiagnosisDTO {
  confirmation: PassportDiagnosisConfirmation;
  /**
   * The one sentence the pack prints under 诊断依据. Built here rather
   * than at the render site because there is exactly one way to get
   * this wrong — printing 「FSHD」 unqualified over a patient's own
   * unconfirmed guess — and one place is easier to keep right than
   * three.
   */
  statement: string;
  geneticType: string;
  d4z4Repeats: string;
  methylationValue: string;
  diagnosisDate: string;
  geneEvidence: string;
  latestSourceDate: string | null;
}

/** What one row of a function-test series can mean. See migration 017. */
export type ReferralFunctionTestOutcome = 'measured' | 'unable';

export interface ReferralFunctionTestPointDTO {
  performedAt: string;
  outcome: ReferralFunctionTestOutcome;
  measuredValue: number | null;
  unit: string | null;
  side: string | null;
  protocol: string | null;
  deviceUsed: string | null;
  assistanceRequired: boolean | null;
  notes: string | null;
}

export interface ReferralFunctionTestSeriesDTO {
  testType: string;
  label: string;
  /** Oldest first — a series is read as a trend, not as a stack. */
  points: ReferralFunctionTestPointDTO[];
  /**
   * Rows dropped from `points` to keep the printed page finite.
   * Reported rather than swallowed: a doctor who is shown 12 of 40
   * attempts and is not told so is reading a shorter history than the
   * patient has.
   */
  omittedEarlierCount: number;
  /** True when any surviving row is 「当天做不了」. */
  hasUnableEntries: boolean;
}

/**
 * `listed`        — the baseline form holds one or more devices.
 * `none_selected` — the baseline form was submitted with the device
 *                   question answered by selecting nothing. Weaker than
 *                   「患者说自己不用辅具」, and worded that way.
 * `not_recorded`  — no baseline, or the section was never filled in.
 *
 * The distinction is only as good as what the client stores: the
 * registration form always sends an array (possibly empty), so an empty
 * array is a real answer today. Any future client that omits the key
 * when the patient selects nothing collapses `none_selected` into
 * `not_recorded` — which is the safe direction, because the pack then
 * says 「未记录」 instead of asserting an absence.
 */
export type ReferralDeviceRecordState = 'listed' | 'none_selected' | 'not_recorded';

export type ReferralAmbulationState = 'independent' | 'assisted' | 'unable';

export interface ReferralDeviceStartEventDTO {
  eventType: 'started_afo' | 'started_wheelchair' | 'started_niv';
  label: string;
  occurredAt: string;
  description: string | null;
}

export interface ReferralDevicesDTO {
  state: ReferralDeviceRecordState;
  devices: string[];
  /**
   * 「开始使用」 events, most recent first.
   *
   * These are NOT the current device list and are not merged into it. A
   * logged 「开始使用轮椅」 says a transition happened on a date; it does
   * not say the patient still uses one, or only one. Merging them would
   * manufacture a present-tense fact out of a past-tense record.
   */
  startEvents: ReferralDeviceStartEventDTO[];
  ambulation: ReferralAmbulationState | null;
  ambulationLabel: string;
  /**
   * Set only for `assisted`, and load-bearing. Before migration 022 the
   * baseline form offered 「可独立行走」 and 「需要辅助」 and nothing
   * else, so a patient who cannot walk at all had to answer 「需要
   * 辅助」, and every historical value was migrated to that string. The
   * profile has no per-field timestamp, so this file cannot tell a
   * migrated answer from a fresh one — it says so rather than pick.
   */
  ambulationCaveat: string | null;
  note: string;
}

export interface ReferralMonitoringSlotDTO {
  key: 'blood' | 'respiratory' | 'cardiac';
  title: string;
  state: 'present' | 'unreadable' | 'absent';
  /** The rendered sentence, one per state. Never a bare 「暂无数据」. */
  statement: string;
  latestDate: string | null;
  freshnessLabel: string;
  /** Whether the test is indicated at all — carried from the passport. */
  note: string | null;
}

export interface ReferralRespiratoryDTO {
  /** Date of the 「开始无创通气」 event, if one was ever logged. */
  nivStartedAt: string | null;
  /** `null` when the baseline section was never filled in. */
  breathingSymptomsRecorded: boolean | null;
  pulmonary: ReferralMonitoringSlotDTO;
  statement: string;
}

export interface ReferralQuestionPromptDTO {
  id: string;
  prompt: string;
  /** What to have ready, or what the question is for. */
  hint: string;
  /** A document number, or an explicit statement that this page wrote it. */
  source: string;
}

export interface ReferralPackDTO {
  generatedAt: string;
  documentTitle: string;
  fileName: string;
  contentType: 'text/markdown';
  patientName: string;
  passportId: string;
  latestUpdatedAt: string | null;
  catalogue: ReferralCatalogueRefDTO;
  diagnosis: ReferralDiagnosisDTO;
  functionTests: ReferralFunctionTestSeriesDTO[];
  devices: ReferralDevicesDTO;
  respiratory: ReferralRespiratoryDTO;
  monitoring: ReferralMonitoringSlotDTO[];
  questions: ReferralQuestionPromptDTO[];
  markdown: string;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const FUNCTION_TEST_LABELS: Record<string, string> = {
  stair_climb: '上楼梯计时',
  ten_meter_walk: '10 米步行',
  sit_to_stand: '坐站转换',
  six_minute_walk: '6 分钟步行',
  timed_up_and_go: '起立行走（TUG）',
  custom: '自定义测试',
};

const UNIT_LABELS: Record<string, string> = {
  sec: '秒',
  m: '米',
  'm/s': '米/秒',
  reps: '次',
  kg: '千克',
  score: '分',
};

const SIDE_LABELS: Record<string, string> = {
  left: '左',
  right: '右',
  bilateral: '双侧',
  none: '不分侧',
};

const START_EVENT_LABELS: Record<ReferralDeviceStartEventDTO['eventType'], string> = {
  started_afo: '开始使用 AFO（踝足矫形器）',
  started_wheelchair: '开始使用轮椅',
  started_niv: '开始无创通气',
};

const AMBULATION_LABELS: Record<ReferralAmbulationState, string> = {
  independent: '可独立行走',
  assisted: '需要辅助（拐杖、支具或扶人）才能行走',
  unable: '无法行走（含长期使用轮椅、卧床）',
};

/**
 * How many rows of one function-test series the pack prints.
 *
 * The pack is printed or shown on a phone at a desk. A patient who has
 * logged a 10-metre walk every fortnight for three years has 78 rows of
 * one test, and 78 rows is not a trend a clinician reads in a corridor,
 * it is a wall. Twelve most-recent rows plus an explicit count of what
 * was dropped keeps the page readable without hiding the history.
 */
export const REFERRAL_MAX_POINTS_PER_SERIES = 12;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getTimestamp = (value?: string | null): number => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Local-time accessors, matching `formatDate` in profile.passport.ts
 * rather than formatting in UTC.
 *
 * Not because local is right — it is not, in general. A stored
 * timestamp printed with the *process's* timezone follows the server,
 * not the patient, so a report the patient filed at 01:00 Beijing time
 * can print as the previous day on a UTC host. The reason to match is
 * that this pack and the clinical-passport export are generated from
 * one profile and are meant to be read side by side; two documents from
 * one app disagreeing about the date of one report is a worse failure
 * in front of a clinician than both being off by the same day.
 *
 * Fixing it properly means giving the whole module one timezone (the
 * patient's, or an explicitly configured one) in a single place. That
 * is a change to profile.passport.ts, which this lane does not own.
 */
const formatDate = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.trim() !== '—';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Markdown table cells are not used here, but a stray pipe in a
 *  patient-typed device name still ends up inside a list item that a
 *  renderer may be reading as a table row. Cheap to neutralise. */
const escapeMarkdown = (value: string) => value.replace(/\|/g, '\\|');

/* ------------------------------------------------------------------ */
/* Diagnosis                                                           */
/* ------------------------------------------------------------------ */

const buildDiagnosis = (summary: ClinicalPassportSummaryDTO): ReferralDiagnosisDTO => {
  const { diagnosis } = summary;
  const repeats = hasText(diagnosis.d4z4Repeats) ? diagnosis.d4z4Repeats : null;

  // Same three states, same refusal to flatten them, as the anesthesia
  // card — see PassportDiagnosisConfirmation. The wording here is longer
  // because this reader can act on the difference: an unconfirmed
  // patient in front of a 协作网 neurologist is a patient who may still
  // be able to get confirmed.
  const statement =
    diagnosis.confirmation === 'genetic'
      ? repeats
        ? `面肩肱型肌营养不良症（FSHD），基因确诊；D4Z4 重复数 ${repeats}`
        : '面肩肱型肌营养不良症（FSHD），基因确诊'
      : diagnosis.confirmation === 'self_reported'
        ? '面肩肱型肌营养不良症（FSHD）—— 本人填报，本平台未收到基因报告，请勿按已确诊处理'
        : '本平台尚无任何诊断依据记录 —— 以下内容仅为患者自述与自测，不构成诊断';

  return {
    confirmation: diagnosis.confirmation,
    statement,
    geneticType: diagnosis.geneticType,
    d4z4Repeats: diagnosis.d4z4Repeats,
    methylationValue: diagnosis.methylationValue,
    diagnosisDate: diagnosis.diagnosisDate,
    geneEvidence: diagnosis.geneEvidence,
    latestSourceDate: diagnosis.latestSourceDate,
  };
};

/* ------------------------------------------------------------------ */
/* Function tests                                                      */
/* ------------------------------------------------------------------ */

const buildFunctionTestSeries = (profile: PatientProfileDTO): ReferralFunctionTestSeriesDTO[] => {
  const byType = new Map<string, ReferralFunctionTestPointDTO[]>();

  for (const test of profile.functionTests ?? []) {
    if (!hasText(test.testType) || !hasText(test.performedAt)) continue;

    // `notApplicable` first: migration 017's CHECK forbids a value
    // alongside it, but this file reads rows, not the constraint, and a
    // row that somehow carries both must not be printed as a clean
    // measurement. 「做不了」 is the safer of the two to believe.
    const unable = test.notApplicable === true;
    const measured = isFiniteNumber(test.measuredValue);
    if (!unable && !measured) continue;

    const points = byType.get(test.testType) ?? [];
    points.push({
      performedAt: test.performedAt,
      outcome: unable ? 'unable' : 'measured',
      measuredValue: unable ? null : (test.measuredValue as number),
      unit: hasText(test.unit) ? test.unit : null,
      side: hasText(test.side) ? test.side : null,
      protocol: hasText(test.protocol) ? test.protocol : null,
      deviceUsed: hasText(test.deviceUsed) ? test.deviceUsed : null,
      assistanceRequired:
        typeof test.assistanceRequired === 'boolean' ? test.assistanceRequired : null,
      notes: hasText(test.notes) ? test.notes : null,
    });
    byType.set(test.testType, points);
  }

  const series = [...byType.entries()].map(([testType, points]) => {
    const sorted = [...points].sort(
      (a, b) => getTimestamp(a.performedAt) - getTimestamp(b.performedAt),
    );
    const omittedEarlierCount = Math.max(0, sorted.length - REFERRAL_MAX_POINTS_PER_SERIES);
    const kept = omittedEarlierCount > 0 ? sorted.slice(omittedEarlierCount) : sorted;
    return {
      testType,
      label: FUNCTION_TEST_LABELS[testType] ?? testType,
      points: kept,
      omittedEarlierCount,
      hasUnableEntries: kept.some((point) => point.outcome === 'unable'),
    };
  });

  // Most recently performed series first: the test the patient is
  // actually still doing is the one worth the top of the page.
  return series.sort(
    (a, b) =>
      getTimestamp(b.points[b.points.length - 1]?.performedAt) -
      getTimestamp(a.points[a.points.length - 1]?.performedAt),
  );
};

const formatFunctionTestPoint = (point: ReferralFunctionTestPointDTO): string => {
  const date = formatDate(point.performedAt) ?? point.performedAt;
  const qualifiers: string[] = [];
  if (point.side && SIDE_LABELS[point.side]) qualifiers.push(SIDE_LABELS[point.side]);
  else if (point.side) qualifiers.push(point.side);
  if (point.protocol) qualifiers.push(`方案：${point.protocol}`);
  if (point.deviceUsed) qualifiers.push(`器械：${point.deviceUsed}`);
  if (point.assistanceRequired === true) qualifiers.push('需要他人协助');
  if (point.assistanceRequired === false) qualifiers.push('无人协助');
  if (point.notes) qualifiers.push(point.notes);

  const body =
    point.outcome === 'unable'
      ? // Not「无数据」. The patient attempted this and could not finish
        // it, which is an observation, and on a page whose other rows
        // are numbers it is the row that changes management.
        '当天尝试后无法完成'
      : `${point.measuredValue}${point.unit ? (UNIT_LABELS[point.unit] ?? point.unit) : ''}`;

  const tail = qualifiers.length > 0 ? `（${qualifiers.join('；')}）` : '';
  return `${date}：${escapeMarkdown(body)}${escapeMarkdown(tail)}`;
};

/* ------------------------------------------------------------------ */
/* Devices, ambulation, respiratory support                            */
/* ------------------------------------------------------------------ */

const AMBULATION_ASSISTED_CAVEAT =
  '注意：本平台早期版本的问卷只有「可独立行走」和「需要辅助」两个选项，无法行走的患者当时只能选「需要辅助」，历史数据已按原选项迁移。本条无法区分是当时的迁移值还是近期填写，请当面确认。';

const collectStartEvents = (
  events: PatientFollowupEventDTO[],
  types: ReadonlyArray<ReferralDeviceStartEventDTO['eventType']>,
): ReferralDeviceStartEventDTO[] =>
  events
    .filter((event) => types.includes(event.eventType as ReferralDeviceStartEventDTO['eventType']))
    .map((event) => ({
      eventType: event.eventType as ReferralDeviceStartEventDTO['eventType'],
      label: START_EVENT_LABELS[event.eventType as ReferralDeviceStartEventDTO['eventType']],
      occurredAt: event.occurredAt,
      description: hasText(event.description) ? event.description : null,
    }))
    .sort((a, b) => getTimestamp(b.occurredAt) - getTimestamp(a.occurredAt));

const buildDevices = (profile: PatientProfileDTO): ReferralDevicesDTO => {
  const baseline = asRecord(profile.baseline);
  const currentStatus = asRecord(baseline?.currentStatus);
  const rawDevices = currentStatus?.assistiveDevices;

  const devices = Array.isArray(rawDevices)
    ? rawDevices.filter(hasText).map((value) => value.trim())
    : [];

  const state: ReferralDeviceRecordState = !Array.isArray(rawDevices)
    ? 'not_recorded'
    : devices.length > 0
      ? 'listed'
      : 'none_selected';

  const rawAmbulation = currentStatus?.independentlyAmbulatory;
  const ambulation: ReferralAmbulationState | null =
    rawAmbulation === 'independent' || rawAmbulation === 'assisted' || rawAmbulation === 'unable'
      ? rawAmbulation
      : null;

  const startEvents = collectStartEvents(profile.followupEvents ?? [], [
    'started_afo',
    'started_wheelchair',
  ]);

  const note =
    state === 'listed'
      ? '以下为患者在基线问卷中自行勾选的辅具，不是处方或适配记录。'
      : state === 'none_selected'
        ? '患者提交过基线问卷，但辅具一项没有勾选任何选项。这不等于患者说自己不需要辅具，请当面确认。'
        : '患者没有填写过辅具这一节。本平台对此没有记录 —— 不等于没有使用辅具。';

  return {
    state,
    devices,
    startEvents,
    ambulation,
    ambulationLabel: ambulation
      ? AMBULATION_LABELS[ambulation]
      : '本平台没有行走状态记录 —— 不等于行走正常',
    ambulationCaveat: ambulation === 'assisted' ? AMBULATION_ASSISTED_CAVEAT : null,
    note,
  };
};

const buildMonitoringSlot = (
  item: ClinicalPassportSummaryDTO['monitoring']['items'][number],
): ReferralMonitoringSlotDTO => {
  const date = formatDate(item.latestDate);
  const statement =
    item.state === 'present'
      ? date
        ? `${item.summary}（${date}）`
        : item.summary
      : item.state === 'unreadable'
        ? // The distinction the anesthesia card exists to protect,
          // restated for a reader who can do something about it: the
          // original report is in the patient's hands or their phone.
          date
          ? `已上传该类报告（${date}），但本平台未能自动读出数值 —— 请向患者索取原件`
          : '已上传该类报告，但本平台未能自动读出数值 —— 请向患者索取原件'
        : '本平台没有该类报告的记录 —— 不等于没有做过，请当面询问';

  return {
    key: item.key,
    title: item.title,
    state: item.state,
    statement,
    latestDate: item.latestDate,
    freshnessLabel: item.freshness.label,
    note: item.note ?? null,
  };
};

const buildRespiratory = (
  profile: PatientProfileDTO,
  monitoring: ReferralMonitoringSlotDTO[],
): ReferralRespiratoryDTO => {
  const nivEvents = collectStartEvents(profile.followupEvents ?? [], ['started_niv']);
  const nivStartedAt = nivEvents[0]?.occurredAt ?? null;

  const baseline = asRecord(profile.baseline);
  const currentStatus = asRecord(baseline?.currentStatus);
  const rawBreathing = currentStatus?.breathingSymptoms;
  const breathingSymptomsRecorded = typeof rawBreathing === 'boolean' ? rawBreathing : null;

  // The passport emits all three monitoring slots unconditionally
  // today, and a test in referral-pack.test.ts pins that. The fallback
  // is not dead defensiveness: if that ever stops being true, a pack
  // whose 呼吸支持 section silently loses its 肺功能 line is a page that
  // reads as「没问题」 to the reader deciding about anesthesia. Printing
  //「本平台没有记录」 is the failure mode this section can survive.
  const pulmonary =
    monitoring.find((slot) => slot.key === 'respiratory') ??
    ({
      key: 'respiratory',
      title: '肺功能',
      state: 'absent',
      statement: '本平台没有该类报告的记录 —— 不等于没有做过，请当面询问',
      latestDate: null,
      freshnessLabel: '未知',
      note: null,
    } satisfies ReferralMonitoringSlotDTO);

  const nivDate = formatDate(nivStartedAt);
  const statement = nivStartedAt
    ? // A start date, not a present-tense claim: the app records the
      // transition and never asks again, so「正在使用」would be this
      // file's invention rather than the patient's answer.
      `患者记录过「开始无创通气」，日期 ${nivDate ?? nivStartedAt}。本平台此后未再确认使用情况，请当面核实目前的通气方式、参数与依从性。`
    : '本平台没有无创通气的记录 —— 不等于没有使用，请当面询问。';

  return { nivStartedAt, breathingSymptomsRecorded, pulmonary, statement };
};

/* ------------------------------------------------------------------ */
/* 我想问的问题                                                         */
/* ------------------------------------------------------------------ */

/**
 * The sheet the patient fills in before the visit.
 *
 * Why it is in the pack and not a separate leaflet: the FSHD diagnostic
 * odyssey runs close to a decade and this may be the patient's first
 * appointment at a hospital that knows the disease. The failure mode is
 * not that the doctor says nothing useful, it is that the patient walks
 * out having forgotten to ask, and the next slot is months away. A
 * printed line with a blank after it is answered far more often than a
 * remembered intention.
 *
 * Every entry is a QUESTION. None of them tells the patient what should
 * be done — the two that touch a guideline point at 我的随访计划, where
 * the AAN recommendations live with their levels attached, rather than
 * restating a recommendation here with the level filed off.
 */
export const REFERRAL_QUESTION_PROMPTS: readonly ReferralQuestionPromptDTO[] = [
  {
    id: 'registry',
    prompt: '我的病例要不要录入国家罕见病诊疗服务信息系统？',
    hint: '协作网医院有这项义务，不是给患者的额外恩惠。被登记进去，是以后参加研究和试验的前提之一。',
    source:
      '《国家卫生健康委办公厅关于建立全国罕见病诊疗协作网的通知》国卫办医函〔2019〕157号：「协作网医院要及时将诊治的罕见病患者相关信息录入登记系统。」',
  },
  {
    id: 'followup-where',
    prompt: '以后的随访放在哪家医院？本地医院能不能接？',
    hint: '把「下次去哪、多久一次、谁负责」当场问清楚，比回家再打电话省一趟路。',
    source:
      '国卫办医函〔2019〕157号要求协作网医院之间建立双向转诊制度，成员医院按牵头医院制订的随访治疗方案做接续管理',
  },
  {
    id: 'which-tests',
    prompt: '按我现在的情况，哪些检查需要做？哪些暂时不用做？',
    hint: '本资料第五节列了本平台掌握的三项监测记录，可以直接给医生看。检查费用多数要自己出，「不用做」和「要做」一样值得问。',
    source: '本页自拟的提问，不是检查建议；具体项目与依据见本应用「我的随访计划」',
  },
  {
    id: 'rehab',
    prompt: '康复怎么安排？在哪做、多久一次、哪些动作要避开？',
    hint: '可以问能不能转介康复科或物理治疗师，以及有没有可以在家做的方案。',
    source: '本页自拟的提问，不是康复处方',
  },
  {
    id: 'devices',
    prompt: '辅具（AFO、肩托、助行器、轮椅）现在该不该配？去哪评估？',
    hint: '本资料第三节写了本平台记录到的辅具和行走状态。适配通常需要单独的评估，问清楚去哪个科。',
    source: '本页自拟的提问，不是辅具建议',
  },
  {
    id: 'family',
    prompt: '家里其他人要不要查？遗传咨询在哪做？',
    hint: 'FSHD 多为常染色体显性遗传。想问生育相关的问题，可以先看本应用「遗传与生育」那一页再来问。',
    source: '本页自拟的提问，不是遗传咨询意见',
  },
  {
    id: 'surgery',
    prompt: '如果以后要做手术或全身麻醉，我需要提前准备什么？',
    hint: '本应用可以生成一张麻醉提示卡，术前可以交给麻醉科。',
    source: '本页自拟的提问；术前肺功能一项的依据见本应用「我的随访计划」',
  },
  {
    id: 'next-visit',
    prompt: '下一次复诊什么时候？中间出现什么情况需要提前来？',
    hint: '把「什么情况要提前来」问成一句具体的话，回家才用得上。',
    source: '本页自拟的提问',
  },
];

const buildQuestions = (
  diagnosis: ReferralDiagnosisDTO,
  functionTests: ReferralFunctionTestSeriesDTO[],
): ReferralQuestionPromptDTO[] => {
  const questions: ReferralQuestionPromptDTO[] = [];

  // The sheet leads with the thing this particular visit can fix. A
  // patient without a genetic result sitting in front of a 协作网
  // neurologist is the one situation where the ten-year odyssey has a
  // short way out, and it is the question people are most likely to
  // assume has already been settled.
  if (diagnosis.confirmation !== 'genetic') {
    questions.push({
      id: 'confirm-diagnosis',
      prompt: '我这个诊断确定吗？要不要做基因检测？在哪做、大概多少钱、能不能报销？',
      hint:
        diagnosis.confirmation === 'self_reported'
          ? '本平台没有收到你的基因报告，所以本资料把诊断标为「本人填报」。如果你其实做过，把报告带上或上传，这一行就会改。'
          : '本平台没有任何诊断依据记录。这一问放在最前面，是因为后面所有问题的答案都取决于它。',
      source: '本页自拟的提问，不是检测建议',
    });
  }

  const unableSeries = functionTests.filter((series) => series.hasUnableEntries);
  if (unableSeries.length > 0) {
    questions.push({
      id: 'unable-tests',
      prompt: `这几项我最近做不了了：${unableSeries.map((series) => series.label).join('、')}。是病情本身的变化，还是有别的原因？`,
      hint: '「做不了」在本资料第二节是单独一种记录，不是漏填。带着日期问，医生更容易判断。',
      source: '本页自拟的提问；记录本身来自你自己标记的「今天做不了」',
    });
  }

  return [...questions, ...REFERRAL_QUESTION_PROMPTS];
};

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

/**
 * The paragraph at the top of the printed page.
 *
 * It is first, and it is not collapsible, because everything after it
 * is patient-supplied and a clinician who reads the tables without
 * reading this will over-trust them. This app has no way to verify a
 * single number below it.
 */
export const REFERRAL_PROVENANCE_NOTE =
  '本资料由患者本人在自助管理平台上生成，内容来自患者上传的报告与自行填写的记录，未经医疗机构核对，不是病历，也不构成诊断。凡写「本平台未能读出」或「本平台没有记录」的条目，都只说明本平台的记录状态，不能推断该项检查没有做过。';

const questionBlankLine = '　我的情况 / 想问的：______________________________________';

export const buildReferralPack = (
  profile: PatientProfileDTO,
  now: Date = new Date(),
): ReferralPackDTO => {
  const summary = buildClinicalPassportSummary(profile);
  const diagnosis = buildDiagnosis(summary);
  const functionTests = buildFunctionTestSeries(profile);
  const devices = buildDevices(profile);
  const monitoring = summary.monitoring.items.map(buildMonitoringSlot);
  const respiratory = buildRespiratory(profile, monitoring);
  const questions = buildQuestions(diagnosis, functionTests);

  const catalogue = REFERRAL_CATALOGUE_REF;

  const lines: string[] = [
    `# ${escapeMarkdown(summary.patientName)} 罕见病诊疗协作网转诊资料`,
    '',
    `- 病种：${catalogue.diseaseNameZh}（${catalogue.diseaseNameEn}，FSHD）`,
    `- 目录依据：${catalogue.catalogue}序号 ${catalogue.itemNumber}，${catalogue.documentNumber}（${catalogue.issuedOn}）`,
    `- 护照 ID：${summary.passportId}`,
    `- 生成时间：${formatDate(now.toISOString()) ?? ''}`,
    `- 平台内最近更新：${formatDate(summary.latestUpdatedAt) ?? '—'}`,
    '',
    `> ${REFERRAL_PROVENANCE_NOTE}`,
    '',
    '## 一、诊断依据',
    '',
    `- 结论：${escapeMarkdown(diagnosis.statement)}`,
    `- 基因类型：${escapeMarkdown(diagnosis.geneticType)}`,
    `- D4Z4 重复数：${escapeMarkdown(diagnosis.d4z4Repeats)}`,
    `- 甲基化：${escapeMarkdown(diagnosis.methylationValue)}`,
    `- 诊断日期：${escapeMarkdown(diagnosis.diagnosisDate)}`,
    `- 证据摘要：${escapeMarkdown(diagnosis.geneEvidence)}`,
    `- 最近一份诊断相关报告：${formatDate(diagnosis.latestSourceDate) ?? '本平台无记录'}`,
    '',
    '## 二、功能测试（按时间）',
    '',
  ];

  if (functionTests.length === 0) {
    lines.push('- 本平台没有功能测试记录 —— 不等于没有做过。', '');
  } else {
    for (const series of functionTests) {
      lines.push(`### ${escapeMarkdown(series.label)}`, '');
      for (const point of series.points) {
        lines.push(`- ${formatFunctionTestPoint(point)}`);
      }
      if (series.omittedEarlierCount > 0) {
        lines.push(`- （另有 ${series.omittedEarlierCount} 次更早的记录未列出）`);
      }
      lines.push('');
    }
  }

  lines.push('## 三、当前辅具与行走状态', '');
  lines.push(`- 行走状态：${escapeMarkdown(devices.ambulationLabel)}`);
  if (devices.ambulationCaveat) {
    lines.push(`  - ${escapeMarkdown(devices.ambulationCaveat)}`);
  }
  if (devices.state === 'listed') {
    lines.push(`- 辅具：${devices.devices.map((item) => escapeMarkdown(item)).join('、')}`);
  } else {
    lines.push('- 辅具：本平台无可列出的辅具');
  }
  lines.push(`  - ${escapeMarkdown(devices.note)}`);
  if (devices.startEvents.length > 0) {
    lines.push('- 患者记录过的起始事件：');
    for (const event of devices.startEvents) {
      const date = formatDate(event.occurredAt) ?? event.occurredAt;
      lines.push(
        `  - ${escapeMarkdown(event.label)}：${date}${event.description ? `（${escapeMarkdown(event.description)}）` : ''}`,
      );
    }
    lines.push('  - 起始事件记录的是某一天发生过的转变，不代表目前的使用情况，请当面确认。');
  }
  lines.push('');

  lines.push('## 四、呼吸支持', '');
  lines.push(`- 无创通气：${escapeMarkdown(respiratory.statement)}`);
  lines.push(
    `- 呼吸相关症状（患者自填）：${
      respiratory.breathingSymptomsRecorded === null
        ? '未填写'
        : respiratory.breathingSymptomsRecorded
          ? '有'
          : '无'
    }`,
  );
  lines.push(`- 最近肺功能：${escapeMarkdown(respiratory.pulmonary.statement)}`);
  lines.push('');

  lines.push('## 五、系统监测三项', '');
  for (const slot of monitoring) {
    lines.push(`- ${escapeMarkdown(slot.title)}：${escapeMarkdown(slot.statement)}`);
    if (slot.note) {
      // Carries whether the test is indicated at all. Dropped here, the
      // page would read as three tests everyone owes, which is how this
      // product once asked asymptomatic patients for echocardiograms.
      lines.push(`  - ${escapeMarkdown(slot.note)}`);
    }
  }
  lines.push('');

  lines.push('## 六、我想问的问题（就诊前请自行填写）', '');
  questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${escapeMarkdown(question.prompt)}`);
    lines.push(`　${escapeMarkdown(question.hint)}`);
    lines.push(questionBlankLine);
    lines.push('');
  });

  const safeName = summary.patientName.replace(/[^\p{L}\p{N}_-]+/gu, '_');

  return {
    generatedAt: now.toISOString(),
    documentTitle: `${summary.patientName} 罕见病诊疗协作网转诊资料`,
    fileName: `${safeName || 'patient'}-referral-pack.md`,
    contentType: 'text/markdown',
    patientName: summary.patientName,
    passportId: summary.passportId,
    latestUpdatedAt: summary.latestUpdatedAt,
    catalogue,
    diagnosis,
    functionTests,
    devices,
    respiratory,
    monitoring,
    questions,
    markdown: lines.join('\n'),
  };
};
