/**
 * 我的随访计划 — the AAN/AANEM 2015 surveillance table, evaluated
 * against one patient's own record.
 *
 * The source, for every clinical sentence below:
 *
 *  [AAN] Tawil R, Kissel JT, Heatwole C, Pandya S, Gronseth G,
 *        Benatar M. Evidence-based guideline summary: Evaluation,
 *        diagnosis, and management of facioscapulohumeral muscular
 *        dystrophy. Neurology. 2015;85(4):357-364.
 *        In the corpus at 01.疾病定义和科普 and 02.临床管理与治疗;
 *        the patient/family fact sheet of the same guideline carries
 *        the same table with 「Moderate」/「Weak」 in place of
 *        Level B / Level C.
 *
 * Why the levels are kept per row instead of flattened
 * ----------------------------------------------------
 * Level B and Level C are not two shades of the same advice. AAN's own
 * key: a moderate recommendation is one that 「in most circumstances,
 * most patients would want」 followed; a weak one is 「in some
 * circumstances, some patients」. A screen that renders 「做一次眼底
 * 检查」 (B) and 「可以考虑肩胛固定手术」 (C) in the same weight is
 * telling the patient something the guideline does not say, and the
 * one it flattens upward is elective surgery.
 *
 * Why the negative recommendations are rows and not omissions
 * -----------------------------------------------------------
 * Two of the guideline's recommendations are 「do not」: routine
 * cardiac screening is not essential in an asymptomatic patient
 * (Level C), and clinicians should not prescribe albuterol,
 * corticosteroid or diltiazem for improving strength (Level B). A
 * patient who is being offered one of those is the person who needs
 * the row. Leaving them out would make the page a to-do list of
 * tests to buy, which — in a population paying out of pocket for
 * every one of them — is the more expensive kind of wrong.
 *
 * What this file is NOT
 * ---------------------
 * It is not a plan, a prescription or a schedule the app hands down.
 * Every row ends at `ask`: a sentence the patient can say out loud to
 * a doctor. The product does not treat anyone, and an app that told
 * an FSHD patient to start a drug or skip a test would be doing
 * exactly what the guideline tells clinicians to do carefully, with
 * none of the examination.
 *
 * On 「对不上」 rows
 * ------------------
 * `not_matched` never means 「你不需要」. It means this platform holds
 * no record of the condition the guideline names — and the platform
 * only ever sees what the patient uploaded or typed. Every such row
 * says so in its own words, because a patient reading 「不适用」 about
 * their own scoliosis (which we never asked about) would be reading a
 * false statement about their body.
 */

import { buildAnesthesiaCard } from './anesthesia-card';
import { ageInYears } from './guardian-consent';
import { bucketForScore } from '../screens/p-data_entry/sleep-score';
import {
  readPassportValueOrigins,
  type ClinicalPassportSummary,
  type PassportValueOrigin,
  type PatientProfile,
} from './api';

/** AAN recommendation strength, kept as the guideline states it. */
export type SurveillanceLevel = 'B' | 'C';

/**
 * 'do'     — the guideline asks for something.
 * 'do_not' — the guideline asks for it NOT to be done routinely.
 */
export type SurveillancePolarity = 'do' | 'do_not';

/**
 * How the row relates to THIS patient's record.
 *
 *  everyone      — the guideline applies to every FSHD patient; no
 *                  branch to evaluate.
 *  matched       — a condition the guideline names is present in the
 *                  patient's own record here.
 *  not_matched   — the record we hold does not show that condition.
 *                  NOT the same as 「you don't need this」.
 *  unknown       — the guideline's condition is about something this
 *                  platform never collects, or collected unreadably.
 */
export type SurveillanceApplicability = 'everyone' | 'matched' | 'not_matched' | 'unknown';

export interface SurveillanceLink {
  label: string;
  href: string;
  /** Why the link is here, in one line. */
  hint: string;
}

export interface SurveillanceRow {
  id: string;
  title: string;
  level: SurveillanceLevel;
  polarity: SurveillancePolarity;
  /** The guideline's recommendation, in Chinese. */
  guideline: string;
  applicability: SurveillanceApplicability;
  /** 依据你的记录 — what in this patient's file produced the state
   *  above, named explicitly enough that they can check it. */
  evidence: string;
  /** The sentence to say to a doctor. Every row ends here. */
  ask: string;
  source: string;
  link?: SurveillanceLink;
}

export interface SurveillanceGroup {
  key: string;
  title: string;
  lede: string;
  rows: SurveillanceRow[];
}

export interface SurveillanceSchedule {
  groups: SurveillanceGroup[];
  /** Rows whose guideline condition is present in this patient's own
   *  record. Drives one line of copy, not a badge on the tab: a count
   *  of 0 must not read as「你没事」. */
  matchedCount: number;
  /** True when the pre-anesthesia row is quoting the anesthesia card
   *  rather than the local fallback.
   *
   *  Nothing renders this — it exists so the test can assert that the
   *  normal path is the quoting one. Without it, a rename inside
   *  anesthesia-card.ts would drop this page onto the fallback
   *  silently and every assertion about the row's text would still
   *  pass. The screen deliberately does not branch on it: the
   *  fallback sentence is correct guideline content, just thinner,
   *  and a patient does not need to be told which of two correct
   *  sentences they are reading. */
  anesthesiaLineLinked: boolean;
}

export const SURVEILLANCE_SOURCE = 'AAN/AANEM 2015 指南（Tawil 等, Neurology 2015;85:357-364）';

