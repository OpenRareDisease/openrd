import type { Response } from 'express';
import OpenAI from 'openai';
import {
  activityLogSchema,
  baselineProfileSchema,
  createSubmissionSchema,
  createProfileSchema,
  dailyImpactSchema,
  documentSchema,
  documentUploadSchema,
  followupEventSchema,
  functionTestSchema,
  measurementSchema,
  medicationSchema,
  symptomScoreSchema,
  attachDocumentsSchema,
  muscleInsightQuerySchema,
  submissionListQuerySchema,
  updateProfileSchema,
} from './profile.schema.js';
import type { PatientProfileService } from './profile.service.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { OcrProvider } from '../../services/ocr/ocr-provider.js';
import { ReportManagerOcrProvider } from '../../services/ocr/report-manager-ocr.js';
import type { StorageProvider } from '../../services/storage/storage-provider.js';
import { AppError } from '../../utils/app-error.js';

type AiSummaryDeps = {
  client: OpenAI;
  model: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pickText = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
};

const buildFallbackDocumentSummary = (documentType: string, fields: Record<string, unknown>) => {
  const typeLabel =
    pickText(fields, ['reportTypeLabel']) ||
    pickText(fields, ['classifiedType', 'documentType']) ||
    documentType ||
    '报告';

  const joinParts = (parts: string[]) =>
    parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join('；');

  switch (documentType) {
    case 'genetic_report': {
      const summary = joinParts([
        pickText(fields, ['diagnosisType', 'geneticType']) &&
          `提示类型 ${pickText(fields, ['diagnosisType', 'geneticType'])}`,
        pickText(fields, ['d4z4Repeats', 'd4z4RepeatPathogenic']) &&
          `D4Z4 重复数 ${pickText(fields, ['d4z4Repeats', 'd4z4RepeatPathogenic'])}`,
        pickText(fields, ['haplotype']) && `单倍型 ${pickText(fields, ['haplotype'])}`,
        pickText(fields, ['ecoRIFragment', 'ecoriFragmentKb']) &&
          `EcoRI 片段 ${pickText(fields, ['ecoRIFragment', 'ecoriFragmentKb'])}`,
      ]);
      return summary
        ? `${typeLabel}结构化结果显示：${summary}。基于结构化解析自动生成，仅供参考。`
        : `${typeLabel}已完成结构化解析，但关键信息仍需结合原报告确认。`;
    }
    case 'pulmonary_function': {
      const summary = joinParts([
        pickText(fields, ['ventilatoryPattern']) &&
          `通气模式 ${pickText(fields, ['ventilatoryPattern'])}`,
        pickText(fields, ['fvcPredPct']) && `FVC 预计值占比 ${pickText(fields, ['fvcPredPct'])}`,
        pickText(fields, ['dlcoPredPct', 'diffusionStatus']) &&
          `弥散相关 ${pickText(fields, ['dlcoPredPct', 'diffusionStatus'])}`,
      ]);
      return summary
        ? `${typeLabel}结构化结果显示：${summary}。基于结构化解析自动生成，仅供参考。`
        : `${typeLabel}已完成结构化解析，但通气/弥散结论未明确提取。`;
    }
    case 'muscle_mri': {
      const impression = pickText(fields, ['reportImpression', 'impressionText']);
      return impression
        ? `${typeLabel}结构化结果提示：${impression}。基于结构化解析自动生成，仅供参考。`
        : `${typeLabel}已完成结构化解析，但影像印象仍需查看原文。`;
    }
    case 'ecg': {
      const summary = joinParts([
        pickText(fields, ['ecgSummary', 'ecgRhythm']) &&
          `心电结论 ${pickText(fields, ['ecgSummary', 'ecgRhythm'])}`,
        pickText(fields, ['heartRate']) && `心率 ${pickText(fields, ['heartRate'])}`,
        pickText(fields, ['conductionAbnormality']) &&
          `传导异常 ${pickText(fields, ['conductionAbnormality'])}`,
      ]);
      return summary
        ? `${typeLabel}结构化结果显示：${summary}。基于结构化解析自动生成，仅供参考。`
        : `${typeLabel}已完成结构化解析，但心电结论未明确提取。`;
    }
    case 'echocardiography': {
      const summary = joinParts([
        pickText(fields, ['echoSummary']) && `超声结论 ${pickText(fields, ['echoSummary'])}`,
        pickText(fields, ['lvef']) && `LVEF ${pickText(fields, ['lvef'])}`,
      ]);
      return summary
        ? `${typeLabel}结构化结果显示：${summary}。基于结构化解析自动生成，仅供参考。`
        : `${typeLabel}已完成结构化解析，但超声关键结论未明确提取。`;
    }
    default: {
      const summary = joinParts([
        pickText(fields, ['ck']) && `CK ${pickText(fields, ['ck'])}`,
        pickText(fields, ['ldh']) && `LDH ${pickText(fields, ['ldh'])}`,
        pickText(fields, ['ckmb']) && `CKMB ${pickText(fields, ['ckmb'])}`,
        pickText(fields, ['reportImpression', 'ecgSummary', 'echoSummary']),
      ]);
      return summary
        ? `${typeLabel}结构化结果显示：${summary}。基于结构化解析自动生成，仅供参考。`
        : `${typeLabel}已完成结构化解析，建议结合原始报告查看细节。`;
    }
  }
};

