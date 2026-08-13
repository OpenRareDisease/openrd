import { z } from 'zod';
import { INSTRUMENT_KEYS } from './registry.js';

/**
 * Request schemas for the instrument endpoints.
 *
 * Every enum here is closed, and none of them admit free text. That is
 * deliberate and it is the lesson of migration 015: the one
 * unconstrained patient-writable TEXT column on the followup path
 * (`patient_function_tests.unit`) reached the AI retriever verbatim
 * and had to be retro-fitted with a value set, a back-fill, a recovery
 * column and a rollback script. An instrument administration is a
 * registry-grade record; it starts closed.
 *
 * Note there is no `notes` field anywhere below. A free-text note on a
 * scored assessment is the field that ends up carrying the meaning
 * ("actually I was having a bad week") while every consumer reads only
 * the number — and it is also the field the AI retriever's privacy
 * contract refuses to read. If the context matters, it belongs in a
 * followup event, which is a first-class record with its own screen.
 */

/**
 * One item answer.
 *
 * `skipped` and `notApplicable` are separate flags, not one
 * "no answer" flag, and the DB CHECK in migration 022 keeps them
 * mutually exclusive. 「这题我不想答」 and 「这题对我不适用」 are
 * different facts about a patient, and only the second is a clinical
 * observation — the same distinction migration 017 had to add an
 * entire column for after NULL was made to carry both.
 */
export const instrumentItemResponseSchema = z
  .object({
    itemCode: z.string().trim().min(1).max(80),
    // `.finite()` for the reason functionTestSchema documents: string
    // "Infinity" survives z.coerce.number() and would then have to be
    // rejected by a bounds check that this field does not have (the
    // allowed values come from the instrument definition, not from a
    // range here).
    responseValue: z.coerce.number().finite().optional().nullable(),
    skipped: z.boolean().optional(),
    notApplicable: z.boolean().optional(),
  })
  .refine((value) => !(value.skipped === true && value.notApplicable === true), {
    message: '同一题不能同时标记为「跳过」和「不适用」',
    path: ['notApplicable'],
  })
  .refine(
    (value) =>
      !((value.skipped === true || value.notApplicable === true) && value.responseValue != null),
    {
      // The DB has the same CHECK. Reaching it means a contradictory
      // body comes back as a 500 instead of an answerable 400.
      message: '标记为「跳过」或「不适用」时不能同时选择等级',
      path: ['responseValue'],
    },
  );

export const createAdministrationSchema = z.object({
  instrumentKey: z.enum(INSTRUMENT_KEYS),
  responses: z.array(instrumentItemResponseSchema).min(1).max(64),
  /**
   * Who the answers came from. Defaults to 'self' because that is what
   * this app is — but a clinician-entered grade must be able to say so
   * rather than being laundered into a self-report, and a family
   * member answering for someone who cannot type is 'proxy'.
   */
  source: z.enum(['self', 'clinician', 'proxy']).optional(),
  assistedBy: z.enum(['none', 'family', 'caregiver', 'clinician', 'other']).optional(),
  /**
   * The correction pointer. A completed administration is immutable
   * (migration 022): fixing a mis-tap means recording a new one that
   * names the row it replaces, so both the mistake and the correction
   * stay auditable.
   */
  supersedesId: z.string().uuid().optional().nullable(),
  /** When the assessment was actually performed, if not now. */
  administeredAt: z.string().datetime().optional(),
  /**
   * Vignos only: 「把结果同步到我的档案」.
   *
   * Opt-in, default off, and it is the patient asking — not the app
   * deciding on their behalf that one self-assessment overrides what
   * they told us about their own walking. See
   * `applyVignosToBaseline` in instruments.service.ts for exactly what
   * it writes and what it refuses to infer.
   */
  applyToBaseline: z.boolean().optional(),
});
export type CreateAdministrationInput = z.infer<typeof createAdministrationSchema>;

export const administrationListQuerySchema = z.object({
  instrumentKey: z.enum(INSTRUMENT_KEYS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /**
   * Superseded rows are EXCLUDED by default and reachable on request.
   * A trend line drawn through a mis-tap and its correction shows a
   * cliff that never happened; a correction history that cannot be
   * inspected is not an audit trail. Both readings are needed, so the
   * caller picks.
   */
  includeSuperseded: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});
export type AdministrationListQuery = z.infer<typeof administrationListQuerySchema>;