export const SURVEILLANCE_INTRO =
  '下面这些来自 AAN/AANEM 2015 年的 FSHD 指南 —— 一份对每条建议都标注了证据强度的 FSHD 管理指南。我们把它逐条对照了你在本平台的记录，标出哪些和你现在的情况对得上。\n\n这不是处方，也不是给你安排的检查计划。每一条的终点都是一句可以对医生说的话：做不做、什么时候做，是你和医生的事。';

export const SURVEILLANCE_COVERAGE_NOTE =
  '本页只看得到你上传或填写在本平台的内容。没有记录不等于没有发生 —— 指南里提到的脊柱侧弯、白天嗜睡、慢阻肺等情况，本平台从来没有采集过，所以永远不会自己「对上」。这些要你自己在门诊说出来。';

export const SURVEILLANCE_LEVEL_LEGEND: Array<{
  level: SurveillanceLevel;
  label: string;
  gloss: string;
}> = [
  {
    level: 'B',
    label: 'Level B · 中等推荐',
    // AAN's own key, translated rather than paraphrased.
    gloss: '「在多数情况下，多数患者会希望按这条来做。」',
  },
  {
    level: 'C',
    label: 'Level C · 弱推荐',
    gloss: '「在某些情况下，某些患者会希望按这条来做。」',
  },
];

export const SURVEILLANCE_DISCLAIMER =
  '本页是对一份公开指南的整理，不是诊疗意见，也不构成对你个人的医疗建议。指南写给医生，判断要由看过你本人的医生做出。本平台不提供治疗。';

/** Where the anesthesia card is generated today. */
export const ANESTHESIA_CARD_HREF = '/p-clinical_passport';

/**
 * The anesthesia card's own section title and line prefix.
 *
 * The pre-general-anesthesia pulmonary row does not restate the card's
 * clinical sentence — it reads it out of `buildAnesthesiaCard` at
 * build time, so the two artefacts cannot say different things about
 * the same test. These two constants are the only coupling, and
 * `surveillance-schedule.test.ts` asserts the lookup resolves against
 * a real summary: rename the card's section or reword the start of
 * that line and the test goes red rather than the screen silently
 * dropping to the fallback below.
 */
const ANESTHESIA_PREOP_SECTION_TITLE = '术前评估';
const ANESTHESIA_PULMONARY_PREFIX = '肺功能：';

/**
 * Used only if the lookup above fails. It is deliberately thinner than
 * the card's line — it states the guideline recommendation and
 * nothing else, so a drift can never make this file the source of a
 * prevalence figure the card no longer carries.
 */
const ANESTHESIA_PULMONARY_FALLBACK =
  '指南建议：平时没有定期查肺功能的 FSHD 患者，在需要全身麻醉的手术前先查一次 —— 这类检查可能查出没有任何自觉症状的呼吸功能下降。';

/**
 * Sleep / dyspnea records older than this stop counting as evidence
 * about how the patient is now. 180 days rather than 90: people here
 * log in bursts around clinic visits, and a six-month-old 「较差」 is
 * still worth raising, while a two-year-old one is a different person's
 * week. The date is printed either way so the patient can judge.
 */
const RECENT_WINDOW_DAYS = 180;

/**
 * The sleep score at or below which the daily form's own bands read
 * 「较差」 or 「很差」 (see screens/p-data_entry/sleep-score.ts). The
 * band label shown to the patient is taken from that module rather
 * than re-typed here — telling someone their sleep was 「一般」 on this
 * page when the form they filled said 「较差」 is the drift that module
 * exists to prevent.
 */
const SLEEP_CONCERN_MAX = 4;

/**
 * Whole years below which the yearly hearing screen applies.
 *
 * The guideline's own boundary is 「until these children start school」,
 * a date no app can know. 6 is 小学入学年龄 in mainland China, and the
 * API's passport uses the same number for the same recommendation
 * (profile.passport.ts). The row says out loud that the real boundary
 * is school entry, so a 6-year-old already in first grade is not told
 * something false.
 */
const SCHOOL_ENTRY_AGE = 7;

const hasValue = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.trim() !== '—';

/** YYYY-MM-DD, or null. Full year on purpose: 「05-14」 on a wheelchair
 *  event tells the patient nothing about whether it was this spring. */
