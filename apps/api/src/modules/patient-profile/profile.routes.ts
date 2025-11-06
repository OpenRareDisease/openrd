import { Router } from 'express';
import { PatientProfileController } from './profile.controller';
import { PatientProfileService } from './profile.service';
import { getPool } from '../../db/pool';
import { requireAuth } from '../../middleware/require-auth';
import type { RouteContext } from '../../routes';
import { asyncHandler } from '../../utils/async-handler';

export const createPatientProfileRouter = (context: RouteContext) => {
  const router = Router();
  const service = new PatientProfileService({
    pool: getPool(),
    logger: context.logger,
  });
  const controller = new PatientProfileController(service);
  const authMiddleware = requireAuth(context.env, context.logger);

  router.use(authMiddleware);

  router.post('/', asyncHandler(controller.createProfile));
  router.get('/me', asyncHandler(controller.getMyProfile));
  router.put('/me', asyncHandler(controller.updateMyProfile));

  router.post('/me/measurements', asyncHandler(controller.addMeasurement));
  router.post('/me/function-tests', asyncHandler(controller.addFunctionTest));
  router.post('/me/activity-logs', asyncHandler(controller.addActivityLog));
  router.post('/me/documents', asyncHandler(controller.addDocument));

  return router;
};