const resolveDocumentTypeFromPayload = (fallbackType: string, payload: unknown) => {
  const payloadObj = isRecord(payload) ? payload : null;
  const fields =
    payloadObj && isRecord(payloadObj.fields)
      ? (payloadObj.fields as Record<string, unknown>)
      : null;

  const candidates = [
    fields?.classifiedType,
    fields?.classified_type,
    fields?.reportType,
    fields?.report_type,
    fields?.documentType,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (!normalized || normalized === 'other' || normalized === 'unknown') continue;
    return normalized;
  }

  return fallbackType;
};

const resolveDocumentStatusFromPayload = (payload: unknown) => {
  const payloadObj = isRecord(payload) ? payload : null;
  if (!payloadObj) {
    return 'uploaded';
  }

  if (typeof payloadObj.error === 'string' && payloadObj.error.trim()) {
    return 'parse_failed';
  }

  const fields =
    payloadObj.fields && isRecord(payloadObj.fields)
      ? (payloadObj.fields as Record<string, unknown>)
      : null;
  const analysisStatusCandidate = fields?.analysisStatus ?? fields?.analysis_status;
  const analysisStatus =
    typeof analysisStatusCandidate === 'string' ? analysisStatusCandidate.trim() : '';

  switch (analysisStatus) {
    case 'completed':
      return 'parsed';
    case 'needs_review':
      return 'needs_review';
    case 'processing':
      return 'processing';
    case 'failed':
      return 'parse_failed';
    default:
      return 'uploaded';
  }
};

export class PatientProfileController {
  constructor(
    private readonly service: PatientProfileService,
    private readonly storage: StorageProvider,
    private readonly ocr: OcrProvider,
    private readonly aiSummary?: AiSummaryDeps,
  ) {}

  createProfile = async (req: AuthenticatedRequest, res: Response) => {
    const payload = createProfileSchema.parse(req.body);
    const result = await this.service.createProfile(req.user.id, payload);
    res.status(201).json(result);
  };

  getMyProfile = async (req: AuthenticatedRequest, res: Response) => {
    const profile = await this.service.getProfileByUserId(req.user.id);

    if (!profile) {
      throw new AppError('Patient profile not found', 404);
    }

    res.status(200).json(profile);
  };

  getMyBaseline = async (req: AuthenticatedRequest, res: Response) => {
    const baseline = await this.service.getBaselineByUserId(req.user.id);

    if (!baseline) {
      throw new AppError('Patient profile not found', 404);
    }

    res.status(200).json(baseline);
  };

  getMyPassport = async (req: AuthenticatedRequest, res: Response) => {
    const passport = await this.service.getClinicalPassportByUserId(req.user.id);

    if (!passport) {
      throw new AppError('Patient profile not found', 404);
    }

    res.status(200).json(passport);
  };