const formatFullDate = (value: string | null | undefined): string | null => {
  if (!hasValue(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const daysBetween = (from: string, today: Date): number | null => {
  const then = new Date(from);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((today.getTime() - then.getTime()) / 86_400_000);
};

const isRecent = (value: string, today: Date): boolean => {
  const days = daysBetween(value, today);
  return days !== null && days >= 0 && days <= RECENT_WINDOW_DAYS;
};

const latestFollowupEvent = (profile: PatientProfile | null, eventType: string) => {
  if (!profile) return null;
  return (
    profile.followupEvents
      .filter((event) => event.eventType === eventType)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0] ??
    null
  );
};

const latestSymptomScore = (profile: PatientProfile | null, symptomKey: string) => {
  if (!profile) return null;
  return (
    profile.symptomScores
      .filter((item) => item.symptomKey === symptomKey && Number.isFinite(Number(item.score)))
      .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())[0] ??
    null
  );
};

/** Where a score sits on its own declared scale, 0–1. Records carry
 *  their scaleMin/scaleMax; assuming 0–10 would misread a clinic-side
 *  entry on a different scale in the direction of alarm. */
const normalizedScore = (item: {
  score: number;
  scaleMin: number;
  scaleMax: number;
}): number | null => {
  const span = item.scaleMax - item.scaleMin;
  if (!Number.isFinite(span) || span <= 0) return null;
  const ratio = (item.score - item.scaleMin) / span;
  if (!Number.isFinite(ratio)) return null;
  return Math.min(1, Math.max(0, ratio));
};

const monitoringItem = (summary: ClinicalPassportSummary, key: 'respiratory' | 'cardiac') =>
  summary.monitoring.items.find((item) => item.key === key) ?? null;

declare const REPORT_READ_REPEATS: unique symbol;

/**
 * A D4Z4 REPEAT COUNT THIS PLATFORM READ OFF AN UPLOADED REPORT.
 *
 * THE RULE THIS TYPE IS: a value that was not read out of an uploaded
 * report may be DISPLAYED, always with its origin beside it. It may
 * never decide a recommendation, a threshold, a guideline citation or a
 * screening interval.
 *
 * `summary.diagnosis.d4z4Repeats` is a merged value — the passport
 * resolves it from a report OR from the baseline, where an
 * administrator's transcription of a report read out over the phone
 * lands beside the patient's own typing. Both are `string`, so nothing
 * but a rule in someone's head kept the merged one out of the branch
 * that tells a patient to go pay for a dilated fundus exam, and the
 * rule did not hold. The brand is that rule expressed as a type:
 * `readReportReadRepeatCount` is the only expression that mints one and
 * it mints nothing unless the API's own `valueOrigins` says the value
 * came off a report.
 */
export interface ReportReadRepeatCount {
  /** The count as the report printed it — free text, not a number. */
  readonly raw: string;
  readonly [REPORT_READ_REPEATS]: true;
}

/**
 * The printed repeat count, but only when a report supplied it.
 *
 * Null covers every other way a number reaches this page —
 * an administrator's transcription, the patient's own typing, a value
 * the API cannot attribute, an API build old enough to send no
 * `valueOrigins` at all — and deliberately does not tell them apart,
 * because none of them may reach a guideline branch. The row's evidence
 * text is where they are told apart for the reader; this function only
 * answers 「may this decide anything」.
 */
export const readReportReadRepeatCount = (
  summary: ClinicalPassportSummary,
): ReportReadRepeatCount | null => {
  const origins = readPassportValueOrigins(summary.diagnosis.valueOrigins);
  if (origins?.d4z4Repeats.kind !== 'report') return null;
  const raw = (summary.diagnosis.d4z4Repeats ?? '').trim();
  if (!raw || raw === '—') return null;
  return { raw } as ReportReadRepeatCount;
};

/**
 * True only when the D4Z4 repeat count is unambiguously in the range
 * the guideline calls a large deletion.
 *
 * Ported from the API's `isLargeD4Z4Deletion`
 * (apps/api/src/modules/patient-profile/profile.passport.ts) because
 * the mobile bundle cannot import from the API package. Same rule,
 * same reasons, and the table in the test file is the same table:
 *
 *  - the guideline supplies both forms of the threshold in one
 *    sentence — 「contracted D4Z4 allele of 10–20 kb or 1–4 repeats」 —
 *    so nothing here converts kb to repeats on its own authority;
 *  - the input is OCR'd off a genetics report and arrives as free
 *    text (「3」,「3个」,「1-10」,「≤10」). A range or a comparison
 *    operator means the number is not known, and this gates a
 *    recommendation to go pay for an ophthalmology appointment, so
 *    anything short of a single plain integer is treated as unknown;
 *  - 0 repeats is not a viable FSHD1 allele. Reading one means the
 *    extraction is wrong, not that the deletion is enormous.
 *
 * The API's copy takes its own branded reading for the same reason this
 * one takes `ReportReadRepeatCount`. If either version's rule changes,
 * the other has to change with it — the two are checked against the
 * same cases but nothing in the build links them.
 */
export const isLargeD4Z4Deletion = (count: ReportReadRepeatCount | null): boolean => {
  const text = count?.raw.trim() ?? '';
  if (!text || text === '—') return false;
  if (/[<>≤≥~]|--|–|—|~|至|到/.test(text)) return false;
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length !== 1) return false;
  const repeats = Number(numbers[0]);
  return Number.isInteger(repeats) && repeats >= 1 && repeats <= 4;
};

/**
 * The 判断不了 sentence for a count this page is showing but did not get
 * off a report.
 *
 * ONE SENTENCE PER ORIGIN, because a single flat 「它不是本平台从基因报告
 * 里读出来的」 is false in the state that fires most. `indeterminate` is
 * the API's answer for 「the read-time OCR autofill copies a report's
 * value into an empty baseline field and leaves no record, so this
 * platform cannot tell that apart from the patient's own typing」 — a
 * state an FSHD2 methylation workup uploaded after the sizing report
 * produces on its own, because the passport only ever opens the newest
 * genetic report. Asserting the negative there contradicts the server's
 * own record of what it does not know.
 *
 * What IS true in every arm is the slot: this passport took the number
 * out of the archive rather than reading it off a report, which is what
 * `origins.d4z4Repeats.kind !== 'report'` says and all any of these
 * sentences claims.
 */
