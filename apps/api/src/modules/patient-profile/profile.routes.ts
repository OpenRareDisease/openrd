import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { DELETION_PURGE_INTERVAL_MS } from './account-deletion.js';
import {
  OCR_STUCK_AFTER_MINUTES,
  OCR_SWEEP_INTERVAL_MS,
  PatientProfileController,
} from './profile.controller.js';
import { PatientProfileService } from './profile.service.js';
import { getPool } from '../../db/pool.js';
import { createRateLimitMiddleware } from '../../middleware/rate-limit.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { RouteContext } from '../../routes/index.js';
import { startRetentionSweep } from '../../services/audit/retention.js';
import { BaiduOcrProvider } from '../../services/ocr/baidu-ocr.js';
import { EmbeddedReportOcrProvider } from '../../services/ocr/embedded-report-ocr.js';
import { MockOcrProvider } from '../../services/ocr/mock-ocr.js';
import { LocalStorageProvider } from '../../services/storage/local-storage.js';
import { MinioStorageProvider } from '../../services/storage/minio-storage.js';
import { RoutedStorageProvider } from '../../services/storage/routed-storage.js';
import { AppError } from '../../utils/app-error.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { AuditLogger } from '../ai-agents/audit/prompt-audit.js';
import {
  requireGuardianConsentForMinor,
  requireSensitiveDataConsent,
} from '../legal/require-consent.js';

const UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * multer rejects a request by calling `next(MulterError)` — a class
 * the shared error handler doesn't recognise, so every limit breach
 * surfaced as a generic 500 "Internal server error" and was logged as
 * an unhandled fault. That was survivable while the client uploaded
 * one file at a time and a human could guess; the batch uploader
 * sends a whole folder at once, where "第 3 份超过 10MB" has to reach
 * the user as an actionable per-file message instead of poisoning the
 * batch with a server error. Mapped here, next to the multer instance
 * that owns the limits, rather than teaching the global error handler
 * about multipart internals.
 */
const MULTER_ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  LIMIT_FILE_SIZE: { status: 413, message: '文件超过 10MB 上限，请压缩后重试' },
  LIMIT_FILE_COUNT: { status: 400, message: '一次只能上传一份文件' },
  LIMIT_UNEXPECTED_FILE: { status: 400, message: '上传字段不正确，文件需放在 file 字段' },
  LIMIT_PART_COUNT: { status: 400, message: '上传内容过多' },
  LIMIT_FIELD_COUNT: { status: 400, message: '上传内容过多' },
  LIMIT_FIELD_KEY: { status: 400, message: '上传字段名过长' },
  LIMIT_FIELD_VALUE: { status: 400, message: '上传字段内容过长' },
};

