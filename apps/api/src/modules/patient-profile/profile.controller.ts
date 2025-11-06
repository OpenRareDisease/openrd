import type { Response } from 'express';
import {
  activityLogSchema,
  createProfileSchema,
  documentSchema,
  functionTestSchema,
  measurementSchema,
  updateProfileSchema,
} from './profile.schema';
import type { PatientProfileService } from './profile.service';
import type { AuthenticatedRequest } from '../../middleware/require-auth';
import { AppError } from '../../utils/app-error';

export class PatientProfileController {
  constructor(private readonly service: PatientProfileService) {}

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

  updateMyProfile = async (req: AuthenticatedRequest, res: Response) => {
    const payload = updateProfileSchema.parse(req.body);
    const result = await this.service.updateProfile(req.user.id, payload);
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
}
