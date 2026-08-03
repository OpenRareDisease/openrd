import type { NextFunction, RequestHandler, Request, Response } from 'express';
import type { Pool } from 'pg';

import { GUARDIAN_CONSENT_DOCUMENT, SENSITIVE_DATA_DOCUMENT } from './legal.constants.js';
import { hasAcceptedDocument } from './legal.service.js';
import { requiresGuardianConsent } from './minor-age.js';
import type { AppLogger } from '../../config/logger.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';

/**
 * Refuse to store 敏感个人信息 without a recorded 单独同意.
 *
 * This exists because the first version of this feature put the gate
 * only in the mobile client, and then said otherwise in two comments —
 * legal.routes.ts claimed the ledger is read 「on every upload」 and
 * migration 019 justified its ON DELETE CASCADE with 「the first upload
 * is blocked until the sensitive-PI consent is recorded」. Neither was
 * true. `hasAcceptedDocument` had no caller outside its own test, and
 * a JWT-bearing request could store and OCR a genetic report with an
 * empty acceptance ledger.
 *
 * A client-side gate is a UX affordance, not a control. The bundle is
 * cached, the modal can throw, and the API is reachable with curl —
 * so the one place the guarantee can actually live is here, in front
 * of every route that writes health or genetic data.
 *
 * FAILS CLOSED. A database error means we cannot show the consent was
 * given, and storing a patient's MRI on the strength of a failed SELECT
 * is not a recoverable mistake. The client already treats a failed
 * status read as「ask again」, so a 503 here lands on a path it handles.
 *
 * The response carries a machine-readable `code` because the client has
 * to tell「你还没同意，这是同意书」apart from a generic 403; the mobile
 * gate maps `sensitive_consent_required` onto the modal it already
 * renders, so a user who somehow reaches an ungated build is asked
 * rather than stuck.
 */
export const requireSensitiveDataConsent = (pool: Pool, logger: AppLogger): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      // requireAuth runs first; this is belt-and-braces so a future
      // re-ordering cannot turn the check into a silent no-op.
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let accepted: boolean;
    try {
      accepted = await hasAcceptedDocument(pool, userId, SENSITIVE_DATA_DOCUMENT);
    } catch (error) {
      logger.error({ error }, 'sensitive-data consent check failed');
      res.status(503).json({
        error: '暂时无法确认你的授权状态，请稍后重试',
        code: 'consent_check_unavailable',
      });
      return;
    }

    if (!accepted) {
      res.status(403).json({
        error: '需要先阅读并同意《敏感个人信息处理单独同意》才能保存报告或健康数据',
        code: 'sensitive_consent_required',
      });
      return;
    }

    next();
  };
};

/**
 * PIPL Art. 31: a profile for a patient under 14 needs the guardian's
 * consent on record before it exists.
 *
 * Reads the date of birth off the request body and recomputes the age
 * from the SERVER clock. The mobile form has the same rule, but it
 * reads the handset's clock — which is user-settable, so the client
 * gate is skippable by anyone who wants to skip it. That matters more
 * than usual here: the whole population this guard protects is
 * children, and the person filling the form is not the person it
 * protects.
 *
 * A request with no date of birth passes through. The field is optional
 * on some update paths, and a write that does not touch it cannot make
 * the patient younger; the create path validates its presence
 * separately. If a future schema change makes dateOfBirth removable,
 * this becomes a hole — hence the explicit test.
 */
export const requireGuardianConsentForMinor = (pool: Pool, logger: AppLogger): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const dateOfBirth = (req.body as { dateOfBirth?: unknown } | undefined)?.dateOfBirth;
    if (typeof dateOfBirth !== 'string' || !requiresGuardianConsent(dateOfBirth)) {
      next();
      return;
    }

    let accepted: boolean;
    try {
      accepted = await hasAcceptedDocument(pool, userId, GUARDIAN_CONSENT_DOCUMENT);
    } catch (error) {
      logger.error({ error }, 'guardian consent check failed');
      res.status(503).json({
        error: '暂时无法确认监护人同意状态，请稍后重试',
        code: 'consent_check_unavailable',
      });
      return;
    }

    if (!accepted) {
      res.status(403).json({
        error: '未满 14 周岁的患者需要监护人阅读并同意《儿童个人信息处理规则》后才能建档',
        code: 'guardian_consent_required',
      });
      return;
    }

    next();
  };
};
