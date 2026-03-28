import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { OcrProvider, OcrResult } from './ocr-provider.js';
import { AppError } from '../../utils/app-error.js';

const execFileAsync = promisify(execFile);

interface EmbeddedReportOcrConfig {
  pythonBin?: string;
  timeoutMs?: number;
  scriptPath?: string;
}

interface EmbeddedParsePayload {
  provider?: string;
  extracted_text?: string;
  analysis?: Record<string, unknown>;
  error?: string;
  detail?: string;
}

interface StructuredField {
  field_name?: unknown;
  field_value?: unknown;
  normalized_value?: unknown;
  unit?: unknown;
  source_text?: unknown;
  confidence?: unknown;
  side?: unknown;
  muscle_name?: unknown;
  body_region?: unknown;
  region?: unknown;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toStringField = (value: unknown) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
};

const toCamelCase = (value: string) =>
  value.replace(/_([a-z])/g, (_, chr: string) => chr.toUpperCase());

const formatStructuredValue = (field: StructuredField) => {
  const normalized = field.normalized_value;
  const raw = field.field_value;
  const base =
    normalized !== null && normalized !== undefined && normalized !== ''
      ? String(normalized)
      : raw !== null && raw !== undefined
        ? String(raw)
        : '';
  const unit = toStringField(field.unit);
  if (!base) return undefined;
  if (unit && !base.includes(unit)) {
    return `${base}${unit}`;
  }
  return base;
};

const formatAggregateStrength = (items: Array<Record<string, unknown>>) => {
  const left = items.find((item) => item.side === 'left')?.mrc_score;
  const right = items.find((item) => item.side === 'right')?.mrc_score;
  const generic = items.find(
    (item) => item.side === 'unspecified' || item.side === 'bilateral',
  )?.mrc_score;
  const leftText = toStringField(left);
  const rightText = toStringField(right);
  const genericText = toStringField(generic);

  if (leftText || rightText) {
    const parts = [];
    if (leftText) parts.push(`L${leftText}`);
    if (rightText) parts.push(`R${rightText}`);
    return parts.join(' / ');
  }
  return genericText;
};

const resolveScriptPath = (explicit?: string) => {
  const candidates = [
    explicit,
    path.resolve(process.cwd(), 'apps/report-manager/embedded_parser.py'),
    path.resolve(process.cwd(), '../report-manager/embedded_parser.py'),
    path.resolve(__dirname, '../../../../report-manager/embedded_parser.py'),
  ].filter((value): value is string => Boolean(value));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new AppError('Embedded report parser script not found', 500);
  }
  return found;
};

const resolveExtension = (mimeType: string | null, fileName?: string) => {
  const fromName = fileName?.match(/(\.[A-Za-z0-9]+)$/)?.[1];
  if (fromName) return fromName;
  switch (mimeType) {
    case 'application/pdf':
      return '.pdf';
    case 'image/png':
      return '.png';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    default:
      return '.bin';
  }
};

