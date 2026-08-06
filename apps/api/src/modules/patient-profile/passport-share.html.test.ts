import { describe, expect, it } from 'vitest';

import { buildPassportSharePage } from './passport-share.html.js';
import type { ClinicalPassportSummaryDTO } from './profile.passport.js';

/**
 * This page is opened by a neurologist who may meet three FSHD patients
 * in a career, on their own phone, in a consulting room, having been
 * handed a link by a patient they have two minutes for.
 *
 * A clean, confident page headed FSHD is exactly the anchoring
 * mechanism that produces the ten-year diagnostic odysseys this
 * population already lives through. So the confirmation state is not a
 * detail in a table here — it is above the fold, and these tests keep
 * it there.
 */

const summary = (over: Record<string, unknown> = {}): ClinicalPassportSummaryDTO =>
  ({
    generatedAt: '2026-08-05T00:00:00.000Z',
    passportId: 'FSHD-TEST',
    patientName: '张三',
    hasRecordedData: true,
    latestUpdatedAt: null,
    completion: { completed: 2, total: 4 },
    metrics: [],
    summaryCards: [],
    diagnosis: {
      ready: true,
      confirmation: 'genetic',
      latestSourceDate: null,
      latestDocumentId: null,
      freshness: { label: '最新', tone: 'success', date: null, daysSince: null },
      geneticType: 'FSHD1',
      d4z4Repeats: '4',
      methylationValue: '—',
      diagnosisDate: '2023-05-01',
      geneEvidence: 'D4Z4 4 拷贝',
    },
    motor: {
      ready: true,
      average: '3.4',
      latestMeasurementAt: '2026-07-31T00:00:00.000Z',
      latestActivityAt: null,
      summary: '肩带明显受累',
      highlights: ['左肩带', '右肩带'],
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
    monitoring: {
      ready: false,
      items: [
        {
          key: 'cardiac',
          title: '心脏检查',
          available: false,
          summary: '暂无心脏检查数据',
          latestDate: null,
          latestDocumentId: null,
          freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
          state: 'absent',
          note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声。',
        },
      ],
    },
    nextSteps: [
      { title: '问一次眼底检查', description: '大片段缺失这一组风险更高。', kind: 'clinical' },
      { title: '上传 MRI 报告', description: '补齐后才能展示受累分布。', kind: 'record' },
    ],
    timeline: [
      {
        id: 't1',
        title: '肌力自测',
        description: '举手过头 4 分',
        timestamp: '2026-07-31T00:00:00.000Z',
        tag: '肌力',
      },
    ],
    ...over,
  }) as unknown as ClinicalPassportSummaryDTO;

const page = (over: Record<string, unknown> = {}) =>
  buildPassportSharePage(summary(over), { expiresAt: '2026-08-12T12:00:00.000Z' });

describe('确诊状态必须在数值之前出现', () => {
  it('自填诊断时，警示横幅排在第一个数值前面', () => {
    const html = page({
      diagnosis: { ...summary().diagnosis, confirmation: 'self_reported' },
    });
    const banner = html.indexOf('未经基因确诊');
    const firstValue = html.indexOf('FSHD1');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(firstValue);
  });

  it('自填的分型和日期在值本身上也标出来', () => {
    // A clinician who scrolled past the banner, or printed only the
    // second page, must still not read 「FSHD1」 as something a lab said.
    const html = page({
      diagnosis: { ...summary().diagnosis, confirmation: 'self_reported' },
    });
    expect(html).toContain('（本人填写）');
    expect(html).toContain('class="reported"');
  });

  it('基因确诊时不加「本人填写」', () => {
    const html = page();
    expect(html).not.toContain('（本人填写）');
    expect(html).toContain('基因确诊');
  });

  it('什么依据都没有时也有横幅，不是留白', () => {
    const html = page({ diagnosis: { ...summary().diagnosis, confirmation: 'none' } });
    expect(html).toContain('本平台尚无诊断依据记录');
  });
});

describe('运动功能不能读起来像查体', () => {
  it('标题写明是患者自测', () => {
    expect(page()).toContain('运动功能（患者自测）');
  });

  it('页脚再说一次，因为打印出来的第二页可能没有标题', () => {
    expect(page()).toContain('运动功能一栏为患者自测，不是查体所得');
  });
});

describe('这是一个页面，不是一个应用', () => {
  it('不含任何脚本', () => {
    const html = page();
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/on(click|load|error)=/i);
  });

  it('不请求任何外部资源', () => {
    // CSP forbids it and the GFW would eat it. A page that half-renders
    // in a hospital corridor is worse than a plain one.
    const html = page();
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
  });

  it('声明不可索引', () => {
    expect(page()).toContain('noindex');
  });

  it('写明失效日期，让医生知道这份东西不是永久的', () => {
    expect(page()).toContain('2026-08-12');
  });
});

describe('转义', () => {
  it('姓名里的尖括号不会变成标签', () => {
    const html = page({ patientName: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('OCR 读出来的自由文本同样转义', () => {
    const html = page({
      diagnosis: { ...summary().diagnosis, geneEvidence: '"><img src=x onerror=1>' },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('给医生的部分', () => {
  it('渲染指南类建议，不渲染「去上传一份 MRI」', () => {
    const html = page();
    expect(html).toContain('问一次眼底检查');
    // A record-completeness chore is the patient's homework, not
    // something to spend a clinician's two minutes on.
    expect(html).not.toContain('上传 MRI 报告');
  });

  it('监测槽位带上「是否需要做」的说明', () => {
    expect(page()).toContain('不需要常规做心电图');
  });
});
