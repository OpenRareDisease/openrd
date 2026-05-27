/**
 * Patient reports retriever.
 *
 * Joins `patient_documents` to the authenticated user's profile and
 * returns the most recent N reports whose `ocr_payload` carries
 * structured fields. Each report becomes one chunk; the orchestrator
 * (with the PIIRedactor) decides what subset of fields makes it into
 * the prompt.
 *
 * Optional filter keys:
 *   - `documentType`: filter to a specific report type
 *     (e.g. `genetic_report`, `mri`, `lab`).
 *   - `since`: ISO date string; only reports uploaded on/after this
 *     date are returned.
 *
 * Like the profile retriever this refuses to read when there's no
 * user in scope or consent is `none`.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  Citation,
  IRetriever,
  RetrieveContext,
  RetrieveInput,
  RetrieveResult,
  RetrievedChunk,
} from './base.js';
import { buildSnippet, emptyResult } from './base.js';

interface ReportRow {
  id: string;
  document_type: string;
  title: string | null;
  uploaded_at: string | Date;
  status: string;
  ocr_payload: Record<string, unknown> | null;
  classified_type: string | null;
}

const RECENT_LIMIT_DEFAULT = 5;
const RECENT_LIMIT_MAX = 20;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const formatTimestamp = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

const renderReportChunk = (row: ReportRow): string => {
  const lines: string[] = [];
  const reportType = row.classified_type ?? row.document_type ?? 'unknown';
  lines.push(`【患者报告 / ${reportType}】`);

  const uploadedAt = formatTimestamp(row.uploaded_at);
  if (uploadedAt) lines.push(`上传时间: ${uploadedAt.slice(0, 10)}`);
  if (row.title) lines.push(`报告标题: ${row.title}`);
  if (row.status) lines.push(`状态: ${row.status}`);

  const fields = isPlainObject(row.ocr_payload?.fields)
    ? (row.ocr_payload?.fields as Record<string, unknown>)
    : null;

  if (fields) {
    const fieldLines: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') {
        fieldLines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        fieldLines.push(`${key}: ${String(value)}`);
      }
    }
    if (fieldLines.length > 0) {
      lines.push('关键字段:');
      lines.push(...fieldLines.map((l) => `  - ${l}`));
    }
  }

  if (lines.length === 1) {
    lines.push('（暂无 OCR 抽取字段）');
  }
  return lines.join('\n');
};

const coerceSince = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || !raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const coerceDocumentType = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;

export class PatientReportsRetriever implements IRetriever {
  readonly id = 'patient_reports';
  readonly kind = 'sql' as const;

  constructor(private readonly pool: Pool) {}

  async search(input: RetrieveInput, ctx: RetrieveContext): Promise<RetrieveResult> {
    if (!ctx.userId) {
      return emptyResult(this.id, 'no_user_in_scope');
    }
    if (ctx.consentLevel === 'none' || ctx.consentLevel === undefined) {
      return emptyResult(this.id, 'consent_not_granted');
    }

    const requestedLimit = input.limit ?? RECENT_LIMIT_DEFAULT;
    const limit = Math.min(Math.max(1, requestedLimit), RECENT_LIMIT_MAX);

    const documentType = coerceDocumentType(input.filter?.documentType);
    const since = coerceSince(input.filter?.since);

    const conditions: string[] = ['pp.user_id = $1', 'pd.ocr_payload IS NOT NULL'];
    const params: unknown[] = [ctx.userId];
    if (documentType) {
      params.push(documentType);
      conditions.push(`pd.document_type = $${params.length}`);
    }
    if (since) {
      params.push(since);
      conditions.push(`pd.uploaded_at >= $${params.length}`);
    }
    params.push(limit);
    const limitParam = `$${params.length}`;

    const result = await this.pool.query<ReportRow>(
      `SELECT pd.id,
              pd.document_type,
              pd.title,
              pd.uploaded_at,
              pd.status,
              pd.ocr_payload,
              (pd.ocr_payload->'fields'->>'classifiedType') AS classified_type
       FROM patient_documents pd
       JOIN patient_profiles pp ON pp.id = pd.profile_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY pd.uploaded_at DESC
       LIMIT ${limitParam}`,
      params,
    );

    if (result.rowCount === 0) {
      return emptyResult(this.id, 'no_reports_found', {
        documentType: documentType ?? null,
        since: since ?? null,
      });
    }

    const chunks: RetrievedChunk[] = [];
    const citations: Citation[] = [];

    result.rows.forEach((row, idx) => {
      const content = renderReportChunk(row);
      const chunkId = randomUUID();
      const sourceFile = `patient_reports/${row.id}`;

      chunks.push({
        id: chunkId,
        source: this.id,
        content,
        metadata: {
          documentId: row.id,
          documentType: row.document_type,
          classifiedType: row.classified_type,
          uploadedAt: formatTimestamp(row.uploaded_at),
          status: row.status,
        },
        distance: null,
        sourceFile,
        chunkIndex: idx,
      });
      citations.push({
        chunkId,
        source: this.id,
        sourceFile,
        chunkIndex: idx,
        snippet: buildSnippet(content),
      });
    });

    return {
      retrieverId: this.id,
      chunks,
      citations,
      metadata: {
        documentCount: result.rowCount,
        documentType: documentType ?? null,
        since: since ?? null,
      },
    };
  }
}
