import { Router } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { PatientProfileController } from './profile.controller.js';
import { PatientProfileService } from './profile.service.js';
import { getPool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/require-auth.js';
import type { RouteContext } from '../../routes/index.js';
import { BaiduOcrProvider } from '../../services/ocr/baidu-ocr.js';
import { MockOcrProvider } from '../../services/ocr/mock-ocr.js';
import { ReportManagerOcrProvider } from '../../services/ocr/report-manager-ocr.js';
import { LocalStorageProvider } from '../../services/storage/local-storage.js';
import { asyncHandler } from '../../utils/async-handler.js';

export const createPatientProfileRouter = (context: RouteContext) => {
  const router = Router();
  const service = new PatientProfileService({
    pool: getPool(),
    logger: context.logger,
  });
  const storage = new LocalStorageProvider();
  const ocr = context.env.REPORT_MANAGER_OCR_URL
    ? new ReportManagerOcrProvider({
        endpoint: context.env.REPORT_MANAGER_OCR_URL,
        apiKey: context.env.REPORT_MANAGER_OCR_API_KEY,
        defaultUserId: context.env.REPORT_MANAGER_OCR_USER_ID,
      })
    : context.env.BAIDU_OCR_API_KEY && context.env.BAIDU_OCR_SECRET_KEY
      ? new BaiduOcrProvider({
          apiKey: context.env.BAIDU_OCR_API_KEY,
          secretKey: context.env.BAIDU_OCR_SECRET_KEY,
          generalEndpoint: context.env.BAIDU_OCR_GENERAL_ENDPOINT,
          accurateEndpoint: context.env.BAIDU_OCR_ACCURATE_ENDPOINT,
          medicalEndpoint: context.env.BAIDU_OCR_MEDICAL_ENDPOINT,
        })
      : new MockOcrProvider();

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
  );
  const authMiddleware = requireAuth(context.env, context.logger);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  router.use(authMiddleware);

  router.post('/', asyncHandler(controller.createProfile));
  router.get('/me', asyncHandler(controller.getMyProfile));
  router.put('/me', asyncHandler(controller.updateMyProfile));

  router.post('/me/measurements', asyncHandler(controller.addMeasurement));
  router.post('/me/function-tests', asyncHandler(controller.addFunctionTest));
  router.post('/me/activity-logs', asyncHandler(controller.addActivityLog));
  router.post('/me/documents', asyncHandler(controller.addDocument));
  router.post(
    '/me/documents/upload',
    upload.single('file'),
    asyncHandler(controller.uploadDocument),
  );
  router.get('/me/documents/:id', asyncHandler(controller.getDocumentFile));
  router.get('/me/documents/:id/ocr', asyncHandler(controller.getDocumentOcr));
  router.post('/me/documents/:id/summary', asyncHandler(controller.generateDocumentSummary));
  router.post('/me/submissions', asyncHandler(controller.createSubmission));
  router.get('/me/submissions', asyncHandler(controller.listSubmissions));
  router.patch('/me/submissions/:id/documents', asyncHandler(controller.attachSubmissionDocuments));
  router.post('/me/medications', asyncHandler(controller.addMedication));
  router.get('/me/medications', asyncHandler(controller.listMedications));
  router.get('/me/risk', asyncHandler(controller.getRiskSummary));
  router.get('/me/insights/muscle', asyncHandler(controller.getMuscleInsight));

  return router;
};
