import {
  API_BASE_URL,
  ApiError,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  apiRequest,
  dispatchUnauthorized,
  extractApiErrorMessage,
  extractRetryAfterSeconds,
  getAuthToken,
  type BaselineProfilePayload,
} from './api';

/**
 * The back-office client.
 *
 * WHERE THESE SHAPES COME FROM
 * ----------------------------
 * There is no shared package between apps/api and apps/mobile, so
 * every type here is a COPY — the arrangement `DIAGNOSIS_LADDER_STATES`
 * in lib/api.ts already lives with. The copies are taken from
 * `apps/api/src/modules/admin/admin.service.ts`, field for field:
 * `AdminPatientListItem`, `AdminPatientListResult`, `AdminAccountDTO`,
 * `AdminCorpusStatus`, `AdminParseFailureQueue`, `AdminAiUsage`.
 *
 * The HTTP paths and the single-patient record shape started life as a
 * contract this file STATED, because `admin.routes.ts` did not exist
 * yet. It exists now, and every path in `ADMIN_ENDPOINTS` was read back
 * against it: the nine routes it mounts are the seven below plus the
 * two export routes added here, and `AdminController.getPatientRecord`
 * sends `account` / `identity` / `baseline` / `baselineIsStored` /
 * `fieldOrigins` / `documents` / `followups` / `falls` / `instruments`.
 * So this is no longer a proposal — but it is still a COPY of a shape
 * nothing enforces across the two workspaces, which is why every
 * response below is shape-checked rather than asserted.
 *
 * Two things about the routes that are NOT guesses, both from
 * `requireAdmin` (apps/api/src/middleware/require-admin.ts):
 *
 *  - a patient-scoped route is keyed on `app_users.id`. Its
 *    `targetParam` refuses anything that is not a UUID at request
 *    time, so a patient code in the path is a 400 naming the mistake
 *    (「链接里的患者 ID 不是一个合法的用户 ID」), not a lookup. An ABSENT
 *    parameter is the other case and stays a 500: that one is a route
 *    mounted wrong rather than an id somebody pasted.
 *  - a 403 means「你不是管理员」and is deliberately NOT audited, so a
 *    non-admin who reaches these screens leaves no row anywhere.
 *
 * EVERY RESPONSE IS UNWRAPPED AND SHAPE-CHECKED HERE
 * --------------------------------------------------
 * `apiRequest` returns the parsed body verbatim and its type parameter
 * is an unchecked assertion, so `apiRequest<AdminCorpusStatus>(...)`
 * typechecks and can still be wrong at runtime — lib/falls-api.ts
 * records what that cost the last time (a `{ data: [...] }` envelope
 * turned a shared record into 「从没分享过」). The API is inconsistent
 * about the envelope: `/ai/audit` answers `{ success, data: {...} }`
 * while `/profiles/me` answers a bare body. So `unwrap` below is
 * tolerance, and the shape checks are the part that matters.
 *
 * THE RULE THE CHECKS FOLLOW: A MISSING NUMBER IS NOT ZERO
 * --------------------------------------------------------
 * Every metric is `number | null` and `null` renders as 「服务端没有
 * 返回」 rather than as 0. An ops page that shows 「解析失败 0 条」
 * because this build's server does not compute that number is worse
 * than one that shows nothing: it is the page an operator checks
 * INSTEAD of checking the queue. Same rule, harder, in `asFieldOrigin`:
 * anything it cannot read becomes 「来源不明」 and never 「本人填写」.
 */

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/**
 * Every path this client calls, in one block.
 *
 * The ops trio mirrors the three service methods one-to-one
 * (`getCorpusStatus`, `getParseFailureQueue`, `getAiUsage`) rather than
 * being folded into a single `/admin/overview`. That costs three
 * `admin.list` audit rows per dashboard open instead of one, and buys
 * the thing an ops page is for: each block fails on its own. A single
 * aggregate endpoint means one slow `ai_prompt_audit` scan blanks the
 * corpus status and the parse queue too, on the page an operator opened
 * because something is already wrong.
 */
export const ADMIN_ENDPOINTS = {
  corpus: '/admin/ops/corpus',
  parseFailures: '/admin/ops/parse-failures',
  aiUsage: '/admin/ops/ai-usage',
  health: '/admin/ops/health',
  patients: '/admin/patients',
  patient: (userId: string) => `/admin/patients/${encodeURIComponent(userId)}`,
  patientBaseline: (userId: string) => `/admin/patients/${encodeURIComponent(userId)}/baseline`,
  patientExport: (userId: string, format: AdminPortableExportFormat) =>
    `/admin/patients/${encodeURIComponent(userId)}/export?format=${encodeURIComponent(format)}`,
  /** POST, not GET, and the server means it: a GET is what a browser
   *  prefetches and a bookmark replays, and this one is every patient
   *  in the database. See the comment above the route in
   *  admin.routes.ts. */
  fullExportCsv: '/admin/exports/patients.csv',
} as const;

