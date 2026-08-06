import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { InstrumentsController } from './instruments.controller.js';
import type { InstrumentsService } from './instruments.service.js';
import { VIGNOS_ITEM_CODE } from './vignos.js';
import type { AuthenticatedRequest } from '../../../middleware/require-auth.js';

const fakeRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;

const asRequest = (body: unknown, query: unknown = {}) =>
  ({ user: { id: 'user-1' }, body, query }) as unknown as AuthenticatedRequest;

const buildService = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    listCatalogue: vi.fn().mockReturnValue([{ key: 'vignos_lower_extremity' }]),
    recordAdministration: vi
      .fn()
      .mockResolvedValue({ administration: { id: 'a1' }, baselineSync: null }),
    listAdministrations: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue([]),
    ...overrides,
  }) as unknown as InstrumentsService;

describe('InstrumentsController', () => {
  it('serves the catalogue with 200', async () => {
    const service = buildService();
    const res = fakeRes();
    await new InstrumentsController(service).listCatalogue(asRequest(undefined), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ instruments: [{ key: 'vignos_lower_extremity' }] });
  });

  it('answers a recorded administration with 201', async () => {
    const service = buildService();
    const res = fakeRes();
    await new InstrumentsController(service).recordAdministration(
      asRequest({
        instrumentKey: 'vignos_lower_extremity',
        responses: [{ itemCode: VIGNOS_ITEM_CODE, responseValue: 3 }],
      }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(service.recordAdministration).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ instrumentKey: 'vignos_lower_extremity' }),
    );
  });

  it('rejects an unknown instrument key before it reaches the service', async () => {
    const service = buildService();
    await expect(
      new InstrumentsController(service).recordAdministration(
        asRequest({ instrumentKey: 'made_up_scale', responses: [] }),
        fakeRes(),
      ),
    ).rejects.toThrow();
    expect(service.recordAdministration).not.toHaveBeenCalled();
  });

  it('rejects a body that both skips an item and answers it', async () => {
    const service = buildService();
    await expect(
      new InstrumentsController(service).recordAdministration(
        asRequest({
          instrumentKey: 'vignos_lower_extremity',
          responses: [{ itemCode: VIGNOS_ITEM_CODE, responseValue: 3, skipped: true }],
        }),
        fakeRes(),
      ),
    ).rejects.toThrow();
    expect(service.recordAdministration).not.toHaveBeenCalled();
  });

  it('rejects an item marked both skipped and not applicable', async () => {
    const service = buildService();
    await expect(
      new InstrumentsController(service).recordAdministration(
        asRequest({
          instrumentKey: 'vignos_lower_extremity',
          responses: [{ itemCode: VIGNOS_ITEM_CODE, skipped: true, notApplicable: true }],
        }),
        fakeRes(),
      ),
    ).rejects.toThrow();
  });

  it('rejects a non-uuid supersedesId rather than letting Postgres 500 on it', async () => {
    const service = buildService();
    await expect(
      new InstrumentsController(service).recordAdministration(
        asRequest({
          instrumentKey: 'vignos_lower_extremity',
          responses: [{ itemCode: VIGNOS_ITEM_CODE, responseValue: 3 }],
          supersedesId: 'not-a-uuid',
        }),
        fakeRes(),
      ),
    ).rejects.toThrow();
  });

  it('passes includeSuperseded through from the query string', async () => {
    const service = buildService();
    await new InstrumentsController(service).listAdministrations(
      asRequest(undefined, { includeSuperseded: 'true' }),
      fakeRes(),
    );
    expect(service.listAdministrations).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ includeSuperseded: true }),
    );
  });

  it('rejects a page size beyond the cap instead of clamping it silently', async () => {
    const service = buildService();
    await expect(
      new InstrumentsController(service).listAdministrations(
        asRequest(undefined, { limit: '5000' }),
        fakeRes(),
      ),
    ).rejects.toThrow();
  });

  it('returns an empty summary as 200, not 404', async () => {
    const service = buildService();
    const res = fakeRes();
    await new InstrumentsController(service).getSummary(asRequest(undefined), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ administrations: [] });
  });
});
