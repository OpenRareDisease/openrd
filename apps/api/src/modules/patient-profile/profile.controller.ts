import type { Response } from 'express';
import OpenAI from 'openai';
import { DOCUMENT_TYPES, type DocumentType } from './profile.constants.js';
import {
  activityLogSchema,
  baselineProfileSchema,
  consentHistoryQuerySchema,
  consentUpdateSchema,
  createSubmissionSchema,
  createProfileSchema,
  dailyImpactSchema,
  documentUploadSchema,
  followupEventSchema,
  functionTestSchema,
  measurementSchema,
  medicationSchema,
  sharingPreferencesUpdateSchema,
  symptomScoreSchema,
  attachDocumentsSchema,
  muscleInsightQuerySchema,
  submissionListQuerySchema,
  updateProfileSchema,
} from './profile.schema.js';
import type { PatientProfileService } from './profile.service.js';
import type { AppLogger } from '../../config/logger.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { OcrProvider } from '../../services/ocr/ocr-provider.js';
import type { StorageProvider } from '../../services/storage/storage-provider.js';
import { AppError } from '../../utils/app-error.js';
import { redactFields, redactionModeForConsent } from '../ai-agents/security/index.js';

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
        pickText(fields, ['mb', 'myoglobin']) && `Mb ${pickText(fields, ['mb', 'myoglobin'])}`,
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

/**
 * Map every OCR-emitted sub-type onto one of the four canonical
 * `document_type` values the migration 012 CHECK constraint admits
 * (`mri | genetic_report | blood_panel | other`). Without this,
 * `resolveDocumentTypeFromPayload` would return the raw OCR
 * classification (`muscle_mri`, `biochemistry`, `pulmonary_function`,
 * etc.) and the INSERT would fail the CHECK — the upload pipeline
 * would 500 with the file already in storage and no DB row to find
 * it again.
 *
 * The granular sub-type stays accessible to the UI via
 * `ocr_payload.fields.classifiedType` (see
 * `documentTypeLabels` in profile.service.ts and `documentLabels` in
 * profile.passport.ts which already key off the OCR field).
 */
const DOCUMENT_TYPE_CANONICAL_MAP: Record<string, DocumentType> = {
  // Canonical values pass through.
  mri: 'mri',
  genetic_report: 'genetic_report',
  blood_panel: 'blood_panel',
  other: 'other',
  // Imaging → mri (only muscle MRI today; add more as the
  // imaging pipeline grows).
  muscle_mri: 'mri',
  // Blood-derived panels → blood_panel.
  biochemistry: 'blood_panel',
  muscle_enzyme: 'blood_panel',
  blood_routine: 'blood_panel',
  thyroid_function: 'blood_panel',
  coagulation: 'blood_panel',
  urinalysis: 'blood_panel',
  infection_screening: 'blood_panel',
  stool_test: 'blood_panel',
  // Everything else collapses to `other`. The OCR sub-type label
  // (e.g. "心电图", "病历摘要") is rendered from
  // `ocr_payload.fields.classifiedType` so we don't lose the detail
  // at the UI layer.
  medical_summary: 'other',
  physical_exam: 'other',
  pulmonary_function: 'other',
  diaphragm_ultrasound: 'other',
  ecg: 'other',
  echocardiography: 'other',
  abdominal_ultrasound: 'other',
};

const isCanonicalDocumentType = (value: string): value is DocumentType =>
  (DOCUMENT_TYPES as readonly string[]).includes(value);

/**
 * Map an arbitrary OCR sub-type string onto the canonical
 * DocumentType enum. Falls back to 'other' so an unknown sub-type
 * (a new OCR classifier output not yet listed in the map) still
 * satisfies the DB CHECK rather than crashing the upload.
 */
const canonicalizeDocumentType = (raw: string): DocumentType => {
  const trimmed = raw.trim();
  const mapped = DOCUMENT_TYPE_CANONICAL_MAP[trimmed];
  if (mapped) return mapped;
  if (isCanonicalDocumentType(trimmed)) return trimmed;
  return 'other';
};

const resolveDocumentTypeFromPayload = (fallbackType: string, payload: unknown): DocumentType => {
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
    return canonicalizeDocumentType(normalized);
  }

  // The fallback comes from documentUploadSchema, which restricts to
  // DOCUMENT_TYPES via z.enum — so it's already canonical. Run it
  // through canonicalize() anyway so a future widening of the schema
  // can't bypass the contract by accident.
  return canonicalizeDocumentType(fallbackType);
};

