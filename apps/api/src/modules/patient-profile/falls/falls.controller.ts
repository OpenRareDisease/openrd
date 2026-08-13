import type { Response } from 'express';
import { createFallSchema, fallIdParamsSchema, fallsQuerySchema } from './falls.schema.js';
import type { FallsService } from './falls.service.js';
import type { AuthenticatedRequest } from '../../../middleware/require-auth.js';

/**
 * HTTP surface for the falls diary.
 *
 * Thin on purpose: parse, delegate, serialise. Everything that decides
 * what a fall count is allowed to claim lives in falls.summary.ts,
 * where it is unit-testable without an Express request.
 */
export class FallsController {
  constructor(private readonly service: FallsService) {}

  /**
   * POST /api/profiles/me/falls
   *
   * Only `occurredOn` is required. A patient recording a fall an hour
   * later, one-handed, saves after one tap; the other five answers are
   * worth having and are not worth losing the record over.
   */
  recordFall = async (req: AuthenticatedRequest, res: Response) => {
    const payload = createFallSchema.parse(req.body);
    const fall = await this.service.recordFall(req.user.id, payload);
    res.status(201).json({ fall });
  };

  /**
   * GET /api/profiles/me/falls
   *
   * Returns the diary entries AND a summary computed over the full
   * history. The two counts can legitimately differ — a fall logged
   * through the old followup-event route has no diary entry — and the
   * screen is expected to say so rather than show the shorter list as
   * if it were everything.
   */
  listFalls = async (req: AuthenticatedRequest, res: Response) => {
    const query = fallsQuerySchema.parse(req.query);
    const result = await this.service.listFalls(req.user.id, query.windowDays);
    res.status(200).json(result);
  };

  /**
   * GET /api/profiles/me/falls/summary
   *
   * The quarterly count the 跌倒记录 block on 病程管理 renders. Returns
   * zeroed counts and an empty `quarters` array for a patient with no
   * falls on record — which is NOT the same as a patient who has not
   * fallen, and no reader may label it that way (the mobile side says
   *「空白只代表这里没有记录」; see summarizeFallsForCourse).
   */
  getSummary = async (req: AuthenticatedRequest, res: Response) => {
    const query = fallsQuerySchema.parse(req.query);
    const summary = await this.service.getFallsSummary(req.user.id, query.windowDays);
    res.status(200).json({ summary });
  };

  /** DELETE /api/profiles/me/falls/:id — retracts the diary entry and
   *  its timeline twin together. Soft delete, same as every other
   *  patient-authored record (migration 016). */
  deleteFall = async (req: AuthenticatedRequest, res: Response) => {
    const params = fallIdParamsSchema.parse(req.params);
    await this.service.deleteFall(req.user.id, params.id);
    res.status(204).send();
  };
}
