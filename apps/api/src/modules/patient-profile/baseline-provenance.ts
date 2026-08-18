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
 *       "foundation.fullName":              { "source": "admin_entered",
 *                                             "adminUserId": "<uuid>",
 *                                             "at": "2026-08-13T04:11:07.912Z" },
 *       "diseaseBackground.onsetRegion":    { ... }
 *     }
 *   }
 *
 * ABSENCE IS THE PATIENT — AS A STORAGE RULE, AND ONLY AS ONE. There is
 * no `self_reported` entry, and that is deliberate: an entry per
 * patient-written field would grow a record of every field every
 * patient ever touched for no reader. So a field is admin-entered if
 * and only if it has an entry, and the patient taking a field back is
 * the entry being REMOVED. That is what §B3's 「标记回到本人填写」 is,
 * mechanically.
 *
 * WHAT THAT SENTENCE IS NOT. It is a rule about THIS BLOCK, not about
 * the world. It says nothing was recorded here — and something can
 * reach a baseline field without being recorded here: OCR extraction
 * off an uploaded report, the read-time autofill that fills an empty
 * column from one, an instrument administration merged in with
 * `jsonb_set`. So a RENDERER may never turn an absent entry into
 * 「本人填写」 on a page a clinician reads. It has one fact — no marker —
 * and 「the patient typed this」 is a different, stronger one.
 *
 * That distinction has regrown the same defect in a new surface in
 * every review round of this branch: the share page, the PDF, the FHIR
 * Condition, the TREAT-NMD items, the anaesthesia card, the 诊断进度
 * cell. Each time, someone carried this header's convention into a
 * rendering decision. If you are about to write a fallback from a
 * missing marker to an authorship claim, this paragraph is the reason
 * not to; say where the value is kept, or say nothing.
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
 * outside it. Two different things sit outside it, for two different
 * reasons.
 *
 * The ladder, the 现状 booleans, the 困难 scores are the patient's
 * account of their own body, and a back office filling those in is
 * inventing self-report. The privacy policy says so in §10（四）.
 *
 * The genetic results — FSHD 分型, D4Z4 重复数, 单倍型, 甲基化 — are
 * outside for the opposite reason: they are nobody's account of
 * anything, they are measurements, and a measurement dictated over a
 * phone call arrives here indistinguishable from one a laboratory
 * produced. There is no marker strong enough to fix that downstream,
 * because the number is what a clinical recommendation reads.
 *
 * A refusal is loud (HTTP 400 naming the field) rather than a silent
 * drop, because an administrator who typed something and was told
 * nothing would assume it landed.
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
 *
 * AND A CLEARED FIELD IS WHATEVER THE HTTP SURFACE CAN SAY 「EMPTY」
 * WITH, not only `null`. `isClearedValue` below is the one definition,
 * and both write helpers use it. It used to be `undefined || null`
 * spelled out at the one place that needed it, which was true of the
 * shipped back-office screen — it sends `null` — and false of the
 * endpoint, which accepts a whole `baselineProfileSchema` body from any
 * client. An empty string reached the marker loop as a value, so
 * clearing 称呼 by emptying the box stored 「」 AND stamped a fresh
 * 管理员代填 on it. Whitespace was the same case arriving by a second
 * door: `nullableText` is `z.string().trim()`, so 「   」 is already
 * 「」 by the time this module sees it. Measured through the real
 * express route on 2026-08-18 — PUT with `preferredName: ''` returned
 * 200 with `fieldProvenance['foundation.preferredName']` freshly
 * stamped at today's date over an empty value, and the same marker then
 * appeared in the record endpoint's `fieldOrigins`, in the back-office
 * row, and in the portable exports envelope, telling a receiving
 * registry a provenance fact about a value that does not exist.
 */

import { AppError } from '../../utils/app-error.js';

/** The reserved key inside `baseline_payload`. */
export const BASELINE_PROVENANCE_KEY = 'fieldProvenance';

