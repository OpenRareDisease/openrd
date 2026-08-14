/**
 * WHO PUT THIS VALUE HERE: the fourth source.
 *
 * The passport already distinguishes three (see
 * PassportDiagnosisConfirmation in profile.passport.ts): `genetic` —
 * extracted from a report the patient uploaded; `self_reported` — the
 * patient typed it; `none`. The whole point of that distinction is
 * that a document handed to a neurologist must never present a
 * patient's own guess in the same register as evidence.
 *
 * An administrator filling a baseline field in on a patient's behalf —
 * off a phone call, off a photo of a discharge summary, off a WeChat
 * message — is none of those three. It is not evidence, and it is not
 * the patient's own account of themselves either: it is our staff's
 * transcription of something they believe the patient said. The
 * failure that makes this worth a module is small and specific: a
 * back-office that writes into `baseline_payload` produces a passport
 * that says 「本人填写」 over a value the patient has never seen, and
 * the patient has no way to know it is there, let alone that it is
 * wrong.
 *
 *
 * THE SHAPE
 *
 * One reserved key inside `baseline_payload`, holding one entry per
 * marked field, keyed by the field's dotted path:
 *
 *   {
 *     "foundation": { ... },
 *     "diseaseBackground": { ... },
 *     "fieldProvenance": {
 *       "foundation.fullName":      { "source": "admin_entered",
 *                                     "adminUserId": "<uuid>",
 *                                     "at": "2026-08-13T04:11:07.912Z" },
 *       "diseaseBackground.d4z4":   { ... }
 *     }
 *   }
 *
 * ABSENCE IS THE PATIENT. There is no `self_reported` entry, and that
 * is deliberate: an entry per patient-written field would grow a
 * record of every field every patient ever touched for no reader, and
 * 「the patient wrote it」 is already the default this app is built on.
 * So a field is admin-entered if and only if it has an entry, and the
 * patient taking a field back is the entry being REMOVED. That is what
 * §B3's 「标记回到本人填写」 is, mechanically.
 *
 * There is no `version` field. A future second source is a new value
 * of `source`, which every reader already switches on; a genuinely
 * incompatible reshape would be distinguishable by its own presence.
 * A version number nothing reads is a field somebody deletes.
 *
 *
 * THE TWO WRITE HELPERS, AND WHY THEY ARE A PAIR
 *
 * `baselineProfileSchema` is a plain Zod object, so it STRIPS unknown
 * keys — `fieldProvenance` does not survive a `parse`, and
 * `upsertBaseline` writes the parsed payload over the whole column.
 * Every marker would therefore be erased by the next save from any
 * client. That is a fact about the schema, asserted in
 * baseline-provenance.test.ts rather than promised here.
 *
 * So the block only exists if the write path puts it back, and both
 * write paths must:
 *
 *   applyAdminBaselineWrite(previous, next, by)   the back-office
 *   applyPatientBaselineWrite(previous, next)     the app
 *
 * Neither takes a list of fields. Both DERIVE the changed set by
 * diffing the stored payload against the one about to be written, and
 * then do opposite things with it: the admin's changed fields gain a
 * marker, the patient's changed fields lose theirs. A list would be an
 * argument a caller could get wrong in the direction that matters —
 * an admin edit that forgot to name a field would be a value in the
 * database attributed to the patient — and there is no way to notice
 * that from the outside afterwards.
 *
 * A BASELINE WRITE THAT REPLACES THE COLUMN AND CALLS NEITHER HELPER
 * ERASES EVERY MARKER. That is not a guarantee this module can enforce
 * from here; it is why both helpers are named for the caller rather
 * than for what they do.
 *
 * The guarantee rests on a property, not on a list: a writer that
 * REPLACES the whole column must go through one of these helpers, and
 * a writer that MERGES into the stored jsonb leaves this module's
 * reserved key standing either way. `InstrumentsService`'s Vignos
 * write is of the second kind — a nested `jsonb_set` — which is why it
 * needs no helper. Audit the COLUMN rather than the helper, because a
 * raw-SQL writer is invisible to a grep for the helper's name:
 * `grep -rn 'baseline_payload' apps/api/src --include='*.ts' | grep -v '\.test\.'`
 * Every hit that assigns the column must either go through
 * `upsertBaseline` (hence through one of the two helpers) or merge
 * into the existing jsonb instead of overwriting it. Grepping for
 * `upsertBaseline(` cannot see a raw-SQL writer at all, and one such
 * writer already exists.
 *
 *
 * WHAT AN ADMIN MAY WRITE AT ALL
 *
 * `ADMIN_WRITABLE_BASELINE_FIELDS` below is an ALLOWLIST, and
 * `applyAdminBaselineWrite` REFUSES a write that changes anything
 * outside it. The rest of the baseline — the ladder, the 现状
 * booleans, the 困难 scores — is the patient's account of their own
 * body, and a back office filling those in is inventing self-report.
 * The privacy policy says so in §10（四）, and until this list existed
 * that sentence was enforced only by which text boxes a screen chose
 * to draw. A refusal is loud (HTTP 400 naming the field) rather than a
 * silent drop, because an administrator who typed something and was
 * told nothing would assume it landed.
 *
 *
 * WHAT CLEARING A FIELD MEANS
 *
 * Clearing REMOVES the field's marker; it never adds one. A marker
 * says 「this value came from an administrator」 and a cleared field
 * has no value to say it about — a marker left behind would render on
 * the passport as a source for nothing. The write itself is not
 * unrecorded: `requireAdmin` writes an `admin.record_write` audit row
 * for the request. Anything on screen that tells an operator otherwise
 * is wrong; see the note in
 * apps/mobile/screens/p-admin/patient-record.tsx.
 */

