import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { DOCUMENT_TYPES } from './profile.constants.js';
import { PatientProfileController, _canonicalizeDocumentType } from './profile.controller.js';
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

/**
 * Pin every `status` the upload path can write against the
 * vocabulary `db/migrations/011_status_check_constraints.sql` admits.
 * Drift here used to fail the DB INSERT after the upload had already
 * landed in storage — the PR #49 reviewer's first finding.
 */
describe('PatientProfileController.uploadDocument — status mapping vs DB CHECK', () => {
  const ALLOWED_BY_MIGRATION_011 = new Set([
    'uploaded',
    'processing',
    'processed',
    'parsed',
    'needs_review',
    'failed',
    'parse_failed',
  ]);

  const cases: Array<{ name: string; ocrPayload: unknown; expected: string }> = [
    {
      name: 'completed OCR → parsed',
      ocrPayload: { provider: 'paddle', fields: { analysisStatus: 'completed' } },
      expected: 'parsed',
    },
    {
      name: 'OCR returns needs_review → needs_review',
      ocrPayload: { provider: 'paddle', fields: { analysisStatus: 'needs_review' } },
      expected: 'needs_review',
    },
    {
      name: 'OCR returns processing → processing',
      ocrPayload: { provider: 'paddle', fields: { analysisStatus: 'processing' } },
      expected: 'processing',
    },
    {
      name: 'OCR returns failed → parse_failed',
      ocrPayload: { provider: 'paddle', fields: { analysisStatus: 'failed' } },
      expected: 'parse_failed',
    },
    {
      name: 'OCR raised → parse_failed via payload.error',
      ocrPayload: { provider: 'unknown', error: 'tesseract crashed' },
      expected: 'parse_failed',
    },
    {
      name: 'no OCR payload → uploaded',
      ocrPayload: null,
      expected: 'uploaded',
    },
  ];

  for (const { name, ocrPayload, expected } of cases) {
    it(`${name} (and the status is admitted by migration 011)`, async () => {
      const { service, storage } = buildDeps();
      const ocr = {
        parse: vi.fn().mockResolvedValue(ocrPayload),
      } as unknown as OcrProvider;
      const controller = new PatientProfileController(service, storage, ocr);

      const req = {
        user: { id: 'user-1' },
        body: { documentType: 'mri' },
        file: makeFile(),
      } as unknown as AuthenticatedRequest;

      await controller.uploadDocument(req, fakeRes());

      const addCall = (service.addUploadedDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.status).toBe(expected);
      // Hard guard against status drift versus the migration vocabulary.
      expect(ALLOWED_BY_MIGRATION_011.has(addCall.status)).toBe(true);
    });
  }
});

/**
 * Pin every OCR sub-type the report pipeline emits to one of the four
 * canonical `document_type` values migration 012's
 * `patient_documents_type_check` admits. PR #50 reviewer flagged that
 * the raw sub-type would otherwise hit the DB CHECK and 500 the
 * upload after the file had already landed in storage.
 */
describe('PatientProfileController.uploadDocument — document_type canonicalisation vs DB CHECK', () => {
  const ALLOWED_BY_MIGRATION_012 = new Set<string>(DOCUMENT_TYPES);

  it('the canonical allowlist matches DOCUMENT_TYPES exactly', () => {
    // If someone widens DOCUMENT_TYPES without also widening the
    // migration CHECK, this test will keep passing while the upload
    // path silently lies about the new value. The downstream
    // per-sub-type cases below are the real safeguard; this assertion
    // is documentation of intent.
    expect(ALLOWED_BY_MIGRATION_012).toEqual(
      new Set(['mri', 'genetic_report', 'blood_panel', 'other']),
    );
  });

  // Every sub-type the OCR / report pipeline emits today, plus
  // their expected canonical mapping. The list is derived from
  // `documentTypeLabels` in profile.service.ts and `documentLabels`
  // in profile.passport.ts.
  const subTypeCases: Array<{ ocrValue: string; expected: string }> = [
    { ocrValue: 'mri', expected: 'mri' },
    { ocrValue: 'muscle_mri', expected: 'mri' },
    { ocrValue: 'genetic_report', expected: 'genetic_report' },
    { ocrValue: 'blood_panel', expected: 'blood_panel' },
    { ocrValue: 'biochemistry', expected: 'blood_panel' },
    { ocrValue: 'muscle_enzyme', expected: 'blood_panel' },
    { ocrValue: 'blood_routine', expected: 'blood_panel' },
    { ocrValue: 'thyroid_function', expected: 'blood_panel' },
    { ocrValue: 'coagulation', expected: 'blood_panel' },
    { ocrValue: 'urinalysis', expected: 'blood_panel' },
    { ocrValue: 'infection_screening', expected: 'blood_panel' },
    { ocrValue: 'stool_test', expected: 'blood_panel' },
    { ocrValue: 'medical_summary', expected: 'other' },
    { ocrValue: 'physical_exam', expected: 'other' },
    { ocrValue: 'pulmonary_function', expected: 'other' },
    { ocrValue: 'diaphragm_ultrasound', expected: 'other' },
    { ocrValue: 'ecg', expected: 'other' },
    { ocrValue: 'echocardiography', expected: 'other' },
    { ocrValue: 'abdominal_ultrasound', expected: 'other' },
    // Unknown sub-type a future OCR classifier might emit: defaults
    // to 'other' so the DB CHECK never breaks the upload.
    { ocrValue: 'novel_unmapped_subtype', expected: 'other' },
  ];

  for (const { ocrValue, expected } of subTypeCases) {
    it(`maps fields.classifiedType='${ocrValue}' → '${expected}' (admitted by migration 012)`, async () => {
      const { service, storage } = buildDeps();
      const ocr = {
        parse: vi.fn().mockResolvedValue({
          provider: 'paddle',
          fields: { classifiedType: ocrValue, analysisStatus: 'completed' },
        }),
      } as unknown as OcrProvider;
      const controller = new PatientProfileController(service, storage, ocr);

      const req = {
        user: { id: 'user-1' },
        // The schema-bound fallback is one of the four canonical
        // values; the OCR sub-type wins over it.
        body: { documentType: 'other' },
        file: makeFile(),
      } as unknown as AuthenticatedRequest;

      await controller.uploadDocument(req, fakeRes());

      const addCall = (service.addUploadedDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.documentType).toBe(expected);
      expect(ALLOWED_BY_MIGRATION_012.has(addCall.documentType)).toBe(true);
    });
  }

  it('canonicalizeDocumentType unit: every known sub-type lands in the allowlist', () => {
    // Probes the helper directly for the same cases, so a future
    // refactor that bypasses the controller-level integration test
    // still trips here.
    for (const { ocrValue, expected } of subTypeCases) {
      const result = _canonicalizeDocumentType(ocrValue);
      expect(result).toBe(expected);
      expect(ALLOWED_BY_MIGRATION_012.has(result)).toBe(true);
    }
  });
});
