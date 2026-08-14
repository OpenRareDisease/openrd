import {
  readPassportValueOrigins,
  type ClinicalPassportSummary,
  type PassportValueOrigin,
} from './api';
import { formatDateLabel } from './clinical-visuals';
import { parseAnswer, type TextSpan } from '../screens/common/answer-format';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeText = (value: string | null | undefined, fallback = '—') => {
  const text = value?.trim();
  return escapeHtml(text && text.length > 0 ? text : fallback);
};

const safeDate = (value: string | null | undefined, fallback = '—') =>
  escapeHtml(value ? formatDateLabel(value) : fallback);

const renderList = (items: string[], emptyLabel: string) => {
  if (items.length === 0) {
    return `<li>${escapeHtml(emptyLabel)}</li>`;
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
};

/**
 * Render the AI visit-prep note as HTML.
 *
 * The note is model-authored Markdown, and this file used to
 * `escapeHtml` it — which is exactly the wrong transform: escaping
 * guarantees every `**`, `|` and `#` survives into the printout. The
 * one artefact that leaves the app and reaches a clinician was the
 * only place the raw syntax was *preserved on purpose*.
 *
 * Parsing first and escaping per span keeps the escaping guarantee —
 * no model-supplied string is ever interpolated unescaped — while
 * turning the syntax into structure.
 */
const renderSpansHtml = (spans: TextSpan[]): string =>
  spans
    .map((span) => {
      const text = escapeHtml(span.text);
      if (span.code) return `<code>${text}</code>`;
      let out = text;
      if (span.bold) out = `<strong>${out}</strong>`;
      if (span.italic) out = `<em>${out}</em>`;
      if (span.strike) out = `<s>${out}</s>`;
      // The href is escaped as an attribute and restricted to http(s):
      // a model can put any string inside `(...)`, including one that
      // starts with `javascript:`.
      if (span.href && /^https?:\/\//i.test(span.href)) {
        out = `<a href="${escapeHtml(span.href)}">${out}</a>`;
      }
      return out;
    })
    .join('');

const renderVisitPrepHtml = (raw: string): string => {
  const blocks = parseAnswer(raw);
  const html: string[] = [];
  let openList = false;

  const closeList = () => {
    if (openList) {
      html.push('</ul>');
      openList = false;
    }
  };

  for (const block of blocks) {
    if (block.kind === 'listItem') {
      if (!openList) {
        html.push('<ul class="visit-prep-list">');
        openList = true;
      }
      // The marker is printed rather than left to the list style: a
      // `<ul>` would renumber「1. 2. 3.」into three identical bullets,
      // and the note's 建议问医生 section is a numbered list of things
      // to raise in the appointment.
      html.push(
        `<li><span class="visit-prep-marker">${escapeHtml(block.marker)}</span>` +
          `${renderSpansHtml(block.spans)}</li>`,
      );
      continue;
    }
    closeList();

    switch (block.kind) {
      case 'heading':
        html.push(`<h3 class="visit-prep-heading">${renderSpansHtml(block.spans)}</h3>`);
        break;
      case 'pair':
        html.push(
          `<p class="visit-prep-pair"><span class="visit-prep-pair-label">${escapeHtml(
            block.label,
          )}</span>${renderSpansHtml(block.spans)}</p>`,
        );
        break;
      case 'quote':
        html.push(`<blockquote>${renderSpansHtml(block.spans)}</blockquote>`);
        break;
      case 'code':
        html.push(`<pre>${escapeHtml(block.text)}</pre>`);
        break;
      case 'rule':
        html.push('<hr />');
        break;
      default:
        html.push(`<p class="visit-prep-body">${renderSpansHtml(block.spans)}</p>`);
    }
  }
  closeList();
  return html.join('\n');
};

export { renderVisitPrepHtml as _renderVisitPrepHtml };

export const buildClinicalPassportPdfFileName = (patientName: string) => {
  const safeName = patientName.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_');
  return `${safeName || 'patient'}-clinical-passport.pdf`;
};

export const buildClinicalPassportPdfHtml = (
  summary: ClinicalPassportSummary,
  /** Optional AI-drafted visit-prep note. Rendered in its own boxed
   *  section, visually separated from the passport proper and labelled
   *  as machine-drafted — a clinician reading the printout must be
   *  able to tell at a glance which parts are recorded data and which
   *  part is a summary a model wrote. */
  visitPrep?: string | null,
) => {
  const visitPrepSection = visitPrep?.trim()
    ? `
      <section class="section visit-prep">
        <div class="section-header">
          <div>
            <h2>门诊准备</h2>
            <p class="section-copy">由 AI 依据患者本人的记录整理，供沟通参考，非诊断意见。</p>
          </div>
        </div>
        ${renderVisitPrepHtml(visitPrep.trim())}
      </section>
    `
    : '';

  /**
   * 契约 §B3 在这张纸上的落点：基线里不是患者本人填的字段，逐条列出。
   *
   * 三种情况分开处理，`undefined` 不当成「没有标记」。这一项是新加的，
   * 而这个 App 是 web export，微信浏览器会缓存好几天——新前端配上还没升
   * 级的后端时字段就是 undefined。把它读成「都是本人填的」，恰好就是这
   * 整块代码要防的那句假话，所以那种情况直接说服务端没给。
   */
  const origins = summary.fieldOrigins;
  const fieldOriginsBlock =
    origins === undefined
      ? `<div class="note">
          <p class="note-title">字段来源</p>
          <p class="info-value">服务端这一版没有返回字段来源，无法确认本节的值是否都由患者本人填写。</p>
        </div>`
      : origins.length === 0
        ? ''
        : `<div class="note">
          <p class="note-title">这些字段不是患者本人填的</p>
          <ul>${origins
            .map(
              (origin) =>
                `<li>${escapeHtml(origin.labelZh)}：${
                  origin.state === 'admin_entered'
                    ? `「肌愈通」管理员于 ${safeDate(origin.at, '未记录时间')} 代为录入，不是患者本人填写。`
                    : `来源记录读不出来（${escapeHtml(origin.detail ?? '原因未记录')}），只能确定不是患者本人填写。`
                }</li>`,
            )
            .join('')}</ul>
        </div>`;

  /**
   * 逐项来源：`diagnosisCard` 把它印成值下面单独的一行
   * （`.value-origin`），不是只写在横幅里。
   *
   * `confirmation` 是证据等级，本节各个值的来源互不相同（见
   * profile.passport.ts 里 PassportValueOriginKind 的注释）。来源必须跟
   * 着值走：`confirmation === 'genetic'` 时下面那条横幅根本不印，而那种
   * 档案的分型仍然可能不是从报告里读出来的。拿着这张纸的医生要能分清哪
   * 个数是实验室出的，哪个是患者对自己的叙述。
   *
   * 服务端没给来源时不留空，也不默认「都是本人填的」——那正是这一块要
   * 防的假话。和本文件 `fieldOriginsBlock` 一样：undefined 不是「没有」。
   */
  const valueOrigins = readPassportValueOrigins(summary.diagnosis.valueOrigins);
  const diagnosisCard = (label: string, value: string, origin: PassportValueOrigin | null) => `
          <article class="info-card">
            <p class="info-label">${escapeHtml(label)}</p>
            <p class="info-value">${safeText(value)}</p>
            ${
              origin && origin.kind !== 'absent'
                ? `<p class="value-origin">${escapeHtml(origin.labelZh)}</p>`
                : ''
            }
          </article>`;
  const valueOriginsFallback = valueOrigins
    ? ''
    : `<div class="note">
          <p class="note-title">逐项来源</p>
          <p class="info-value">服务端这一版没有返回逐项来源，本节每一个值是从报告里读出来的还是谁填进去的，本平台无法说明。</p>
        </div>`;

  const summaryCards = summary.summaryCards
    .map(
      (card) => `
        <article class="metric-card">
          <div class="metric-top">
            <span class="metric-title">${escapeHtml(card.title)}</span>
            <span class="metric-status ${card.ready ? 'is-ready' : 'is-pending'}">
              ${card.ready ? '已就绪' : '待补齐'}
            </span>
          </div>
          <p class="metric-summary">${escapeHtml(card.summary)}</p>
          <p class="metric-meta">${escapeHtml(card.meta)}</p>
        </article>
      `,
    )
    .join('');

  const monitoringCards = summary.monitoring.items
    .map(
      (item) => `
        <article class="monitor-card">
          <div class="monitor-top">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="monitor-freshness">${escapeHtml(item.freshness.label)}</span>
          </div>
          <p>${escapeHtml(item.summary)}</p>
          <p class="monitor-meta">最近日期：${safeDate(item.latestDate)}</p>
          ${
            // The cardiac note is the one that has to survive printing:
            // this page gets handed to clinicians who mostly meet FSHD
            // through other dystrophies, where an annual echo is
            // correct. An empty 心脏检查 box with no explanation reads
            // as an overdue test to exactly that reader.
            item.note ? `<p class="monitor-note">${escapeHtml(item.note)}</p>` : ''
          }
        </article>
      `,
    )
    .join('');

  const timelineItems = summary.timeline
    .map(
      (item) => `
        <li class="timeline-item">
          <div class="timeline-row">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="timeline-tag">${escapeHtml(item.tag)}</span>
          </div>
          <div class="timeline-date">${safeDate(item.timestamp)}</div>
          <div class="timeline-desc">${escapeHtml(item.description)}</div>
        </li>
      `,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${safeText(summary.patientName, 'FSHD 患者')} 临床护照</title>
    <style>
      @page {
        margin: 26px 22px 32px;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        color: #213547;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
          "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
        background: #f7f3ed;
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .hero,
      .section {
        background: #ffffff;
        border: 1px solid #e3d7c9;
        border-radius: 18px;
        padding: 18px 18px 16px;
      }
      .hero {
        background: linear-gradient(135deg, #fff8ef 0%, #f8f1e7 100%);
      }
      .eyebrow {
        margin: 0 0 8px;
        color: #976945;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 26px;
        line-height: 1.3;
      }
      .hero-meta {
        margin-top: 8px;
        color: #6c5a4b;
        font-size: 13px;
        line-height: 1.6;
      }
      .hero-grid,
      .info-grid,
      .monitor-grid {
        display: grid;
        gap: 10px;
      }
      .hero-grid,
      .info-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .monitor-grid {
        grid-template-columns: 1fr;
      }
      .summary-grid {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .metric-card,
      .info-card,
      .monitor-card {
        border: 1px solid #e8dfd3;
        border-radius: 14px;
        padding: 12px;
        background: #fcfaf7;
      }
      .metric-top,
      .monitor-top,
      .timeline-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .metric-title,
      h2 {
        color: #1f2f3d;
      }
      .metric-status,
      .timeline-tag,
      .monitor-freshness,
      .freshness {
        border-radius: 999px;
        padding: 4px 9px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }
      .is-ready {
        background: #e7f4eb;
        color: #1f7a43;
      }
      .visit-prep {
        border: 1px dashed #b6cdc6;
        background: #f4f8f6;
      }
      .visit-prep-body {
        margin-top: 10px;
        color: #35505c;
        font-size: 12.5px;
        line-height: 1.75;
        /* white-space: pre-wrap is gone with the raw text it was
           there for. The note is now real block elements, and
           preserving source whitespace on top of them reintroduces the
           model's line breaks inside an already-wrapped paragraph. */
      }
      .visit-prep-heading {
        margin: 14px 0 4px;
        color: #1d3b45;
        font-size: 13px;
        font-weight: 700;
      }
      .visit-prep-list {
        margin: 6px 0 0;
        padding-left: 0;
        list-style: none;
        color: #35505c;
        font-size: 12.5px;
        line-height: 1.75;
      }
      .visit-prep-list li {
        display: flex;
        gap: 6px;
      }
      .visit-prep-marker {
        flex: none;
        min-width: 16px;
        color: #6b8189;
      }
      .visit-prep-pair {
        margin: 4px 0 0;
        color: #35505c;
        font-size: 12.5px;
        line-height: 1.75;
      }
      .visit-prep-pair-label {
        display: inline-block;
        min-width: 84px;
        color: #6b8189;
      }
      .visit-prep blockquote {
        margin: 8px 0 0;
        padding-left: 10px;
        border-left: 2px solid #b6cdc6;
        color: #4a636d;
      }
      .visit-prep pre {
        margin: 8px 0 0;
        padding: 8px;
        background: #eef3f1;
        border-radius: 4px;
        font-size: 11.5px;
        overflow-x: auto;
      }
      .is-pending {
        background: #fff0d9;
        color: #b56a08;
      }
      .timeline-tag,
      .monitor-freshness,
      .freshness {
        background: #f0e7dc;
        color: #7d5c41;
      }
      .unconfirmed-banner {
        /* Printed and handed to a neurologist who may see three FSHD
           patients in a career. A patient's own guess must not share a
           visual register with a genetic result, and grey small print
           is exactly how it would. Border and weight survive a
           photocopy and a 一块钱 print shop.

           This selector used to also carry 「.metric-summary」 and
           「.metric-meta」 — the body and footer of every summary card on
           the hero. So all four cards wore the amber "this is not
           evidence" frame, on a page whose one genuinely unconfirmed
           block is this banner. Amber that appears five times says
           nothing the fifth time, and the one place it had to be read
           was the fifth. It is the only amber on the page again. */
        margin: 6px 0 10px;
        padding: 7px 10px;
        border: 1.5px solid #8a5a00;
        background: #fff6e5;
        color: #6b4400;
        font-weight: 600;
        font-size: 11.5px;
        line-height: 1.5;
        border-radius: 4px;
      }
      /* Ordinary card text, which is what these two always were. They
         are not matched by the 「.section-copy, …」 block below, so they
         carry their own size and rhythm rather than inheriting body
         defaults from the browser. */
      .metric-summary {
        margin: 8px 0 0;
        font-size: 12.5px;
        line-height: 1.6;
        color: #4c5b68;
      }
      .metric-meta {
        margin: 4px 0 0;
        font-size: 11.5px;
        line-height: 1.5;
      }

      .section-copy,
      .monitor-card p,
      .timeline-desc,
      .timeline-date,
      li,
      .info-value {
        margin: 8px 0 0;
        font-size: 13px;
        line-height: 1.7;
        color: #4c5b68;
      }
      /* Sits under the reading of a test that may be absent, and has to
         explain why it is absent. Ruled off and set apart so it does not
         get skimmed as more of the same measurement text. */
      .monitor-card p.monitor-note {
        margin-top: 8px;
        padding-top: 7px;
        border-top: 1px solid #d8dee5;
        font-size: 11.5px;
        line-height: 1.6;
        color: #3d4a56;
      }

      .metric-meta,
      .timeline-date {
        color: #7d8891;
      }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 12px;
      }
      h2 {
        margin: 0;
        font-size: 18px;
      }
      .section-copy {
        margin: 4px 0 0;
      }
      .info-label {
        margin: 0;
        font-size: 12px;
        color: #8a8077;
      }
      /* The source of the value directly above it. Set below the value
         rather than beside it so it cannot be mistaken for a second
         reading, and kept at ink weight rather than grey-on-grey
         because this page gets photocopied at a 一块钱 print shop and a
         clinician who loses this line loses the difference between a
         laboratory's number and a patient's account of themselves. */
      .value-origin {
        margin: 4px 0 0;
        font-size: 11px;
        line-height: 1.5;
        color: #6c5a4b;
      }
      .note,
      .list-block {
        margin-top: 12px;
        border: 1px solid #e8dfd3;
        border-radius: 14px;
        padding: 12px;
        background: #fcfaf7;
      }
      .note-title {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 700;
      }
      ul,
      ol {
        margin: 8px 0 0;
        padding-left: 18px;
      }
      .timeline-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .timeline-item {
        border-left: 3px solid #d8c3ad;
        padding-left: 12px;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">Clinical Passport</p>
        <h1>${safeText(summary.patientName, '未命名病例')} 的 FSHD 临床护照</h1>
        <div class="hero-meta">
          护照 ID：${safeText(summary.passportId)}<br />
          生成时间：${safeDate(summary.generatedAt)}<br />
          最近更新：${safeDate(summary.latestUpdatedAt)}<br />
          完整度：${summary.completion.completed}/${summary.completion.total}
        </div>

        <div class="summary-grid">
          ${summaryCards}
        </div>
      </section>

      ${visitPrepSection}

      <section class="section">
        <div class="section-header">
          <div>
            <h2>诊断证据</h2>
            <p class="section-copy">集中查看基因结果、诊断日期和证据摘要。</p>
            ${
              /*
               * 横幅只说证据，不说是谁填的。
               *
               * `confirmation` 是证据等级（见 profile.passport.ts 里
               * PassportDiagnosisConfirmation 的注释），本节各张卡片的来源
               * 各不相同：基因确诊靠的是 D4Z4 重复数 / 单倍型 / EcoRI 片段
               * 之一，所以「基因确诊」时的分型仍可能是患者自己打的字；而只
               * 解析出 diagnosisType 的报告不足以基因确诊，那一行却是系统
               * 从报告里读出来的。
               *
               * 逐项来源印在下面每个值自己下面那一行，见 「diagnosisCard」。
               */
              summary.diagnosis.confirmation === 'genetic'
                ? ''
                : `<p class="unconfirmed-banner">${
                    summary.diagnosis.confirmation === 'admin_entered'
                      ? '⚠ 未经基因确诊：本平台未从该患者上传的报告里读到 D4Z4 重复数、4q 单倍型或 EcoRI 片段，且档案里的「确诊年份」不是患者本人填写的（详见本节末尾的字段来源），请勿据此确认诊断。'
                      : summary.diagnosis.confirmation === 'self_reported'
                        ? '⚠ 未经基因确诊：本平台未从该患者上传的报告里读到 D4Z4 重复数、4q 单倍型或 EcoRI 片段，本节内容不构成诊断依据，请勿据此确认诊断。'
                        : // 不写「本节为空」：这个状态只表示没有分型、没有诊断
                          // 日期，也没有 D4Z4/单倍型/EcoRI；甲基化不在这三项
                          // 里，只解析出甲基化值的报告会落在这里，而那张卡片
                          // 上是有值的。
                          '⚠ 尚无诊断依据：本平台没有可展示的分型或诊断日期，也没有可作确诊依据的基因结果，请勿据此确认诊断。'
                  }</p>`
            }
          </div>
          <span class="freshness">${escapeHtml(summary.diagnosis.freshness.label)}</span>
        </div>
        <div class="info-grid">
          ${diagnosisCard('基因类型', summary.diagnosis.geneticType, valueOrigins?.geneticType ?? null)}
          ${diagnosisCard('D4Z4 重复数', summary.diagnosis.d4z4Repeats, valueOrigins?.d4z4Repeats ?? null)}
          ${diagnosisCard('甲基化值', summary.diagnosis.methylationValue, valueOrigins?.methylationValue ?? null)}
          ${diagnosisCard('诊断日期', summary.diagnosis.diagnosisDate, valueOrigins?.diagnosisDate ?? null)}
        </div>
        <div class="note">
          <p class="note-title">证据摘要</p>
          <p class="info-value">${safeText(summary.diagnosis.geneEvidence)}</p>
        </div>
        ${valueOriginsFallback}
        ${fieldOriginsBlock}
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <h2>影像受累与功能变化</h2>
            <p class="section-copy">以 MRI 识别结果和最近日常记录变化为主，不再强调主观肌力体图。</p>
          </div>
        </div>
        <div class="info-grid">
          <article class="info-card">
            <p class="info-label">最近记录</p>
            <p class="info-value">${safeDate(summary.motor.latestActivityAt || summary.motor.latestMeasurementAt)}</p>
          </article>
          <article class="info-card">
            <p class="info-label">最近 MRI</p>
            <p class="info-value">${safeDate(summary.imaging.latestMriDate)}</p>
          </article>
        </div>
        <div class="list-block">
          <p class="note-title">MRI 重点区域</p>
          <ul>${renderList(summary.imaging.highlights, '暂无 MRI 重点区域')}</ul>
        </div>
        <div class="note">
          <p class="note-title">最近功能变化</p>
          <p class="info-value">${safeText(summary.motor.activitySummary)}</p>
        </div>
        <div class="note">
          <p class="note-title">MRI 摘要</p>
          <p class="info-value">${safeText(summary.imaging.summary)}</p>
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <h2>检查结果</h2>
            <p class="section-copy">血检、呼吸和心脏相关结果的最新摘要。</p>
          </div>
        </div>
        <div class="monitor-grid">
          ${monitoringCards}
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <h2>待补项</h2>
            <p class="section-copy">仍建议尽快补充的记录项目。</p>
          </div>
        </div>
        <div class="list-block">
          <ul>
            ${
              summary.nextSteps.length > 0
                ? summary.nextSteps
                    .map(
                      (item) =>
                        `<li><strong>${escapeHtml(item.title)}</strong>：${escapeHtml(item.description)}</li>`,
                    )
                    .join('')
                : '<li>当前没有明显缺口</li>'
            }
          </ul>
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <h2>时间轴</h2>
            <p class="section-copy">便于和医生快速核对近期录入和上传的内容。</p>
          </div>
        </div>
        <ol class="timeline-list">
          ${timelineItems || '<li class="timeline-item">暂无时间轴内容</li>'}
        </ol>
      </section>
    </main>
  </body>
</html>`;
};
