import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { DOCUMENT_TYPES } from './profile.constants.js';
import {
  PatientProfileController,
  _canonicalizeDocumentType,
  _buildContentDisposition,
  _SAFE_INLINE_MIME_ALLOWLIST,
} from './profile.controller.js';
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

/**
 * PR #50 review round 2: getDocumentFile used to echo the user-supplied
 * mime_type back as Content-Type and used Content-Disposition: inline
 * with the raw filename. Both gave a stored-XSS / header-injection
 * surface. This test pins the MIME allowlist + RFC 5987-safe filename
 * + nosniff + attachment.
 */
describe('PatientProfileController.getDocumentFile — Content-Type + Content-Disposition safety', () => {
  const buildFileServer = (storedMime: string | null, fileName: string | null) => {
    const service = {
      getDocumentForUser: vi.fn().mockResolvedValue({
        id: 'doc-1',
        document_type: 'mri',
        storage_uri: 'local://uploads/x/scan.pdf',
        file_name: fileName,
        mime_type: storedMime,
        ocr_payload: null,
      }),
    } as unknown as PatientProfileService;
    const storage = {
      load: vi.fn().mockResolvedValue({
        stream: { pipe: vi.fn() },
        fileName: 'fallback.bin',
        mimeType: null,
      }),
      save: vi.fn(),
      remove: vi.fn(),
      canHandle: vi.fn(),
    } as unknown as StorageProvider;
    const ocr = { parse: vi.fn() } as unknown as OcrProvider;
    return { service, storage, ocr };
  };

  const captureHeaders = () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: vi.fn((name: string, value: string) => {
        headers[name.toLowerCase()] = String(value);
      }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return { res, headers };
  };

  it('rejects a text/html stored MIME — falls back to octet-stream', async () => {
    const { service, storage, ocr } = buildFileServer('text/html', 'innocent.pdf');
    const controller = new PatientProfileController(service, storage, ocr);
    const { res, headers } = captureHeaders();

    await controller.getDocumentFile(
      { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
      res,
    );

    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['x-content-type-options']).toBe('nosniff');
    // attachment, not inline
    expect(headers['content-disposition']?.startsWith('attachment;')).toBe(true);
  });

  it('passes application/pdf through (on the allowlist)', async () => {
    const { service, storage, ocr } = buildFileServer('application/pdf', 'scan.pdf');
    const controller = new PatientProfileController(service, storage, ocr);
    const { res, headers } = captureHeaders();

    await controller.getDocumentFile(
      { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
      res,
    );

    expect(headers['content-type']).toBe('application/pdf');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-disposition']).toContain('attachment');
    expect(headers['content-disposition']).toContain('filename="scan.pdf"');
  });

  it('uses RFC 5987 encoding for non-ASCII filenames', () => {
    const disposition = _buildContentDisposition('张三的报告.pdf');
    // ASCII fallback present
    expect(disposition).toMatch(/filename="[A-Za-z0-9._-]+"/);
    // UTF-8 form for the real bytes
    expect(disposition).toContain("filename*=UTF-8''");
    // No raw CJK bytes in the ASCII filename
    expect(disposition).not.toMatch(/filename="[^"]*张三/);
  });

  it('strips CR / LF / quote so a header-injection filename cannot break out', () => {
    const evil = 'evil"\r\nSet-Cookie: pwned=1\r\n";.pdf';
    const disposition = _buildContentDisposition(evil);
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    // Quote inside the ASCII filename slot must have been replaced
    expect(disposition).not.toMatch(/filename="evil"/);
  });

  it('falls back to a safe placeholder when filename collapses to empty', () => {
    expect(_buildContentDisposition('   \r\n  ')).toContain('filename="document"');
  });

  it('MIME allowlist contains only safe inline types', () => {
    // Sanity guard against someone widening the allowlist to text/html
    // or image/svg+xml without realising the inline render risk.
    expect(_SAFE_INLINE_MIME_ALLOWLIST.has('text/html')).toBe(false);
    expect(_SAFE_INLINE_MIME_ALLOWLIST.has('image/svg+xml')).toBe(false);
    expect(_SAFE_INLINE_MIME_ALLOWLIST.has('application/xhtml+xml')).toBe(false);
    expect(_SAFE_INLINE_MIME_ALLOWLIST.has('application/pdf')).toBe(true);
    expect(_SAFE_INLINE_MIME_ALLOWLIST.has('image/png')).toBe(true);
  });
});

/**
 * PR-Sec-5 #2: generateDocumentSummary used to ship the raw OCR
 * fields blob (patientName, idCard, phoneNumber, doctorName, mrn,
 * dateOfBirth, raw extractedText…) straight to the LLM with no
 * consent gate and no redactor. The whole ai-agents/security/* stack
 * existed to prevent exactly this, so the endpoint was a glaring
 * carve-out. These tests pin every guard.
 */