const unverifiedRepeatEvidence = (printed: string, origin: PassportValueOrigin | null): string => {
  const head = `你档案里的 D4Z4 重复数是 ${printed}`;
  // 「只读最新的一份」 is the passport's actual behaviour: its genetic
  // values all come out of one document, so a count printed on an
  // earlier report is not read at all. Naming that is what makes the
  // instruction actionable instead of 「上传报告」 to someone who has.
  const askDoctor =
    '这一条要不要做，请医生看着报告原件判断。本平台只读你上传的最新一份基因报告 —— 重复数写在别的报告上的话，把那一份重新上传一次，这一行就会跟着改。';
  switch (origin?.kind) {
    case 'admin_entered':
      return `${head}，它是本平台的管理员代你录进来的 —— 是谁、什么时候，护照的「字段来源」那一栏里有。这个数是从你的档案里取的，本平台没有打开基因报告读过它。${askDoctor}`;
    case 'admin_unreadable':
      // The marker exists and cannot be parsed. 「不是你自己填的」 is
      // the whole of what it proves — naming an author it does not name
      // is the direction this row exists to avoid.
      return `${head}，它不是你自己填的，但那条来源记录本平台读不出来，原因写在护照的「字段来源」里。这个数是从你的档案里取的，本平台没有打开基因报告读过它。${askDoctor}`;
    case 'patient':
      return `${head}，它填在你的档案里，而本平台手上没有任何一份能读出重复数的基因报告。这一条要不要做，请医生看着报告原件判断 —— 把写着重复数的基因报告上传上来，这一行就会跟着改。`;
    case 'indeterminate':
      return `${head}。本平台分不清它是你自己填的，还是系统从你上传的报告里读来的 —— 读取档案时系统会拿报告里的值补上空着的栏位，而且不留记录。所以这个数可能就是报告上写的那个，也可能不是。${askDoctor}`;
    default:
      // No `valueOrigins` on the wire: this app ships as a web export
      // that WeChat's in-app browser caches for days, so a handset can
      // be running today's bundle against an API build that sends none.
      // 「不是从报告里读出来的」 would be inventing the answer the server
      // did not give.
      return `${head}，但本平台这次没有拿到这个数的来源，所以说不出它是从报告里读出来的，还是填在档案里的。${askDoctor}`;
  }
};

/**
 * The drugs the guideline says not to prescribe for strength, with the
 * brand and Chinese names a patient would actually see on a box or a
 * 处方. Matched case-insensitively against the medication list.
 *
 * Deliberately narrow. A broad match on 「激素」 would flag every
 * inhaled steroid for asthma and turn a Level B recommendation about
 * FSHD strength into a warning about someone's unrelated treatment.
 */
const STRENGTH_DRUG_PATTERNS: Array<{ label: string; needles: string[] }> = [
  { label: '沙丁胺醇', needles: ['albuterol', 'salbutamol', '沙丁胺醇', '舒喘灵', '万托林'] },
  {
    label: '糖皮质激素',
    needles: [
      'prednisone',
      'prednisolone',
      'methylprednisolone',
      '泼尼松',
      '强的松',
      '甲泼尼龙',
      '美卓乐',
    ],
  },
  { label: '地尔硫䓬', needles: ['diltiazem', '地尔硫', '合心爽', '恬尔心'] },
];

const matchedStrengthDrugs = (profile: PatientProfile | null): string[] => {
  const names = (profile?.medications ?? [])
    .map((item) => (item.medicationName ?? '').toLowerCase())
    .filter((name) => name.length > 0);
  if (names.length === 0) return [];
  return STRENGTH_DRUG_PATTERNS.filter((drug) =>
    drug.needles.some((needle) => names.some((name) => name.includes(needle.toLowerCase()))),
  ).map((drug) => drug.label);
};

/** The card's own pre-op pulmonary sentence, or null if the card no
 *  longer has one under the shape this module knows. */
const readAnesthesiaPulmonaryLine = (
  summary: ClinicalPassportSummary,
  today: Date,
): string | null => {
  const card = buildAnesthesiaCard(summary, today);
  const section = card.sections.find((entry) => entry.title === ANESTHESIA_PREOP_SECTION_TITLE);
  return section?.lines.find((line) => line.startsWith(ANESTHESIA_PULMONARY_PREFIX)) ?? null;
};

const respiratoryEvidence = (summary: ClinicalPassportSummary): string => {
  const item = monitoringItem(summary, 'respiratory');
  const date = formatFullDate(item?.latestDate);
  if (item?.state === 'present' && hasValue(item.summary)) {
    return date
      ? `你的档案里有肺功能结果：${item.summary}（${date}）。`
      : `你的档案里有肺功能结果：${item.summary}。`;
  }
  if (item?.state === 'unreadable') {
    return date
      ? `你上传过肺功能报告（${date}），但系统没能自动读出数值。这一条对不对得上，要看报告原件。`
      : '你上传过肺功能报告，但系统没能自动读出数值。这一条对不对得上，要看报告原件。';
  }
  return '本平台还没有收到你的肺功能结果。这不代表你没做过 —— 只说明这里没有记录。';
};

