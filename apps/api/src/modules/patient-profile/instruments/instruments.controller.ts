import type { Response } from 'express';
import { administrationListQuerySchema, createAdministrationSchema } from './instruments.schema.js';
import type { InstrumentsService } from './instruments.service.js';
import type { AuthenticatedRequest } from '../../../middleware/require-auth.js';

/**
 * HTTP surface for the instrument engine.
 *
 * Thin on purpose: parse, delegate, serialise. Every clinical decision
 * — what an anchor says, what a grade implies, what may be inferred
 * from it — lives in the instrument definitions and the service, where
 * it is unit-testable without an Express request.
 */
export class InstrumentsController {
  constructor(private readonly service: InstrumentsService) {}

  /**
   * GET /api/profiles/me/instruments
   *
   * The catalogue: anchors, citation, licence, self-report evidence
   * AND the documented limitations, in one response. The caveats are
   * not a separate endpoint the client can forget to call — a screen
   * that renders a scale without its floor-effect warning would be
   * telling a patient that a flat line means a stable disease.
   */
  listCatalogue = async (_req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({ instruments: this.service.listCatalogue() });
  };

  /** POST /api/profiles/me/instruments/administrations */
  recordAdministration = async (req: AuthenticatedRequest, res: Response) => {
    const payload = createAdministrationSchema.parse(req.body);
    const result = await this.service.recordAdministration(req.user.id, payload);
    res.status(201).json(result);
  };

  /** GET /api/profiles/me/instruments/administrations */
  listAdministrations = async (req: AuthenticatedRequest, res: Response) => {
    const query = administrationListQuerySchema.parse(req.query);
    const administrations = await this.service.listAdministrations(req.user.id, query);
    res.status(200).json({ administrations });
  };

  /** GET /api/profiles/me/instruments/summary — latest live score per
   *  instrument. Returns `{ administrations: [] }` rather than 404 for
   *  a patient who has not taken any, so the dashboard can render an
   *  empty state without a second "does this exist" call. */
  getSummary = async (req: AuthenticatedRequest, res: Response) => {
    const administrations = await this.service.getSummary(req.user.id);
    res.status(200).json({ administrations });
  };
}
