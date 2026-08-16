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

// The builder reads `readPassportValueOrigins` out of api.ts, which
// pulls in AsyncStorage through session-storage, and that has no native
// module under jest. Same stub api-transport.test.ts uses.
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import { buildClinicalPassportPdfHtml } from '../../../lib/clinical-passport-pdf';
import type { ClinicalPassportSummary } from '../../../lib/api';

const summary = (confirmation: 'genetic' | 'self_reported' | 'admin_entered' | 'none') =>
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
        // The server's own wording for this state. 「尚无基因报告佐证」
        // stood here and the API has never been able to send it: it
        // denies a document rather than a reading, which is false of
        // the patient holding an unreadable report, and it is the claim
        // every surface in this product was walked off. A fixture is
        // where the next reader learns what the wire looks like.
        summary:
          '未经基因确诊（本护照内没有从基因报告里读出来的、可作确诊依据的基因结果）—— 分型（报告读取）、诊断日期（本人填写）',
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

/**
 * 后台照着基因报告代填的数值，落在导出的这份 PDF 上。
 *
 * 这一节的末尾就是 §B3 那份 「这些字段不是患者本人填的」 清单，用的词是
 * 「D4Z4 重复数」「甲基化」 —— 和上面两张卡片的标题一字不差。卡片上印
 * 「—」、清单里点名同一个字段，是同一页纸自己跟自己打架，而拿着它的是
 * 一位一辈子可能只见三个 FSHD 患者的神经内科医生。
 */
describe('PDF：基线里的基因数值', () => {
  const valueOrigin = (kind: string, labelZh: string) => ({
    kind,
    labelZh,
    documentId: null,
    adminUserId: kind === 'admin_entered' ? '11111111-2222-3333-4444-555555555555' : null,
    at: kind === 'admin_entered' ? '2026-08-01T02:03:04.000Z' : null,
    detail: null,
  });

  const adminTyped = (over: Record<string, unknown> = {}) => {
    const built = summary('admin_entered' as never) as unknown as Record<string, unknown>;
    return {
      ...built,
      diagnosis: {
        ...(built.diagnosis as Record<string, unknown>),
        geneticType: 'FSHD1',
        d4z4Repeats: '6',
        methylationValue: '25%',
        geneEvidence: 'FSHD1',
        valueOrigins: {
          geneticType: valueOrigin('admin_entered', '管理员代填'),
          d4z4Repeats: valueOrigin('admin_entered', '管理员代填'),
          methylationValue: valueOrigin('admin_entered', '管理员代填'),
          diagnosisDate: valueOrigin('admin_entered', '管理员代填'),
        },
        geneEvidenceOrigin: valueOrigin('admin_entered', '管理员代填'),
      },
      fieldOrigins: [
        {
          path: 'diseaseBackground.d4z4',
          labelZh: 'D4Z4 重复数',
          state: 'admin_entered',
          adminUserId: '11111111-2222-3333-4444-555555555555',
          at: '2026-08-01T02:03:04.000Z',
          detail: null,
        },
      ],
      ...over,
    } as unknown as ClinicalPassportSummary;
  };

  /** 一张卡片的文字，去掉标签。 */
  const cardText = (html: string, label: string) => {
    const cards = html.match(/<article class="info-card">[\s\S]*?<\/article>/g) ?? [];
    const card = cards.find((candidate) => candidate.includes(`>${label}<`));
    if (card === undefined) throw new Error(`no card labelled ${label}`);
    return card
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  it('卡片上印着值，下面一行印着是谁填的', () => {
    const html = buildClinicalPassportPdfHtml(adminTyped());

    expect(cardText(html, 'D4Z4 重复数')).toBe('D4Z4 重复数 6 管理员代填');
    expect(cardText(html, '甲基化值')).toBe('甲基化值 25% 管理员代填');
    expect(cardText(html, '基因类型')).toBe('基因类型 FSHD1 管理员代填');
  });

  it('横幅说的是没有可作确诊依据的结果，不是「这一节里没有这个数」', () => {
    const html = buildClinicalPassportPdfHtml(adminTyped());

    expect(html).toContain('没有从基因报告里读出来的、可作确诊依据的基因结果');
    // 这句话与同一节里那张印着 6 的卡片直接矛盾。
    expect(html).not.toContain('本节里没有 D4Z4 重复数');
    // 横幅不再逐条点名读数：确诊要报告同时写明长度和允许型单倍型，报告
    // 只写了其中一项时那一项就印在横幅下面，点名它就是自相矛盾。
    expect(html).not.toContain('4q 单倍型或 EcoRI 片段');
  });

  it('卡片上的值和节末那份清单说的是同一批字段', () => {
    const html = buildClinicalPassportPdfHtml(adminTyped());

    expect(html).toContain('这些字段不是患者本人填的');
    expect(cardText(html, 'D4Z4 重复数')).not.toBe('D4Z4 重复数 —');
  });
});
