import type { OcrProvider, OcrResult } from './ocr-provider.js';
import { AppError } from '../../utils/app-error.js';

interface ReportManagerOcrConfig {
  endpoint: string;
  apiKey?: string;
  defaultUserId?: number;
}

interface ReportManagerResponse {
  id: number;
  report_name: string;
  user_id: number;
  ocr_text?: string | null;
  ai_extraction?: unknown;
  d4z4_repeats?: number | null;
  methylation_value?: number | null;
  serratus_fatigue_grade?: number | null;
  deltoid_strength?: string | null;
  biceps_strength?: string | null;
  triceps_strength?: string | null;
  quadriceps_strength?: string | null;
  liver_function?: string | null;
  creatine_kinase?: number | null;
  stair_test_result?: string | null;
}

const toStringField = (value: unknown) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  return String(value);
};

const pickAnalyteValue = (
  byAnalyte: Record<string, unknown>,
  keywords: string[],
): string | undefined => {
  const entries = Object.entries(byAnalyte);
  for (const keyword of keywords) {
    const direct = entries.find(([name]) => name === keyword);
    if (direct) {
      const value = direct[1] as Record<string, unknown> | undefined;
      const text = toStringField(value?.value_text);
      if (text) return text;
      const num = toStringField(value?.value_num);
      const unit = toStringField(value?.unit) ?? '';
      if (num) return `${num}${unit}`;
    }
  }

  for (const keyword of keywords) {
    const fuzzy = entries.find(([name]) => name.includes(keyword));
    if (!fuzzy) continue;
    const value = fuzzy[1] as Record<string, unknown> | undefined;
    const text = toStringField(value?.value_text);
    if (text) return text;
    const num = toStringField(value?.value_num);
    const unit = toStringField(value?.unit) ?? '';
    if (num) return `${num}${unit}`;
  }

  return undefined;
};

const pickAiExtractionField = (ai: unknown, keywords: string[]): string | undefined => {
  if (!ai || typeof ai !== 'object') return undefined;
  const byAnalyte = (ai as { latest_summary?: { by_analyte?: Record<string, unknown> } })
    .latest_summary?.by_analyte;
  if (!byAnalyte || typeof byAnalyte !== 'object') return undefined;
  return pickAnalyteValue(byAnalyte as Record<string, unknown>, keywords);
};

const parseJsonFromFence = (raw: string) => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
};

const normalizeAiExtraction = (ai: unknown) => {
  if (!ai) return ai;
  if (typeof ai === 'string') {
    return parseJsonFromFence(ai) ?? ai;
  }
  if (typeof ai === 'object') {
    const raw = (ai as { raw_response?: unknown }).raw_response;
    if (typeof raw === 'string') {
      return parseJsonFromFence(raw) ?? ai;
    }
  }
  return ai;
};

const pickReportTime = (ai: unknown): string | undefined => {
  if (!ai || typeof ai !== 'object') return undefined;
  const encounter = (ai as { encounter_info?: { report_time?: unknown } }).encounter_info;
  return toStringField(encounter?.report_time);
};

const pickFindingsSummary = (ai: unknown): { findingText?: string; impressionText?: string } => {
  if (!ai || typeof ai !== 'object') return {};
  const findings = (ai as { findings?: Array<Record<string, unknown>> }).findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    return {};
  }
  const first = findings[0] ?? {};
  return {
    findingText: toStringField(first.finding_text),
    impressionText: toStringField(first.impression_text),
  };
};

export class ReportManagerOcrProvider implements OcrProvider {
  private readonly config: ReportManagerOcrConfig;

  constructor(config: ReportManagerOcrConfig) {
    if (!config.endpoint) {
      throw new AppError('Missing Report Manager OCR endpoint', 500);
    }
    this.config = config;
  }