const buildRespiratoryRows = (
  summary: ClinicalPassportSummary,
  profile: PatientProfile | null,
  today: Date,
): { rows: SurveillanceRow[]; anesthesiaLineLinked: boolean } => {
  const respiratory = monitoringItem(summary, 'respiratory');
  const hasReadableRespiratory = respiratory?.state === 'present' && hasValue(respiratory.summary);

  const baseline: SurveillanceRow = {
    id: 'pulmonary_baseline',
    title: '做一次肺功能基线',
    level: 'B',
    polarity: 'do',
    guideline:
      '指南建议为每一位 FSHD 患者做一次肺功能基线（FVC / FEV1）。理由是：FSHD 的呼吸肌受累不算常见，但出现时往往没有典型的气短 —— 早期只在睡眠中表现为通气不足，白天什么感觉都没有，只有肺功能查得出来。',
    applicability: 'everyone',
    evidence: respiratoryEvidence(summary),
    ask: '可以问：「我做过肺功能基线吗？如果做过，结果现在还算数吗？」',
    source: SURVEILLANCE_SOURCE,
  };

  const wheelchair = latestFollowupEvent(profile, 'started_wheelchair');
  const wheelchairDate = formatFullDate(wheelchair?.occurredAt);
  const repeat: SurveillanceRow = {
    id: 'pulmonary_repeat',
    title: '肺功能要不要定期复查',
    level: 'B',
    polarity: 'do',
    guideline:
      '指南没有让所有人定期复查肺功能。需要定期复查的是这几种情况：基线结果异常，或者合并明显的近端肌无力、脊柱后凸侧弯、轮椅依赖，以及其他会影响通气的疾病（例如慢阻肺、心脏病）。',
    applicability: wheelchair ? 'matched' : 'unknown',
    evidence: wheelchair
      ? `你在随访里记录了「开始使用轮椅」${wheelchairDate ? `（${wheelchairDate}）` : ''}。轮椅依赖是指南列出的复查条件之一 —— 但你的用法是不是指南说的「依赖」，要医生看过才算。`
      : '这一条本平台判断不了：基线是否异常由医生读片子和数值，脊柱侧弯、慢阻肺这些本平台从来没有采集过，你的记录里也没有轮椅相关的随访事件。也就是说，这一栏的「对不上」只代表这里没有数据。',
    ask: '可以问：「按我现在的情况，肺功能需要多久查一次？还是查过这一次就够了？」',
    source: SURVEILLANCE_SOURCE,
  };

  const niv = latestFollowupEvent(profile, 'started_niv');
  const nivDate = formatFullDate(niv?.occurredAt);
  const sleep = latestSymptomScore(profile, 'sleep_quality');
  const sleepDate = formatFullDate(sleep?.recordedAt);
  const sleepIsRecent = sleep ? isRecent(sleep.recordedAt, today) : false;
  const sleepIsPoor = sleep ? Number(sleep.score) <= SLEEP_CONCERN_MAX : false;
  const dyspnea = latestSymptomScore(profile, 'dyspnea');
  const dyspneaRatio = dyspnea ? normalizedScore(dyspnea) : null;
  const dyspneaDate = formatFullDate(dyspnea?.recordedAt);
  const dyspneaIsHigh =
    dyspnea !== null &&
    dyspneaRatio !== null &&
    dyspneaRatio >= 0.5 &&
    isRecent(dyspnea.recordedAt, today);

  const sleepEvidence = (() => {
    if (niv) {
      return `你记录过「开始无创通气」${nivDate ? `（${nivDate}）` : ''}。对你来说这一条已经不是要不要转诊，而是随访：参数合不合适、戴得住戴不住、白天有没有变精神，需要有人定期看。`;
    }
    const parts: string[] = [];
    if (sleep && sleepIsPoor && sleepIsRecent) {
      const band = bucketForScore(Number(sleep.score)).label;
      parts.push(
        `你最近一次睡眠评分是 ${sleep.score}/10（${sleepDate ?? '日期不详'}），在日常记录里属于「${band}」。`,
      );
    }
    if (dyspneaIsHigh && dyspnea) {
      parts.push(
        `你最近一次气短评分是 ${dyspnea.score}/${dyspnea.scaleMax}（${dyspneaDate ?? '日期不详'}）。`,
      );
    }
    if (parts.length > 0) {
      parts.push(
        '睡不好和气短都有很多种原因，夜间通气不足只是其中一种，而且不是最常见的一种。把它作为一个需要排除的可能提出来就够了。',
      );
      return parts.join('');
    }
    if (sleep && sleepIsPoor && !sleepIsRecent) {
      return `你有过偏低的睡眠评分（${sleep.score}/10，${sleepDate ?? '日期不详'}），但那已经是半年以前的记录了，不能代表你现在的情况。`;
    }
    if (sleep) {
      return `你最近一次睡眠评分是 ${sleep.score}/10（${sleepDate ?? '日期不详'}），不在偏低的区间。本平台没有你的 FVC 百分比，所以指南的另一半条件这里判断不了。`;
    }
    return '本平台没有你的睡眠评分，也没有 FVC 百分比，这一条判断不了。白天特别困、早上起来头痛、夜里反复醒 —— 这些只有你自己知道，出现了就值得说。';
  })();

  const sleepReferral: SurveillanceRow = {
    id: 'sleep_referral',
    title: '睡不好、白天困，问一次夜间通气',
    level: 'B',
    polarity: 'do',
    guideline:
      '指南建议：如果肺功能明显偏低（例如 FVC 低于 60%），或者出现白天过度嗜睡、睡了也不解乏（夜里频繁醒、早上头痛），应当转呼吸科或睡眠医学科，评估要不要做夜间睡眠监测、要不要用夜间无创通气。指南写明：早期开始无创通气可以改善生存和生活质量。',
    applicability: niv || (sleepIsPoor && sleepIsRecent) || dyspneaIsHigh ? 'matched' : 'unknown',
    evidence: sleepEvidence,
    ask: niv
      ? '可以问：「我现在的无创通气参数还合适吗？需要复查睡眠监测吗？」'
      : '可以问：「我这样的睡不好，需要做一次夜间血氧或睡眠监测吗？」',
    source: SURVEILLANCE_SOURCE,
  };

  const anesthesiaLine = readAnesthesiaPulmonaryLine(summary, today);
  const preop: SurveillanceRow = {
    id: 'preop_pulmonary',
    title: '全身麻醉前先查一次肺功能',
    level: 'B',
    polarity: 'do',
    // Quoted from the anesthesia card, not restated. See
    // readAnesthesiaPulmonaryLine.
    guideline: anesthesiaLine ?? ANESTHESIA_PULMONARY_FALLBACK,
    // 'everyone', not a matched/not_matched pair.
    //
    // A pre-op pulmonary function test is recommended for every FSHD
    // patient facing general anesthesia — it is not conditional on
    // anything in their record. Scoring it as 'matched' when nothing was
    // on file made a brand-new, entirely empty profile render 「其中 1
    // 条和你记录里的情况直接对得上」, which is what `matched` means
    // (「a condition the guideline names is present in the patient's
    // own record」) and which was not true of anything. And the
    // inverse was no better: a patient WITH a reading was told
    //「按你的记录不适用」 directly above evidence text explaining that
    // an old reading usually has to be repeated.
    //
    // Whether the existing reading is recent enough is the
    // anesthetist's call, not this screen's. The row says the same
    // thing to everyone and the evidence line carries the nuance.
    applicability: 'everyone',
    evidence: hasReadableRespiratory
      ? `${respiratoryEvidence(summary)}如果这次结果的时间离手术不远，医生可能直接用它；隔得久了通常要重新查一次。`
      : `${respiratoryEvidence(summary)}如果近期要做手术或者无痛胃肠镜，这就是需要先安排的那一项。`,
    ask: '可以问：「这次手术前，我需要先做肺功能吗？」',
    source: SURVEILLANCE_SOURCE,
    link: {
      label: '打开麻醉注意事项卡',
      href: ANESTHESIA_CARD_HREF,
      hint: '在临床护照里生成，是给麻醉医师看的那一张。上面这句话就来自那张卡，两边不会说成两个版本。',
    },
  };

  return {
    rows: [baseline, repeat, sleepReferral, preop],
    anesthesiaLineLinked: anesthesiaLine !== null,
  };
};

