import { MAX_PICKUP_ATTEMPTS, PICKUP_TTL_MINUTES } from './passport-share.service.js';
import type { ClinicalPassportSummaryDTO, PassportValueOriginDTO } from './profile.passport.js';

/**
 * The page a clinician opens.
 *
 * NOT the PDF. `apps/mobile/lib/clinical-passport-pdf.ts` builds a
 * document laid out for A4 and a printer; this is read on a phone that
 * someone is holding in a consulting room, one-handed, in under a
 * minute, having just been handed a WeChat link by a patient they have
 * two minutes for. Different artefact, different priorities:
 *
 *   - The first screen has to answer 「这人是什么病，凭什么」. Everything
 *     else can be scrolled to.
 *   - No JavaScript. WeChat's X5 webview, an ageing hospital Android,
 *     a locked-down browser — the page must render as HTML or not at
 *     all. There is nothing here that needs a script.
 *   - No external requests. Fonts, styles and layout are inline; the
 *     CSP forbids anything else and the GFW would eat it anyway.
 *   - It prints. A clinician who wants it in the paper chart hits
 *     print and gets something filed-shaped, without us shipping a
 *     second renderer.
 *
 * THE ONE THING THIS PAGE MUST NEVER DO
 *
 * Present a self-reported diagnosis as a confirmed one. A neurologist
 * who may meet three FSHD patients in a career, reading a clean,
 * confident page headed FSHD, is exactly the anchoring mechanism that
 * produces the ten-year odysseys this population already lives
 * through. `confirmation` is therefore not a detail in a table — it is
 * the banner above the fold, and it is the first thing rendered.
 */

/* The two pages the pickup flow adds live at the bottom of this file:
 * `buildPickupFormPage` (where the doctor types the code) and
 * `buildPickupUnavailablePage` (the ONE answer every failure gets),
 * followed by `buildPublicErrorPage` — the answer for the failures that
 * happen before any handler runs. */

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const dash = (value: string | null | undefined): string => {
  const text = (value ?? '').trim();
  return text && text !== '—' ? esc(text) : '—';
};

/** A calendar date that is already a calendar date. Several of the
 *  values below have been through `formatDate` in profile.passport.ts
 *  and arrive as `YYYY-MM-DD` — a monitoring slot's `latestDate`, the
 *  imaging date. `new Date('2026-02-10')` is UTC midnight and every
 *  accessor under it reads local, so re-parsing one of those on a host
 *  west of Greenwich printed the day before the one the passport
 *  itself carries. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const day = (value: string | null | undefined): string => {
  if (!value) return '—';
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

/**
 * THE BANNER STATES THE EVIDENCE. IT DOES NOT NAME AN AUTHOR.
 *
 * `confirmation` is an evidence grade — see its doc comment in
 * profile.passport.ts — and a sentence about who typed the 诊断信息
 * block cannot be read off it. 基因确诊 is earned by a D4Z4 count, a
 * haplotype or an EcoRI fragment alone, so it sits over a 分型 that may
 * be the patient's own free text; and a report parsed to nothing but
 * `diagnosisType` lands in `self_reported`, whose name says the patient
 * wrote a value OCR read off a report. Authorship is per value, in
 * `diagnosis.valueOrigins`, printed in brackets on the row itself.
 *
 * NOR DOES IT QUANTIFY OVER UPLOADED REPORTS. `buildReportInsights`
 * takes its genetic values out of ONE document, so a repeat count in an
 * earlier report is never read and 「没有从任何上传的报告里读到」 would be
 * a claim about reports this page has not opened. These sentences say
 * what the page holds, which is what its reader can check against the
 * report in the patient's hands.
 *
 * 「从基因报告里读出来的」 IS NOT PADDING. The 诊断信息 rows below can
 * carry a D4Z4 重复数 or a 甲基化 the patient typed into the
 * registration form, each with its own source in brackets, and the bare
 * 「没有可作确诊依据的基因结果」 would then sit above a number the
 * clinician can read. The qualifier is still a claim about this page
 * and not about the patient's other reports.
 */
const CONFIRMATION_BANNER: Record<
  ClinicalPassportSummaryDTO['diagnosis']['confirmation'],
  { tone: string; title: string; body: string }
