/**
 * Tool wrapper for the patient profile retriever.
 *
 * Advertised only when the user has at least `basic` consent. Takes
 * no arguments — the profile is identified by the authenticated user
 * id carried in `ToolContext`.
 *
 * The underlying retriever also gates on consent + user-in-scope and
 * returns an empty result with `metadata.reason` if either is
 * missing; this wrapper relies on that as the second layer of
 * defence.
 *
 * A TOOL DESCRIPTION IS AN INSTRUCTION, so it may not name a field the
 * result cannot carry — the model asserts what it was told it has.
 * This one opened on an age band and closed on symptom categories, and
 * neither can ever be in it: `dateOfBirth` is on HARD_DELETE_KEYS, so
 * layer 1 removes the cell before the derivation that would band it is
 * handed the input, and no retriever writes a symptom field at all.
 * Both are gone from the sentence and from PROMPT_ALLOWLIST, which is
 * the inventory this sentence was written from — a key listed there
 * reads as something the result carries, and these two were read that
 * way. `tool-descriptions.test.ts` fails on the next one.
 *
 * The genetics clause is the same correction in miniature: it said
 * 「clinicalised or raw depending on consent」 from when the reading
 * itself was strict-only. It is asked in both modes now and the mode
 * decides only whether the raw cell survives beside it, so the
 * sentence has to leave room for both.
 *
 * AND METHYLATION IS NOT ONE OF THE TWO. The clause promised the same
 * reading for all three cells, and for this one the result can carry
 * none of it: this repo states no methylation boundary, so there is
 * nothing to read the cell against and no `methylation_clinical` in
 * either mode. What the model gets is the cell as recorded, or — for a
 * measurement under basic consent — the statement that a number is on
 * file and is not being shared. Promising a reading here is how the
 * key came to be labelled 甲基化临床分级 while holding the laboratory's
 * own word. See `methylationCell` in the redactor.
 *
 * AND THE WITHHOLDING IS NOT PURELY A CONSENT RULE, WHICH IS WHAT THIS
 * SENTENCE USED TO SAY. It read 「a numeric result is withheld without
 * precise-value consent」 — a claim about one mode, stated as the whole
 * rule. Under precise consent the profile scope still renders
 * `methylation_withheld` for any methylation cell this platform cannot
 * read as a single value: an array reaches `formatScalar`, which would
 * join `['35', '40']` into 「甲基化值: 35、40」 and publish it as this
 * patient's result, and the redactor documents refusing that as
 * deliberate and true of BOTH modes. So a precise-consent reader met
 * 「甲基化数值: value_withheld」 having been instructed that withholding
 * only happens in its absence, and the honest reading of that is that
 * a value was hidden from them rather than that none could be read.
 * The sentence names both conditions now.
 *
 * `tool-descriptions.test.ts` could not catch it: its reachability
 * check UNIONED the two modes, so a claim conditional on a mode passed
 * as long as the key existed in either. A clause naming a consent
 * level is checked against that mode alone there now.
 *
 * ORIGIN IS THE THIRD THING THIS CELL CARRIES and it is deliberately
 * not spelled out in the sentence: 「never graded」 already covers it,
 * and `methylation_origin` holds a refusal rather than something the
 * model should go looking for.
 */

import type { ITool, ToolContext, ToolExecutionResult } from './base.js';
import { isPlainObject, safeParseJson } from './base.js';
import type { ConsentLevel } from '../retrievers/base.js';
import type { PatientProfileRetriever } from '../retrievers/patient-profile.js';

const PARAMETERS_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

export class GetMyProfileTool implements ITool {
  readonly name = 'get_my_profile';
  readonly description =
    'Retrieve the authenticated user\'s own patient profile: gender, diagnosis stage / year / type, D4Z4 / haplotype (this platform\'s reading of the cell, the raw value, or both, depending on consent), methylation (the cell as recorded, never graded — this platform states no methylation boundary; a measurement is withheld without precise-value consent, and a cell this platform cannot read as a single value is withheld whatever the consent), onset region, family history, ambulatory status, assistive devices. Use this when the user asks about themselves ("my", "我的", "我目前") or when their personal context is required to give a useful answer.';
  readonly parametersSchema: Record<string, unknown> = PARAMETERS_SCHEMA;
  readonly minConsent: ConsentLevel = 'basic';

  constructor(private readonly retriever: PatientProfileRetriever) {}

  parseArgs(rawJson: string): Record<string, unknown> {
    const raw = safeParseJson(rawJson);
    // Tolerate the model passing an empty object, null, or unknown
    // keys — none of them matter for this tool.
    return isPlainObject(raw) ? raw : {};
  }

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    const retrieval = await this.retriever.search(
      { question: '' },
      {
        userId: ctx.userId,
        consentLevel: ctx.consentLevel,
        requestId: ctx.requestId,
        logger: ctx.logger,
        signal: ctx.signal,
      },
    );
    const display =
      retrieval.chunks.length === 0
        ? `patient_profile: empty (${retrieval.metadata?.reason ?? 'no_data'})`
        : 'patient_profile: 1 chunk';
    return { retrieval, display };
  }
}