const buildCardiacRow = (summary: ClinicalPassportSummary): SurveillanceRow => {
  const cardiac = monitoringItem(summary, 'cardiac');
  const date = formatFullDate(cardiac?.latestDate);
  const evidence = (() => {
    if (cardiac?.state === 'present' && hasValue(cardiac.summary)) {
      return `你的档案里有心脏检查结果：${cardiac.summary}（${date ?? '日期不详'}）。做过一次不等于每年都要再做一次 —— 按指南，复查的理由应该是症状，不是日历。`;
    }
    if (cardiac?.state === 'unreadable') {
      return '你上传过心脏检查报告，但系统没能自动读出数值。这一条不需要你补数据 —— 它本来就不是一个要定期做的检查。';
    }
    return '本平台没有你的心脏检查记录。按这一条，没有症状时这不是缺口。';
  })();

  return {
    id: 'cardiac_routine',
    title: '不需要常规查心脏 —— 有症状时例外',
    level: 'C',
    polarity: 'do_not',
    // Verbatim from the API's cardiac monitoring note when it is
    // present: that sentence was written against the primary sources
    // (Level C plus the AANA 2025 preoperative exception) and the
    // clinical passport already shows it. Two screens in one app
    // giving different answers about whether to buy an echocardiogram
    // is the failure this avoids. The fallback below is the same
    // recommendation with the surgical clause kept, because dropping
    // it would leave a sentence a patient could hand to a pre-op
    // clinic as grounds to skip the ECG.
    guideline:
      cardiac?.note ??
      '没有症状的 FSHD 患者不需要常规做心电图或心脏超声 —— 这一点和 DMD 等其他肌营养不良不同。两种情况例外：出现胸痛、心悸或不寻常的气短时应该去做心脏评估；以及手术前 —— FSHD 的术前评估应当包括心电图和心脏超声。',
    applicability: 'everyone',
    evidence,
    ask: '可以问：「我没有心悸和胸痛，还需要每年查心脏吗？」',
    source: `${SURVEILLANCE_SOURCE}；术前部分见 Mani 等, AANA Journal 2025 年 10 月`,
  };
};