> = {
  genetic: {
    tone: 'ok',
    title: '基因确诊',
    body: '本平台已从患者上传的报告里读到可作确诊依据的基因结果。下面「诊断信息」里，括号写在哪一行后面就只说那一行。原始报告以患者手中的报告单为准。',
  },
  self_reported: {
    tone: 'warn',
    title: '未经基因确诊',
    body: '这份摘要里没有从基因报告里读出来的基因结果（D4Z4 重复数、4q 单倍型或 EcoRI 片段），下面的诊断信息不构成诊断依据。括号写在哪一行后面就只说那一行 —— 每一行的来源写在它自己的括号里，本平台说不上来的那几行也照实写着。FSHD 的误诊率很高，请勿据此锚定。患者手里可能还有本平台没有读过的报告，值得当面问一句。',
  },
  // The fourth source (baseline-provenance.ts). The title names the
  // FIELD, because the field is all the marker covers: this state is
  // derived from 确诊年份's provenance entry alone, and the 分型, D4Z4
  // 重复数 and 甲基化 rows below each carry their own source in their
  // own bracket.
  admin_entered: {
    tone: 'warn',
    title: '未经基因确诊 —— 档案里的「确诊年份」由本平台工作人员代填',
    body: '这份摘要里没有从基因报告里读出来的基因结果，患者手里可能还有本平台没有读过的报告。这份档案的「确诊年份」带着一条本平台管理员代为录入的记录：那是我们的工作人员根据患者的电话或消息转述录入的，患者本人可能没有看过，也没有核对过。这一句只说这一个字段 —— 下面的括号写在哪一行后面，就只说那一行。FSHD 的误诊率很高，请勿据此锚定，具体以患者手中的病历与报告单为准。',
  },
  none: {
    tone: 'warn',
    title: '这份摘要里没有诊断依据',
    // Not 「该患者既未上传基因报告，也未填写诊断信息」. This state means no
    // 分型 and no 诊断日期. 甲基化 is in neither test, and neither is a
    // D4Z4 重复数 that reached the record without one of those two, so
    // both can be printed below with their own source in brackets while
    // this banner stands.
    body: '这份摘要里没有可展示的分型或诊断日期，也没有从基因报告里读出来的基因结果，患者手里可能还有本平台没有读过的报告。下面的括号写在哪一行后面，就只说那一行。',
  },
};

/**
 * `admin_entered` is also the state for a marker this platform could
 * not parse (PassportDiagnosisConfirmation, profile.passport.ts), and
 * for those we know only that the value is not the patient's own. The
 * banner above names an administrator and their phone call, which
 * would be invented for such a profile — and the 字段来源 list further
 * down the same page would say 「读不出来」 about the same field.
 */
const UNREADABLE_ORIGIN_BANNER = {
  tone: 'warn',
  title: '未经基因确诊 —— 档案里的「确诊年份」不是患者本人填写的，来源记录读不出来',
  body: '这份摘要里没有可作确诊依据的基因结果，患者手里可能还有本平台没有读过的报告。这份档案的「确诊年份」带着一条「非本人填写」的来源记录，但那条记录本平台读不出来（原因见下方「字段来源」），所以只能确定它不是患者自己填的，无法说明是谁录入、什么时候录入的。这一句只说这一个字段 —— 下面的括号写在哪一行后面，就只说那一行。FSHD 的误诊率很高，请勿据此锚定，具体以患者手中的病历与报告单为准。',
};

/** The baseline field `confirmation` is derived from
 *  (profile.passport.ts). A marker on any OTHER field says nothing
 *  about who entered this one. */
const DIAGNOSIS_ORIGIN_PATH = 'foundation.diagnosisYear';

