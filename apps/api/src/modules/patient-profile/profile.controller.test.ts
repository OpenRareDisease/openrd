import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { PatientProfileController } from './profile.controller.js';
import type { PatientProfileService } from './profile.service.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { OcrProvider } from '../../services/ocr/ocr-provider.js';
import type { StorageProvider } from '../../services/storage/storage-provider.js';
import { AppError } from '../../utils/app-error.js';

const fakeRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;

const makeFile = (size = 32): Express.Multer.File =>
  ({
    fieldname: 'file',
    originalname: 'scan.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size,
    buffer: Buffer.alloc(size, 'x'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
  }) as unknown as Express.Multer.File;

describe('PatientProfileController.uploadDocument — submission ownership probe (PR-Sec-1 review)', () => {
  it('rejects a foreign submissionId BEFORE calling storage.save or ocr.parse', async () => {
    // Reviewer (openrd-review-bot) flagged that the ownership check
    // inside addUploadedDocument runs after both side effects, so an
    // attacker could repeatedly burn storage writes + OCR CPU under a
    // foreign submissionId and only then receive a 404. The fix
    // surfaces the probe through the controller upfront; this test
    // pins the ordering.
    const service = {
      assertSubmissionOwnership: vi
        .fn()
        .mockRejectedValue(new AppError('Submission not found', 404)),
      addUploadedDocument: vi.fn(),
    } as unknown as PatientProfileService;
    const storage = {
      save: vi.fn(),
      load: vi.fn(),
      remove: vi.fn(),
      canHandle: vi.fn(),
    } as unknown as StorageProvider;
    const ocr = {
      parse: vi.fn(),
    } as unknown as OcrProvider;

    const controller = new PatientProfileController(service, storage, ocr);

    const req = {
      user: { id: 'attacker' },
      body: {
        documentType: 'mri',
        submissionId: '00000000-0000-0000-0000-000000000000',
      },
      file: makeFile(10 * 1024 * 1024),
    } as unknown as AuthenticatedRequest;

    await expect(controller.uploadDocument(req, fakeRes())).rejects.toBeInstanceOf(AppError);

    // Nothing past the probe should have run.
    expect(service.assertSubmissionOwnership).toHaveBeenCalledWith(
      'attacker',
      '00000000-0000-0000-0000-000000000000',
    );
    expect(storage.save).not.toHaveBeenCalled();
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(service.addUploadedDocument).not.toHaveBeenCalled();
  });

  it('proceeds to storage + OCR when submissionId is omitted', async () => {
    const service = {
      assertSubmissionOwnership: vi.fn().mockResolvedValue(undefined),
      addUploadedDocument: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    } as unknown as PatientProfileService;
    const storage = {
      save: vi.fn().mockResolvedValue({
        storageUri: 'local://uploads/x/scan.pdf',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 32,
      }),
      load: vi.fn(),
      remove: vi.fn(),
      canHandle: vi.fn(),
    } as unknown as StorageProvider;
    const ocr = {
      parse: vi.fn().mockResolvedValue({ provider: 'mock' }),
    } as unknown as OcrProvider;

    const controller = new PatientProfileController(service, storage, ocr);

    const req = {
      user: { id: 'user-1' },
      body: { documentType: 'mri' },
      file: makeFile(),
    } as unknown as AuthenticatedRequest;

    await controller.uploadDocument(req, fakeRes());

    expect(service.assertSubmissionOwnership).toHaveBeenCalledWith('user-1', undefined);
    expect(storage.save).toHaveBeenCalledOnce();
    expect(ocr.parse).toHaveBeenCalledOnce();
    expect(service.addUploadedDocument).toHaveBeenCalledOnce();
  });
});