const buildEyeAndEarRows = (
  summary: ClinicalPassportSummary,
  profile: PatientProfile | null,
  today: Date,
): SurveillanceRow[] => {
  /**
   * A REPORT'S REPEAT COUNT, OR NOTHING.
   *
   * This row decides whether a guideline about vision loss applies, so
   * its input is `ReportReadRepeatCount` — a value the merged
   * `summary.diagnosis.d4z4Repeats` cannot be assigned to. 「你的基因
   * 报告里 D4Z4 重复数是 6」 would be a sentence about a report nobody
   * here has opened. A transcribed number sends this to the 判断不了
   * branch, which asks for the original — the same answer a range gets,
   * and for the same reason.
   */
  // Read here for the wording only. `readReportReadRepeatCount` reads it
  // again rather than being handed this: what may decide a
  // recommendation must not depend on a caller having checked the
  // origin correctly, and the two reads are of the same bytes by the
  // same pure parser.
  const origins = readPassportValueOrigins(summary.diagnosis.valueOrigins);
  const reportCount = readReportReadRepeatCount(summary);
  const reportRaw = reportCount?.raw ?? '';
  const isLarge = isLargeD4Z4Deletion(reportCount);
  const hasPlainCount = /^\d+$/.test(reportRaw);
  /** The printed number, when the page is showing one that no report
   *  supplied — so the 判断不了 sentence can say which state it is in
   *  rather than claiming the platform has nothing. */
  const printedRepeats = (summary.diagnosis.d4z4Repeats ?? '').trim();
  const showsUnverifiedRepeats =
    !reportCount &&
    printedRepeats !== '' &&
    printedRepeats !== '—' &&
    origins?.d4z4Repeats.kind !== 'absent';

  const retina: SurveillanceRow = {
    id: 'retinal_screening',
    title: '大片段缺失：问一次散瞳眼底检查',
    level: 'B',
    polarity: 'do',
    guideline:
      '指南建议：D4Z4 大片段缺失（缺失后片段 10–20 kb，约 1–4 个重复）的患者，转有经验的眼科医生（最好是视网膜专科）做一次散瞳间接检眼镜。渗出性视网膜病变（Coats 病）在 FSHD 里很少见，但几乎只出现在这一组人身上；不处理可能造成明显的视力损失，早发现能挡住。之后多久复查一次，由第一次的结果决定。',
    applicability: isLarge ? 'matched' : hasPlainCount ? 'not_matched' : 'unknown',
    evidence: isLarge
      ? `你的基因报告里 D4Z4 重复数是 ${reportRaw}，落在指南说的大片段缺失范围（1–4）内。这不是急事，但值得在下次就诊时主动提出来。`
      : hasPlainCount
        ? `你的基因报告里 D4Z4 重复数是 ${reportRaw}，不在指南说的大片段缺失范围（1–4）内。眼底检查这一条按指南对你不适用 —— 但如果出现视力变化，那是另一回事，该查还是要查。`
        : showsUnverifiedRepeats
          ? unverifiedRepeatEvidence(printedRepeats, origins?.d4z4Repeats ?? null)
          : '本平台读不出你的 D4Z4 重复数：可能是还没上传基因报告，或者报告上写的是一个范围（例如「1-10」）而不是一个确定的数字。范围我们不猜 —— 这一条要不要做，请医生看着报告原件判断。',
    ask: '可以问：「按我的基因结果，需要做一次散瞳眼底检查吗？」',
    source: SURVEILLANCE_SOURCE,
  };

  // The date of birth is already on file and already governs the PIPL
  // Art. 31 guardian-consent gate at registration; `ageInYears` is
  // that same tested calculation rather than a second one. Taking the
  // leading YYYY-MM-DD covers a server that ever starts sending a
  // timestamp — today it sends a plain date (profile.service's
  // toDateString).
  const rawDob = (profile?.dateOfBirth ?? '').trim();
  const dobMatch = /^(\d{4}-\d{2}-\d{2})/.exec(rawDob);
  const age = dobMatch ? ageInYears(dobMatch[1], today) : null;
  const isYoungChild = age !== null && age >= 0 && age < SCHOOL_ENTRY_AGE;

  const hearing: SurveillanceRow = {
    id: 'hearing_child',
    title: '学龄前儿童：每年一次听力筛查',
    level: 'B',
    polarity: 'do',
    guideline:
      '指南建议：确诊 FSHD 的幼儿，在确诊时以及之后每年做一次听力筛查，直到上学。理由写得很直接 —— 听力损失在确诊时不一定已经出现，而且可能是进行性的；成人和大孩子自己察觉得到，婴幼儿察觉不到，这个年龄漏掉的听力损失会明显影响语言发育。',
    applicability: isYoungChild ? 'matched' : age !== null ? 'not_matched' : 'unknown',
    evidence: isYoungChild
      ? `按档案里的出生日期，患者今年 ${age} 岁，在这一条覆盖的年龄段里。指南的界线是「直到上学」，本平台按 ${SCHOOL_ENTRY_AGE} 周岁估算 —— 已经上学的话，以实际入学时间为准。`
      : age !== null
        ? `按档案里的出生日期，患者今年 ${age} 岁，这一条是给学龄前幼儿的。如果家里有确诊 FSHD 的小孩，这一条对他们适用。`
        : '档案里没有可用的出生日期，年龄这一条判断不了。如果家里有确诊 FSHD 的学龄前孩子，这一条对他们适用。',
    ask: '可以问：「孩子需要每年做听力筛查吗？该去耳鼻喉科还是听力中心？」',
    source: SURVEILLANCE_SOURCE,
  };

  return [retina, hearing];
};

const buildPainRow = (profile: PatientProfile | null, today: Date): SurveillanceRow => {
  const pain = latestSymptomScore(profile, 'pain');
  const ratio = pain ? normalizedScore(pain) : null;
  const painDate = formatFullDate(pain?.recordedAt);
  const painIsNotable =
    pain !== null && ratio !== null && ratio >= 0.4 && isRecent(pain.recordedAt, today);

  return {
    id: 'pain_management',
    title: '疼痛：该被主动问起的一项',
    level: 'B',
    polarity: 'do',
    guideline:
      '指南要求医生定期主动询问 FSHD 患者的疼痛，而不是等患者开口。FSHD 的疼痛多是肌肉骨骼来源 —— 关节位置不正，长期拉扯肌肉和肌腱。指南把康复/物理治疗评估列为第一步的非药物处理；疼痛持续且没有禁忌时，急性痛可以试非甾体抗炎药，慢性肌肉骨骼痛可以用抗抑郁药或抗癫痫药。这些药名是写给医生看的，不是可以自己去买的清单。',
    applicability: painIsNotable ? 'matched' : 'everyone',
    evidence: painIsNotable
      ? `你最近一次疼痛评分是 ${pain.score}/${pain.scaleMax}（${painDate ?? '日期不详'}）。把这个数字和「哪个部位、什么动作会疼」一起说，比只说「疼」更容易找到原因。`
      : pain
        ? `你最近一次疼痛评分是 ${pain.score}/${pain.scaleMax}（${painDate ?? '日期不详'}）。`
        : '本平台没有你的疼痛记录。这一条本来就是写给医生的：该主动问的是他们。',
    ask: '可以问：「我这个疼是从哪来的？需要先看康复科吗？」',
    source: SURVEILLANCE_SOURCE,
  };
};