import { AppError } from '../../utils/app-error.js';

/** The reserved key inside `baseline_payload`. */
export const BASELINE_PROVENANCE_KEY = 'fieldProvenance';

/**
 * The baseline fields an administrator may write, and the ONLY ones.
 *
 * These are what actually gets transcribed off a phone call or a photo
 * of a discharge summary. Deny-by-default is the point of the shape: a
 * baseline field added next year is patient-only until someone adds it
 * here and changes the policy paragraph that enumerates this list.
 *
 * The back office renders text boxes for exactly these twelve
 * (`EDITABLE_FIELDS` in apps/mobile/screens/p-admin/patient-record.tsx)
 * and §10（四）of the privacy policy enumerates them in Chinese. Those
 * two are copies for a reader; THIS one is the one that is enforced.
 */
export const ADMIN_WRITABLE_BASELINE_FIELDS = [
  'foundation.fullName',
  'foundation.preferredName',
  'foundation.regionLabel',
  'foundation.birthYear',
  'foundation.diagnosisYear',
  'diseaseBackground.diagnosisType',
  'diseaseBackground.d4z4',
  'diseaseBackground.haplotype',
  'diseaseBackground.methylation',
  'diseaseBackground.familyHistory',
  'diseaseBackground.onsetRegion',
  'notes',
] as const;

const ADMIN_WRITABLE = new Set<string>(ADMIN_WRITABLE_BASELINE_FIELDS);

/**
 * How a marked field is named to a human — on the passport a
 * neurologist reads, and in the three portable exports.
 *
 * Only the admin-writable paths are here, because only those can gain
 * a marker. A path with no label falls back to the dotted path itself
 * rather than to a guess: a marker on an unlabelled field still has to
 * be shown, and 「foundation.somethingNew」 is honest where an invented
 * Chinese label would not be.
 */
export const BASELINE_FIELD_LABELS_ZH: Record<string, string> = {
  'foundation.fullName': '姓名',
  'foundation.preferredName': '称呼',
  'foundation.regionLabel': '所在地区',
  'foundation.birthYear': '出生年份',
  'foundation.diagnosisYear': '确诊年份',
  'diseaseBackground.diagnosisType': 'FSHD 分型',
  'diseaseBackground.d4z4': 'D4Z4 重复数',
  'diseaseBackground.haplotype': '单倍型',
  'diseaseBackground.methylation': '甲基化',
  'diseaseBackground.familyHistory': '家族史',
  'diseaseBackground.onsetRegion': '起病部位',
  notes: '备注',
};

export const baselineFieldLabelZh = (fieldPath: string): string =>
  BASELINE_FIELD_LABELS_ZH[fieldPath] ?? fieldPath;

/**
 * Only `admin_entered` today. A value, not a boolean, because the next
 * source this app needs (a clinician entering data under their own
 * account, an import from a registry) is a different fact again, and a
 * boolean would have to be replaced rather than extended.
 */
export const BASELINE_FIELD_SOURCES = ['admin_entered'] as const;
export type BaselineFieldSource = (typeof BASELINE_FIELD_SOURCES)[number];

export interface BaselineFieldProvenance {
  source: BaselineFieldSource;
  /** `app_users.id` of the administrator who entered the value. */
  adminUserId: string;
  /** ISO 8601, UTC. */
  at: string;
}

/**
 * What a reader gets back, as three cases rather than a nullable
 * record.
 *
 * `unreadable` is the case that earns the discriminated union. A
 * malformed entry can only come from outside these helpers — a
 * hand-written UPDATE, a half-applied future shape — and the tempting
 * thing to do with one is to fall back to「no entry」. That fallback
 * renders an admin-entered value as 「本人填写」, which is the exact
 * claim this module exists to stop being made. So an entry that exists
 * and cannot be read is its own state, and a reader that renders it as
 * anything other than 「来源不明」 is wrong.
 */
