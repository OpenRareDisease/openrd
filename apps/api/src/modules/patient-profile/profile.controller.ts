import type { Response } from 'express';
import {
  activityLogSchema,
  createProfileSchema,
  documentSchema,
  documentUploadSchema,
  functionTestSchema,
  measurementSchema,
  medicationSchema,
  updateProfileSchema,
} from './profile.schema';
import type { PatientProfileService } from './profile.service';
import type { AuthenticatedRequest } from '../../middleware/require-auth';
import type { OcrProvider } from '../../services/ocr/ocr-provider.js';
import type { StorageProvider } from '../../services/storage/storage-provider.js';
import { AppError } from '../../utils/app-error';

export class PatientProfileController {
  constructor(
    private readonly service: PatientProfileService,
    private readonly storage: StorageProvider,
    private readonly ocr: OcrProvider,
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR failed';
      ocrPayload = { provider: 'unknown', error: message };
    }

    const result = await this.service.addUploadedDocument({
      userId: req.user.id,
      documentType: payload.documentType,
      title: payload.title ?? null,
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

  getDocumentOcr = async (req: AuthenticatedRequest, res: Response) => {
    const documentId = req.params.id;
    const document = await this.service.getDocumentForUser(req.user.id, documentId);
    res.status(200).json({
      documentId,
      ocrPayload: document.ocr_payload ?? null,
    });
  };

  getRiskSummary = async (req: AuthenticatedRequest, res: Response) => {
    const result = await this.service.getRiskSummary(req.user.id);
    res.status(200).json(result);
  };
}
