import type { PatientProfile } from './api';

/**
 * Rule engine for the「我的数据资产」overview card on the archive
 * screen — the piece that makes the state of a patient's data asset
 * visible at a glance: how complete it is, whether reports are
 * current, whether daily records are continuous, and whether the
 * basics have gone stale.
 *
 * Shares its gap rules with the home screen's guidance cards
 * (guidance-cards.ts imports collectProfileGaps) so「首页说你缺什么」
 * and「档案页说你缺什么」can never disagree. Pure functions over the
 * profile the archive screen already fetches; no extra requests.
 */

export interface ProfileGap {
  key: string;
  /** Short chip label, e.g.「出生日期」. */
  label: string;
  /** Where one tap takes the user to fill this gap. */
  route: '/p-register_profile' | '/p-data_entry';
  /** Basic demographics (shown by the home guidance card) vs the
   *  broader asset checklist (archive overview only). */
  kind: 'basic' | 'asset';
}

export type AssetTone = 'ok' | 'warn';

export interface AssetSignal {
  label: string;
  tone: AssetTone;
}

export interface DataAssetOverview {
  /** 0-100, share of the checklist that is filled. */
  completenessPercent: number;
  /** Unfilled checklist items, in fixed checklist order. */
  gaps: ProfileGap[];
  /** Report recency — is there a report in the last 6 months? */
  coverage: AssetSignal;
  /** Record continuity — how many of the last 8 weeks have records? */
  continuity: AssetSignal;
  /** Basics freshness — has the profile been updated in 12 months? */
  freshness: AssetSignal;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const CONTINUITY_WINDOW_WEEKS = 8;
const COVERAGE_WINDOW_DAYS = 183; // ~6 months
const FRESHNESS_LIMIT_DAYS = 365;

const parseTime = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

export const daysSince = (iso: string | null | undefined, now: number): number | null => {
  const t = parseTime(iso);
  return t === null ? null : Math.floor((now - t) / DAY_MS);
};

/**
 * The completeness checklist — single source for both the gap list
 * and the percent denominator, so adding an item can never silently
 * skew the math. `basic` items mirror what the home guidance card
 * nags about; `asset` items only appear on the archive overview.
 */
const CHECKLIST: Array<
  Omit<ProfileGap, 'key'> & { key: string; isFilled: (profile: PatientProfile) => boolean }
> = [
  {
    key: 'dateOfBirth',
    label: '出生日期',
    route: '/p-register_profile',
    kind: 'basic',
    isFilled: (profile) => Boolean(profile.dateOfBirth),
  },
  {
    key: 'gender',
    label: '性别',
    route: '/p-register_profile',
    kind: 'basic',
    isFilled: (profile) => Boolean(profile.gender),
  },
  {
    key: 'region',
    label: '所在地区',
    route: '/p-register_profile',
    kind: 'basic',
    isFilled: (profile) => Boolean(profile.regionProvince),
  },
  {
    key: 'diagnosis',
    label: '诊断信息',
    route: '/p-register_profile',
    kind: 'asset',
    isFilled: (profile) =>
      Boolean(profile.diagnosisDate) ||
      Boolean(profile.baseline?.diseaseBackground?.diagnosisType) ||
      Boolean(profile.baseline?.foundation?.diagnosisYear),
  },
  {
    key: 'genetics',
    label: '基因检测信息',
    route: '/p-register_profile',
    kind: 'asset',
    isFilled: (profile) =>
      Boolean(profile.geneticMutation) || Boolean(profile.baseline?.diseaseBackground?.d4z4),
  },
  {
    key: 'firstReport',
    label: '第一份检查报告',
    route: '/p-data_entry',
    kind: 'asset',
    isFilled: (profile) => profile.documents.length > 0,
  },
  {
    key: 'firstRecord',
    label: '第一条日常记录',
    route: '/p-data_entry',
    kind: 'asset',
    isFilled: (profile) => profile.functionTests.length > 0,
  },
];

export const collectProfileGaps = (profile: PatientProfile): ProfileGap[] =>
  CHECKLIST.filter((item) => !item.isFilled(profile)).map(({ key, label, route, kind }) => ({
    key,
    label,
    route,
    kind,
  }));

const buildCoverage = (profile: PatientProfile, now: number): AssetSignal => {
  const uploadTimes = profile.documents
    .map((doc) => parseTime(doc.uploadedAt))
    .filter((t): t is number => t !== null);
  if (uploadTimes.length === 0) {
    return { label: '还没有检查报告，拍一份即可开始积累', tone: 'warn' };
  }
  const latest = Math.max(...uploadTimes);
  const ageDays = Math.floor((now - latest) / DAY_MS);
  if (ageDays <= COVERAGE_WINDOW_DAYS) {
    return { label: `共 ${uploadTimes.length} 份报告，最近 6 个月内有更新`, tone: 'ok' };
  }
  const months = Math.floor(ageDays / 30);
  return {
    label: `共 ${uploadTimes.length} 份报告，最近一份已是 ${months} 个月前`,
    tone: 'warn',
  };
};

const buildContinuity = (profile: PatientProfile, now: number): AssetSignal => {
  const recordTimes = [
    ...profile.functionTests.map((t) => t.performedAt),
    ...profile.activityLogs.map((l) => l.logDate),
    ...profile.followupEvents.map((e) => e.occurredAt),
  ]
    .map(parseTime)
    .filter((t): t is number => t !== null);
  if (recordTimes.length === 0) {
    return { label: '还没有日常记录，30 秒即可记第一条', tone: 'warn' };
  }
  const windowStart = now - CONTINUITY_WINDOW_WEEKS * WEEK_MS;
  const weeksWithRecords = new Set(
    recordTimes
      .filter((t) => t >= windowStart && t <= now)
      .map((t) => Math.floor((now - t) / WEEK_MS)),
  ).size;
  if (weeksWithRecords === 0) {
    return { label: `近 ${CONTINUITY_WINDOW_WEEKS} 周没有记录，趋势正在断档`, tone: 'warn' };
  }
  return {
    label: `近 ${CONTINUITY_WINDOW_WEEKS} 周中有 ${weeksWithRecords} 周有记录`,
    tone: weeksWithRecords >= CONTINUITY_WINDOW_WEEKS / 2 ? 'ok' : 'warn',
  };
};

const buildFreshness = (profile: PatientProfile, now: number): AssetSignal => {
  const age = daysSince(profile.updatedAt, now);
  if (age === null) {
    return { label: '基础健康信息更新时间未知', tone: 'warn' };
  }
  if (age > FRESHNESS_LIMIT_DAYS) {
    const months = Math.floor(age / 30);
    return {
      label: `基础健康信息已 ${months} 个月未更新，行走能力可能有变化`,
      tone: 'warn',
    };
  }
  return { label: '基础健康信息在一年内更新过', tone: 'ok' };
};

export const buildDataAssetOverview = (
  profile: PatientProfile,
  now: number = Date.now(),
): DataAssetOverview => {
  const gaps = collectProfileGaps(profile);
  const completenessPercent = Math.round(
    ((CHECKLIST.length - gaps.length) / CHECKLIST.length) * 100,
  );
  return {
    completenessPercent,
    gaps,
    coverage: buildCoverage(profile, now),
    continuity: buildContinuity(profile, now),
    freshness: buildFreshness(profile, now),
  };
};