export const createPatientProfileRouter = (context: RouteContext) => {
  const router = Router();
  const service = new PatientProfileService({
    pool: getPool(),
    logger: context.logger,
  });
  const localStorage = new LocalStorageProvider();
  const minioStorage =
    context.env.MINIO_ENDPOINT && context.env.MINIO_ACCESS_KEY && context.env.MINIO_SECRET_KEY
      ? new MinioStorageProvider({
          endpoint: context.env.MINIO_ENDPOINT,
          accessKey: context.env.MINIO_ACCESS_KEY,
          secretKey: context.env.MINIO_SECRET_KEY,
          bucketName: context.env.MINIO_BUCKET_NAME,
          useSSL: context.env.MINIO_USE_HTTPS,
        })
      : null;
  const primaryStorage =
    context.env.STORAGE_PROVIDER === 'minio' && minioStorage ? minioStorage : localStorage;
  const storage = new RoutedStorageProvider({
    primary: primaryStorage,
    providers: [localStorage, ...(minioStorage ? [minioStorage] : [])],
  });
  const ocr =
    context.env.OCR_PROVIDER === 'baidu' &&
    context.env.BAIDU_OCR_API_KEY &&
    context.env.BAIDU_OCR_SECRET_KEY
      ? new BaiduOcrProvider({
          apiKey: context.env.BAIDU_OCR_API_KEY,
          secretKey: context.env.BAIDU_OCR_SECRET_KEY,
          generalEndpoint: context.env.BAIDU_OCR_GENERAL_ENDPOINT,
          accurateEndpoint: context.env.BAIDU_OCR_ACCURATE_ENDPOINT,
          medicalEndpoint: context.env.BAIDU_OCR_MEDICAL_ENDPOINT,
        })
      : context.env.OCR_PROVIDER === 'mock'
        ? new MockOcrProvider()
        : new EmbeddedReportOcrProvider({
            pythonBin: context.env.OCR_PYTHON_BIN,
            timeoutMs: context.env.OCR_PARSER_TIMEOUT_MS,
          });

  const aiApiKey = context.env.AI_API_KEY || context.env.OPENAI_API_KEY || '';
  const aiClient = aiApiKey
    ? new OpenAI({
        apiKey: aiApiKey,
        baseURL: context.env.AI_API_BASE_URL,
        timeout: context.env.AI_API_TIMEOUT,
      })
    : null;

  const controller = new PatientProfileController(
    service,
    storage,
    ocr,
    aiClient ? { client: aiClient, model: context.env.AI_API_MODEL } : undefined,
    context.logger,
    // Same scrubbing reader the /ai/audit endpoint uses — the export
    // must never surface rows the audit screen itself would redact.
    new AuditLogger(getPool()),
  );

  // Async-OCR recovery sweep: rows stuck in 'processing' belong to
  // jobs that died with a previous process (no persistent queue by
  // design). Run once at router construction — i.e. server startup —
  // and then on an interval. A startup-only sweep missed the other
  // way a row gets stranded: a job whose FINAL write fails (pool
  // blip, row deleted mid-parse) logs and gives up, leaving its row
  // 'processing' and the mobile detail screen's poller spinning until
  // someone restarts the container.
  //
  // Skip the tick while this process still has jobs in flight. The
  // sweep judges "stuck" purely by age, and a job parked behind
  // OCR_MAX_IN_FLIGHT_JOBS others can legitimately be older than
  // OCR_STUCK_AFTER_MINUTES while very much alive — sweeping it would
  // flip a live document to parse_failed. With an empty in-flight map
  // the age test is exact, under the same single-instance assumption
  // the controller's own bookkeeping already documents.
  const runStuckProcessingSweep = () => {
    if (controller.inFlightOcrJobs.size > 0) return;
    void service
      .sweepStuckProcessingDocuments(OCR_STUCK_AFTER_MINUTES)
      .then((swept) => {
        if (swept > 0) {
          context.logger.warn(
            { swept },
            'Marked stuck processing documents as parse_failed (recoverable via reparse)',
          );
        }
      })
      .catch((error) => {
        context.logger.error({ error }, 'Stuck-processing sweep failed');
      });
  };
  runStuckProcessingSweep();
  setInterval(runStuckProcessingSweep, OCR_SWEEP_INTERVAL_MS).unref();
  // Account-deletion purge: run once at startup, then every 6 hours.
  // Same single-instance assumption as the OCR sweep above. unref()
  // keeps the interval from pinning the process open in tests /
  // graceful shutdown.
  const runDeletionPurge = () =>
    void service
      .purgeDueAccountDeletions((uri) => storage.remove(uri))
      .then((purged) => {
        if (purged > 0) {
          context.logger.warn({ purged }, 'Purged accounts past their deletion cooling-off');
        }
      })
      .catch((error) => {
        context.logger.error({ error }, 'Account-deletion purge sweep failed');
      });
  runDeletionPurge();
  setInterval(runDeletionPurge, DELETION_PURGE_INTERVAL_MS).unref();
  // Time-based retention for the OTP and audit tables. Wired here next
  // to the other two sweeps because this is where the app's periodic
  // jobs live and where the single-instance assumption is already
  // documented — not because retention is a patient-profile concern.
  startRetentionSweep(getPool(), context.logger);

  const authMiddleware = requireAuth(context.env, context.logger);
  const upload = multer({
    storage: multer.memoryStorage(),
    // multer's defaults bound only the field NAME (100B) and each
    // individual field VALUE (1MB): `files`, `fields` and `parts` are
    // all Infinity. So fileSize was the only cap that actually
    // constrained a multipart body — an authenticated client could
    // stream an unbounded number of ≤1MB text parts, every one of
    // which multer buffers into req.body before documentUploadSchema
    // ever runs. That schema wants exactly three short text fields
    // (documentType / title / submissionId), so cap all four axes.
    limits: {
      fileSize: UPLOAD_MAX_FILE_BYTES,
      files: 1,
      fields: 8,
      parts: 10,
      fieldNameSize: 100,
      // title maxes out at 255 characters (≤765 bytes of UTF-8
      // Chinese); 8KB leaves room without leaving the door open.
      fieldSize: 8 * 1024,
    },
  });

  const acceptSingleUpload: RequestHandler = (req, res, next) => {
    upload.single('file')(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        const mapped = MULTER_ERROR_RESPONSES[error.code];
        return next(new AppError(mapped?.message ?? '上传失败，请重试', mapped?.status ?? 400));
      }
      return next(error);
    });
  };

  /** Per-user throttle on the two endpoints that enqueue an OCR job.
   *  The controller's OCR_MAX_IN_FLIGHT_JOBS cap is process-global,
   *  so on its own one patient batch-uploading a folder holds every
   *  queue slot and 429s everyone else; this bounds how fast a single
   *  account can push toward that shared cap. Keyed by user id
   *  (requireAuth runs first) rather than IP, so a whole clinic
   *  behind one NAT doesn't share a budget. It sits in FRONT of
   *  multer on purpose: a rejected flooder never gets its ≤10MB body
   *  buffered into memory. 60/min is far above a realistic batch and
   *  still stops a scripted flood cold. */
  const uploadLimiter = createRateLimitMiddleware({
    keyPrefix: 'profile:document-upload',
    windowMs: 60_000,
    maxRequests: 60,
    message: '上传过于频繁，请稍后再试',
    keyResolver: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
  });

  router.use(authMiddleware);

  // PIPL Art. 29. Applied to every route that STORES or RE-PROCESSES
  // health or genetic data.
  //
  // Deliberately NOT applied to four write routes, and the exclusion
  // matters as much as the inclusion:
  //
  //   /me/consent, /me/sharing-preferences — these ARE the consent
  //     controls. Gating them behind consent is circular: a user who
  //     withdrew could never turn anything back on, or off.
  //   /me/deletion-request, /me/deletion-request/cancel — withdrawing
  //     consent and then being unable to delete your account is the
  //     exact opposite of what PIPL Art. 47 requires. Erasure must stay
  //     reachable from the least-consented state there is.
  //
  // Reads are ungated throughout for the same reason: 查阅 and 复制 are
  // rights the policy grants, not rewards for consenting.
  const sensitiveDataConsent = requireSensitiveDataConsent(getPool(), context.logger);
  // PIPL Art. 31. Recomputed from the server clock — the mobile form
  // has the same rule but reads the handset's, which is settable.
  const guardianConsent = requireGuardianConsentForMinor(getPool(), context.logger);

  router.post('/', guardianConsent, asyncHandler(controller.createProfile));
  router.get('/me', asyncHandler(controller.getMyProfile));
  router.get('/me/baseline', asyncHandler(controller.getMyBaseline));
  router.get('/me/passport', asyncHandler(controller.getMyPassport));
  router.get('/me/passport/export', asyncHandler(controller.exportMyPassport));
  router.get('/me/data-export', asyncHandler(controller.exportMyData));
  router.put('/me', guardianConsent, asyncHandler(controller.updateMyProfile));
  // The baseline carries diagnosis type, D4Z4 repeat count, haplotype
  // and methylation — the privacy policy names those as 敏感个人信息
  // requiring 单独同意, and the registration form was writing them
  // before the document had ever been rendered.
  router.put('/me/baseline', sensitiveDataConsent, asyncHandler(controller.updateMyBaseline));

  router.get('/me/consent', asyncHandler(controller.getMyConsent));
  router.put('/me/consent', asyncHandler(controller.updateMyConsent));
  router.get('/me/consent/history', asyncHandler(controller.getMyConsentHistory));

  router.get('/me/deletion-request', asyncHandler(controller.getMyAccountDeletion));
  router.post('/me/deletion-request', asyncHandler(controller.requestMyAccountDeletion));
  router.post('/me/deletion-request/cancel', asyncHandler(controller.cancelMyAccountDeletion));

  router.get('/me/sharing-preferences', asyncHandler(controller.getMySharingPreferences));
  router.put('/me/sharing-preferences', asyncHandler(controller.updateMySharingPreferences));

  router.post('/me/measurements', sensitiveDataConsent, asyncHandler(controller.addMeasurement));
  router.post('/me/function-tests', sensitiveDataConsent, asyncHandler(controller.addFunctionTest));
  router.post('/me/symptom-scores', sensitiveDataConsent, asyncHandler(controller.addSymptomScore));
  router.post('/me/daily-impacts', sensitiveDataConsent, asyncHandler(controller.addDailyImpact));
  router.post(
    '/me/followup-events',
    sensitiveDataConsent,
    asyncHandler(controller.addFollowupEvent),
  );
  router.post('/me/activity-logs', sensitiveDataConsent, asyncHandler(controller.addActivityLog));
  // Retract one hand-entered record (function test / symptom score /
  // followup event). Soft delete: the row stays as an audited
  // tombstone, every read path filters it out. `:kind` is parsed
  // against an enum before it reaches the service — see
  // deleteRecordParamsSchema.
  router.delete('/me/records/:kind/:id', asyncHandler(controller.deleteRecord));
  // POST /me/documents (direct insert with caller-supplied storageUri) was
  // removed for security: it let an attacker create document rows pointing
  // at arbitrary `local://...` paths and then read/delete them through
  // /me/documents/:id, escaping the uploads sandbox. All document creation
  // now goes through /me/documents/upload, which derives storageUri from
  // the actual upload buffer.
  router.post(
    '/me/documents/upload',
    uploadLimiter,
    sensitiveDataConsent,
    acceptSingleUpload,
    asyncHandler(controller.uploadDocument),
  );
  router.delete('/me/documents/:id', asyncHandler(controller.deleteDocument));
  router.get('/me/documents/:id', asyncHandler(controller.getDocumentFile));
  router.get('/me/documents/:id/ocr', asyncHandler(controller.getDocumentOcr));
  // Same budget as upload: reparse re-reads the whole file into memory
  // and enqueues an identical OCR job, so it's the same CPU/memory
  // spend behind a cheaper-looking request.
  router.post(
    '/me/documents/:id/reparse',
    uploadLimiter,
    // Re-runs OCR over stored PHI — the same processing as the
    // original upload, so the same consent.
    sensitiveDataConsent,
    asyncHandler(controller.reparseDocument),
  );
  // Editing extracted fields is writing medical values by hand.
  router.patch(
    '/me/documents/:id/ocr',
    sensitiveDataConsent,
    asyncHandler(controller.patchDocumentOcr),
  );
  // Sends report text to the LLM. The AI consent level governs WHAT
  // is sent; this governs whether we may process it at all.
  router.post(
    '/me/documents/:id/summary',
    sensitiveDataConsent,
    asyncHandler(controller.generateDocumentSummary),
  );
  // A submission's `summary` carries clinical text (「睡眠评分 8/10」).
  router.post('/me/submissions', sensitiveDataConsent, asyncHandler(controller.createSubmission));
  router.get('/me/submissions', asyncHandler(controller.listSubmissions));
  router.patch(
    '/me/submissions/:id/documents',
    sensitiveDataConsent,
    asyncHandler(controller.attachSubmissionDocuments),
  );
  router.post('/me/medications', sensitiveDataConsent, asyncHandler(controller.addMedication));
  router.get('/me/medications', asyncHandler(controller.listMedications));
  router.get('/me/risk', asyncHandler(controller.getRiskSummary));
  router.get('/me/progression-summary', asyncHandler(controller.getProgressionSummary));
  router.get('/me/insights/muscle', asyncHandler(controller.getMuscleInsight));

  return router;
};