const buildFields = (
  analysis: Record<string, unknown>,
  documentTypeHint: string,
  extractedText: string,
): { fields: Record<string, string>; confidence?: number } => {
  const normalizedExtractedText = extractedText.trim();
  const fshd = toRecord(analysis.fshd);
  const reviewQueue = Array.isArray(fshd?.review_queue) ? fshd.review_queue : [];
  const analysisStatus = normalizedExtractedText ? 'completed' : 'needs_review';
  const fields: Record<string, string> = {
    documentType: documentTypeHint,
    analysisStatus,
    ocrStatus: normalizedExtractedText ? 'text_extracted' : 'empty_text',
    extractedTextLength: String(normalizedExtractedText.length),
  };

  const encounter = toRecord(analysis.encounter_info);
  const patientInfo = toRecord(analysis.patient_info);
  const normalizedSummary = toRecord(fshd?.normalized_summary);
  const structuredFields = Array.isArray(fshd?.structured_fields)
    ? (fshd?.structured_fields as StructuredField[])
    : [];

  const classifiedType = toStringField(fshd?.report_type);
  const classifiedTypeConfidence = toStringField(fshd?.report_type_confidence);
  if (classifiedType) {
    fields.classifiedType = classifiedType;
  }
  if (classifiedTypeConfidence) {
    fields.classifiedTypeConfidence = classifiedTypeConfidence;
  }

  const reportTypeLabel = toStringField(fshd?.report_type_label);
  if (reportTypeLabel) {
    fields.reportTypeLabel = reportTypeLabel;
  }

  const reportTime = toStringField(encounter?.report_time);
  if (reportTime) {
    fields.reportTime = reportTime;
  }

  const facility = toStringField(encounter?.facility);
  if (facility) {
    fields.facility = facility;
  }

  const patientName = toStringField(patientInfo?.name);
  if (patientName) {
    fields.patientName = patientName;
  }

  for (const field of structuredFields) {
    const fieldName = toStringField(field.field_name);
    const valueText = formatStructuredValue(field);
    if (!fieldName || !valueText) continue;
    fields[fieldName] = valueText;
    fields[toCamelCase(fieldName)] = valueText;
  }

  const geneticSummary = toRecord(normalizedSummary?.genetic_summary);
  if (geneticSummary) {
    const diagnosisType = toStringField(geneticSummary.diagnosis_type);
    const ecoriFragmentKb = toStringField(geneticSummary.ecori_fragment_kb);
    const pathogenicRepeats = toStringField(geneticSummary.d4z4_repeat_pathogenic);
    const methylationValue = toStringField(geneticSummary.methylation_value);
    const interpretationSummary = toStringField(geneticSummary.interpretation_summary);

    if (diagnosisType) {
      fields.diagnosisType = diagnosisType;
      fields.geneticType = diagnosisType;
    }
    if (ecoriFragmentKb) {
      fields.ecoriFragmentKb = ecoriFragmentKb;
      fields.ecoRIFragment = `${ecoriFragmentKb}kb`;
    }
    if (pathogenicRepeats) {
      fields.d4z4RepeatPathogenic = pathogenicRepeats;
      fields.d4z4Repeats = pathogenicRepeats;
    }
    if (methylationValue) {
      fields.methylationValue = methylationValue;
    }
    if (interpretationSummary) {
      fields.interpretationSummary = interpretationSummary;
    }
  }

  const muscleStrength = Array.isArray(normalizedSummary?.muscle_strength)
    ? (normalizedSummary?.muscle_strength as Array<Record<string, unknown>>)
    : [];
  const byMuscle = new Map<string, Array<Record<string, unknown>>>();
  for (const item of muscleStrength) {
    const muscleName = toStringField(item.muscle_name);
    if (!muscleName) continue;
    const existing = byMuscle.get(muscleName) ?? [];
    existing.push(item);
    byMuscle.set(muscleName, existing);
  }
  const strengthAliases: Record<string, string> = {
    deltoid: 'deltoidStrength',
    biceps: 'bicepsStrength',
    triceps: 'tricepsStrength',
    quadriceps: 'quadricepsStrength',
    tibialis_anterior: 'tibialisStrength',
  };
  for (const [muscleName, key] of Object.entries(strengthAliases)) {
    const aggregate = formatAggregateStrength(byMuscle.get(muscleName) ?? []);
    if (aggregate) {
      fields[key] = aggregate;
    }
  }

  const mriSummary = toRecord(normalizedSummary?.mri_summary);
  const reportImpression =
    toStringField(mriSummary?.report_impression) ?? toStringField(fields.reportImpression);
  if (reportImpression) {
    fields.reportImpression = reportImpression;
    fields.impressionText = reportImpression;
  }

  const cardio = toRecord(normalizedSummary?.cardio_respiratory_panel);
  if (cardio) {
    const directKeys = [
      'fvc',
      'fvcPredPct',
      'fev1',
      'fev1PredPct',
      'fev1Fvc',
      'tlc',
      'tlcPredPct',
      'dlco',
      'dlcoPredPct',
      'dlcoVa',
      'ventilatoryPattern',
      'severity',
      'diffusionStatus',
      'diaphragmMotionSummary',
      'diaphragmThickeningSummary',
      'ecgRhythm',
      'heartRate',
      'prIntervalMs',
      'qrsDurationMs',
      'qtMs',
      'qtcMs',
      'conductionAbnormality',
      'ecgSummary',
      'lvef',
      'fs',
      'co',
      'hr',
      'lad',
      'aod',
      'lvdD',
      'eOverEPrime',
      'chamberSizeStatus',
      'wallMotionStatus',
      'valveStatus',
      'echoSummary',
    ];
    for (const key of directKeys) {
      const snakeKey = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
      const valueText = toStringField(cardio[key]) ?? toStringField(cardio[snakeKey]);
      if (valueText) {
        fields[key] = valueText;
      }
    }
  }

  const labPanel = toRecord(normalizedSummary?.lab_panel);
  if (labPanel) {
    const directKeys = ['ck', 'mb', 'ldh', 'ckmb', 'creatinine', 'uricAcid', 'alt', 'ast'];
    for (const key of directKeys) {
      const snakeKey = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
      const valueText = toStringField(labPanel[key]) ?? toStringField(labPanel[snakeKey]);
      if (valueText) {
        fields[key] = valueText;
      }
    }
    if (fields.ck) {
      fields.creatineKinase = fields.ck;
    }
  }

  fields.reviewRecommendedCount = String(reviewQueue.length);
  fields.fieldCount = String(structuredFields.length);
  if (!normalizedExtractedText) {
    fields.ocrIssue = 'No text was extracted from the uploaded file';
  }

  return {
    fields,
    confidence:
      typeof fshd?.report_type_confidence === 'number' ? fshd.report_type_confidence : undefined,
  };
};

