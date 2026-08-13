import { apiRequest } from './api';

/**
 * 罕见病诊疗协作网转诊资料 — the one network call, and the parser that
 * decides whether what came back is safe to put in front of a patient.
 *
 * THE ENVELOPE IS NOT OPTIONAL, AND NEITHER IS THE SHAPE CHECK
 * ------------------------------------------------------------
 * `apiRequest` returns the parsed body verbatim — it does NOT unwrap
 * `{ data: ... }` (lib/api.ts, `return payload as T`) — and its type
 * parameter is an unchecked assertion. `apiRequest<ReferralPack>(...)`
 * typechecks, passes every test written against a hand-made fixture,
 * and can still be `undefined` at every field at runtime. That is not
 * hypothetical: passport-share-api.ts carries the long version of what
 * happened when someone believed the generic — a patient was shown an
 * empty list of share links they had actually created, and minted more
 * because of it.
 *
 * GET /profiles/me/referral-pack answers with a BARE body today (every
 * route in profile.routes.ts does; passport-share.routes.ts wraps in
 * `{ data }`). Both conventions are live in this codebase, so this
 * module unwraps tolerantly rather than depending on which one it is
 * talking to, and referral-pack-api.test.ts asserts against the actual
 * response body the controller builds.
 *
 * WHY THIS PARSER THROWS INSTEAD OF FILLING IN BLANKS
 * ---------------------------------------------------
 * The pack exists to be handed to a neurologist. A half-parsed pack is
 * worse than no pack: a section that quietly went missing reads as a
 * section with nothing in it, and this document's whole point is that
 * 「本平台没有记录」 and 「没有做过」 are different sentences. So the
 * four things that carry that distinction — the markdown itself, the
 * diagnosis sentence, the monitoring array, and each slot's
 * present/unreadable/absent state — are required, and anything else
 * makes the call fail loudly with a sentence the patient can act on.
 *
 * Only fields the screen actually renders are modelled. Carrying the
 * rest of `ReferralPackDTO` "for later" would be a set of fields that
 * nothing keeps honest.
 */

/**
 * present   — a report of this class was uploaded AND read.
 * unreadable— a report was uploaded and the OCR could not read it.
 * absent    — this platform holds nothing of this class.
 *
 * Three states, never two. `profile.passport.ts` carries the long
 * explanation of why collapsing 「上传了但读不出」 into 「没上传」 is
 * dangerous on the anesthesia card; this pack goes to the doctor
 * deciding what to order next, so a slot whose state this client does
 * not recognise is a parse failure rather than a guess.
 */
export type ReferralMonitoringState = 'present' | 'unreadable' | 'absent';

const MONITORING_STATES: readonly string[] = ['present', 'unreadable', 'absent'];

export type ReferralMonitoringSlot = {
  key: string;
  title: string;
  state: ReferralMonitoringState;
  /** The server-authored sentence, one per state. Rendered verbatim —
   *  this client never composes its own wording for a slot. */
  statement: string;
  /** Whether the test is indicated at all. Null when the passport
   *  attached none. Dropping it would turn the panel into three tests
   *  every patient owes. */
  note: string | null;
};

export type ReferralPack = {
  documentTitle: string;
  /** ISO string, or null when the server sent nothing usable. The
   *  screen omits the line rather than printing a wrong date on a
   *  document whose freshness is the reason a clinician trusts it. */
  generatedAt: string | null;
  /**
   * `'genetic' | 'self_reported' | 'none'` server-side. Typed as a
   * plain string on purpose: the only question this client asks is
   * 「是不是基因确诊」, and an unrecognised value must fall to the
   * cautious side rather than blank the page for a patient whose
   * record is fine.
   */
  diagnosisConfirmation: string;
  /** The one sentence that says what backs the diagnosis, including
   *  「请勿按已确诊处理」 when nothing does. Required. */
  diagnosisStatement: string;
  monitoring: ReferralMonitoringSlot[];
  /** The document itself. On a phone in WeChat's in-app browser there
   *  is no print dialog and this app has no clipboard API, so the
   *  markdown rendered as selectable text is the export path that
   *  actually exists. */
  markdown: string;
};

/** True only for a genetically confirmed diagnosis. Every other value —
 *  including one this build has never seen — is treated as unconfirmed,
 *  because that is the direction that cannot hurt anyone. */
export const isGeneticallyConfirmed = (pack: ReferralPack): boolean =>
  pack.diagnosisConfirmation === 'genetic';

export const REFERRAL_PACK_SHAPE_ERROR =
  '转诊资料的格式和这一版页面对不上，为了不把缺了内容的资料带去医院，这一份没有显示。请刷新页面重试；你的记录本身没有丢失，也可以先用「临床护照」那一份。';

/** Pull `data` out of the API envelope. Tolerates a bare body — see the
 *  header for why this module refuses to depend on which convention the
 *  route happens to use. */
const unwrap = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const asMonitoringSlot = (raw: unknown): ReferralMonitoringSlot => {
  if (!raw || typeof raw !== 'object') throw new Error(REFERRAL_PACK_SHAPE_ERROR);
  const record = raw as Record<string, unknown>;

  const state = record.state;
  if (typeof state !== 'string' || !MONITORING_STATES.includes(state)) {
    // Not defaulted to 'absent'. That default is the exact collapse
    // this whole feature is built to avoid, and it would be invisible:
    // the panel would read as 「这项没做过」 for a report the patient
    // has in their bag.
    throw new Error(REFERRAL_PACK_SHAPE_ERROR);
  }

  const statement = text(record.statement);
  const title = text(record.title);
  if (!statement || !title) throw new Error(REFERRAL_PACK_SHAPE_ERROR);

  return {
    key: text(record.key) ?? title,
    title,
    state: state as ReferralMonitoringState,
    statement,
    note: text(record.note),
  };
};

/** Exported for the tests, which feed it a real response body. */
export const parseReferralPack = (payload: unknown): ReferralPack => {
  const data = unwrap(payload);
  if (!data || typeof data !== 'object') throw new Error(REFERRAL_PACK_SHAPE_ERROR);
  const record = data as Record<string, unknown>;

  const markdown = text(record.markdown);
  if (!markdown) throw new Error(REFERRAL_PACK_SHAPE_ERROR);

  const diagnosis =
    record.diagnosis && typeof record.diagnosis === 'object'
      ? (record.diagnosis as Record<string, unknown>)
      : null;
  const diagnosisStatement = diagnosis ? text(diagnosis.statement) : null;
  if (!diagnosisStatement) throw new Error(REFERRAL_PACK_SHAPE_ERROR);

  if (!Array.isArray(record.monitoring)) throw new Error(REFERRAL_PACK_SHAPE_ERROR);

  return {
    documentTitle: text(record.documentTitle) ?? '罕见病诊疗协作网转诊资料',
    generatedAt: text(record.generatedAt),
    diagnosisConfirmation:
      typeof diagnosis?.confirmation === 'string' ? diagnosis.confirmation : '',
    diagnosisStatement,
    monitoring: record.monitoring.map(asMonitoringSlot),
    markdown,
  };
};

/**
 * Build the pack for the signed-in patient.
 *
 * Nothing is cached and nothing is stored: the pack is a snapshot of
 * the record at the moment it is asked for, and a stale copy handed to
 * a clinician under a fresh 生成时间 is a lie the reader cannot check.
 */
export const fetchMyReferralPack = async (): Promise<ReferralPack> =>
  parseReferralPack(await apiRequest<unknown>('/profiles/me/referral-pack'));