/* ------------------------------------------------------------------ */
/* Reading a response                                                  */
/* ------------------------------------------------------------------ */

const unwrap = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
};

const asRecord = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

const asArray = (raw: unknown): unknown[] | null => (Array.isArray(raw) ? raw : null);

const asFiniteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const asBooleanOrNull = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

/**
 * A body this build cannot read at all.
 *
 * Thrown rather than returned as an empty page. An empty ops block and
 * a green ops block look the same from across a room, and the operator
 * who opened this page did so because they already suspect something.
 */
export class AdminResponseError extends Error {
  constructor(what: string) {
    super(`后台接口返回了读不懂的${what}。请确认 API 与本页是同一次部署。`);
    this.name = 'AdminResponseError';
  }
}

/* ------------------------------------------------------------------ */
/* 语料状态 — mirrors AdminCorpusStatus                                 */
/* ------------------------------------------------------------------ */

export interface AdminEmbedModelCount {
  embedModel: string;
  chunkCount: number;
}

export interface AdminCorpusStatus {
  chunkCount: number | null;
  sourceFileCount: number | null;
  /** Chunks with a NULL embedding: in the corpus, returned by no
   *  similarity search. The service's own comment calls this the one
   *  corpus fault the KB service's /health/ready cannot see. */
  unembeddedChunkCount: number | null;
  /** More than one entry is a half-finished re-ingest. */
  embedModels: AdminEmbedModelCount[];
  oldestUpdatedAt: string | null;
  newestUpdatedAt: string | null;
}

export const readAdminCorpusStatus = (payload: unknown): AdminCorpusStatus => {
  const record = asRecord(unwrap(payload));
  if (!record) throw new AdminResponseError('语料状态');
  const embedModels: AdminEmbedModelCount[] = [];
  for (const item of asArray(record.embedModels) ?? []) {
    const entry = asRecord(item);
    const embedModel = entry ? asStringOrNull(entry.embedModel) : null;
    const chunkCount = entry ? asFiniteOrNull(entry.chunkCount) : null;
    if (!embedModel || chunkCount === null) continue;
    embedModels.push({ embedModel, chunkCount });
  }
  return {
    chunkCount: asFiniteOrNull(record.chunkCount),
    sourceFileCount: asFiniteOrNull(record.sourceFileCount),
    unembeddedChunkCount: asFiniteOrNull(record.unembeddedChunkCount),
    embedModels,
    oldestUpdatedAt: asStringOrNull(record.oldestUpdatedAt),
    newestUpdatedAt: asStringOrNull(record.newestUpdatedAt),
  };
};

export const getAdminCorpusStatus = async (): Promise<AdminCorpusStatus> =>
  readAdminCorpusStatus(await apiRequest(ADMIN_ENDPOINTS.corpus));

/* ------------------------------------------------------------------ */
/* 解析失败队列 — mirrors AdminParseFailureQueue                        */
/* ------------------------------------------------------------------ */

export interface AdminParseFailureItem {
  documentId: string;
  /** `app_users.id`, so a queue row opens the patient it belongs to.
   *  The service deliberately does NOT send `title` or `file_name` —
   *  both are patient-typed and routinely hold a name or a hospital. */
  userId: string | null;
  documentType: string | null;
  status: string | null;
  uploadedAt: string | null;
}

export interface AdminParseFailureQueue {
  items: AdminParseFailureItem[];
  /** The list was cut off at `limit`. Rendered, because a truncated
   *  queue that looks complete is how a backlog gets declared clear. */
  atCap: boolean | null;
  limit: number | null;
  /** How old a row stuck in `processing` has to be before it counts as
   *  stuck. Shown so the number on screen has a definition. */
  stuckAfterMinutes: number | null;
}

export const readAdminParseFailureQueue = (payload: unknown): AdminParseFailureQueue => {
  const record = asRecord(unwrap(payload));
  if (!record) throw new AdminResponseError('解析失败队列');
  const rows = asArray(record.items);
  if (!rows) throw new AdminResponseError('解析失败队列');
  const items: AdminParseFailureItem[] = [];
  for (const item of rows) {
    const entry = asRecord(item);
    const documentId = entry ? asStringOrNull(entry.documentId) : null;
    // No document id means no row to act on, and a work list whose
    // items cannot be acted on is a count wearing a list's clothes.
    if (!entry || !documentId) continue;
    items.push({
      documentId,
      userId: asStringOrNull(entry.userId),
      documentType: asStringOrNull(entry.documentType),
      status: asStringOrNull(entry.status),
      uploadedAt: asStringOrNull(entry.uploadedAt),
    });
  }
  return {
    items,
    atCap: asBooleanOrNull(record.atCap),
    limit: asFiniteOrNull(record.limit),
    stuckAfterMinutes: asFiniteOrNull(record.stuckAfterMinutes),
  };
};

export const getAdminParseFailureQueue = async (): Promise<AdminParseFailureQueue> =>
  readAdminParseFailureQueue(await apiRequest(ADMIN_ENDPOINTS.parseFailures));