export type BaselineFieldOrigin =
  | { state: 'patient' }
  | { state: 'admin_entered'; adminUserId: string; at: string }
  | { state: 'unreadable'; detail: string };

/**
 * No pattern filters marker keys, and `ADMIN_WRITABLE_BASELINE_FIELDS`
 * is why one would be an unreachable branch: the only assignment in
 * this module that takes a dotted string as a key draws that key from
 * those literals, so the key set is closed and `__proto__` cannot
 * reach it.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How deep the leaf walk descends before it treats a value as a leaf.
 *
 * `baselineProfileSchema` is two levels (`currentStatus.footDrop`), so
 * 6 is four levels of slack. The cap is not about the schema: it is
 * about `previous`, which is jsonb read back from the database and can
 * be any shape a hand-written UPDATE left there.
 */
const MAX_LEAF_DEPTH = 6;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const own = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

/** Structural equality over JSON values. Not `JSON.stringify`
 *  comparison: two objects with the same entries in a different key
 *  order are the same value, and a stringify diff would report the
 *  patient as having edited a field they did not touch. */
const sameJsonValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameJsonValue(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => own(b, key) && sameJsonValue(a[key], b[key]));
  }
  return false;
};

/** Every leaf path in a payload, excluding the provenance block
 *  itself. A leaf is anything that is not a plain object, plus any
 *  plain object at MAX_LEAF_DEPTH. */
export const leafPaths = (value: unknown, prefix = '', depth = 0): string[] => {
  if (!isPlainObject(value) || depth >= MAX_LEAF_DEPTH) {
    return prefix ? [prefix] : [];
  }
  const out: string[] = [];
  for (const key of Object.keys(value)) {
    if (depth === 0 && key === BASELINE_PROVENANCE_KEY) continue;
    out.push(...leafPaths(value[key], prefix ? `${prefix}.${key}` : key, depth + 1));
  }
  return out;
};

/** `undefined` for a path that does not resolve. Distinguishable from
 *  a stored `null`, which is a real baseline answer meaning 「未填」. */
