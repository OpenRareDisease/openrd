import type { PatientProfile } from './api';

/**
 * Rule engine for the home screen's guidance cards — the piece that
 * turns the home screen from a static function directory into "what
 * should I do today". Pure function over data the home screen already
 * fetches (profile + its embedded documents/tests); no extra
 * requests.
 *
 * Cards are ordered by usefulness and capped at MAX_CARDS so the
 * panel guides instead of nagging. Every card carries a route so the
 * suggested action is one tap away.
 */
export interface GuidanceCard {
  key: string;
  icon: string;
  title: string;
  description: string;
  /** Route the card's tap navigates to. Kept as a literal union so a
   *  typo'd route is a compile error, not a runtime 404. */
  route: '/p-data_entry' | '/p-register_profile' | '/p-report_detail';
  /** Optional param bag for the route (e.g. documentId). */
  params?: Record<string, string>;
}

const MAX_CARDS = 2;
const STALE_FOLLOWUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const daysSince = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY_MS);
};

export const buildGuidanceCards = (
  profile: PatientProfile | null,
  now: number = Date.now(),
): GuidanceCard[] => {
  if (!profile) {
    return [
      {
        key: 'first-steps',
        icon: 'seedling',
        title: '从第一步开始',
        description: '拍一份检查报告，或用 30 秒记录今天的状态 —— 数据会立刻开始为你工作。',
        route: '/p-data_entry',
      },
    ];
  }

  const cards: GuidanceCard[] = [];

  // 1) Reports that finished recognizing but have no AI interpretation
  //    yet — the highest-value pending payoff.
  const uninterpreted = profile.documents.filter(
    (doc) =>
      (doc.status === 'parsed' || doc.status === 'needs_review') &&
      typeof doc.ocrPayload?.fields?.aiSummary !== 'string',
  );
  if (uninterpreted.length > 0) {
    cards.push({
      key: 'interpret-report',
      icon: 'wand-magic-sparkles',
      title: `有 ${uninterpreted.length} 份报告可以解读`,
      description: '识别已完成，点开即可查看 AI 通俗解读。',
      route: '/p-report_detail',
      params: { documentId: uninterpreted[0].id },
    });
  }

  // 2) Followup freshness: nudge when the latest record is stale (or
  //    absent entirely).
  const latestTest = profile.functionTests
    .map((t) => t.performedAt)
    .sort()
    .at(-1);
  const staleDays = daysSince(latestTest ?? null, now);
  if (staleDays === null) {
    cards.push({
      key: 'first-followup',
      icon: 'bolt',
      title: '记录第一条日常状态',
      description: '30 秒记下上楼用时和睡眠，之后每次都能看到自己的变化。',
      route: '/p-data_entry',
    });
  } else if (staleDays >= STALE_FOLLOWUP_DAYS) {
    cards.push({
      key: 'stale-followup',
      icon: 'bolt',
      title: `已经 ${staleDays} 天没有记录了`,
      description: '用 30 秒记一条，趋势曲线才不断档。',
      route: '/p-data_entry',
    });
  }

  // 3) Profile completeness: missing basics blunt every downstream
  //    feature (passport, AI precision, cohort stats).
  const missing: string[] = [];
  if (!profile.dateOfBirth) missing.push('出生日期');
  if (!profile.gender) missing.push('性别');
  if (!profile.regionProvince) missing.push('所在地区');
  if (missing.length > 0) {
    cards.push({
      key: 'complete-profile',
      icon: 'address-card',
      title: '完善基础档案',
      description: `补上${missing.join('、')}，报告解读和数据对比会更准确。`,
      route: '/p-register_profile',
    });
  }

  // 4) No reports at all — the document pipeline is the platform's
  //    richest input; invite the first upload.
  if (profile.documents.length === 0) {
    cards.push({
      key: 'first-report',
      icon: 'camera',
      title: '上传第一份检查报告',
      description: '拍照即可，系统会自动识别指标并生成解读。',
      route: '/p-data_entry',
    });
  }

  return cards.slice(0, MAX_CARDS);
};