/* ------------------------------------------------------------------ */
/* AI 调用量与失败率 — mirrors AdminAiUsage                             */
/* ------------------------------------------------------------------ */

export interface AdminAiStatusCount {
  status: string;
  calls: number;
  avgLatencyMs: number | null;
}

export interface AdminAiUsage {
  windowDays: number | null;
  /** `ai_prompt_audit` is swept at AUDIT_RETENTION_DAYS, so no window
   *  reaches further back than this. Rendered beside the window so a
   *  short history is not read as 「我们一共就这些调用」. */
  retentionDays: number | null;
  totalCalls: number | null;
  byStatus: AdminAiStatusCount[];
  /**
   * `error / (success + error)`, computed by the server.
   *
   * NOT recomputed here from `byStatus`: the server excludes
   * `consent_denied` from both halves on purpose (a consent gate doing
   * its job is not an outage), and a client that divided differently
   * would put two different failure rates in front of two different
   * people. `null` is a real value — 0/0 is not 0%.
   */
  failureRate: number | null;
}

export const readAdminAiUsage = (payload: unknown): AdminAiUsage => {
  const record = asRecord(unwrap(payload));
  if (!record) throw new AdminResponseError('AI 调用统计');
  const byStatus: AdminAiStatusCount[] = [];
  for (const item of asArray(record.byStatus) ?? []) {
    const entry = asRecord(item);
    const status = entry ? asStringOrNull(entry.status) : null;
    const calls = entry ? asFiniteOrNull(entry.calls) : null;
    if (!status || calls === null) continue;
    byStatus.push({ status, calls, avgLatencyMs: asFiniteOrNull(entry?.avgLatencyMs) });
  }
  return {
    windowDays: asFiniteOrNull(record.windowDays),
    retentionDays: asFiniteOrNull(record.retentionDays),
    totalCalls: asFiniteOrNull(record.totalCalls),
    byStatus,
    failureRate: asFiniteOrNull(record.failureRate),
  };
};

export const getAdminAiUsage = async (windowDays?: number): Promise<AdminAiUsage> => {
  const suffix = windowDays === undefined ? '' : `?windowDays=${encodeURIComponent(windowDays)}`;
  return readAdminAiUsage(await apiRequest(`${ADMIN_ENDPOINTS.aiUsage}${suffix}`));
};

/* ------------------------------------------------------------------ */
/* 健康检查 — mirrors HealthSummary (apps/api/src/routes/index.ts)      */
/* ------------------------------------------------------------------ */

export interface AdminHealthComponent {
  name: string;
  status: string;
  detail: string | null;
}

export interface AdminHealth {
  status: string | null;
  ready: boolean | null;
  draining: boolean;
  components: AdminHealthComponent[];
}

/**
 * Why this is an ADMIN route and not the public `/api/healthz`.
 *
 * `respondWithHealth` redacts the component detail for any non-loopback
 * caller on a production-like deploy — an operator's phone gets a
 * status word and a `requestId` to grep the server log for. That is
 * correct for an anonymous prober and useless as a dashboard, so this
 * expects the unredacted summary behind `requireAdmin`.
 */
export const readAdminHealth = (payload: unknown): AdminHealth => {
  const record = asRecord(unwrap(payload));
  if (!record) throw new AdminResponseError('健康检查');
  const components: AdminHealthComponent[] = [];
  const componentMap = asRecord(record.components);
  for (const [name, value] of Object.entries(componentMap ?? {})) {
    const component = asRecord(value);
    components.push({
      name,
      // A component that reports no status is not a healthy component.
      status: (component ? asStringOrNull(component.status) : null) ?? '未知',
      detail: component ? asStringOrNull(component.detail) : null,
    });
  }
  components.sort((a, b) => a.name.localeCompare(b.name));
  return {
    status: asStringOrNull(record.status),
    ready: asBooleanOrNull(record.ready),
    // `draining` is only ever present as `true` (HealthSummary marks it
    // `draining?: true`), so its absence is the normal state.
    draining: record.draining === true,
    components,
  };
};

export const getAdminHealth = async (): Promise<AdminHealth> =>
  readAdminHealth(await apiRequest(ADMIN_ENDPOINTS.health));

/* ------------------------------------------------------------------ */
/* 患者列表 — mirrors AdminPatientListItem / AdminPatientListResult     */
/* ------------------------------------------------------------------ */

/**
 * WHAT THE LIST DELIBERATELY DOES NOT CARRY.
 *
 * `maskedName` (张三 → 张〇) and `maskedPhone` (139****0001) are what
 * the service sends; the unmasked columns are searched and never
 * returned. That is the property this screen must not undo: turning a
 * row into a person costs one `admin.record_read` audit row, so a
 * shoulder-surfed list is not a dialable roster of Chinese FSHD
 * patients. Do not add a column here that the server would have to
 * unmask to fill.
 */
