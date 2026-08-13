/**
 * Amber is spent exactly once on the exported passport.
 *
 * `.metric-summary` and `.metric-meta` — the body and footer of every
 * summary card on the hero — used to share a rule with
 * `.unconfirmed-banner`. So all four summary cards printed inside the
 * amber "this is not evidence" frame, and the one block on the page
 * that genuinely is unconfirmed stopped standing out. This page is
 * handed to a neurologist who may see three FSHD patients in a career;
 * the banner is the thing that has to stop them reading a patient's own
 * guess as a diagnosis, and a frame that appears five times is not a
 * warning by the fifth.
 *
 * Why this file lives under the screen rather than beside
 * `lib/clinical-passport-pdf.ts`: `lib/__tests__/clinical-passport-pdf.
 * test.ts` belongs to another concurrent change, and this screen is the
 * only caller of the builder.
 */

import { buildClinicalPassportPdfHtml } from '../../../lib/clinical-passport-pdf';
import type { ClinicalPassportSummary } from '../../../lib/api';

const summary = (confirmation: 'genetic' | 'self_reported' | 'none') =>
  ({
    generatedAt: '2026-08-05T00:00:00.000Z',
    passportId: 'FSHD-TEST',
    patientName: '测试',
    hasRecordedData: true,
    latestUpdatedAt: null,
    completion: { completed: 1, total: 4 },
    metrics: [],
    summaryCards: [
      {
        key: 'diagnosis',
        title: '诊断证据',
        ready: false,
        summary: '未经基因确诊 —— 以下为本人填写，尚无基因报告佐证',
        meta: '诊断日期 2023-05-01',
      },
      {
        key: 'motor',
        title: '运动功能',
        ready: true,
        summary: '平均 4.0 级',
        meta: '最近记录 08-01',
      },
    ],
    diagnosis: {
      ready: confirmation === 'genetic',
      confirmation,
      latestSourceDate: null,
      latestDocumentId: null,
      freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
      geneticType: 'FSHD1',
      d4z4Repeats: '—',
      methylationValue: '—',
      diagnosisDate: '2023-05-01',
      geneEvidence: '—',
    },
    motor: {
      ready: false,
      average: '—',
      latestMeasurementAt: null,
      latestActivityAt: null,
      summary: '—',
      highlights: [],
      bodyRegions: {},
      activitySummary: '—',
    },
    imaging: {
      ready: false,
      latestMriDate: null,
      latestDocumentId: null,
      freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
      summary: '—',
      highlights: [],
      bodyRegions: {},
    },
    monitoring: { ready: false, items: [] },
    nextSteps: [],
    timeline: [],
  }) as unknown as ClinicalPassportSummary;

/** The declaration block a selector list resolves to, or '' if the
 *  selector is not in the sheet at all. */
const ruleFor = (html: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`(^|,|\\})\\s*${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm'));
  return match?.[3] ?? '';
};

describe('PDF：琥珀色只留给未确诊横幅', () => {
  const html = buildClinicalPassportPdfHtml(summary('self_reported'));

  it('横幅还是琥珀边框', () => {
    const banner = ruleFor(html, '.unconfirmed-banner');
    expect(banner).toContain('#8a5a00');
    expect(banner).toContain('#fff6e5');
  });

  it('摘要卡的正文和页脚不再穿同一件琥珀外套', () => {
    [ruleFor(html, '.metric-summary'), ruleFor(html, '.metric-meta')].forEach((rule) => {
      expect(rule).not.toBe('');
      expect(rule).not.toContain('#8a5a00');
      expect(rule).not.toContain('#fff6e5');
      expect(rule).not.toContain('border:');
    });
  });

  it('整张纸上只有一处琥珀边框色', () => {
    // The count, not just the selector: another rule reaching for the
    // same colour puts the page back where it was.
    expect(html.match(/#8a5a00/g)?.length).toBe(1);
  });

  it('基因确诊时连横幅都不印', () => {
    expect(buildClinicalPassportPdfHtml(summary('genetic'))).not.toContain(
      'class="unconfirmed-banner"',
    );
  });

  it('未确诊和无依据都印，措辞不同', () => {
    expect(html).toContain('⚠ 未经基因确诊');
    expect(buildClinicalPassportPdfHtml(summary('none'))).toContain('⚠ 尚无诊断依据');
  });
});