export class EmbeddedReportOcrProvider implements OcrProvider {
  private readonly pythonBin: string;
  private readonly timeoutMs: number;
  private readonly scriptPath: string;

  constructor(config: EmbeddedReportOcrConfig = {}) {
    this.pythonBin = config.pythonBin?.trim() || 'python3';
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.scriptPath = resolveScriptPath(config.scriptPath);
  }

  async parse(input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    userId?: string | number;
    fileName?: string;
    reportName?: string;
  }): Promise<OcrResult> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'openrd-report-'));
    const extension = resolveExtension(input.mimeType, input.fileName);
    const tempFile = path.join(tempDir, `input${extension}`);

    try {
      await writeFile(tempFile, input.buffer);

      const { stdout, stderr } = await execFileAsync(
        this.pythonBin,
        [
          this.scriptPath,
          '--file-path',
          tempFile,
          '--mime-type',
          input.mimeType ?? 'application/octet-stream',
          '--document-type-hint',
          input.documentType,
          '--report-name',
          input.reportName ?? input.fileName ?? `document-${input.documentType}`,
        ],
        {
          cwd: process.cwd(),
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: process.env,
        },
      );

      const trimmed = stdout.trim();
      if (!trimmed) {
        throw new AppError(
          `Embedded report parser returned empty stdout${stderr ? `: ${stderr}` : ''}`,
          502,
        );
      }

      let payload: EmbeddedParsePayload;
      try {
        payload = JSON.parse(trimmed) as EmbeddedParsePayload;
      } catch (error) {
        throw new AppError(`Embedded report parser returned invalid JSON: ${String(error)}`, 502);
      }

      if (payload.error) {
        throw new AppError(
          `Embedded report parser failed: ${payload.detail ?? payload.error}`,
          502,
        );
      }

      const analysis = toRecord(payload.analysis);
      if (!analysis) {
        throw new AppError('Embedded report parser returned empty analysis payload', 502);
      }

      const mapped = buildFields(analysis, input.documentType, payload.extracted_text ?? '');

      return {
        provider: payload.provider ?? 'embedded_report_pipeline_v1',
        extractedText: payload.extracted_text ?? '',
        fields: mapped.fields,
        confidence: mapped.confidence,
        aiExtraction: analysis,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(`Embedded report OCR failed: ${message}`, 502);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