export interface AdminPatientListItem {
  /** `app_users.id` — the key every patient-scoped admin route needs. */
  userId: string;
  patientCode: string | null;
  maskedName: string | null;
  maskedPhone: string | null;
  role: string | null;
  isActive: boolean | null;
  /** False for an account that registered and never opened the form.
   *  「查无此人」and「有账号，没填过」are different answers. */
  hasProfile: boolean | null;
  registeredAt: string | null;
  profileUpdatedAt: string | null;
}

export interface AdminPatientListResult {
  page: number;
  pageSize: number;
  /** Null when the server sent no total. The screen then says how many
   *  it is showing and does not invent a denominator. */
  total: number | null;
  items: AdminPatientListItem[];
}

const asPatientListItem = (raw: unknown): AdminPatientListItem | null => {
  const record = asRecord(raw);
  if (!record) return null;
  const userId = asStringOrNull(record.userId);
  // No id means no record to open and no audit target. Dropping the
  // row is worse than keeping it only if a reader would notice; an
  // unopenable row would be read as a patient we have, so it goes.
  if (!userId) return null;
  return {
    userId,
    patientCode: asStringOrNull(record.patientCode),
    maskedName: asStringOrNull(record.maskedName),
    maskedPhone: asStringOrNull(record.maskedPhone),
    role: asStringOrNull(record.role),
    isActive: asBooleanOrNull(record.isActive),
    hasProfile: asBooleanOrNull(record.hasProfile),
    registeredAt: asStringOrNull(record.registeredAt),
    profileUpdatedAt: asStringOrNull(record.profileUpdatedAt),
  };
};

export const ADMIN_PATIENT_PAGE_SIZE = 20;

