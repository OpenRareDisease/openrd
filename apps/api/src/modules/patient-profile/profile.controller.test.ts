import type { Response } from 'express';
import { Readable } from 'node:stream';
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
    // The async pipeline lands the parse result via this dedicated
    // write-path once the background job settles.
    updateDocumentOcrResult: vi.fn().mockResolvedValue({ id: 'doc-1', status: 'parsed' }),
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

      // Async pipeline: the INSERT is always 'processing'; the final
      // status lands via updateDocumentOcrResult once the background
      // job settles (tracked in inFlightOcrJobs for exactly this).
      const addCall = (service.addUploadedDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.status).toBe('processing');
      expect(addCall.ocrPayload).toBeNull();

      await controller.inFlightOcrJobs.get('doc-1');

      const updateCall = (service.updateDocumentOcrResult as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(updateCall[2].status).toBe(expected);
      // Hard guard against status drift versus the migration vocabulary.
      expect(ALLOWED_BY_MIGRATION_011.has(updateCall[2].status)).toBe(true);
      // The job removes itself from the in-flight map on settle.
      expect(controller.inFlightOcrJobs.has('doc-1')).toBe(false);
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
      // The canonical type is resolved AFTER the background parse.
      await controller.inFlightOcrJobs.get('doc-1');

      const updateCall = (service.updateDocumentOcrResult as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(updateCall[2].documentType).toBe(expected);
      expect(ALLOWED_BY_MIGRATION_012.has(updateCall[2].documentType)).toBe(true);
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
    // `generateDocumentSummary` now wires `res.on('close', ...)` for
    // AbortController-driven LLM cancellation (PR-Sec-8). Stub both
    // `on` and `off` so the controller can attach + detach without
    // tripping a TypeError on the mock.
    const res = {
      status: vi.fn((code: number) => {
        captured.status = code;
        return res;
      }),
      json: vi.fn((body: unknown) => {
        captured.body = body;
        return res;
      }),
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
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

  /*
   * PR #56 review: `generateDocumentSummary` wires
   * `res.on('close', onClientClose)` to abort the LLM call when the
   * client drops. The contract added with that wiring is "every exit
   * path detaches the listener" — without it, two throw paths
   * (`if (!summary) throw AppError(502)` and a
   * `updateDocumentOcrPayloadForUser` rejection) would leak the
   * closure attached to the (already-finished) response. The fix
   * wraps the work in try/finally; these two cases pin the contract.
   */
  it('detaches res.on("close") listener when the service write rejects (PR #56)', async () => {
    const { controller, service } = buildSummaryDeps({ consentLevel: 'basic' });
    // Force the post-LLM persist call to reject — this is one of
    // the two leak paths flagged on the previous patch.
    (service.updateDocumentOcrPayloadForUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('pg: deadlock detected'),
    );
    const { res } = captureJson();

    await expect(
      controller.generateDocumentSummary(
        { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
        res,
      ),
    ).rejects.toThrow('pg: deadlock detected');

    // Contract: every exit detaches the same handler instance.
    const onCalls = (res.on as ReturnType<typeof vi.fn>).mock.calls;
    const offCalls = (res.off as ReturnType<typeof vi.fn>).mock.calls;
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0][0]).toBe('close');
    expect(offCalls).toHaveLength(1);
    expect(offCalls[0][0]).toBe('close');
    // Reference equality on the listener — proves we detached the
    // exact closure we attached, not a different one.
    expect(offCalls[0][1]).toBe(onCalls[0][1]);
  });

  it('detaches res.on("close") listener when LLM returns empty content (PR #56)', async () => {
    const { controller, completionsCreate } = buildSummaryDeps({ consentLevel: 'basic' });
    // Empty content from the LLM stays the empty string after trim;
    // the catch branch never fires (resolved promise, not rejection),
    // so the fallback also never runs. `if (!summary) throw` lights
    // up — the second leak path the review flagged.
    completionsCreate.mockReset();
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: '   ' } }],
    });
    const { res } = captureJson();

    await expect(
      controller.generateDocumentSummary(
        { user: { id: 'u-1' }, params: { id: 'doc-1' } } as unknown as AuthenticatedRequest,
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 502 });

    const onCalls = (res.on as ReturnType<typeof vi.fn>).mock.calls;
    const offCalls = (res.off as ReturnType<typeof vi.fn>).mock.calls;
    expect(onCalls).toHaveLength(1);
    expect(offCalls).toHaveLength(1);
    expect(offCalls[0][1]).toBe(onCalls[0][1]);
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