export const buildPassportSharePage = (
  summary: ClinicalPassportSummaryDTO,
  /* A union, not an optional flag beside a required date. A pickup
   * redemption has no meaningful expiry to print — the credential was
   * spent rendering this page — and the previous shape would have made
   * the caller invent one. */
  meta: { viaPickup: true } | { viaPickup?: false; expiresAt: string },
): string => {
  /** True when the only thing this page can prove about the diagnosis
   *  is that the patient did not type it: the marker `confirmation` was
   *  derived from does not name anybody. The 字段来源 section below
   *  prints that field's own state, which is what the banner points
   *  at. */
  const diagnosisOriginUnreadable =
    summary.diagnosis.confirmation === 'admin_entered' &&
    summary.fieldOrigins.find((origin) => origin.path === DIAGNOSIS_ORIGIN_PATH)?.state !==
      'admin_entered';
  const banner = diagnosisOriginUnreadable
    ? UNREADABLE_ORIGIN_BANNER
    : CONFIRMATION_BANNER[summary.diagnosis.confirmation];

  const rows = (pairs: Array<[string, string]>): string =>
    pairs.map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('');

  /**
   * One diagnosis row: the value, its own source in brackets, and the
   * typographic register that source has earned.
   *
   * NOTHING HERE IS INFERRED. Absence from `fieldOrigins` means 「no
   * administrator wrote this baseline field」 and never 「the patient
   * typed this value」, so authorship cannot be worked out on this page.
   * `diagnosis.valueOrigins` answers it per value, at the point in
   * profile.passport.ts where the source is still known, and this
   * function prints what it is handed.
   *
   * The bracket is on the value and not only in the banner because a
   * clinician who scrolled past the banner, or printed page two on its
   * own, still has to be able to tell a laboratory's number from a
   * patient's account of themselves.
   */
  const diagnosisRow = (value: string, origin: PassportValueOriginDTO): string => {
    const text = dash(value);
    if (text === '—' || origin.kind === 'absent') return text;
    const marked = `${text}（${esc(origin.labelZh)}）`;
    // Only a value this platform read off a report gets the tabular,
    // weighted treatment a lab value gets. Everything else — including
    // 「来源无法确定」 — reads as an account, because it may be one.
    return origin.kind === 'report' ? marked : `<span class="reported">${marked}</span>`;
  };

  /** §B3 in the document a clinician reads: every baseline field on
   *  this page that somebody other than the patient entered, named,
   *  with when. Rendered only when there is something to render — an
   *  empty section reading 「无」 would train readers to skip the
   *  heading. */
  const origins = summary.fieldOrigins
    .map(
      (origin) => `
      <li>
        <strong>${esc(origin.labelZh)}</strong>
        <span>${
          origin.state === 'admin_entered'
            ? `本平台管理员于 ${day(origin.at)} 代为录入，不是患者本人填写。`
            : `这一项的来源记录读不出来（${esc(origin.detail ?? '原因未记录')}），只能确定它不是患者本人填写的。`
        }</span>
      </li>`,
    )
    .join('');

  const monitoring = summary.monitoring.items
    .map(
      (item) => `
      <section class="slot">
        <h3>${esc(item.title)}</h3>
        <p class="val">${dash(item.summary)}</p>
        <p class="meta">最近日期：${day(item.latestDate)}</p>
        ${item.note ? `<p class="note">${esc(item.note)}</p>` : ''}
      </section>`,
    )
    .join('');

  const timeline = summary.timeline
    .slice(0, 12)
    .map(
      (t) => `
      <li>
        <span class="tl-date">${day(t.timestamp)}</span>
        <span class="tl-tag">${esc(t.tag)}</span>
        <span class="tl-title">${esc(t.title)}</span>
        <span class="tl-desc">${esc(t.description)}</span>
      </li>`,
    )
    .join('');

  const clinical = summary.nextSteps
    .filter((s) => s.kind === 'clinical')
    .map((s) => `<li><strong>${esc(s.title)}</strong><span>${esc(s.description)}</span></li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-Hans-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- A share link is a private publication to one clinician. It must not
     end up in a search index, a browser's shared cache, or a preview
     card in the group chat it was forwarded through. -->
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${dash(summary.patientName)} · 临床记录摘要</title>
<style>
  :root{
    --paper:#FBF8F3;--surface:#fff;--ink:#17272E;--soft:#42565F;--mute:#5F7078;
    --line:rgba(23,39,46,.13);--accent:#26695C;--warn:#8F5714;--warnbg:rgba(143,87,20,.09);
    --okbg:rgba(38,105,92,.08);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);line-height:1.7;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",
      "Microsoft YaHei","Noto Sans CJK SC",sans-serif;
    -webkit-text-size-adjust:100%;}
  .wrap{max-width:44rem;margin:0 auto;padding:20px 18px 56px}
  header{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:18px}
  .who{font-size:26px;font-weight:700;margin:0}
  .sub{color:var(--mute);font-size:13px;margin:6px 0 0}
  /* The banner is first, before any value, and it is not dismissible.
     Reordering it below the data would undo the point of the page. */
  .banner{border-radius:6px;padding:13px 15px;margin:0 0 20px;border:1px solid var(--line)}
  .banner.warn{background:var(--warnbg);border-color:var(--warn);border-left-width:4px}
  .banner.ok{background:var(--okbg);border-left:4px solid var(--accent)}
  .banner h2{margin:0 0 5px;font-size:15px;font-weight:700}
  .banner.warn h2{color:var(--warn)}
  .banner p{margin:0;font-size:13.5px;color:var(--soft)}
  h2.sec{font-size:15px;font-weight:700;margin:26px 0 10px;padding-top:12px;
    border-top:1px solid var(--line);letter-spacing:.02em}
  .row{display:flex;gap:14px;padding:7px 0;border-bottom:1px solid var(--line)}
  dt{flex:0 0 6.5em;margin:0;color:var(--mute);font-size:13px}
  dd{margin:0;flex:1;font-size:14.5px;font-variant-numeric:tabular-nums;word-break:break-word}
  /* Values this platform did not read off a report do not get the
     tabular, weighted treatment a lab value gets — the difference has
     to be visible, not just stated in the banner.
     「.reported」, NOT 「dd.reported」: the class goes on a <span> inside
     the <dd>, so the compound selector matched nothing and a typed
     value rendered exactly like a lab-extracted one. 运动功能's rows
     carry no inline marker naming who entered them, so this rule is
     their only signal; a 诊断信息 row with a source to name prints it
     in brackets as well. */
  .reported{font-variant-numeric:normal;color:var(--soft)}
  .slots{display:grid;gap:10px}
  @media(min-width:620px){.slots{grid-template-columns:1fr 1fr 1fr}}
  .slot{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:11px 13px}
  .slot h3{margin:0 0 5px;font-size:13px;font-weight:700}
  .val{margin:0;font-size:14px}
  .meta{margin:5px 0 0;font-size:12px;color:var(--mute);font-variant-numeric:tabular-nums}
  .note{margin:7px 0 0;padding-top:6px;border-top:1px solid var(--line);
    font-size:12px;color:var(--soft)}
  ul.tl{list-style:none;margin:0;padding:0}
  /* 6.6em, not 5.6: an ISO date wrapped to 「2026-07-」/「31」 in the
     narrow column, which is unreadable at a glance and doubles the
     height of every row on the one screen a clinician skims. */
  ul.tl li{display:grid;grid-template-columns:6.6em 3em 1fr;gap:2px 8px;
    padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px}
  .tl-date{color:var(--mute);font-variant-numeric:tabular-nums;white-space:nowrap}
  .tl-tag{color:var(--accent);font-size:12px}
  .tl-title{font-weight:600}
  .tl-desc{grid-column:3;color:var(--soft);font-size:13px}
  ul.adv{list-style:none;margin:0;padding:0}
  ul.adv li{padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px}
  ul.adv strong{display:block;margin-bottom:2px}
  ul.adv span{color:var(--soft);font-size:13px}
  footer{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);
    font-size:12px;color:var(--mute)}
  @media print{
    body{background:#fff}
    .wrap{max-width:none;padding:0}
    .slot,.banner{break-inside:avoid}
    /* Both banners carry meaning through colour; without this the
       amber one prints as the same white box as the green one. */
    .banner{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>
<div class="wrap">

<header>
  <p class="who">${dash(summary.patientName)}</p>
  <p class="sub">FSHD 临床记录摘要 · 由患者本人通过「肌愈通」生成并分享</p>
</header>

<div class="banner ${banner.tone}">
  <h2>${esc(banner.title)}</h2>
  <p>${esc(banner.body)}</p>
</div>

<h2 class="sec">诊断信息</h2>
<dl>
${rows([
  // The rows in this block do not share a source: 分型 and 诊断日期 can
  // each come from a report or from a text box, D4Z4 and 甲基化 come only
  // off a report, and 基因证据 joins several of them. A clinician who
  // scrolled past the banner, or printed only page two, reads the
  // bracket instead of guessing from the heading.
  ['分型', diagnosisRow(summary.diagnosis.geneticType, summary.diagnosis.valueOrigins.geneticType)],
  [
    'D4Z4 重复数',
    diagnosisRow(summary.diagnosis.d4z4Repeats, summary.diagnosis.valueOrigins.d4z4Repeats),
  ],
  [
    '甲基化',
    diagnosisRow(
      summary.diagnosis.methylationValue,
      summary.diagnosis.valueOrigins.methylationValue,
    ),
  ],
  [
    '诊断日期',
    diagnosisRow(summary.diagnosis.diagnosisDate, summary.diagnosis.valueOrigins.diagnosisDate),
  ],
  // 基因证据 joins 分型 with 单倍型, EcoRI 片段 and D4Z4 重复数, which
  // come off an uploaded report, so its bracket comes from
  // `geneEvidenceOrigin` rather than from a `valueOrigins` entry —
  // profile.passport.ts decides it beside the components. Same row
  // renderer, so a mix of a laboratory number and a value of unproven
  // origin is not set as a laboratory value, and a 基因证据 that is 分型
  // by itself is set the way the 分型 row is.
  ['基因证据', diagnosisRow(summary.diagnosis.geneEvidence, summary.diagnosis.geneEvidenceOrigin)],
])}
</dl>

<h2 class="sec">运动功能（患者自测）</h2>
<dl>
${rows([
  ['概况', `<span class="reported">${dash(summary.motor.summary)}</span>`],
  ['最近测量', day(summary.motor.latestMeasurementAt)],
  [
    '受累部位',
    summary.motor.highlights.length
      ? `<span class="reported">${esc(summary.motor.highlights.join('、'))}</span>`
      : '—',
  ],
])}
</dl>

<h2 class="sec">影像</h2>
<dl>
${rows([
  ['MRI 摘要', dash(summary.imaging.summary)],
  ['最近 MRI', day(summary.imaging.latestMriDate)],
])}
</dl>

<h2 class="sec">检查结果</h2>
<div class="slots">${monitoring}</div>

${
  origins
    ? `<h2 class="sec">这些字段不是患者本人填的</h2>
<ul class="adv">${origins}</ul>`
    : ''
}

${
  clinical
    ? `<h2 class="sec">按指南，这位患者值得确认的事</h2>
<ul class="adv">${clinical}</ul>`
    : ''
}

${
  timeline
    ? `<h2 class="sec">最近记录</h2>
<ul class="tl">${timeline}</ul>`
    : ''
}

<footer>
  <p>本页由患者本人主动分享，内容来自其在「肌愈通」中上传的报告与自行录入的记录${
    // Tied to the 「这些字段不是患者本人填的」 section above: this clause
    // is emitted on the same condition, and has to go if that section
    // ever does.
    origins ? '，以及上方「这些字段不是患者本人填的」一节逐条列出的字段' : ''
  }，
     未经医疗机构核验，不构成诊断或诊疗意见。运动功能一栏为患者自测，不是查体所得。</p>
  <p>生成时间 ${day(summary.generatedAt)} · ${
    // A pickup code lives fifteen minutes, so printing its expiry as a
    // DAY would tell the clinician the page is good until midnight. It
    // is good until they close it: the code was spent opening this.
    meta.viaPickup
      ? '本页由患者当场用取件码打开。取件码是一次性的，刚才那一个已经用掉了 ——' +
        '需要再看一次，请让患者再生成一个；需要留存，请现在打印或保存。'
      : `本链接将于 ${day(meta.expiresAt)} 失效，患者也可随时撤销。`
  }</p>
</footer>

</div>
</body>
</html>`;
};

/* ================================================================
 * The pickup flow's two pages.
 *
 * Same constraints as the passport page above and one more: this one
 * takes input, and it takes it with NO JAVASCRIPT. A plain form POST
 * works in WeChat's X5 webview, in a hospital's locked-down IE-mode
 * shell, and with a screen reader, and it keeps the code out of the
 * URL — a GET would put a live credential in the doctor's history, in
 * the proxy log, and in the Referer of whatever they open next.
 * ================================================================ */

/** Shared chrome. Both pages are read for about eight seconds by
 *  someone standing up, so they get one column, large type and no
 *  decoration. */
const PICKUP_STYLE = `
  *{box-sizing:border-box}
  body{margin:0;background:#FBF8F3;color:#17272E;line-height:1.7;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",
      "Microsoft YaHei","Noto Sans CJK SC",sans-serif;-webkit-text-size-adjust:100%}
  .wrap{max-width:26rem;margin:0 auto;padding:34px 20px 56px}
  h1{font-size:21px;margin:0 0 8px}
  .lede{color:#42565F;font-size:14.5px;margin:0 0 22px}
  label{display:block;font-size:14px;font-weight:600;margin:16px 0 5px}
  .hint{font-size:12.5px;color:#5F7078;font-weight:400;margin:3px 0 7px}
  /* 17px minimum: anything smaller and iOS Safari zooms the page on
     focus, which on a doctor's phone throws the second field off
     screen mid-form. */
  input{width:100%;padding:13px 12px;font-size:19px;line-height:1.3;
    border:1px solid rgba(23,39,46,.28);border-radius:6px;background:#fff;
    color:#17272E;font-variant-numeric:tabular-nums}
  input#code{letter-spacing:.16em;text-transform:uppercase;font-weight:700}
  button{width:100%;margin-top:22px;padding:15px;font-size:16px;font-weight:600;
    color:#fff;background:#26695C;border:0;border-radius:6px;cursor:pointer}
  .note{margin:22px 0 0;padding-top:14px;border-top:1px solid rgba(23,39,46,.13);
    font-size:12.5px;color:#5F7078}
`;

/**
 * Where the clinician types the code.
 *
 * `formAction` comes from the router's own mount point rather than
 * being hardcoded, so a deployment that mounts /s under a path prefix
 * does not get a form that posts into the void.
 *
 * The two numbers on this page are interpolated from the constants that
 * enforce them, never typed out. They were literals, and a literal here
 * is a page that keeps saying 「15 分钟」 after someone changes
 * PICKUP_TTL_MINUTES to 10 — with the whole suite still green, because
 * the tests asserted the literal too.
 */
export const buildPickupFormPage = (formAction: string): string =>
  `<!DOCTYPE html>
<html lang="zh-Hans-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>用取件码打开患者记录</title>
<style>${PICKUP_STYLE}</style>
</head>
<body>
<div class="wrap">
<h1>用取件码打开患者记录</h1>
<p class="lede">请患者在「肌愈通」App 里生成一个取件码，读给你。取件码 ${PICKUP_TTL_MINUTES} 分钟内有效，只能用一次。</p>
<form method="post" action="${esc(formAction)}" autocomplete="off">
  <label for="code">取件码
    <span class="hint">8 位，中间的短横可有可无。字母不分大小写；I、L 按 1 输，O 按 0 输也可以。</span>
  </label>
  <input id="code" name="code" type="text" inputmode="latin" autocapitalize="characters"
         autocorrect="off" spellcheck="false" maxlength="16" placeholder="K7F3-9QTM" required>

  <label for="dob">患者出生日期
    <span class="hint">8 位数字，例如 19850312。这一栏是为了确认你打开的是眼前这位患者的记录。</span>
  </label>
  <input id="dob" name="dob" type="text" inputmode="numeric" autocorrect="off"
         spellcheck="false" maxlength="10" placeholder="19850312" required>

  <button type="submit">打开记录</button>
</form>
<!-- 「出生日期输错」, not 「输错」. Only a wrong BIRTHDATE increments the
     counter — a wrong code matches no row, so there is nothing to
     count on (db/migrations/024). The in-app card said this correctly
     and this page did not, which is the version a doctor reads. -->
<p class="note">这份记录由患者本人主动交给你，内容未经医疗机构核验。出生日期输错 ${MAX_PICKUP_ATTEMPTS} 次，
   这个取件码会作废（取件码本身打错不计入这 ${MAX_PICKUP_ATTEMPTS} 次）。患者可以当场再生成一个。</p>
</div>
</body>
</html>`;

/**
 * The ONE page every failure gets.
 *
 * Wrong code, right code with the wrong birthdate, expired, burned,
 * already redeemed, revoked by the patient, never existed — all of them
 * land here, with the same words and the same status. Telling them
 * apart would tell whoever is guessing that they guessed a real code,
 * and a real code identifies a real patient. The copy therefore lists
 * the possibilities instead of naming one, which is both safe and, for
 * an honest clinician who mistyped, exactly as useful.
 */
export const buildPickupUnavailablePage = (formAction: string): string =>
  `<!DOCTYPE html>
<html lang="zh-Hans-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>取件码打不开</title>
<style>${PICKUP_STYLE}</style>
</head>
<body>
<div class="wrap">
<h1>这个取件码打不开</h1>
<p class="lede">可能是取件码输错了，也可能它已经过期、已经用过一次，或者出生日期和这份记录对不上。</p>
<p class="lede">最省事的做法：请患者在「肌愈通」里当场再生成一个取件码，念给你，${PICKUP_TTL_MINUTES} 分钟内输进来。</p>
<p class="note">为了保护患者，这个页面不会告诉你上面哪一种情况才是真的。</p>
<form method="get" action="${esc(formAction)}">
  <button type="submit">再输一次</button>
</form>
</div>
</body>
</html>`;

/**
 * The failures that happen BEFORE any handler runs.
 *
 * A rate-limit rejection, an over-long form body, or a throw on the way
 * to the passport all used to be answered by the app-level JSON error
 * handler, so a clinician standing in a consulting room read
 * `{"error":"请求过于频繁，请稍后再试"}` as the page. Everything else
 * this router sends is a page for exactly the same reason — the reader
 * has no account, no app, and no way to tell our outage from a link the
 * patient revoked. So each of these says which of the two it is.
 *
 * The 429 is the one a hospital actually hits: an outpatient department
 * is one NAT address, so the wording blames the network rather than the
 * person holding the phone, and says the link is still good.
 */
export const buildPublicErrorPage = (
  detail:
    | { kind: 'rate_limited'; retryAfterSeconds: number | null }
    | { kind: 'too_large'; formAction: string }
    | { kind: 'failed' },
): string => {
  const copy =
    detail.kind === 'rate_limited'
      ? {
          title: '这个链接暂时打不开',
          lede: `刚才从这个网络打开得太频繁了${
            detail.retryAfterSeconds ? `，请等 ${detail.retryAfterSeconds} 秒` : '，请稍等一会儿'
          }再刷新一次。`,
          note: '链接本身没有失效，也没有被撤销 —— 医院整层门诊往往共用一个网络出口，所以计数会比你以为的快。',
          action: null,
        }
      : detail.kind === 'too_large'
        ? {
            title: '提交的内容太长了',
            lede: '这个表单只收 8 位取件码和 8 位出生日期。请回到上一步，只填这两栏。',
            note: '如果你是从别的地方粘贴进来的，先清空输入框再手输一次。',
            action: detail.formAction,
          }
        : {
            // Deliberately says what it is NOT. This page is also what a
            // revoked or expired link shows, and a clinician who cannot
            // tell those apart stops trusting the whole handover.
            title: '这一页现在打不开',
            lede: '这次打开没有成功 —— 不是链接失效，也不是患者撤销了它。',
            note: '请过一会儿再打开同一个链接。如果一直这样，请让患者在「肌愈通」里重新生成一个。',
            action: null,
          };

  return `<!DOCTYPE html>
<html lang="zh-Hans-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(copy.title)}</title>
<style>${PICKUP_STYLE}</style>
</head>
<body>
<div class="wrap">
<h1>${esc(copy.title)}</h1>
<p class="lede">${esc(copy.lede)}</p>
${
  copy.action
    ? `<form method="get" action="${esc(copy.action)}">
  <button type="submit">回到取件码页面</button>
</form>`
    : ''
}
<p class="note">${esc(copy.note)}</p>
</div>
</body>
</html>`;
};