export interface ListAdminPatientsOptions {
  /** Free text over phone, patient code and both name columns. Sent as
   *  `?q=`; `requireAdmin` strips the query string before writing the
   *  audit row precisely because this parameter carries a patient's
   *  name. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export const listAdminPatients = async (
  options: ListAdminPatientsOptions = {},
): Promise<AdminPatientListResult> => {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? ADMIN_PATIENT_PAGE_SIZE;
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const q = options.q?.trim();
  if (q) params.set('q', q);

  const record = asRecord(unwrap(await apiRequest(`${ADMIN_ENDPOINTS.patients}?${params}`)));
  const rows = record ? asArray(record.items) : null;
  if (!record || !rows) throw new AdminResponseError('患者列表');

  return {
    // The server echoes the page it served. Falling back to the one we
    // asked for keeps the pager honest about which page is on screen
    // even against a build that does not echo it.
    page: asFiniteOrNull(record.page) ?? page,
    pageSize: asFiniteOrNull(record.pageSize) ?? pageSize,
    total: asFiniteOrNull(record.total),
    items: rows
      .map(asPatientListItem)
      .filter((item): item is AdminPatientListItem => item !== null),
  };
};

/* ------------------------------------------------------------------ */
/* 一个患者的档案 — §B3 provenance + §B4 read/write                     */
/* ------------------------------------------------------------------ */

/**
 * WHO PUT THIS VALUE HERE, on the wire.
 *
 * Mirrors `BaselineFieldOrigin` in
 * apps/api/src/modules/patient-profile/baseline-provenance.ts. Three
 * cases and not a nullable record, because `unreadable` has to be
 * renderable: an entry that exists and cannot be parsed must show as
 * 「来源不明」. Showing it as 「本人填写」 would put our own staff's
 * transcription under the patient's name, which is the single claim
 * that module exists to prevent.
 */
export type AdminFieldOrigin =
  | { state: 'patient' }
  | { state: 'admin_entered'; adminUserId: string; at: string }
  | { state: 'unreadable'; detail: string };

export const ADMIN_FIELD_ORIGIN_LABEL: Record<AdminFieldOrigin['state'], string> = {
  // NOT 「本人填写」. This state is inferred from a path having no entry
  // in a list that did arrive, which proves only that nobody on our
  // side marked it — the value can still have been read off an uploaded
  // report, or written into an empty column by the read-time autofill,
  // neither of which records anything. See ABSENCE IS THE PATIENT in
  // apps/api's baseline-provenance for why the storage rule and this
  // label are different claims.
  patient: '无代填记录',
  admin_entered: '管理员代填',
  unreadable: '来源不明',
};

/**
 * Read one provenance entry.
 *
 * EVERY UNRECOGNISED SHAPE BECOMES `unreadable`, INCLUDING ONE THAT
 * SAYS `state: 'patient'`. The server only lists entries that are
 * PRESENT in the provenance block, and a present entry means the field
 * is not the patient's — `listBaselineFieldOrigins` returns
 * `admin_entered` or `unreadable` and never `patient`, because absence
 * is the patient. So a wire entry claiming `patient` is a shape this
 * build does not understand, and the safe reading of a shape we do not
 * understand is 「来源不明」.
 */
export const asFieldOrigin = (raw: unknown): AdminFieldOrigin => {
  const record = asRecord(raw);
  if (!record) return { state: 'unreadable', detail: '条目不是对象' };
  if (record.state === 'admin_entered') {
    const adminUserId = asStringOrNull(record.adminUserId);
    const at = asStringOrNull(record.at);
    if (!adminUserId || !at) {
      return { state: 'unreadable', detail: '代填条目缺少管理员或时间' };
    }
    return { state: 'admin_entered', adminUserId, at };
  }
  if (record.state === 'unreadable') {
    return { state: 'unreadable', detail: asStringOrNull(record.detail) ?? '服务端未说明原因' };
  }
  return { state: 'unreadable', detail: `未知来源：${asStringOrNull(record.state) ?? '（空）'}` };
};

export interface AdminFieldOriginEntry {
  /** Dotted path into the baseline payload, e.g. foundation.fullName. */
  path: string;
  origin: AdminFieldOrigin;
}

/** Mirrors AdminAccountDTO. Unlike the list, the phone number here is
 *  NOT masked — opening one record is the audited act that unmasks. */
export interface AdminAccount {
  userId: string;
  phoneNumber: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean | null;
  createdAt: string | null;
}

/**
 * The histories §B4 asks the back office to show, read down to the
 * columns this screen renders. Field names mirror the DTOs the patient
 * app already receives for the same rows (`PatientDocument`,
 * `PatientFollowupEvent`, `InstrumentAdministration` in lib/api.ts,
 * `FallRecord` in lib/falls.ts) so the admin router can project the
 * same serializers instead of inventing a second vocabulary for the
 * same tables.
 *
 * Everything but `id` is nullable and renders as 「未填」. `id` is not:
 * a row with no id cannot be keyed in a list.
 */
export interface AdminRecordDocument {
  id: string;
  title: string | null;
  documentType: string | null;
  status: string | null;
  uploadedAt: string | null;
}

export interface AdminRecordFollowup {
  id: string;
  eventType: string | null;
  severity: string | null;
  occurredAt: string | null;
  description: string | null;
}

export interface AdminRecordFall {
  id: string;
  occurredOn: string | null;
  /** Tri-state, never coerced: 「没填」 and 「没受伤」 are different
   *  answers about someone's body. */
  injured: boolean | null;
}

export interface AdminRecordInstrument {
  id: string;
  instrumentNameZh: string | null;
  scoredValue: number | null;
  levelLabelZh: string | null;
  administeredAt: string | null;
}

export interface AdminPatientRecord {
  account: AdminAccount;
  /** Identity fields off `patient_profiles`. Null for an account that
   *  registered and never opened the form. */
  identity: {
    fullName: string | null;
    preferredName: string | null;
    patientCode: string | null;
    regionLabel: string | null;
    updatedAt: string | null;
  } | null;
  /**
   * THE STORED `baseline_payload`, NOT THE ONE THE APP RENDERS.
   *
   * `getBaselineByUserId` and `getProfileByUserId` both run
   * `applyGeneticReportAutofill` at READ time, which fills a missing
   * D4Z4 / haplotype / diagnosis year out of the patient's latest
   * genetic report. Editing on top of that merge and PUTting it back
   * would persist those inferred values into the column AND — because
   * `applyAdminBaselineWrite` derives the changed set by diffing —
   * stamp 管理员代填 on values no administrator typed. So this field
   * has to be the column, and `readAdminPatientRecord` refuses a
   * response that does not distinguish it (see `baselineIsStored`).
   */
  baseline: BaselineProfilePayload | null;
  /**
   * The server's assertion that `baseline` above is the stored column
   * rather than the read-time merge. False (or absent) disables the
   * edit form; it does not silently save into a payload we cannot
   * account for.
   */
  baselineIsStored: boolean;
  /**
   * One entry per MARKED field. An absent path inside a PRESENT list
   * carries no marker — which is not the same as the patient having
   * typed it, and the chip says 无代填记录 for exactly that reason.
   * `null` means the server did not send the list at all, and that is a
   * different fact again: not 「nothing is marked」 but 「we do not
   * know」. Collapsing it to `[]` would answer the second question with
   * the first on every field of a record read from a build that does
   * not send it.
   */
  fieldOrigins: AdminFieldOriginEntry[] | null;
  /**
   * `null` means the server did not send this section at all; `[]`
   * means it sent it and the patient has none. 「这个患者没有报告」 and
   * 「这台服务器不返回报告」 are different sentences and an operator
   * acts differently on each.
   */
  documents: AdminRecordDocument[] | null;
  followups: AdminRecordFollowup[] | null;
  falls: AdminRecordFall[] | null;
  instruments: AdminRecordInstrument[] | null;
}

/** Read a list section, preserving the `null` = 「服务端未返回」
 *  distinction above. Unkeyable rows are dropped; the section is not. */
const asSection = <T>(
  raw: unknown,
  read: (record: Record<string, unknown>) => T | null,
): T[] | null => {
  const list = asArray(raw);
  if (!list) return null;
  const rows: T[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const row = read(record);
    if (row) rows.push(row);
  }
  return rows;
};

export const readAdminPatientRecord = (payload: unknown): AdminPatientRecord => {
  const body = asRecord(unwrap(payload));
  const accountRecord = body ? asRecord(body.account) : null;
  const userId = accountRecord ? asStringOrNull(accountRecord.userId) : null;
  if (!body || !accountRecord || !userId) throw new AdminResponseError('患者档案');

  // `null` when the key is absent or unreadable, `[]` when the server
  // sent an empty list. Only the second one lets a field with no entry
  // be reported as unmarked; see the field's doc comment above.
  const rawFieldOrigins = asArray(body.fieldOrigins);
  let fieldOrigins: AdminFieldOriginEntry[] | null = null;
  if (rawFieldOrigins) {
    fieldOrigins = [];
    for (const item of rawFieldOrigins) {
      const record = asRecord(item);
      const path = record ? asStringOrNull(record.path) : null;
      // An entry with no path cannot be attached to a field. Dropping
      // it would leave whichever field it belonged to reporting no
      // marker, when one was in fact recorded — so it is surfaced as
      // its own row instead.
      fieldOrigins.push({
        path: path ?? '（服务端未给出字段名）',
        origin: record
          ? asFieldOrigin(record.origin)
          : { state: 'unreadable', detail: '条目不是对象' },
      });
    }
  }

  const identityRecord = asRecord(body.identity);

  return {
    account: {
      userId,
      phoneNumber: asStringOrNull(accountRecord.phoneNumber),
      email: asStringOrNull(accountRecord.email),
      role: asStringOrNull(accountRecord.role),
      isActive: asBooleanOrNull(accountRecord.isActive),
      createdAt: asStringOrNull(accountRecord.createdAt),
    },
    identity: identityRecord
      ? {
          fullName: asStringOrNull(identityRecord.fullName),
          preferredName: asStringOrNull(identityRecord.preferredName),
          patientCode: asStringOrNull(identityRecord.patientCode),
          regionLabel: asStringOrNull(identityRecord.regionLabel),
          updatedAt: asStringOrNull(identityRecord.updatedAt),
        }
      : null,
    baseline: asRecord(body.baseline) as BaselineProfilePayload | null,
    baselineIsStored: body.baselineIsStored === true,
    fieldOrigins,
    documents: asSection(body.documents, (record) => {
      const id = asStringOrNull(record.id);
      return id
        ? {
            id,
            title: asStringOrNull(record.title),
            documentType: asStringOrNull(record.documentType),
            status: asStringOrNull(record.status),
            uploadedAt: asStringOrNull(record.uploadedAt),
          }
        : null;
    }),
    followups: asSection(body.followups, (record) => {
      const id = asStringOrNull(record.id);
      return id
        ? {
            id,
            eventType: asStringOrNull(record.eventType),
            severity: asStringOrNull(record.severity),
            occurredAt: asStringOrNull(record.occurredAt),
            description: asStringOrNull(record.description),
          }
        : null;
    }),
    falls: asSection(body.falls, (record) => {
      const id = asStringOrNull(record.id);
      return id
        ? {
            id,
            occurredOn: asStringOrNull(record.occurredOn),
            injured: asBooleanOrNull(record.injured),
          }
        : null;
    }),
    instruments: asSection(body.instruments, (record) => {
      const id = asStringOrNull(record.id);
      return id
        ? {
            id,
            instrumentNameZh: asStringOrNull(record.instrumentNameZh),
            scoredValue: asFiniteOrNull(record.scoredValue),
            levelLabelZh: asStringOrNull(record.levelLabelZh),
            administeredAt: asStringOrNull(record.administeredAt),
          }
        : null;
    }),
  };
};

export const getAdminPatientRecord = async (userId: string): Promise<AdminPatientRecord> =>
  readAdminPatientRecord(await apiRequest(ADMIN_ENDPOINTS.patient(userId)));

/**
 * Merge an edit map into a copy of the stored baseline.
 *
 * `edits` is keyed by the same dotted paths the provenance block uses.
 * One or two levels only, which is what `baselineProfileSchema` has
 * (`currentStatus.footDrop`); a deeper path is REFUSED rather than
 * dropped, because a silently ignored edit is an operator who believes
 * they saved a value that was never sent.
 */
export const buildAdminBaselineWrite = (
  stored: BaselineProfilePayload | null,
  edits: Record<string, string | number | null>,
): BaselineProfilePayload => {
  const next: Record<string, unknown> = { ...((stored ?? {}) as Record<string, unknown>) };
  for (const [path, value] of Object.entries(edits)) {
    const parts = path.split('.');
    if (parts.length === 1) {
      next[parts[0]] = value;
      continue;
    }
    if (parts.length !== 2) {
      throw new Error(`无法写入字段「${path}」：只支持一层或两层的字段路径。`);
    }
    const [group, field] = parts;
    next[group] = { ...(asRecord(next[group]) ?? {}), [field]: value };
  }
  return next as BaselineProfilePayload;
};

/**
 * Write the baseline back.
 *
 * THE PAYLOAD IS THE WHOLE BASELINE, NOT THE EDITED FIELDS. Two
 * independent reasons, both read out of the API source rather than
 * assumed:
 *
 *  1. `upsertBaseline` (profile.service.ts) runs
 *     `UPDATE patient_profiles SET baseline_payload = $1` — the whole
 *     column, not a merge. A partial payload deletes what it omits.
 *  2. `applyAdminBaselineWrite` derives the changed set by diffing the
 *     stored payload against the one about to be written
 *     (baseline-provenance.ts). A partial payload therefore reads as
 *    「the administrator cleared these fields」.
 *
 * `expectedUpdatedAt` IS THE VERSION THE PAYLOAD WAS BUILT ON —
 * `identity.updatedAt` from the record read that filled the form — and
 * it goes in `If-Match` rather than in the body, because the server
 * parses the body with a plain Zod object that strips unknown keys and
 * the comparison would then read `undefined` forever. The server
 * answers 409 when it does not match what is stored: point 1 above is
 * why that matters, since a stale whole-baseline payload reads as the
 * administrator having changed every field the patient touched in the
 * meantime.
 *
 * Returns nothing on purpose: the caller re-fetches the record, so the
 * values and the provenance markers on screen afterwards are the ones
 * the server stored rather than the ones this client hoped it would.
 */
export const updateAdminPatientBaseline = async (
  userId: string,
  baseline: BaselineProfilePayload,
  expectedUpdatedAt: string,
): Promise<void> => {
  await apiRequest(ADMIN_ENDPOINTS.patientBaseline(userId), {
    method: 'PUT',
    headers: { 'If-Match': expectedUpdatedAt },
    body: JSON.stringify(baseline),
  });
};

/* ------------------------------------------------------------------ */
/* 导出 — §B4 导出：单个患者、以及全量 CSV                              */
/* ------------------------------------------------------------------ */

/**
 * WHY THESE TWO CALLS DO NOT GO THROUGH `apiRequest`.
 *
 * `apiRequest` reads `content-type` and returns `response.json()` only
 * when it says `application/json`; anything else becomes `null`. The
 * full export answers `text/csv; charset=utf-8`, so through
 * `apiRequest` a successful download is indistinguishable from an empty
 * body. And both endpoints put the filename §B4 asks for — the
 * timestamp and the operator's `app_users.id` — in `Content-Disposition`,
 * which `apiRequest` discards along with the rest of the headers.
 *
 * So this is its own fetch. It keeps the three behaviours of
 * `apiRequest` that are not about parsing: the bearer token, the
 * deadline, and the global 401 handler. It deliberately does NOT keep
 * the fourth — `apiRequest` retries a timed-out GET once, and a retried
 * export is a second `admin.export` audit row for one operator action,
 * i.e. a trail that says somebody exported this patient twice.
 */

/** Mirrors `PORTABLE_EXPORT_FORMATS`
 *  (apps/api/src/modules/patient-profile/export/index.ts). The server
 *  REQUIRES the parameter — there is no default — so this list is the
 *  whole of what the export endpoint accepts. */
export const ADMIN_PORTABLE_EXPORT_FORMATS = ['fhir-r4', 'phenopacket', 'treat-nmd'] as const;
export type AdminPortableExportFormat = (typeof ADMIN_PORTABLE_EXPORT_FORMATS)[number];

/** 15 s, the same deadline `apiRequest` gives an ordinary JSON call
 *  (DEFAULT_TIMEOUT_MS in lib/api.ts). Not exported from there, so it is
 *  stated here rather than imported. */
const ADMIN_DOWNLOAD_TIMEOUT_MS = 15_000;

export interface AdminDownload {
  blob: Blob;
  /**
   * The name the SERVER put in `Content-Disposition`, or `null` when
   * this browser would not let us read that header.
   *
   * `Content-Disposition` is not a CORS-safelisted response header. In
   * production the web export and the API are the same origin (Caddy
   * serves the bundle and proxies `/api`), so it is readable; against a
   * cross-origin `EXPO_PUBLIC_API_URL` it is not, unless the server
   * adds it to `Access-Control-Expose-Headers` — which
   * apps/api/src/server.ts does not do today.
   *
   * `null` is therefore a real case and NOT papered over with a name we
   * invented: the whole point of the server's name is that it carries
   * the operator and the timestamp, and a locally-built substitute
   * carrying neither would look exactly like it eighteen months later.
   * The caller says so on screen instead.
   */
  fileName: string | null;
}

/**
 * `attachment; filename="openrd-patients-20260813T041107Z-by-<id>.csv"`.
 *
 * Both `filename*=UTF-8''…` and plain `filename=` are read, `filename*`
 * first per RFC 6266. Every name this API produces is ASCII, so the
 * extended form is defence against a future one rather than something
 * observed. A name is refused if it contains a path separator: a
 * download whose name is `../…` is one an operator can be talked into
 * saving somewhere they did not mean to.
 */
export const parseContentDispositionFilename = (header: string | null): string | null => {
  if (!header) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      const decoded = decodeURIComponent(extended[1].trim());
      if (decoded && !decoded.includes('/') && !decoded.includes('\\')) return decoded;
    } catch {
      // A malformed percent-encoding is not a filename. Fall through
      // to the plain form rather than throwing away the download.
    }
  }
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  const name = quoted?.[1]?.trim();
  if (!name || name.includes('/') || name.includes('\\')) return null;
  return name;
};

