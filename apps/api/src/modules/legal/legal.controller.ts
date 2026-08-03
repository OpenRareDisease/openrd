import type { Response } from 'express';
import type { Pool } from 'pg';

import { recordAcceptanceSchema, withdrawAcceptanceSchema } from './legal.schema.js';
import { getAcceptanceSummary, recordAcceptance, withdrawAcceptance } from './legal.service.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';

/**
 * Agreement acceptances. Two routes, both scoped to `req.user.id` —
 * there is no path parameter for a user id anywhere in this module, so
 * there is no way to read or write another patient's consent record.
 *
 * The response is projected field by field rather than returning the
 * service result wholesale. Nothing sensitive is in it today, but this
 * is a consent surface: the moment someone adds `ip` or `user_agent` to
 * the row shape for an admin view, a spread would start handing every
 * patient their own stored IP history back over HTTP without anyone
 * deciding to.
 */
export class LegalController {
  constructor(private readonly pool: Pool) {}

  getMyAcceptances = async (req: AuthenticatedRequest, res: Response) => {
    const summary = await getAcceptanceSummary(this.pool, req.user.id);
    res.status(200).json({
      acceptances: summary.acceptances.map((item) => ({
        document: item.document,
        version: item.version,
        acceptedAt: item.acceptedAt,
      })),
      current: summary.current,
      outstanding: summary.outstanding,
    });
  };

  /**
   * Withdraw consent to a document.
   *
   * The consent documents promise this in writing 「同意后可随时在
   * 「隐私设置」中撤回」 and PIPL Art. 15 requires a convenient way to
   * exercise it; until migration 020 the ledger was append-only and the
   * promise was unkeepable.
   *
   * 200 whether or not a row was live. The user's intent is 「I do not
   * consent」, and that is true afterwards either way — returning 404
   * for 「you had not consented」 would make the UI show an error for a
   * state the user is already in.
   */
  withdrawMyAcceptance = async (req: AuthenticatedRequest, res: Response) => {
    const payload = withdrawAcceptanceSchema.parse(req.body);
    const withdrawn = await withdrawAcceptance(this.pool, req.user.id, payload.document);
    res.status(200).json({ document: payload.document, withdrawn });
  };

  recordMyAcceptance = async (req: AuthenticatedRequest, res: Response) => {
    const payload = recordAcceptanceSchema.parse(req.body);
    const acceptance = await recordAcceptance(this.pool, {
      userId: req.user.id,
      document: payload.document,
      version: payload.version,
      ip: req.ip,
      // The header can legitimately be absent (curl, a native client
      // that sets none) and Node types it as string | string[]; only a
      // plain string is worth storing as evidence of what the user was
      // looking at.
      userAgent:
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    });

    // 201 on both the first write and a repeat: the upsert is
    // idempotent, and making the client distinguish 「新记录」 from
    // 「已有记录」 would invite it to treat one of them as an error and
    // block the user on a retry.
    res.status(201).json({
      document: acceptance.document,
      version: acceptance.version,
      acceptedAt: acceptance.acceptedAt,
    });
  };
}
