import { Router } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { DELETION_PURGE_INTERVAL_MS } from './account-deletion.js';
import { OCR_STUCK_AFTER_MINUTES, PatientProfileController } from './profile.controller.js';
import { PatientProfileService } from './profile.service.js';
import { getPool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/require-auth.js';
import type { RouteContext } from '../../routes/index.js';
import { BaiduOcrProvider } from '../../services/ocr/baidu-ocr.js';
import { EmbeddedReportOcrProvider } from '../../services/ocr/embedded-report-ocr.js';
import { MockOcrProvider } from '../../services/ocr/mock-ocr.js';
import { LocalStorageProvider } from '../../services/storage/local-storage.js';
import { MinioStorageProvider } from '../../services/storage/minio-storage.js';
import { RoutedStorageProvider } from '../../services/storage/routed-storage.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { AuditLogger } from '../ai-agents/audit/prompt-audit.js';

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
  // design). Run once at router construction — i.e. server startup.
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

  const authMiddleware = requireAuth(context.env, context.logger);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  router.use(authMiddleware);

  router.post('/', asyncHandler(controller.createProfile));
  router.get('/me', asyncHandler(controller.getMyProfile));
  router.get('/me/baseline', asyncHandler(controller.getMyBaseline));
  router.get('/me/passport', asyncHandler(controller.getMyPassport));
  router.get('/me/passport/export', asyncHandler(controller.exportMyPassport));
  router.get('/me/data-export', asyncHandler(controller.exportMyData));
  router.put('/me', asyncHandler(controller.updateMyProfile));
  router.put('/me/baseline', asyncHandler(controller.updateMyBaseline));

  router.get('/me/consent', asyncHandler(controller.getMyConsent));
  router.put('/me/consent', asyncHandler(controller.updateMyConsent));
  router.get('/me/consent/history', asyncHandler(controller.getMyConsentHistory));

  router.get('/me/deletion-request', asyncHandler(controller.getMyAccountDeletion));
  router.post('/me/deletion-request', asyncHandler(controller.requestMyAccountDeletion));
  router.post('/me/deletion-request/cancel', asyncHandler(controller.cancelMyAccountDeletion));

  router.get('/me/sharing-preferences', asyncHandler(controller.getMySharingPreferences));
  router.put('/me/sharing-preferences', asyncHandler(controller.updateMySharingPreferences));

  router.post('/me/measurements', asyncHandler(controller.addMeasurement));
  router.post('/me/function-tests', asyncHandler(controller.addFunctionTest));
  router.post('/me/symptom-scores', asyncHandler(controller.addSymptomScore));
  router.post('/me/daily-impacts', asyncHandler(controller.addDailyImpact));
  router.post('/me/followup-events', asyncHandler(controller.addFollowupEvent));
  router.post('/me/activity-logs', asyncHandler(controller.addActivityLog));
  // POST /me/documents (direct insert with caller-supplied storageUri) was
  // removed for security: it let an attacker create document rows pointing
  // at arbitrary `local://...` paths and then read/delete them through
  // /me/documents/:id, escaping the uploads sandbox. All document creation
  // now goes through /me/documents/upload, which derives storageUri from
  // the actual upload buffer.
  router.post(
    '/me/documents/upload',
    upload.single('file'),
    asyncHandler(controller.uploadDocument),
  );
  router.delete('/me/documents/:id', asyncHandler(controller.deleteDocument));
  router.get('/me/documents/:id', asyncHandler(controller.getDocumentFile));
  router.get('/me/documents/:id/ocr', asyncHandler(controller.getDocumentOcr));
  router.post('/me/documents/:id/reparse', asyncHandler(controller.reparseDocument));
  router.post('/me/documents/:id/summary', asyncHandler(controller.generateDocumentSummary));
  router.post('/me/submissions', asyncHandler(controller.createSubmission));
  router.get('/me/submissions', asyncHandler(controller.listSubmissions));
  router.patch('/me/submissions/:id/documents', asyncHandler(controller.attachSubmissionDocuments));
  router.post('/me/medications', asyncHandler(controller.addMedication));
  router.get('/me/medications', asyncHandler(controller.listMedications));
  router.get('/me/risk', asyncHandler(controller.getRiskSummary));
  router.get('/me/progression-summary', asyncHandler(controller.getProgressionSummary));
  router.get('/me/insights/muscle', asyncHandler(controller.getMuscleInsight));

  return router;
};
