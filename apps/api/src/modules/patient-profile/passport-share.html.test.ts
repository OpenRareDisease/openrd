import { describe, expect, it } from 'vitest';

import {
  buildPassportSharePage,
  buildPickupFormPage,
  buildPickupUnavailablePage,
} from './passport-share.html.js';
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

/* ================================================================
 * The pickup pages.
 *
 * Read for about eight seconds by someone standing up in a consulting
 * room, in WeChat's X5 webview or a hospital Android that may be older
 * than the patient's diagnosis. Two hard rules:
 *
 *   - NO SCRIPT. A plain form POST or nothing.
 *   - The failure page names no reason. Which failure it was is the
 *     one fact that would tell a guesser they guessed a real patient.
 * ================================================================ */

describe('取件码表单页', () => {
  const page = buildPickupFormPage('/s/passport/pickup');

  it('是个不带脚本的普通表单 —— X5 里必须能用', () => {
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/\son[a-z]+=/i);
    expect(page).toContain('<form method="post" action="/s/passport/pickup"');
  });

  it('两个输入框都在，且都是 required', () => {
    expect(page).toMatch(/id="code"[^>]*required/);
    expect(page).toMatch(/id="dob"[^>]*required/);
  });

  it('把 Crockford 的折叠规则直接写给医生看', () => {
    // Otherwise a doctor who reads「0」as「O」types it, fails, and
    // spends one of three attempts on a rule nobody told them.
    expect(page).toContain('I、L 按 1 输，O 按 0 输也可以');
  });

  it('说清楚 15 分钟、一次性、错 3 次作废', () => {
    expect(page).toContain('15 分钟内有效，只能用一次');
    expect(page).toContain('输错 3 次');
  });

  it('说清楚出生日期那一栏是干什么的', () => {
    // A doctor asked for a patient's birthdate with no explanation
    // reasonably wonders whether we are collecting it.
    expect(page).toContain('确认你打开的是眼前这位患者的记录');
  });

  it('不进索引、不带 Referer 出去', () => {
    expect(page).toContain('name="robots" content="noindex, nofollow, noarchive"');
    expect(page).toContain('name="referrer" content="no-referrer"');
  });

  it('action 是转义过的，不能被挂载路径注入', () => {
    const injected = buildPickupFormPage('/s/"><script>alert(1)</script>');
    expect(injected).not.toContain('<script>alert(1)</script>');
    expect(injected).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('取件码失败页 —— 一种页面回答所有失败', () => {
  const page = buildPickupUnavailablePage('/s/passport/pickup');

  it('列出可能性，但不说是哪一种', () => {
    expect(page).toContain('可能是取件码输错了');
    expect(page).toContain('不会告诉你上面哪一种情况才是真的');
    // The words that would identify a specific failure must not appear
    // as an assertion about THIS attempt.
    expect(page).not.toContain('取件码不存在');
    expect(page).not.toContain('出生日期错误');
  });

  it('给出下一步，而不是让人对着死页面站着', () => {
    expect(page).toContain('再生成一个取件码');
    expect(page).toContain('再输一次');
  });

  it('也不带脚本', () => {
    expect(page).not.toMatch(/<script/i);
  });
});

describe('取件码打开的临床记录页', () => {
  it('不印一个失效日期 —— 这个凭证已经花在这次打开上了', () => {
    const viaPickup = buildPassportSharePage(summary(), { viaPickup: true });
    expect(viaPickup).toContain('取件码是一次性的');
    expect(viaPickup).not.toContain('本链接将于');
  });

  it('链接打开的那一版仍然印失效日期', () => {
    const viaLink = buildPassportSharePage(summary(), {
      expiresAt: '2026-08-12T12:00:00.000Z',
    });
    expect(viaLink).toContain('本链接将于 2026-08-12 失效');
    expect(viaLink).not.toContain('取件码是一次性的');
  });
});