const valueAtPath = (payload: unknown, fieldPath: string): unknown => {
  let cursor: unknown = payload;
  for (const segment of fieldPath.split('.')) {
    if (!isPlainObject(cursor) || !own(cursor, segment)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
};

const readBlock = (payload: unknown): Record<string, unknown> => {
  if (!isPlainObject(payload)) return {};
  const block = payload[BASELINE_PROVENANCE_KEY];
  return isPlainObject(block) ? block : {};
};

/** Attach a block to a copy of `next`, or drop the key when the block
 *  is empty — an empty object stored on every profile is noise that
 *  reads like a marker until you open it. */
const withBlock = (
  next: Record<string, unknown>,
  block: Record<string, unknown>,
): Record<string, unknown> => {
  const out = { ...next };
  if (Object.keys(block).length === 0) {
    delete out[BASELINE_PROVENANCE_KEY];
    return out;
  }
  out[BASELINE_PROVENANCE_KEY] = block;
  return out;
};

/** The leaf paths whose value differs between the stored payload and
 *  the one about to be written. A path present in one and not the
 *  other counts as changed. */
const changedLeafPaths = (previous: unknown, next: Record<string, unknown>): Set<string> => {
  const paths = new Set([...leafPaths(previous), ...leafPaths(next)]);
  const changed = new Set<string>();
  for (const path of paths) {
    if (!sameJsonValue(valueAtPath(previous, path), valueAtPath(next, path))) {
      changed.add(path);
    }
  }
  return changed;
};

/**
 * The back-office write.
 *
 * Every field this write CHANGES gains an `admin_entered` marker;
 * every field it leaves alone keeps whatever marker it had. Fields the
 * write CLEARS (absent, or explicitly null in `next`) get no marker
 * and LOSE any marker they had — there is no value there to attribute,
 * and a marker on an empty field would show up on the passport as a
 * source for nothing. See WHAT CLEARING A FIELD MEANS at the top.
 *
 * REFUSES, with a 400, a write that changes any field outside
 * `ADMIN_WRITABLE_BASELINE_FIELDS`. The refusal is what makes the
 * policy sentence 「你对自己身体的那些回答……后台只能看，不能替你填」
 * true of the server rather than of one screen's markup: the whole
 * `baselineProfileSchema` is accepted by the admin endpoint's body
 * parse, so this is the only place the boundary exists.
 *
 * Throws on an `adminUserId` that is not a `app_users.id`: a
 * provenance record naming an administrator who cannot be resolved is
 * worse than the plain value, because it looks like an answer.
 */
export const applyAdminBaselineWrite = (
  previous: unknown,
  next: Record<string, unknown>,
  by: { adminUserId: string; at?: Date },
): Record<string, unknown> => {
  if (typeof by.adminUserId !== 'string' || !UUID_PATTERN.test(by.adminUserId)) {
    throw new Error(
      `applyAdminBaselineWrite needs the administrator's app_users.id; got ${JSON.stringify(by.adminUserId)}`,
    );
  }

  const at = (by.at ?? new Date()).toISOString();
  const block = { ...readBlock(previous) };
  const changed = changedLeafPaths(previous, next);

  // Checked over the WHOLE changed set before anything is marked, so a
  // rejected write leaves no half-applied block behind and the message
  // names every field at fault rather than the first one.
  const refused = [...changed].filter((path) => !ADMIN_WRITABLE.has(path)).sort();
  if (refused.length > 0) {
    // The message carries the whole refusal, because nothing else can:
    // `AppError.details` is projected through CLIENT_SAFE_DETAIL_KEYS
    // in middleware/error-handler.ts, which has no `fields` key, and a
    // 400 is `isOperational` so the same handler does not log it
    // either. A machine-readable list attached here would reach no
    // client and no log — so every offending field is named in the
    // sentence the operator actually sees.
    throw new AppError(
      `管理员不能代填这些字段：${refused.map(baselineFieldLabelZh).join('、')}。这些是患者对自己身体的回答，后台只能查看。`,
      400,
    );
  }

  for (const path of changed) {
    const written = valueAtPath(next, path);
    if (written === undefined || written === null) {
      delete block[path];
      continue;
    }
    // `path` is one of the twelve literals in
    // ADMIN_WRITABLE_BASELINE_FIELDS — the refusal above returned for
    // everything else — so this is the one assignment in the module
    // that uses a dotted string as a key, and its key set is closed.
    block[path] = { source: 'admin_entered', adminUserId: by.adminUserId, at };
  }

  return withBlock(next, block);
};

/**
 * The patient's own write.
 *
 * Carries the existing block forward — `baselineProfileSchema` stripped
 * it, so without this every marker in the profile is erased by the
 * patient saving any unrelated field — and drops the entry for every
 * field the patient actually CHANGED. Opening the form and saving it
 * unedited changes nothing and releases nothing: the patient looking
 * at a value is not the same act as the patient entering it, and only
 * the second one makes the value theirs.
 *
 * Entries for fields that are not in `next` at all are dropped too:
 * the value they described is gone, so there is nothing left to
 * attribute.
 */
export const applyPatientBaselineWrite = (
  previous: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> => {
  const block = { ...readBlock(previous) };
  const changed = changedLeafPaths(previous, next);

  for (const path of Object.keys(block)) {
    if (changed.has(path) || valueAtPath(next, path) === undefined) {
      delete block[path];
    }
  }

  return withBlock(next, block);
};

const parseEntry = (entry: unknown): BaselineFieldOrigin => {
  if (!isPlainObject(entry)) {
    return {
      state: 'unreadable',
      detail: `entry is ${Array.isArray(entry) ? 'an array' : typeof entry}`,
    };
  }
  const { source, adminUserId, at } = entry;
  if (
    typeof source !== 'string' ||
    !BASELINE_FIELD_SOURCES.includes(source as BaselineFieldSource)
  ) {
    return { state: 'unreadable', detail: `unknown source ${JSON.stringify(source)}` };
  }
  if (typeof adminUserId !== 'string' || !UUID_PATTERN.test(adminUserId)) {
    return { state: 'unreadable', detail: 'adminUserId is not a user id' };
  }
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
    return { state: 'unreadable', detail: 'at is not a timestamp' };
  }
  return { state: 'admin_entered', adminUserId, at };
};

/**
 * Who entered one field. `{ state: 'patient' }` for a field with no
 * entry — see ABSENCE IS THE PATIENT at the top.
 *
 * Never throws. This is called from the passport and the exports,
 * which must render something for a profile whose jsonb somebody
 * edited by hand; a malformed entry comes back as `unreadable` rather
 * than as an exception or, much worse, as `patient`.
 */
export const readBaselineFieldOrigin = (
  payload: unknown,
  fieldPath: string,
): BaselineFieldOrigin => {
  const block = readBlock(payload);
  if (!own(block, fieldPath)) return { state: 'patient' };
  return parseEntry(block[fieldPath]);
};

/**
 * Every marked field in a payload, for the export side, which has to
 * carry the source out with the data rather than discovering it field
 * by field. Sorted by path so a re-export of an unchanged profile is
 * byte-identical.
 *
 * `patient` never appears in this list: a field with no entry has no
 * row here, by construction.
 */
export const listBaselineFieldOrigins = (
  payload: unknown,
): Array<{ path: string; origin: BaselineFieldOrigin }> => {
  const block = readBlock(payload);
  return Object.keys(block)
    .sort()
    .map((path) => ({ path, origin: parseEntry(block[path]) }));
};