/**
 * POST /me/documents/:id/reparse — the recovery path for failed or
 * lost parses. State-gated so it can't double-parse or reparse a
 * perfectly good document.
 */
describe('PatientProfileController.reparseDocument', () => {
  const buildReparseDeps = (documentStatus: string, uploadedAt = new Date()) => {
    const service = {
      getDocumentForUser: vi.fn().mockResolvedValue({
        id: 'doc-1',
        document_type: 'other',
        status: documentStatus,
        title: '肌肉MRI',
        storage_uri: 'local://uploads/x/scan.pdf',
        file_name: 'scan.pdf',
        mime_type: 'application/pdf',
        ocr_payload: null,
        uploaded_at: uploadedAt,
      }),
      updateDocumentOcrResult: vi.fn().mockResolvedValue({ id: 'doc-1', status: 'processing' }),
    } as unknown as PatientProfileService;
    const storage = {
      save: vi.fn(),
      load: vi.fn().mockResolvedValue({
        stream: Readable.from([Buffer.from('%PDF-fake')]),
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      }),
      remove: vi.fn(),
      canHandle: vi.fn(),
    } as unknown as StorageProvider;
    const ocr = {
      parse: vi
        .fn()
        .mockResolvedValue({ provider: 'paddle', fields: { analysisStatus: 'completed' } }),
    } as unknown as OcrProvider;
    return { service, storage, ocr };
  };

  const reparseReq = () =>
    ({
      user: { id: 'user-1' },
      params: { id: 'doc-1' },
    }) as unknown as AuthenticatedRequest;

  it('parse_failed → 202, row flipped to processing, background job lands the result', async () => {
    const { service, storage, ocr } = buildReparseDeps('parse_failed');
    const controller = new PatientProfileController(service, storage, ocr);
    const res = fakeRes();

    await controller.reparseDocument(reparseReq(), res);

    expect(res.status).toHaveBeenCalledWith(202);
    // First update: back to processing with the payload cleared.
    const firstUpdate = (service.updateDocumentOcrResult as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstUpdate[2]).toEqual({ status: 'processing', ocrPayload: null });

    await controller.inFlightOcrJobs.get('doc-1');

    // Second update: the fresh parse result (buffer came from
    // storage.load's stream).
    expect(ocr.parse).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: Buffer.from('%PDF-fake') }),
    );
    const secondUpdate = (service.updateDocumentOcrResult as ReturnType<typeof vi.fn>).mock
      .calls[1];
    expect(secondUpdate[2].status).toBe('parsed');
  });

  it('legacy uploaded rows are eligible too', async () => {
    const { service, storage, ocr } = buildReparseDeps('uploaded');
    const controller = new PatientProfileController(service, storage, ocr);
    const res = fakeRes();

    await controller.reparseDocument(reparseReq(), res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('fresh processing → 409 (its job may still be running elsewhere)', async () => {
    const { service, storage, ocr } = buildReparseDeps('processing', new Date());
    const controller = new PatientProfileController(service, storage, ocr);

    await expect(controller.reparseDocument(reparseReq(), fakeRes())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(storage.load).not.toHaveBeenCalled();
  });

  it('stuck processing (older than the threshold) IS eligible', async () => {
    const stale = new Date(Date.now() - 11 * 60 * 1000);
    const { service, storage, ocr } = buildReparseDeps('processing', stale);
    const controller = new PatientProfileController(service, storage, ocr);
    const res = fakeRes();

    await controller.reparseDocument(reparseReq(), res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('parsed → 409 (nothing to recover, source file unchanged)', async () => {
    const { service, storage, ocr } = buildReparseDeps('parsed');
    const controller = new PatientProfileController(service, storage, ocr);

    await expect(controller.reparseDocument(reparseReq(), fakeRes())).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('an in-flight job for the same document → 409, no duplicate parse', async () => {
    const { service, storage, ocr } = buildReparseDeps('parse_failed');
    const controller = new PatientProfileController(service, storage, ocr);
    controller.inFlightOcrJobs.set('doc-1', Promise.resolve());

    await expect(controller.reparseDocument(reparseReq(), fakeRes())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(storage.load).not.toHaveBeenCalled();
    controller.inFlightOcrJobs.delete('doc-1');
  });
});

describe('PatientProfileController.uploadDocument — queue admission cap', () => {
  it('rejects with 429 BEFORE storage.save when the job queue is full', async () => {
    const { service, storage, ocr } = buildDeps();
    const controller = new PatientProfileController(service, storage, ocr);
    // Saturate the queue: each entry parks a ≤10MB buffer, which is
    // exactly the memory the cap exists to bound.
    for (let i = 0; i < 10; i += 1) {
      controller.inFlightOcrJobs.set(`queued-${i}`, Promise.resolve());
    }

    const req = {
      user: { id: 'user-1' },
      body: { documentType: 'mri' },
      file: makeFile(),
    } as unknown as AuthenticatedRequest;

    await expect(controller.uploadDocument(req, fakeRes())).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(storage.save).not.toHaveBeenCalled();
    expect(service.addUploadedDocument).not.toHaveBeenCalled();
    controller.inFlightOcrJobs.clear();
  });
});

describe('PatientProfileController.exportMyData — full data export', () => {
  const buildExportController = (overrides: {
    profile?: unknown;
    auditPages?: unknown[][];
    submissionBatches?: Array<{ items: unknown[]; total: number }>;
  }) => {
    const submissionBatches = overrides.submissionBatches ?? [{ items: [], total: 0 }];
    let submissionCall = 0;
    const service = {
      getProfileByUserId: vi.fn().mockResolvedValue(overrides.profile ?? null),
      getConsentDetails: vi.fn().mockResolvedValue({ personal: true }),
      getConsentHistory: vi.fn().mockResolvedValue([{ flagName: 'personal' }]),
      getSharingPreferences: vi.fn().mockResolvedValue({ donation: false }),
      listSubmissions: vi.fn().mockImplementation(() => {
        const batch = submissionBatches[Math.min(submissionCall, submissionBatches.length - 1)];
        submissionCall += 1;
        return Promise.resolve({ page: submissionCall, pageSize: 100, ...batch });
      }),
    } as unknown as PatientProfileService;

    const auditPages = overrides.auditPages ?? [[]];
    let auditCall = 0;
    const auditReader = {
      listByUser: vi.fn().mockImplementation(() => {
        const rows = auditPages[Math.min(auditCall, auditPages.length - 1)];
        auditCall += 1;
        return Promise.resolve(rows);
      }),
    };

    const controller = new PatientProfileController(
      service,
      { save: vi.fn() } as unknown as StorageProvider,
      { parse: vi.fn() } as unknown as OcrProvider,
      undefined,
      undefined,
      auditReader,
    );
    return { controller, service, auditReader };
  };

  const req = { user: { id: 'user-1' } } as unknown as AuthenticatedRequest;

  it('404s when the caller has no profile', async () => {
    const { controller } = buildExportController({ profile: null });
    await expect(controller.exportMyData(req, fakeRes())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('assembles profile, consent, history, preferences, submissions and audit trail', async () => {
    const { controller, auditReader } = buildExportController({
      profile: { id: 'p1', documents: [] },
      submissionBatches: [{ items: [{ id: 's1' }], total: 1 }],
      auditPages: [[{ id: 'a1' }]],
    });
    const res = fakeRes();
    await controller.exportMyData(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.formatVersion).toBe(1);
    expect(payload.profile).toEqual({ id: 'p1', documents: [] });
    expect(payload.consent).toEqual({ personal: true });
    expect(payload.consentHistory).toHaveLength(1);
    expect(payload.sharingPreferences).toEqual({ donation: false });
    expect(payload.submissions).toEqual([{ id: 's1' }]);
    expect(payload.aiAuditTrail).toEqual([{ id: 'a1' }]);
    expect(payload.truncation).toEqual({
      submissions: false,
      aiAuditTrail: false,
      consentHistory: false,
    });
    expect(auditReader.listByUser).toHaveBeenCalledTimes(1);
  });

  it('pages through the audit trail until a short batch', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}` }));
    const { controller, auditReader } = buildExportController({
      profile: { id: 'p1' },
      auditPages: [fullPage, [{ id: 'last' }]],
    });
    const res = fakeRes();
    await controller.exportMyData(req, res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.aiAuditTrail).toHaveLength(201);
    expect(auditReader.listByUser).toHaveBeenCalledTimes(2);
    expect(auditReader.listByUser).toHaveBeenNthCalledWith(2, 'user-1', {
      limit: 200,
      offset: 200,
    });
  });

  it('429s a second export within the cooldown window (with waitSeconds)', async () => {
    const { controller } = buildExportController({ profile: { id: 'p1' } });
    await controller.exportMyData(req, fakeRes());
    await expect(controller.exportMyData(req, fakeRes())).rejects.toMatchObject({
      statusCode: 429,
      details: { waitSeconds: expect.any(Number) },
    });
    // A different user is unaffected by user-1's cooldown.
    const otherReq = { user: { id: 'user-2' } } as unknown as AuthenticatedRequest;
    const res = fakeRes();
    await controller.exportMyData(otherReq, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('works without an audit reader (empty trail, no crash)', async () => {
    const { controller } = buildExportController({ profile: { id: 'p1' } });
    const bare = new PatientProfileController(
      (controller as unknown as { service: PatientProfileService }).service,
      { save: vi.fn() } as unknown as StorageProvider,
      { parse: vi.fn() } as unknown as OcrProvider,
    );
    const res = fakeRes();
    await bare.exportMyData(req, res);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.aiAuditTrail).toEqual([]);
  });
});

describe('PatientProfileController.patchDocumentOcr — hand-correction whitelist', () => {
  const buildPatchController = (patchImpl?: ReturnType<typeof vi.fn>) => {
    const service = {
      patchDocumentOcrFields:
        patchImpl ?? vi.fn().mockResolvedValue({ id: 'doc-1', ocr_payload: { fields: {} } }),
    } as unknown as PatientProfileService;
    const controller = new PatientProfileController(
      service,
      { save: vi.fn() } as unknown as StorageProvider,
      { parse: vi.fn() } as unknown as OcrProvider,
    );
    return { controller, service };
  };

  const reqWith = (body: unknown) =>
    ({ user: { id: 'user-1' }, params: { id: 'doc-1' }, body }) as unknown as AuthenticatedRequest;

  it('rejects keys outside the whitelist with a 400 (zod)', async () => {
    const { controller, service } = buildPatchController();
    await expect(
      controller.patchDocumentOcr(reqWith({ fields: { extractedText: 'x' } }), fakeRes()),
    ).rejects.toThrow();
    expect(service.patchDocumentOcrFields).not.toHaveBeenCalled();
  });

  it('rejects an empty fields object', async () => {
    const { controller } = buildPatchController();
    await expect(controller.patchDocumentOcr(reqWith({ fields: {} }), fakeRes())).rejects.toThrow();
  });

  it('passes whitelisted corrections through to the service', async () => {
    const { controller, service } = buildPatchController();
    const res = fakeRes();
    await controller.patchDocumentOcr(
      reqWith({ fields: { d4z4Repeats: '4/22', reportName: '基因检测报告' } }),
      res,
    );
    expect(service.patchDocumentOcrFields).toHaveBeenCalledWith('user-1', 'doc-1', {
      d4z4Repeats: '4/22',
      reportName: '基因检测报告',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