  exportMyPassport = async (req: AuthenticatedRequest, res: Response) => {
    const exported = await this.service.exportClinicalPassportByUserId(req.user.id);

    if (!exported) {
      throw new AppError('Patient profile not found', 404);
    }

    res.status(200).json(exported);
  };

  updateMyProfile = async (req: AuthenticatedRequest, res: Response) => {
    const payload = updateProfileSchema.parse(req.body);
    const result = await this.service.updateProfile(req.user.id, payload);
    res.status(200).json(result);
  };

  updateMyBaseline = async (req: AuthenticatedRequest, res: Response) => {
    const payload = baselineProfileSchema.parse(req.body);
    const result = await this.service.upsertBaseline(req.user.id, payload);
    res.status(200).json(result);
  };

  addMeasurement = async (req: AuthenticatedRequest, res: Response) => {
    const payload = measurementSchema.parse(req.body);
    const result = await this.service.addMeasurement(req.user.id, payload);
    res.status(201).json(result);
  };

  addFunctionTest = async (req: AuthenticatedRequest, res: Response) => {
    const payload = functionTestSchema.parse(req.body);
    const result = await this.service.addFunctionTest(req.user.id, payload);
    res.status(201).json(result);
  };

  addActivityLog = async (req: AuthenticatedRequest, res: Response) => {
    const payload = activityLogSchema.parse(req.body);
    const result = await this.service.addActivityLog(req.user.id, payload);
    res.status(201).json(result);
  };

  addDocument = async (req: AuthenticatedRequest, res: Response) => {
    const payload = documentSchema.parse(req.body);
    const result = await this.service.addDocument(req.user.id, payload);
    res.status(201).json(result);
  };

  uploadDocument = async (req: AuthenticatedRequest, res: Response) => {
    const payload = documentUploadSchema.parse(req.body);
    const file = (req as AuthenticatedRequest & { file?: Express.Multer.File }).file;

    if (!file) {
      throw new AppError('File is required', 400);
    }

    const stored = await this.storage.save({
      userId: req.user.id,
      fileName: file.originalname ?? 'upload',
      mimeType: file.mimetype ?? null,
      buffer: file.buffer,
    });

    let ocrPayload: unknown | null = null;
    try {
      ocrPayload = await this.ocr.parse({
        buffer: file.buffer,
        mimeType: file.mimetype ?? null,
        documentType: payload.documentType,
        userId: req.user.id,
        fileName: file.originalname ?? undefined,
        reportName: payload.title ?? file.originalname ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR failed';
      ocrPayload = { provider: 'unknown', error: message };
    }

    const resolvedDocumentType = resolveDocumentTypeFromPayload(payload.documentType, ocrPayload);
    const result = await this.service.addUploadedDocument({
      userId: req.user.id,
      documentType: resolvedDocumentType,
      status: resolveDocumentStatusFromPayload(ocrPayload),
      title: payload.title ?? null,
      submissionId: payload.submissionId ?? null,
      storageUri: stored.storageUri,
      fileName: file.originalname ?? stored.fileName,
      mimeType: file.mimetype ?? null,
      fileSizeBytes: file.size ?? stored.fileSizeBytes,
      ocrPayload,
    });

    res.status(201).json(result);
  };

  addMedication = async (req: AuthenticatedRequest, res: Response) => {
    const payload = medicationSchema.parse(req.body);
    const result = await this.service.addMedication(req.user.id, payload);
    res.status(201).json(result);
  };

  addSymptomScore = async (req: AuthenticatedRequest, res: Response) => {
    const payload = symptomScoreSchema.parse(req.body);
    const result = await this.service.addSymptomScore(req.user.id, payload);
    res.status(201).json(result);
  };

  addDailyImpact = async (req: AuthenticatedRequest, res: Response) => {
    const payload = dailyImpactSchema.parse(req.body);
    const result = await this.service.addDailyImpact(req.user.id, payload);
    res.status(201).json(result);
  };

  addFollowupEvent = async (req: AuthenticatedRequest, res: Response) => {
    const payload = followupEventSchema.parse(req.body);
    const result = await this.service.addFollowupEvent(req.user.id, payload);
    res.status(201).json(result);
  };

  listMedications = async (req: AuthenticatedRequest, res: Response) => {
    const items = await this.service.getMedications(req.user.id);
    res.status(200).json(items);
  };

  getDocumentFile = async (req: AuthenticatedRequest, res: Response) => {
    const documentId = req.params.id;
    const document = await this.service.getDocumentForUser(req.user.id, documentId);
    const loaded = await this.storage.load(document.storage_uri);

    res.setHeader(
      'Content-Type',
      document.mime_type ?? loaded.mimeType ?? 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.file_name ?? loaded.fileName}"`,
    );

    loaded.stream.pipe(res);
  };

  deleteDocument = async (req: AuthenticatedRequest, res: Response) => {
    const documentId = req.params.id;
    const deleted = await this.service.deleteDocumentForUser(req.user.id, documentId);

    let storageCleanupStatus: 'removed' | 'missing' | 'failed' = 'removed';
    try {
      await this.storage.remove(deleted.storageUri);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        storageCleanupStatus = 'missing';
      } else {
        storageCleanupStatus = 'failed';
      }
    }

    res.status(200).json({
      documentId: deleted.id,
      deleted: true,
      storageCleanupStatus,
    });
  };