const adminFetchFile = async (path: string, options: RequestInit = {}): Promise<AdminDownload> => {
  const token = await getAuthToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADMIN_DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json, text/csv',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...((options.headers as Record<string, string> | undefined) ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
  } catch (caught) {
    const failure = new ApiError(
      (caught as Error)?.name === 'AbortError' ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE,
    );
    failure.code = (caught as Error)?.name === 'AbortError' ? 'timeout' : 'network';
    throw failure;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json() : null;
    const error = new ApiError(extractApiErrorMessage(payload) ?? '导出失败');
    error.status = response.status;
    error.data = payload;
    // The same extraction `apiRequest` runs, for the same reason: the
    // only 429 on this router is the full export's 10/min limiter, and
    // it is reached through THIS function. `createRateLimitMiddleware`
    // throws `AppError(message, 429, { retryAfterSeconds, rateLimitKey })`
    // (apps/api/src/middleware/rate-limit.ts:72-80) and
    // `retryAfterSeconds` is in CLIENT_SAFE_DETAIL_KEYS, so the body is
    // `{error, details:{retryAfterSeconds}}` and the countdown branch of
    // `describeAdminError` was dead without this line.
    error.retryAfterSeconds = extractRetryAfterSeconds(payload);
    // Same reason apiRequest does it: a stale token on any admin route
    // has to clear the local session, or the operator keeps looking at
    // a shell that will 401 every request.
    if (response.status === 401) await dispatchUnauthorized();
    throw error;
  }

  return {
    blob: await response.blob(),
    fileName: parseContentDispositionFilename(response.headers.get('content-disposition')),
  };
};