/**
 * The baseline fields an administrator may write, and the ONLY ones.
 *
 * Every one of them is identity or history — what a person is called,
 * where they live, which years they were born and diagnosed in, who
 * else in the family has it, where the weakness started, and a free
 * note. That is what an operator on a phone call is actually in a
 * position to take down. Deny-by-default is the point of the shape: a
 * baseline field added next year is patient-only until someone adds it
 * here and changes the policy paragraph that enumerates this list.
 *
 * NO MEASUREMENT IS ON THIS LIST, and the genetic ones are why the
 * rule is worth stating rather than leaving to taste. FSHD 分型,
 * D4Z4 重复数, 单倍型 and 甲基化 are laboratory results; read out over
 * the phone and typed into a back office, what lands is a number that
 * LOOKS like laboratory data and is nobody's measurement. It then
 * reads as one everywhere downstream — a clinical recommendation, a
 * registry export — with nothing in the value to say otherwise. So a
 * genetic value gets into a baseline from an uploaded report
 * (`applyGeneticReportAutofill` in profile.autofill.ts), and an
 * administrator sees it without being able to type it.
 *
 * The back office renders text boxes for the fields on this list
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
  'diseaseBackground.familyHistory',
  'diseaseBackground.onsetRegion',
  'notes',
] as const;

const ADMIN_WRITABLE = new Set<string>(ADMIN_WRITABLE_BASELINE_FIELDS);

/**
 * The genetic results, kept apart from the rest of what an
 * administrator may not write so the REFUSAL can tell the truth about
 * which one it is refusing.
 *
 * One sentence over both would have to pick a reason, and the reasons
 * are opposites: a 困难评分 is refused because it is the patient's
 * account of themselves and ours to leave alone; a 甲基化 is refused
 * because it is nobody's account of anything — it is a measurement,
 * and the operator holding a phone is not where one comes from. An
 * operator told 「这是患者对自己身体的回答」 about a D4Z4 they are
 * reading off a laboratory report would reasonably conclude the
 * refusal is a mistake.
 */
const GENETIC_BASELINE_FIELDS = new Set<string>([
  'diseaseBackground.diagnosisType',
  'diseaseBackground.d4z4',
  'diseaseBackground.haplotype',
  'diseaseBackground.methylation',
]);

/**
 * How a baseline field is named to a human — on the passport a
 * neurologist reads, in the portable exports, and in the refusal
 * `applyAdminBaselineWrite` throws.
 *
 * Keyed on every path `baselineProfileSchema` accepts, not only the
 * admin-writable ones: `applyAdminBaselineWrite` renders its refusal
 * through this map, and a refused path is by construction outside the
 * allowlist. The genetic paths are the ones to be careful with — they
 * are the refusal an operator is most likely to meet, and 「管理员不能
 * 代填 diseaseBackground.d4z4」 names nothing they can see on their own
 * screen.
 *
 * A path with no label falls back to the dotted path itself rather
 * than to a guess: a marker on an unlabelled field still has to be
 * shown, and 「foundation.somethingNew」 is honest where an invented
 * Chinese label would not be.
 */