describe('PatientProfileController.generateDocumentSummary — consent + redaction guards', () => {
  const buildSummaryDeps = (
    overrides: Partial<{
      consentLevel: 'none' | 'basic' | 'precise';
      ocrPayload: unknown;
      llmShouldFail: boolean;
    }> = {},
  ) => {
    const consentLevel = overrides.consentLevel ?? 'precise';
    const ocrPayload = overrides.ocrPayload ?? {
      provider: 'paddle',
      fields: {
        // The full long-tail of identifying fields the redactor is
        // supposed to strip. If a single one of these leaks into the
        // prompt, this test will catch it.
        patientName: '张三',
        idCard: '110101199005203212',
        phoneNumber: '13800001234',
        doctorName: 'Dr. Li',
        dateOfBirth: '1990-05-20',
        mrn: 'MRN-0001',
        notes: '私人备注：曾在 XX 医院就诊',
        // Clinical fields the orchestrator's allowlist accepts:
        classifiedType: 'genetic_report',
        d4z4Repeats: '3/22',
        haplotype: '4qA',
        analysisStatus: 'completed',
      },
      // The OCR raw-text dump that the legacy code sliced to 2000
      // chars and shipped to the LLM. Must not appear in the prompt.
      extractedText: '患者 张三 ，男，身份证 110101199005203212，主诉 …',
    };

    const completionsCreate = vi
      .fn()
      .mockImplementation(({ messages }: { messages: Array<{ content: string }> }) => {
        if (overrides.llmShouldFail) throw new Error('LLM upstream timeout');
        return Promise.resolve({
          choices: [
            {
              message: {
                content: `LLM saw:\n${messages.map((m) => m.content).join('\n---\n')}`,
              },
            },
          ],
        });
      });

    const service = {
      getConsentStatus: vi.fn().mockResolvedValue({ level: consentLevel }),
      getDocumentForUser: vi.fn().mockResolvedValue({
        id: 'doc-1',
        document_type: 'genetic_report',
        storage_uri: 'local://uploads/x/scan.pdf',
        file_name: 'scan.pdf',
        mime_type: 'application/pdf',
        ocr_payload: ocrPayload,
      }),
      updateDocumentOcrPayloadForUser: vi.fn().mockResolvedValue(undefined),
    } as unknown as PatientProfileService;
    const storage = {
      save: vi.fn(),
      load: vi.fn(),
      remove: vi.fn(),
      canHandle: vi.fn(),
    } as unknown as StorageProvider;
    const ocr = { parse: vi.fn() } as unknown as OcrProvider;
    const aiSummary = {
      client: { chat: { completions: { create: completionsCreate } } },
      model: 'test-model',
    } as unknown as ConstructorParameters<typeof PatientProfileController>[3];

    const controller = new PatientProfileController(service, storage, ocr, aiSummary);
    return { controller, service, completionsCreate };
  };

  const captureJson = () => {
    const captured: { status: number; body: unknown } = { status: 200, body: null };
    const res = {
      status: vi.fn((code: number) => {
        captured.status = code;
        return res;
      }),
      json: vi.fn((body: unknown) => {
        captured.body = body;
        return res;
      }),
    } as unknown as Response;
    return { res, captured };
  };

  it('rejects with 403 + consent_required when consent level is none', async () => {
    const { controller } = buildSummaryDeps({ consentLevel: 'none' });
    const { res } = captureJson();

    await expect(
      controller.generateDocumentSummary(
        { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
        res,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('redacts hard-delete keys from the prompt before sending to the LLM', async () => {
    const { controller, completionsCreate } = buildSummaryDeps({ consentLevel: 'basic' });
    const { res } = captureJson();

    await controller.generateDocumentSummary(
      { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
      res,
    );

    // Inspect what was actually handed to the LLM.
    const call = completionsCreate.mock.calls[0][0];
    const prompt = (call.messages as Array<{ content: string }>).map((m) => m.content).join('\n');

    for (const leaked of [
      '张三',
      '110101199005203212',
      '13800001234',
      'Dr. Li',
      '1990-05-20',
      'MRN-0001',
      '私人备注',
    ]) {
      expect(prompt).not.toContain(leaked);
    }
  });

  it('does NOT send the OCR extractedText raw dump to the LLM', async () => {
    const { controller, completionsCreate } = buildSummaryDeps({ consentLevel: 'basic' });
    const { res } = captureJson();

    await controller.generateDocumentSummary(
      { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
      res,
    );

    const call = completionsCreate.mock.calls[0][0];
    const prompt = (call.messages as Array<{ content: string }>).map((m) => m.content).join('\n');

    expect(prompt).not.toContain('患者 张三');
    expect(prompt).not.toContain('身份证');
    expect(prompt).not.toContain('extractedText');
    expect(prompt).not.toContain('rawFreeText');
  });

  it('marks the response with source=fallback when the LLM throws', async () => {
    const { controller } = buildSummaryDeps({ consentLevel: 'basic', llmShouldFail: true });
    const { res, captured } = captureJson();

    await controller.generateDocumentSummary(
      { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
      res,
    );

    expect(captured.status).toBe(200);
    expect((captured.body as { source: string }).source).toBe('fallback');
  });
});

describe('PatientProfileController.deleteDocument — service receives audit meta', () => {
  it('forwards req.ip + user-agent so the service can write the audit row', async () => {
    const deleteDocumentForUser = vi.fn().mockResolvedValue({
      id: 'doc-1',
      documentType: 'mri',
      title: null,
      storageUri: 'local://uploads/x/scan.pdf',
    });
    const service = { deleteDocumentForUser } as unknown as PatientProfileService;
    const storage = {
      remove: vi.fn().mockResolvedValue(undefined),
      load: vi.fn(),
      save: vi.fn(),
      canHandle: vi.fn(),
    } as unknown as StorageProvider;
    const ocr = { parse: vi.fn() } as unknown as OcrProvider;
    const controller = new PatientProfileController(service, storage, ocr);

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    await controller.deleteDocument(
      {
        user: { id: 'u-1' },
        params: { id: 'doc-1' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'TestAgent/1.0' },
      } as unknown as AuthenticatedRequest,
      res,
    );

    expect(deleteDocumentForUser).toHaveBeenCalledWith('u-1', 'doc-1', {
      ip: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
    });
  });
});