/**
 * One patient, as a FHIR / Phenopacket / TREAT-NMD document.
 *
 * `includeLocalOnly` is not a parameter here because it is not one on
 * the server either: `AdminController.exportPatient` always sends
 * `false`. The local-only block is the patient's account of their
 * RELATIVES' health — a second person who consented to nothing here —
 * and disclosing it is theirs to do from 我的 › 导出我的数据, not an
 * administrator's.
 */
export const exportAdminPatient = async (
  userId: string,
  format: AdminPortableExportFormat,
): Promise<AdminDownload> => adminFetchFile(ADMIN_ENDPOINTS.patientExport(userId, format));

/**
 * The full-database CSV, both halves of its two-step.
 *
 * Called with no phrase it is the FIRST half: the server answers 428
 * with the exact phrase to send back, the row count that phrase was
 * built from, and what the file does and does not contain. Nothing has
 * been read at that point. Called with the phrase it is the second
 * half and the answer is the file.
 *
 * A 428 on the SECOND call is not an error either — the phrase carries
 * today's date in Asia/Shanghai and the row count, so it goes stale at
 * local midnight and when somebody registers. Both come back as
 * `confirmation_required` with the NEW phrase, which is why this
 * returns a union rather than throwing: the caller has to be able to
 * tell「你要确认」from「导出失败了」.
 */