  async parse(input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    userId?: string | number;
    fileName?: string;
    reportName?: string;
  }): Promise<OcrResult> {
    const reportName =
      input.reportName?.trim() ||
      input.fileName?.replace(/\.[^.]+$/, '') ||
      `document-${input.documentType}`;
    const numericUserId =
      typeof input.userId === 'number'
        ? input.userId
        : typeof input.userId === 'string' && input.userId.trim()
          ? Number(input.userId)
          : NaN;
    const userId = Number.isFinite(numericUserId)
      ? numericUserId
      : (this.config.defaultUserId ?? 0);

    const form = new FormData();
    form.set(
      'file',
      new Blob([input.buffer], {
        type: input.mimeType ?? 'application/octet-stream',
      }),
      input.fileName ?? 'document.pdf',
    );
    form.set('report_name', reportName);
    form.set('user_id', String(userId));

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      body: form,
      headers,
    });

    const payload = (await response.json().catch(() => null)) as
      | ReportManagerResponse
      | { detail?: string };

    if (!response.ok) {
      const detail =
        payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : undefined;
      const message =
        typeof detail === 'string'
          ? detail
          : detail
            ? JSON.stringify(detail)
            : payload
              ? JSON.stringify(payload)
              : response.statusText;
      throw new AppError(`Report Manager OCR failed: ${message}`, 502);
    }

    const aiExtraction = normalizeAiExtraction(payload?.ai_extraction);
    const reportTime = pickReportTime(aiExtraction);
    const { findingText, impressionText } = pickFindingsSummary(aiExtraction);
    const fields: Record<string, string> = {
      documentType: input.documentType,
    };

    const reportId = toStringField(payload?.id);
    if (reportId) {
      fields.reportId = reportId;
    }

    const fieldMap: Record<string, unknown> = {
      reportName: payload?.report_name,
      reportTime,
      findingText,
      impressionText,
      hint: impressionText ?? findingText,
      d4z4Repeats:
        payload?.d4z4_repeats ??
        pickAiExtractionField(aiExtraction, ['D4Z4重复数', 'D4Z4重复', 'D4Z4 repeats']),
      methylationValue:
        payload?.methylation_value ??
        pickAiExtractionField(aiExtraction, ['甲基化值', '甲基化', 'methylation']),
      serratusFatigueGrade:
        payload?.serratus_fatigue_grade ??
        pickAiExtractionField(aiExtraction, ['前锯肌脂肪化等级', '前锯肌脂肪化', 'serratus']),
      deltoidStrength:
        payload?.deltoid_strength ??
        pickAiExtractionField(aiExtraction, ['三角肌肌力', '三角肌', 'deltoid']),
      bicepsStrength:
        payload?.biceps_strength ??
        pickAiExtractionField(aiExtraction, ['肱二头肌肌力', '肱二头肌', 'biceps']),
      tricepsStrength:
        payload?.triceps_strength ??
        pickAiExtractionField(aiExtraction, ['肱三头肌肌力', '肱三头肌', 'triceps']),
      quadricepsStrength:
        payload?.quadriceps_strength ??
        pickAiExtractionField(aiExtraction, ['股四头肌肌力', '股四头肌', 'quadriceps']),
      liverFunction:
        payload?.liver_function ?? pickAiExtractionField(aiExtraction, ['肝功能', 'ALT', 'AST']),
      creatineKinase:
        payload?.creatine_kinase ??
        pickAiExtractionField(aiExtraction, ['肌酸激酶', 'CK', 'Creatine kinase']),
      stairTestResult:
        payload?.stair_test_result ??
        pickAiExtractionField(aiExtraction, ['楼梯测试', '爬楼', 'stair test']),
    };

    for (const [key, value] of Object.entries(fieldMap)) {
      const text = toStringField(value);
      if (text !== undefined) {
        fields[key] = text;
      }
    }

    return {
      provider: 'report_manager_002',
      extractedText: payload?.ocr_text ?? '',
      fields,
      aiExtraction,
    };
  }
}
