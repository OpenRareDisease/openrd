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

const buildDeps = (
  serviceOverrides: Partial<{
    assertCallerCanWriteSubmission: ReturnType<typeof vi.fn>;
    addUploadedDocument: ReturnType<typeof vi.fn>;
  }> = {},
) => {
  const service = {
    assertCallerCanWriteSubmission:
      serviceOverrides.assertCallerCanWriteSubmission ?? vi.fn().mockResolvedValue(undefined),
    addUploadedDocument:
      serviceOverrides.addUploadedDocument ?? vi.fn().mockResolvedValue({ id: 'doc-1' }),
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
  return { service, storage, ocr };
};

describe('PatientProfileController.uploadDocument — preflight authorization (PR-Sec-1 reviews)', () => {
  it('rejects a foreign submissionId BEFORE calling storage.save or ocr.parse', async () => {
    // Round 1 of the review (foreign-submission path): an attacker
    // could otherwise burn storage writes + OCR CPU under a foreign
    // submissionId and only later receive a 404. The preflight pins
    // the ordering — storage / OCR / DB insert must never run.
    const { service, storage, ocr } = buildDeps({
      assertCallerCanWriteSubmission: vi
        .fn()
        .mockRejectedValue(new AppError('Submission not found', 404)),
      addUploadedDocument: vi.fn(),
    });
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

    expect(service.assertCallerCanWriteSubmission).toHaveBeenCalledWith(
      'attacker',
      '00000000-0000-0000-0000-000000000000',
    );
    expect(storage.save).not.toHaveBeenCalled();
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(service.addUploadedDocument).not.toHaveBeenCalled();
  });

  it('rejects a profile-less caller BEFORE calling storage.save or ocr.parse', async () => {
    // Round 2 of the review (no-profile + no-submissionId path): a
    // newly registered account that hasn't completed onboarding could
    // otherwise upload 10 MB files, force OCR, and only then receive
    // the 404 ensureProfileForUser would emit inside
    // addUploadedDocument. The preflight now runs ensureProfileForUser
    // first regardless of submissionId.
    const { service, storage, ocr } = buildDeps({
      assertCallerCanWriteSubmission: vi
        .fn()
        .mockRejectedValue(new AppError('Patient profile not found', 404)),
      addUploadedDocument: vi.fn(),
    });
    const controller = new PatientProfileController(service, storage, ocr);

    const req = {
      user: { id: 'newcomer' },
      // No submissionId → previous preflight short-circuited.
      body: { documentType: 'mri' },
      file: makeFile(10 * 1024 * 1024),
    } as unknown as AuthenticatedRequest;

    await expect(controller.uploadDocument(req, fakeRes())).rejects.toBeInstanceOf(AppError);

    expect(service.assertCallerCanWriteSubmission).toHaveBeenCalledWith('newcomer', undefined);
    expect(storage.save).not.toHaveBeenCalled();
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(service.addUploadedDocument).not.toHaveBeenCalled();
  });

  it('proceeds to storage + OCR when the caller has a profile (no submissionId)', async () => {
    const { service, storage, ocr } = buildDeps();
    const controller = new PatientProfileController(service, storage, ocr);

    const req = {
      user: { id: 'user-1' },
      body: { documentType: 'mri' },
      file: makeFile(),
    } as unknown as AuthenticatedRequest;

    await controller.uploadDocument(req, fakeRes());

    expect(service.assertCallerCanWriteSubmission).toHaveBeenCalledWith('user-1', undefined);
    expect(storage.save).toHaveBeenCalledOnce();
    expect(ocr.parse).toHaveBeenCalledOnce();
    expect(service.addUploadedDocument).toHaveBeenCalledOnce();
  });
});
