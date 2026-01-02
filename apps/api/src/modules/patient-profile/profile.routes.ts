import { Router } from 'express';
import multer from 'multer';
import { PatientProfileController } from './profile.controller';
import { PatientProfileService } from './profile.service';
import { getPool } from '../../db/pool';
import { requireAuth } from '../../middleware/require-auth';
import type { RouteContext } from '../../routes';
import { BaiduOcrProvider } from '../../services/ocr/baidu-ocr.js';
import { MockOcrProvider } from '../../services/ocr/mock-ocr.js';
import { LocalStorageProvider } from '../../services/storage/local-storage.js';
import { asyncHandler } from '../../utils/async-handler';

export const createPatientProfileRouter = (context: RouteContext) => {
  const router = Router();
  const service = new PatientProfileService({
    pool: getPool(),
    logger: context.logger,
  });
  const storage = new LocalStorageProvider();
  const ocr =
    context.env.BAIDU_OCR_API_KEY && context.env.BAIDU_OCR_SECRET_KEY
      ? new BaiduOcrProvider({
          apiKey: context.env.BAIDU_OCR_API_KEY,
          secretKey: context.env.BAIDU_OCR_SECRET_KEY,
          generalEndpoint: context.env.BAIDU_OCR_GENERAL_ENDPOINT,
          accurateEndpoint: context.env.BAIDU_OCR_ACCURATE_ENDPOINT,
          medicalEndpoint: context.env.BAIDU_OCR_MEDICAL_ENDPOINT,
        })
      : new MockOcrProvider();
  const controller = new PatientProfileController(service, storage, ocr);
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
  router.post('/me/medications', asyncHandler(controller.addMedication));
  router.get('/me/medications', asyncHandler(controller.listMedications));
  router.get('/me/risk', asyncHandler(controller.getRiskSummary));
  router.get('/me/insights/muscle', asyncHandler(controller.getMuscleInsight));

  return router;
};