  getDocumentOcr = async (req: AuthenticatedRequest, res: Response) => {
    const documentId = req.params.id;
    const document = await this.service.getDocumentForUser(req.user.id, documentId);

    // If this document was parsed via Report Manager async endpoint, the initial OCR payload
    // may only contain a reportId + analysisStatus=processing. Refresh on demand.
    const currentPayload = document.ocr_payload;
    const payloadObj = isRecord(currentPayload) ? currentPayload : null;
    const provider =
      payloadObj && typeof payloadObj.provider === 'string' ? payloadObj.provider : null;
    const fields =
      payloadObj && isRecord(payloadObj.fields)
        ? (payloadObj.fields as Record<string, unknown>)
        : null;
    const reportId =
      fields && typeof fields.reportId === 'string' ? (fields.reportId as string) : '';
    const analysisStatus =
      fields && typeof fields.analysisStatus === 'string' ? (fields.analysisStatus as string) : '';
    const documentType = resolveDocumentTypeFromPayload(document.document_type, currentPayload);
    const shouldRefresh =
      provider === 'report_manager_002' &&
      reportId &&
      analysisStatus !== 'completed' &&
      analysisStatus !== 'failed' &&
      this.ocr instanceof ReportManagerOcrProvider;

    if (shouldRefresh) {
      try {
        const refreshed = await this.ocr.fetch(reportId, documentType);
        const updated = await this.service.updateDocumentOcrPayloadForUser(
          req.user.id,
          documentId,
          refreshed,
          resolveDocumentTypeFromPayload(documentType, refreshed),
          resolveDocumentStatusFromPayload(refreshed),
        );
        return res.status(200).json({
          documentId,
          ocrPayload: updated.ocr_payload ?? null,
        });
      } catch {
        // Don't fail the whole request if refresh fails; return the last known payload.
        // The UI can retry polling later.
      }
    }

    res.status(200).json({
      documentId,
      ocrPayload: document.ocr_payload ?? null,
    });
  };