export type AdminFullExportResult =
  | {
      state: 'confirmation_required';
      requiredConfirmation: string;
      patientCount: number | null;
      notes: string[];
    }
  | { state: 'downloaded'; download: AdminDownload };

export const requestAdminFullPatientCsv = async (
  confirmation?: string,
): Promise<AdminFullExportResult> => {
  try {
    return {
      state: 'downloaded',
      download: await adminFetchFile(ADMIN_ENDPOINTS.fullExportCsv, {
        method: 'POST',
        body: JSON.stringify(confirmation ? { confirm: confirmation } : {}),
      }),
    };
  } catch (caught) {
    if (!(caught instanceof ApiError) || caught.status !== 428) throw caught;
    const body = asRecord(caught.data);
    const requiredConfirmation = body ? asStringOrNull(body.requiredConfirmation) : null;
    // A 428 with no phrase in it cannot be answered — there is nothing
    // to type. Surfaced as a shape error rather than as an empty
    // confirmation box that no input will ever satisfy.
    if (!requiredConfirmation) throw new AdminResponseError('全量导出确认要求');
    return {
      state: 'confirmation_required',
      requiredConfirmation,
      patientCount: body ? asFiniteOrNull(body.patientCount) : null,
      notes: (body && asArray(body.notes) ? (asArray(body.notes) as unknown[]) : [])
        .map((note) => asStringOrNull(note))
        .filter((note): note is string => note !== null),
    };
  }
};