export const BASELINE_FIELD_LABELS_ZH: Record<string, string> = {
  'foundation.fullName': '姓名',
  'foundation.preferredName': '称呼',
  'foundation.regionLabel': '所在地区',
  'foundation.birthYear': '出生年份',
  'foundation.diagnosisYear': '确诊年份',
  'foundation.ageBand': '年龄段',
  'diseaseBackground.diagnosisType': 'FSHD 分型',
  'diseaseBackground.d4z4': 'D4Z4 重复数',
  'diseaseBackground.haplotype': '单倍型',
  'diseaseBackground.methylation': '甲基化',
  'diseaseBackground.familyHistory': '家族史',
  'diseaseBackground.onsetRegion': '起病部位',
  'diseaseBackground.diagnosisLadder': '诊断进展',
  'diseaseBackground.diagnosedFshd': '是否确诊 FSHD',
  'currentStatus.independentlyAmbulatory': '独立行走',
  'currentStatus.armRaiseDifficulty': '抬臂困难',
  'currentStatus.facialWeakness': '面部无力',
  'currentStatus.footDrop': '足下垂',
  'currentStatus.breathingSymptoms': '呼吸症状',
  'currentStatus.assistiveDevices': '辅具',
  'currentChallenges.fatigue': '疲劳',
  'currentChallenges.pain': '疼痛',
  'currentChallenges.stairs': '上楼梯',
  'currentChallenges.dressing': '穿衣',
  'currentChallenges.reachingUp': '上举',
  'currentChallenges.walkingStability': '行走稳定性',
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

/**
 * Whether the value about to be written is a CLEAR — the field being
 * emptied rather than filled in.
 *
 * Three spellings of the same act, because three of them can reach a
 * write: the key is absent (`undefined`), the client sent `null`, or
 * the client sent a string with nothing in it. `nullableText` is
 * `z.string().trim()`, so a box holding only spaces arrives here as
 * '' — whitespace is not a fourth case, it is the third one after the
 * schema.
 *
 * DELIBERATELY NOT USED BY `changedLeafPaths`. Clearing a field IS a
 * change, and has to stay one: it is what the allowlist refusal is
 * checked against (so emptying a genetic box is still refused) and what
 * makes the erase itself visible. This predicate decides only what
 * happens to the MARKER afterwards.
 *
 * Only strings are trimmed. A number, a boolean or an empty array is a
 * value somebody chose, and 0 / false are answers.
 */
const isClearedValue = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

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
 * write CLEARS — absent, `null`, or a string with nothing in it, see
 * `isClearedValue` — get no marker and LOSE any marker they had: there
 * is no value there to attribute, and a marker on an empty field would
 * show up on the passport as a source for nothing. See WHAT CLEARING A
 * FIELD MEANS at the top.
 *
 * REFUSES, with a 400, a write that changes any field outside
 * `ADMIN_WRITABLE_BASELINE_FIELDS` — the patient's answers about their
 * own body, and the genetic results. The refusal is what makes the
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
    // sentence the operator actually sees, under the reason that
    // actually applies to it.
    const names = (paths: string[]) => paths.map(baselineFieldLabelZh).join('、');
    const genetic = refused.filter((path) => GENETIC_BASELINE_FIELDS.has(path));
    const selfReported = refused.filter((path) => !GENETIC_BASELINE_FIELDS.has(path));
    throw new AppError(
      [
        genetic.length > 0
          ? `管理员不能代填这些基因结果：${names(genetic)}。基因结果只能来自患者上传的基因报告——电话里听来的数字存进去之后，和化验读出来的就分不出来了。`
          : '',
        selfReported.length > 0
          ? `管理员不能代填这些字段：${names(selfReported)}。这些是患者对自己身体的回答，后台只能查看。`
          : '',
      ].join(''),
      400,
    );
  }

  for (const path of changed) {
    if (isClearedValue(valueAtPath(next, path))) {
      delete block[path];
      continue;
    }
    // `path` is one of the literals in ADMIN_WRITABLE_BASELINE_FIELDS
    // — the refusal above returned for everything else — so this is the
    // one assignment in the module that uses a dotted string as a key,
    // and its key set is closed.
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
 * Entries for fields that are NOT FILLED IN in `next` are dropped too:
 * the value they described is gone, so there is nothing left to
 * attribute. That is `isClearedValue` and not a bare `=== undefined`,
 * so that the two helpers agree on what an empty field is. The bare
 * check was reachable in one direction only — a marker standing over a
 * value that is present and empty, which `applyAdminBaselineWrite` can
 * no longer create but a hand-written UPDATE still can — and leaving it
 * would have kept 「管理员填的」 on the passport beside nothing.
 */
export const applyPatientBaselineWrite = (
  previous: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> => {
  const block = { ...readBlock(previous) };
  const changed = changedLeafPaths(previous, next);

  for (const path of Object.keys(block)) {
    if (changed.has(path) || isClearedValue(valueAtPath(next, path))) {
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