  generateDocumentSummary = async (req: AuthenticatedRequest, res: Response) => {
    const documentId = req.params.id;

    if (!this.aiSummary?.client || !this.aiSummary.model) {
      throw new AppError('AI 总结服务未配置（缺少 AI_API_KEY/OPENAI_API_KEY）', 500);
    }

    const document = await this.service.getDocumentForUser(req.user.id, documentId);
    const currentPayload = document.ocr_payload;

    const payloadObj = isRecord(currentPayload) ? currentPayload : null;
    if (!payloadObj) {
      throw new AppError('该报告暂无可用的解析结果', 409);
    }

    const fields = isRecord(payloadObj.fields)
      ? (payloadObj.fields as Record<string, unknown>)
      : {};
    const analysisStatusRaw = fields.analysisStatus ?? fields.analysis_status;
    const analysisStatus =
      typeof analysisStatusRaw === 'string'
        ? analysisStatusRaw.trim()
        : String(analysisStatusRaw ?? '');

    const existingSummary = fields.aiSummary;
    if (typeof existingSummary === 'string' && existingSummary.trim()) {
      return res.status(200).json({ documentId, summary: existingSummary.trim() });
    }

    if (analysisStatus && analysisStatus !== 'completed') {
      throw new AppError(`报告尚未解析完成（当前状态：${analysisStatus}）`, 409);
    }

    const documentType = resolveDocumentTypeFromPayload(document.document_type, currentPayload);
    const extractedText =
      typeof payloadObj.extractedText === 'string'
        ? payloadObj.extractedText
        : typeof payloadObj.extracted_text === 'string'
          ? payloadObj.extracted_text
          : '';
    const aiExtraction = payloadObj.aiExtraction ?? payloadObj.ai_extraction ?? null;

    const promptPayload = {
      documentId,
      documentType,
      reportName: typeof fields.reportName === 'string' ? fields.reportName : undefined,
      reportTime: typeof fields.reportTime === 'string' ? fields.reportTime : undefined,
      highlights: fields,
      aiExtraction,
      extractedText: extractedText ? extractedText.slice(0, 2000) : '',
    };

    const system = [
      '你是医疗报告解读助手。请根据给定的结构化解析结果(aiExtraction/highlights)输出一个简洁的中文总结。',
      '要求：',
      '1) 仅输出纯文本，不要 Markdown。',
      '2) 结构：一句总览 + 3~6 条要点（每条不超过 30 字）。',
      '3) 不要编造数据；缺失则写“未提及/不明确”。',
      '4) 适当提示：仅供参考，需结合医生意见。',
    ].join('\n');

    const user = `结构化信息(JSON)：\n${JSON.stringify(promptPayload, null, 2)}`;

    let summary = '';
    try {
      const completion = await this.aiSummary.client.chat.completions.create({
        model: this.aiSummary.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      summary = completion.choices?.[0]?.message?.content?.trim() ?? '';
    } catch {
      summary = buildFallbackDocumentSummary(documentType, fields);
    }

    if (!summary) {
      throw new AppError('生成 AI 总结失败：空响应', 502);
    }

    const nextPayload = {
      ...payloadObj,
      fields: {
        ...fields,
        aiSummary: summary,
      },
    };

    await this.service.updateDocumentOcrPayloadForUser(req.user.id, documentId, nextPayload);
    res.status(200).json({ documentId, summary });
  };

  getRiskSummary = async (req: AuthenticatedRequest, res: Response) => {
    const result = await this.service.getRiskSummary(req.user.id);
    res.status(200).json(result);
  };

  getProgressionSummary = async (req: AuthenticatedRequest, res: Response) => {
    const result = await this.service.getProgressionSummary(req.user.id);
    res.status(200).json(result);
  };

  getMuscleInsight = async (req: AuthenticatedRequest, res: Response) => {
    const payload = muscleInsightQuerySchema.parse(req.query);
    const result = await this.service.getMuscleInsight(
      req.user.id,
      payload.muscleGroup,
      payload.limit,
    );
    res.status(200).json(result);
  };

  createSubmission = async (req: AuthenticatedRequest, res: Response) => {
    const payload = createSubmissionSchema.parse(req.body ?? {});
    const result = await this.service.createSubmission(req.user.id, payload);
    res.status(201).json(result);
  };

  listSubmissions = async (req: AuthenticatedRequest, res: Response) => {
    const payload = submissionListQuerySchema.parse(req.query);
    const result = await this.service.listSubmissions(
      req.user.id,
      payload.page ?? 1,
      payload.pageSize ?? 10,
    );
    res.status(200).json(result);
  };

  attachSubmissionDocuments = async (req: AuthenticatedRequest, res: Response) => {
    const payload = attachDocumentsSchema.parse(req.body);
    const submissionId = req.params.id;
    const result = await this.service.attachDocumentsToSubmission(
      req.user.id,
      submissionId,
      payload.documentIds,
    );
    res.status(200).json(result);
  };
}