const buildMedicationRow = (profile: PatientProfile | null): SurveillanceRow => {
  const matched = matchedStrengthDrugs(profile);
  return {
    id: 'no_strength_drugs',
    title: '不要为了「增肌力」吃这三类药',
    level: 'B',
    polarity: 'do_not',
    guideline:
      '指南写得很明确：医生不应当为了改善肌力而给 FSHD 患者开沙丁胺醇（albuterol）、糖皮质激素或地尔硫䓬。沙丁胺醇的随机对照试验是阴性结果，糖皮质激素和地尔硫䓬的开放标签试验都没看到获益。到目前为止，没有任何药物被证明能延缓、停止或逆转 FSHD 的肌无力，FDA 也没有批准过这样的药。',
    applicability: matched.length > 0 ? 'matched' : 'everyone',
    evidence:
      matched.length > 0
        ? `你的用药记录里出现了${matched.join('、')}。如果这是为了改善肌力开的，值得再和医生确认一次；如果是为了别的病（比如哮喘、高血压），那不在这一条的范围里 —— 请不要自己停药。`
        : '你的用药记录里没有这三类药。这一条放在这里，是因为它可能会被推荐给你 —— 到时候你知道指南是怎么说的。',
    ask: '可以问：「这个药是为了什么开的？如果是为了肌力，还有必要继续吗？」',
    source: SURVEILLANCE_SOURCE,
  };
};

const buildExerciseAndSurgeryRows = (): SurveillanceRow[] => [
  {
    id: 'aerobic_exercise',
    title: '低强度有氧运动',
    level: 'C',
    polarity: 'do',
    guideline:
      '指南说医生「可以鼓励」FSHD 患者做低强度有氧运动，方案最好由有经验的物理治疗师来定。这是 Level C —— 弱推荐，意味着证据有限，适合一部分人而不是所有人。',
    applicability: 'everyone',
    evidence: '这一条不依赖你的记录：它是一个可以和康复科讨论的选项，不是一个需要打勾的检查。',
    ask: '可以问：「以我现在的肌力，什么强度的有氧运动是安全的？」',
    source: SURVEILLANCE_SOURCE,
  },
  {
    id: 'strength_training',
    title: '想做力量训练，先找物理治疗师',
    level: 'C',
    polarity: 'do',
    guideline:
      '指南建议：想做力量训练的患者，由物理治疗师制定安全方案 —— 低到中等的重量和阻力，并考虑本人的实际限制（Level C）。同一份指南也写明：中等强度的证据显示，力量训练大概不会明显提高肌力。也就是说，做它的理由是活动度、日常功能和心肺，不是「练回来」。',
    applicability: 'everyone',
    evidence: '这一条不依赖你的记录。把它当成一个需要专业人陪着开始的选项。',
    ask: '可以问：「我可以练力量吗？哪些动作是要避开的？」',
    source: SURVEILLANCE_SOURCE,
  },
  {
    id: 'scapular_fixation',
    title: '肩胛固定手术：可以谈，但要算清楚',
    level: 'C',
    polarity: 'do',
    guideline:
      '指南说医生「可以考虑」为部分患者做肩胛固定手术，但要先充分权衡：上肢肌肉本身的情况、能换回多少活动范围、病情进展的速度，以及手术效果不理想和术后长期支具固定的可能（Level C）。',
    applicability: 'everyone',
    evidence:
      '这一条不依赖你的记录。如果抬手已经明显影响到穿衣、取物这些每天要做的事，它就值得被放到桌面上谈一次。',
    ask: '可以问：「我适合做肩胛固定吗？大概能换回什么，代价是什么？」',
    source: SURVEILLANCE_SOURCE,
  },
];

/**
 * Build the whole page's content for one patient.
 *
 * Pure: same summary, profile and clock produce the same rows. The
 * clock is injected rather than read from `new Date()` inside so the
 * age and recency branches are testable at a fixed date.
 */
export const buildSurveillanceSchedule = (
  summary: ClinicalPassportSummary,
  profile: PatientProfile | null,
  today: Date,
): SurveillanceSchedule => {
  const respiratory = buildRespiratoryRows(summary, profile, today);

  const groups: SurveillanceGroup[] = [
    {
      key: 'respiratory',
      title: '呼吸',
      lede: '指南在这一块给的条目最多。原因写在指南里：神经肌肉病造成的呼吸功能下降常常没有典型的气短，早期可能只在睡眠中表现出来。',
      rows: respiratory.rows,
    },
    {
      key: 'cardiac',
      title: '心脏',
      lede: '这一条的重点是「不需要做什么」。FSHD 和 DMD 在这件事上的答案不一样。',
      rows: [buildCardiacRow(summary)],
    },
    {
      key: 'eye_ear',
      title: '眼睛与听力',
      lede: '两条都只针对特定人群：基因是大片段缺失的人，和还没上学的孩子。',
      rows: buildEyeAndEarRows(summary, profile, today),
    },
    {
      key: 'pain',
      title: '疼痛',
      lede: '疼痛在 FSHD 里很常见，也最容易在门诊被漏掉 —— 指南把「主动问」写成了医生的责任。',
      rows: [buildPainRow(profile, today)],
    },
    {
      key: 'medication',
      title: '用药',
      lede: '指南里唯一一条明确的「不要开」。',
      rows: [buildMedicationRow(profile)],
    },
    {
      key: 'exercise_surgery',
      title: '运动与手术',
      lede: '这一组都是 Level C：可以谈的选项，不是应该做的事。',
      rows: buildExerciseAndSurgeryRows(),
    },
  ];

  const matchedCount = groups
    .flatMap((group) => group.rows)
    .filter((row) => row.applicability === 'matched').length;

  return {
    groups,
    matchedCount,
    anesthesiaLineLinked: respiratory.anesthesiaLineLinked,
  };
};
