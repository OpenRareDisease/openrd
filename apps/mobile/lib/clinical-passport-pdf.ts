import type { ClinicalPassportSummary } from './api';
import { formatDateLabel } from './clinical-visuals';

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

export const buildClinicalPassportPdfFileName = (patientName: string) => {
  const safeName = patientName.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_');
  return `${safeName || 'patient'}-clinical-passport.pdf`;
};

export const buildClinicalPassportPdfHtml = (summary: ClinicalPassportSummary) => {
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
      .metric-summary,
      .metric-meta,
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

      <section class="section">
        <div class="section-header">
          <div>
            <h2>诊断证据</h2>
            <p class="section-copy">集中查看基因结果、诊断日期和证据摘要。</p>
          </div>
          <span class="freshness">${escapeHtml(summary.diagnosis.freshness.label)}</span>
        </div>
        <div class="info-grid">
          <article class="info-card">
            <p class="info-label">基因类型</p>
            <p class="info-value">${safeText(summary.diagnosis.geneticType)}</p>
          </article>
          <article class="info-card">
            <p class="info-label">D4Z4 重复数</p>
            <p class="info-value">${safeText(summary.diagnosis.d4z4Repeats)}</p>
          </article>
          <article class="info-card">
            <p class="info-label">甲基化值</p>
            <p class="info-value">${safeText(summary.diagnosis.methylationValue)}</p>
          </article>
          <article class="info-card">
            <p class="info-label">诊断日期</p>
            <p class="info-value">${safeText(summary.diagnosis.diagnosisDate)}</p>
          </article>
        </div>
        <div class="note">
          <p class="note-title">证据摘要</p>
          <p class="info-value">${safeText(summary.diagnosis.geneEvidence)}</p>
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <h2>运动功能与影像</h2>
            <p class="section-copy">结合肌力记录、活动日志和 MRI 摘要快速查看当前受累情况。</p>
          </div>
        </div>
        <div class="info-grid">
          <article class="info-card">
            <p class="info-label">平均肌力</p>
            <p class="info-value">${safeText(summary.motor.average)} 级</p>
          </article>
          <article class="info-card">
            <p class="info-label">最近 MRI</p>
            <p class="info-value">${safeDate(summary.imaging.latestMriDate)}</p>
          </article>
        </div>
        <div class="list-block">
          <p class="note-title">重点区域</p>
          <ul>${renderList(summary.motor.highlights, '暂无结构化肌力重点区域')}</ul>
        </div>
        <div class="note">
          <p class="note-title">活动摘要</p>
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
            <h2>系统监测</h2>
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
            <h2>最近来源时间轴</h2>
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