// Exported for unit tests in profile.controller.test.ts. Production
// callers stay inside this module.
export { canonicalizeDocumentType as _canonicalizeDocumentType };

/**
 * MIME types that are safe to render inline. Anything else either
 * downloads as octet-stream or — combined with `Content-Disposition:
 * attachment` + `X-Content-Type-Options: nosniff` — refuses to execute
 * in the API origin. Stays intentionally small: PDF and common image
 * formats are the only inputs the patient profile pipeline actually
 * processes; HTML / SVG / XML are deliberately absent because they can
 * carry script.
 */
const SAFE_INLINE_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

/**
 * Build an RFC 5987-safe Content-Disposition header. CRLF + quote
 * characters in user-supplied filenames would otherwise let a patient
 * inject extra header parameters; the legacy code interpolated the
 * raw `file_name` (preserved verbatim through multer) straight into a
 * `filename="..."` form. We always use `attachment` so the browser
 * never renders the resource in-origin, and we use the `filename*`
 * (UTF-8) form for any character outside `[A-Za-z0-9._-]`.
 */
const buildContentDisposition = (rawName: string): string => {
  const fallback = 'document';
  const trimmed = (rawName ?? '').replace(/[\r\n]/g, '').trim() || fallback;
  const asciiSafe = trimmed.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) || fallback;
  const utf8Safe = encodeURIComponent(trimmed).slice(0, 400);
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${utf8Safe}`;
};

// Exported for unit tests.
export {
  SAFE_INLINE_MIME_ALLOWLIST as _SAFE_INLINE_MIME_ALLOWLIST,
  buildContentDisposition as _buildContentDisposition,
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

/** Minimal concurrency gate for the background OCR jobs. The embedded
 *  OCR provider shells out to a Python process per parse; unbounded
 *  parallel uploads would fork-bomb the box. Two concurrent parses
 *  keeps a second user responsive while one big PDF grinds. */
const createLimiter = (concurrency: number) => {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
};

const OCR_JOB_CONCURRENCY = 2;
/** processing older than this is considered lost (job died with the
 *  process) — both the startup sweep and the reparse endpoint's
 *  "stuck" branch use it. */
export const OCR_STUCK_AFTER_MINUTES = 10;
/** Admission cap for the background queue. The 2-slot limiter bounds
 *  CPU, but every queued job parks its full (≤10MB) upload buffer in
 *  memory — without this cap an authenticated flooder could stack
 *  buffers far faster than OCR drains them, since uploads now return
 *  in milliseconds. 10 queued jobs ≈ 100MB worst case. */
export const OCR_MAX_IN_FLIGHT_JOBS = 10;

export class PatientProfileController {
  /** In-flight background parses keyed by documentId. Serves three
   *  jobs: reparse-while-running returns 409 instead of double
   *  parsing; tests can await completion; graceful shutdown could
   *  drain. Entries remove themselves on settle.
   *
   *  SINGLE-INSTANCE ASSUMPTION: this map, the concurrency limiter,
   *  and the stuck-processing heuristics are all process-local. The
   *  production topology is one api container (docker-compose), so
   *  that holds. A second replica would double-parse and mis-judge
   *  "stuck" — scaling out requires moving this coordination into
   *  the database (e.g. a claimed_at column) first. */
  readonly inFlightOcrJobs = new Map<string, Promise<void>>();
  private readonly ocrLimiter = createLimiter(OCR_JOB_CONCURRENCY);

  constructor(
    private readonly service: PatientProfileService,
    private readonly storage: StorageProvider,
    private readonly ocr: OcrProvider,
    private readonly aiSummary?: AiSummaryDeps,
    private readonly logger?: AppLogger,
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

  getMyConsent = async (req: AuthenticatedRequest, res: Response) => {
    const details = await this.service.getConsentDetails(req.user.id);
    if (!details) {
      throw new AppError('Patient profile not found', 404);
    }
    res.status(200).json(details);
  };

  updateMyConsent = async (req: AuthenticatedRequest, res: Response) => {
    const payload = consentUpdateSchema.parse(req.body);
    const updated = await this.service.updateConsent(req.user.id, payload);
    res.status(200).json(updated);
  };

  /**
   * Read the consent grant/revoke timeline for the calling user.
   * Returns `{ events: [] }` (not 404) for users with no events yet
   * so the mobile audit history can render an empty state without an
   * extra "exists?" branch.
   *
   * Query params:
   *  - `limit`    1–500, default 100
   *  - `offset`   >= 0,  default 0
   *  - `flagName` 'personal' | 'third_party' | 'precise_values'
   */
  getMyConsentHistory = async (req: AuthenticatedRequest, res: Response) => {
    const query = consentHistoryQuerySchema.parse(req.query);
    const events = await this.service.getConsentHistory(req.user.id, query);
    res.status(200).json({ events });
  };

  /**
   * Read the four data-sharing toggles (clinical trial, data
   * donation, hospital sync, community share). Returns 404 when the
   * user has no profile row yet so the mobile screen can prompt
   * them to finish onboarding instead of silently showing default
   * "off" values that we'd never actually persist.
   */
  getMySharingPreferences = async (req: AuthenticatedRequest, res: Response) => {
    const prefs = await this.service.getSharingPreferences(req.user.id);
    if (!prefs) {
      throw new AppError('Patient profile not found', 404);
    }
    res.status(200).json(prefs);
  };

  /** Partial update of the four data-sharing toggles. Body fields
   *  are all optional but at least one must be present (Zod
   *  schema enforces this). */
  updateMySharingPreferences = async (req: AuthenticatedRequest, res: Response) => {
    const payload = sharingPreferencesUpdateSchema.parse(req.body);
    const updated = await this.service.updateSharingPreferences(req.user.id, payload);
    res.status(200).json(updated);
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

  uploadDocument = async (req: AuthenticatedRequest, res: Response) => {
    const payload = documentUploadSchema.parse(req.body);
    const file = (req as AuthenticatedRequest & { file?: Express.Multer.File }).file;

    if (!file) {
      throw new AppError('File is required', 400);
    }

    // Verify the caller can actually write to this user's submission
    // log BEFORE we spend any storage write / OCR CPU on the buffer.
    // The preflight covers two side-effect-leak paths the downstream
    // checks would otherwise close only after the work was done:
    //   - foreign submissionId → DB-level 404 in addUploadedDocument
    //   - caller has no profile yet → ensureProfileForUser 404
    // Both branches are cheap SELECTs.
    await this.service.assertCallerCanWriteSubmission(req.user.id, payload.submissionId);

    // Bound admission BEFORE the storage write: each queued job holds
    // its full upload buffer in memory until the limiter drains it.
    if (this.inFlightOcrJobs.size >= OCR_MAX_IN_FLIGHT_JOBS) {
      throw new AppError('识别队列已满，请稍后再试', 429);
    }

    const stored = await this.storage.save({
      userId: req.user.id,
      fileName: file.originalname ?? 'upload',
      mimeType: file.mimetype ?? null,
      buffer: file.buffer,
    });

    // Async OCR: insert the row as 'processing' and return 201
    // immediately — the parse (up to OCR_PARSER_TIMEOUT_MS, 120s by
    // default) used to run inline here, pinning the user to a spinner
    // for the whole ride. The mobile detail screen already polls
    // processing documents, so it picks the result up on its own.
    let result;
    try {
      result = await this.service.addUploadedDocument({
        userId: req.user.id,
        documentType: payload.documentType,
        status: 'processing',
        title: payload.title ?? null,
        submissionId: payload.submissionId ?? null,
        storageUri: stored.storageUri,
        fileName: file.originalname ?? stored.fileName,
        mimeType: file.mimetype ?? null,
        fileSizeBytes: file.size ?? stored.fileSizeBytes,
        ocrPayload: null,
      });
    } catch (insertError) {
      // The file is already in storage; if the DB row never lands the
      // object becomes an orphan that no UI / cleanup job can find by
      // documentId. Remove it best-effort — swallow remove failures
      // because the original insert error is the one the caller cares
      // about.
      try {
        await this.storage.remove(stored.storageUri);
      } catch (cleanupError) {
        (insertError as { storageOrphan?: string }).storageOrphan = stored.storageUri;
        void cleanupError;
      }
      throw insertError;
    }

    this.startOcrJob({
      userId: req.user.id,
      documentId: result.id,
      buffer: file.buffer,
      mimeType: file.mimetype ?? null,
      documentType: payload.documentType,
      fileName: file.originalname ?? undefined,
      reportName: payload.title ?? file.originalname ?? undefined,
    });

    res.status(201).json(result);
  };

  /** Fire-and-forget wrapper so upload/reparse can't accidentally
   *  await the parse. The job promise is tracked in inFlightOcrJobs
   *  for dedupe/tests and always cleans up after itself. */
  private startOcrJob(input: {
    userId: string;
    documentId: string;
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    fileName?: string;
    reportName?: string;
  }) {
    const job = this.ocrLimiter(async () => {
      let ocrPayload: unknown | null = null;
      try {
        ocrPayload = await this.ocr.parse({
          buffer: input.buffer,
          mimeType: input.mimeType,
          documentType: input.documentType,
          userId: input.userId,
          fileName: input.fileName,
          reportName: input.reportName,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OCR failed';
        ocrPayload = { provider: 'unknown', error: message };
      }

      const resolvedDocumentType = resolveDocumentTypeFromPayload(input.documentType, ocrPayload);
      await this.service.updateDocumentOcrResult(input.userId, input.documentId, {
        status: resolveDocumentStatusFromPayload(ocrPayload),
        ocrPayload,
        documentType: resolvedDocumentType,
      });
    })
      .catch((error) => {
        // The parse itself never throws past the inner catch — this
        // only fires when landing the RESULT failed (DB down, row
        // deleted mid-parse). The row stays 'processing' and the
        // startup sweep / reparse endpoint recover it.
        this.logger?.error(
          { error, documentId: input.documentId },
          'OCR job failed to persist its result',
        );
      })
      .finally(() => {
        this.inFlightOcrJobs.delete(input.documentId);
      });

    this.inFlightOcrJobs.set(input.documentId, job);
  }

  /** POST /me/documents/:id/reparse — recover a failed or lost parse
   *  without deleting and re-uploading the file. */
  reparseDocument = async (req: AuthenticatedRequest, res: Response) => {
    const documentId = req.params.id;
    const document = await this.service.getDocumentForUser(req.user.id, documentId);

    if (this.inFlightOcrJobs.has(documentId)) {
      throw new AppError('该报告正在识别中，请稍候', 409);
    }

    const status = document.status ?? 'uploaded';
    const uploadedAt = new Date(document.uploaded_at);
    const stuckSinceMs = Date.now() - OCR_STUCK_AFTER_MINUTES * 60 * 1000;
    const isStuckProcessing =
      status === 'processing' &&
      !Number.isNaN(uploadedAt.getTime()) &&
      uploadedAt.getTime() < stuckSinceMs;
    // Eligible: failed parses, legacy 'uploaded' rows (written before
    // the async pipeline / with OCR disabled), and processing rows
    // whose job evidently died. Fresh 'processing' waits for its job;
    // parsed/needs_review reparse is out of scope (no user value —
    // the source file hasn't changed).
    const eligible = status === 'parse_failed' || status === 'uploaded' || isStuckProcessing;
    if (!eligible) {
      throw new AppError('该报告当前状态不支持重新识别', 409);
    }

    const loaded = await this.storage.load(document.storage_uri);
    const chunks: Buffer[] = [];
    for await (const chunk of loaded.stream) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const buffer = Buffer.concat(chunks);

    await this.service.updateDocumentOcrResult(req.user.id, documentId, {
      status: 'processing',
      ocrPayload: null,
    });

    this.startOcrJob({
      userId: req.user.id,
      documentId,
      buffer,
      mimeType: document.mime_type,
      documentType: document.document_type,
      fileName: document.file_name ?? undefined,
      reportName: document.title ?? document.file_name ?? undefined,
    });

    res.status(202).json({ documentId, status: 'processing' });
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

    // Pin the Content-Type to an allowlist so a caller who uploaded
    // `evil.html` with `Content-Type: text/html` can't get the browser
    // to render it in the API origin. Anything off the allowlist falls
    // back to octet-stream + attachment, so the worst case is a
    // useless download rather than a stored XSS.
    const rawType = (document.mime_type ?? loaded.mimeType ?? '').toLowerCase().trim();
    const safeContentType = SAFE_INLINE_MIME_ALLOWLIST.has(rawType)
      ? rawType
      : 'application/octet-stream';
    res.setHeader('Content-Type', safeContentType);
    // `attachment` (not `inline`) keeps the browser from rendering the
    // resource even when the MIME slips past the allowlist via a
    // future config change. nosniff blocks Chrome's content sniffing.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(document.file_name ?? loaded.fileName ?? 'document'),
    );

    loaded.stream.pipe(res);
  };

  deleteDocument = async (req: AuthenticatedRequest, res: Response) => {
    const documentId = req.params.id;
    const deleted = await this.service.deleteDocumentForUser(req.user.id, documentId, {
      ip: req.ip,
      userAgent:
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    });

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

    // Gate the call on AI consent. The orchestrator at /api/ai/ask
    // already does this; the summary endpoint used to bypass the
    // whole ai-agents/security/* stack (no consent check, no field
    // redaction, no extractedText cap). This brings it in line.
    const consentStatus = await this.service.getConsentStatus(req.user.id);
    if (consentStatus.level === 'none') {
      throw new AppError('请先在隐私设置中同意 AI 使用你的数据', 403, {
        code: 'consent_required',
        consent: consentStatus,
      });
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

    // Project the OCR `fields` blob through the same PII redactor the
    // orchestrator uses. The redactor hard-deletes the long tail of
    // identifying keys (patientName, idCard, doctorName, mrn, etc.)
    // and projects clinical fields into a per-mode allowlist. Anything
    // off the allowlist is dropped — this is the only sanctioned path
    // for OCR fields to reach an LLM in this codebase.
    const redactionMode = redactionModeForConsent(consentStatus.level);
    const redacted = redactFields({ fields }, { scope: 'reports', mode: redactionMode });
    // The `extractedText` / `rawFreeText` / `fullText` family is in
    // HARD_DELETE_KEYS — we deliberately do NOT send the OCR full-text
    // dump. It always carries the patient's name and the issuing
    // physician's name; the structured fields the redactor passes
    // through carry enough for the model to summarise. The legacy
    // 2000-char slice was not a fix; it was a half-measure.
    const promptPayload = {
      documentId,
      documentType,
      // Keep reportName + reportTime only if they survived redaction
      // (they should — neither is in HARD_DELETE_KEYS). Pull from the
      // redacted shape so unknown future keys can't sneak back in via
      // a typo here.
      report: redacted.fields,
    };

    const system = [
      '你是医疗报告解读助手。请根据给定的结构化解析结果(report)输出一个简洁的中文总结。',
      '要求：',
      '1) 仅输出纯文本，不要 Markdown。',
      '2) 结构：一句总览 + 3~6 条要点（每条不超过 30 字）。',
      '3) 不要编造数据；缺失则写“未提及/不明确”。',
      '4) 适当提示：仅供参考，需结合医生意见。',
    ].join('\n');

    const user = `结构化信息(JSON)：\n${JSON.stringify(promptPayload, null, 2)}`;

    // Cancel the upstream LLM request if the client drops, mirroring
    // the /api/ai/ask flow's res.on('close') wiring. Without this, a
    // dropped phone keeps the OpenAI SDK call running until its
    // built-in timeout (30s+) fires, holding a worker + vendor
    // concurrency budget for a user who isn't watching.
    const abortController = new AbortController();
    const onClientClose = () => {
      if (!abortController.signal.aborted) abortController.abort();
    };
    res.on('close', onClientClose);

    // Contract: every exit path below — success, AppError(502) for
    // empty LLM content, service write rejection, anything else
    // throwing — detaches `onClientClose`. The previous shape only
    // detached on the success branch, leaking the closure on the two
    // throw paths (caught by PR #56 review). Wrapping the work in a
    // try/finally turns the contract into a single-point invariant so
    // any future await inserted in here can't accidentally regress
    // the leak. abort() is idempotent (the `signal.aborted` guard in
    // `onClientClose`), so a late `close` event that races the
    // detach is still safe.
    try {
      let summary = '';
      let usedFallback = false;
      try {
        const completion = await this.aiSummary.client.chat.completions.create(
          {
            model: this.aiSummary.model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          },
          { signal: abortController.signal },
        );
        summary = completion.choices?.[0]?.message?.content?.trim() ?? '';
      } catch {
        // Don't mask the upstream failure with a silent fallback. The
        // fallback's structured summary is still useful for the UI,
        // but the response and the persisted ocr_payload both carry
        // aiSummarySource='fallback' so monitoring + the mobile UI
        // can distinguish LLM output from rule-based output. The
        // original exception is not propagated upward (response
        // would 502) and also not logged here to avoid accidentally
        // surfacing the upstream Authorization header in
        // unstructured logs (the route boundary scrubber doesn't
        // touch this path).
        summary = buildFallbackDocumentSummary(documentType, fields);
        usedFallback = true;
      }

      if (!summary) {
        throw new AppError('生成 AI 总结失败：空响应', 502);
      }

      const nextPayload = {
        ...payloadObj,
        fields: {
          ...fields,
          aiSummary: summary,
          aiSummarySource: usedFallback ? 'fallback' : 'llm',
        },
      };

      await this.service.updateDocumentOcrPayloadForUser(req.user.id, documentId, nextPayload);
      res.status(200).json({ documentId, summary, source: usedFallback ? 'fallback' : 'llm' });
    } finally {
      res.off('close', onClientClose);
    }
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
