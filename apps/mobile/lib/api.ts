import { getSessionValue, removeSessionValue, setSessionValue } from './session-storage';

export const AUTH_TOKEN_STORAGE_KEY = 'openrd.authToken';
export const AUTH_USER_STORAGE_KEY = 'openrd.authUser';

/**
 * AsyncStorage keys whose value is scoped to the currently signed-in
 * user. They must be cleared on logout and on a server-side 401 so a
 * second user signing in on a shared device never sees the previous
 * user's medical history (chat answers with RAG snippets, cached
 * profile, etc.). AsyncStorage is NOT encrypted by default — the
 * auth token lives in SecureStore (see session-storage.ts), but
 * these caches were in plain AsyncStorage and never cleared.
 *
 * Any new patient-scoped cache should be added to this list.
 */
export const QNA_CHAT_STORAGE_KEY = 'openrd.qna.chatMessages.v1';
export const QNA_HISTORY_EPOCH_STORAGE_KEY = 'openrd.qna.historyEpoch';

export const PATIENT_SCOPED_CACHE_KEYS: string[] = [
  QNA_CHAT_STORAGE_KEY,
  QNA_HISTORY_EPOCH_STORAGE_KEY,
];

// Single source of truth for the API base URL. ai-streaming.ts and
// any other caller imports this rather than re-reading the env at
// the call site, so the dev default + env override path stays
// consistent across modules.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  status?: number;
  data?: unknown;
  /** Set for transport-level failures (no HTTP response): 'network'
   *  for fetch TypeErrors (offline, DNS, connection reset), 'timeout'
   *  when the request exceeded its deadline. */
  code?: 'network' | 'timeout';
  /** How long the server said to wait before retrying (429 rate limit,
   *  429 login lockout). Lifted out of `data` so callers don't each
   *  re-implement the "is it under `details` or top level" dig — the
   *  server has been sending this since the rate limiter landed and
   *  nobody was reading it, which is why a throttled patient only ever
   *  saw「过于频繁」with no idea whether to wait 5 seconds or 5 minutes. */
  retryAfterSeconds?: number;
}

export const NETWORK_ERROR_MESSAGE = '网络连接不稳定，请检查网络后重试';
export const TIMEOUT_ERROR_MESSAGE = '请求超时，请检查网络后重试';

/**
 * Pull the human sentence out of a 4xx/5xx body. Handlers are
 * inconsistent about which key carries it: `next(new AppError(...))`
 * is serialized as `error` by the API's error-handler middleware,
 * while the hand-written responses in ai-chat.routes.ts use `message`.
 * Reading only one of them threw away every sentence that told the
 * patient what to do next（「一次最多 500 字，太长的话分几次记」became
 * 「请求失败」）.
 *
 * Returns null rather than a canned string so each caller keeps its
 * own fallback — the JSON path wants「请求失败」, the SSE path wants to
 * fall back to the raw body it already has.
 *
 * Shared with ai-streaming.ts on purpose: a pre-stream 429 and a
 * plain-fetch 429 carry the identical body, so they must not decode it
 * two different ways.
 */
export const extractApiErrorMessage = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as { error?: unknown; message?: unknown };
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  return null;
};

/**
 * Seconds to wait before retrying, as advertised by a 429.
 *
 * The value normally arrives nested under `details` because the API's
 * error handler only forwards allow-listed `AppError.details` keys;
 * the top-level read covers hand-written bodies that never go through
 * that middleware. Non-numeric / non-positive values are dropped
 * instead of forwarded — the UI renders this straight into a sentence
 * and「NaN 秒后再试」is worse than no countdown at all. Fractions round
 * up so we never tell the patient to retry before the window closes.
 */
export const extractRetryAfterSeconds = (payload: unknown): number | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const body = payload as { retryAfterSeconds?: unknown; details?: unknown };
  const details =
    body.details && typeof body.details === 'object'
      ? (body.details as { retryAfterSeconds?: unknown })
      : null;
  const raw = details?.retryAfterSeconds ?? body.retryAfterSeconds;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.ceil(raw);
};

// Deadlines: most JSON endpoints answer in well under a second, so
// 15s only trips on a genuinely stuck connection. Uploads and
// LLM-backed endpoints legitimately take longer.
const DEFAULT_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const SLOW_ENDPOINT_TIMEOUT_MS = 60_000;
const NETWORK_RETRY_DELAY_MS = 300;

/**
 * Callback the AuthProvider registers so apiRequest can fire a single
 * source-of-truth logout when the server returns 401. Without this,
 * a screen on a stale token kept rendering its last-known state (e.g.
 * privacy settings cached toggles) instead of bouncing to login.
 * Registered exactly once at AuthProvider mount.
 */
let onUnauthorizedHandler: (() => Promise<void> | void) | null = null;

export const registerOnUnauthorized = (handler: (() => Promise<void> | void) | null) => {
  onUnauthorizedHandler = handler;
};

/**
 * Fire the registered 401 handler. Used by code paths that hit 401
 * outside of `apiRequest` (notably the SSE stream — its error event
 * doesn't go through the JSON request path, so it has to dispatch
 * the same global logout hook directly). No-op when no handler is
 * registered, so unit tests that don't mount AuthProvider stay
 * happy.
 */
export const dispatchUnauthorized = async () => {
  if (!onUnauthorizedHandler) return;
  try {
    await onUnauthorizedHandler();
  } catch {
    // Best-effort.
  }
};

const buildHeaders = async (
  headers?: HeadersInit,
  config?: {
    isFormData?: boolean;
  },
) => {
  const mergedHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string>),
  };

  if (!config?.isFormData) {
    mergedHeaders['Content-Type'] = 'application/json';
  }

  const token = await getAuthToken();
  if (token) {
    mergedHeaders.Authorization = `Bearer ${token}`;
  }

  return mergedHeaders;
};

export const setAuthToken = async (token: string | null) => {
  if (token) {
    await setSessionValue(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    await removeSessionValue(AUTH_TOKEN_STORAGE_KEY);
  }
};

export const getAuthToken = async () => {
  return getSessionValue(AUTH_TOKEN_STORAGE_KEY);
};

/** One fetch attempt with a hard deadline. Transport failures are
 *  wrapped into ApiError with a `code` + a human-readable message so
 *  every screen's `error instanceof ApiError ? error.message : …`
 *  fallback automatically shows something actionable instead of a raw
 *  TypeError("Network request failed"). */
const performFetch = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      const timeoutError = new ApiError(TIMEOUT_ERROR_MESSAGE);
      timeoutError.code = 'timeout';
      throw timeoutError;
    }
    const networkError = new ApiError(NETWORK_ERROR_MESSAGE);
    networkError.code = 'network';
    throw networkError;
  } finally {
    clearTimeout(timer);
  }
};

export const apiRequest = async <T = unknown>(
  path: string,
  options: RequestInit = {},
  config?: {
    isFormData?: boolean;
    /** Per-call deadline override for legitimately slow endpoints
     *  (LLM-backed generation). */
    timeoutMs?: number;
  },
): Promise<T> => {
  const url = `${API_BASE_URL}${path}`;
  const method = (options.method ?? 'GET').toUpperCase();
  const timeoutMs =
    config?.timeoutMs ?? (config?.isFormData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const init: RequestInit = {
    ...options,
    headers: await buildHeaders(options.headers, config),
  };

  let response: Response;
  try {
    response = await performFetch(url, init, timeoutMs);
  } catch (error) {
    // GETs are idempotent — one silent retry absorbs the transient
    // blips (radio wake-up, network hand-off) that dominate mobile
    // failures. Mutations are NEVER retried: a timed-out POST may
    // have committed server-side, and retrying would duplicate it.
    const isTransport =
      error instanceof ApiError && (error.code === 'network' || error.code === 'timeout');
    if (method !== 'GET' || !isTransport) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS));
    response = await performFetch(url, init, timeoutMs);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new ApiError(extractApiErrorMessage(payload) ?? '请求失败');
    error.status = response.status;
    error.data = payload;
    error.retryAfterSeconds = extractRetryAfterSeconds(payload);

    // Centralised 401 handling. A stale token landing on any
    // authenticated endpoint must clear the local session so a
    // (previous) user doesn't keep seeing their last-known UI state.
    // The registered handler runs synchronously enough to clear the
    // token + caches before the throw propagates to the caller; the
    // caller's catch block then renders the unauth UI from a clean
    // state.
    if (response.status === 401 && onUnauthorizedHandler) {
      try {
        await onUnauthorizedHandler();
      } catch {
        // Best-effort — never mask the original 401 from the caller.
      }
    }
    throw error;
  }

  return payload as T;
};

export const createPatientProfile = (payload: Record<string, unknown>) =>
  apiRequest('/profiles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updatePatientProfile = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const upsertPatientProfile = async (payload: Record<string, unknown>) => {
  try {
    return await createPatientProfile(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return updatePatientProfile(payload);
    }
    throw error;
  }
};

export interface BaselineProfilePayload {
  foundation?: {
    fullName?: string | null;
    preferredName?: string | null;
    birthYear?: number | null;
    ageBand?: string | null;
    regionLabel?: string | null;
    diagnosisYear?: number | null;
  };
  diseaseBackground?: {
    diagnosedFshd?: boolean | null;
    diagnosisType?: string | null;
    d4z4?: string | null;
    haplotype?: string | null;
    methylation?: string | null;
    familyHistory?: string | null;
    onsetRegion?: string | null;
  };
  currentStatus?: {
    independentlyAmbulatory?: boolean | null;
    armRaiseDifficulty?: boolean | null;
    facialWeakness?: boolean | null;
    footDrop?: boolean | null;
    breathingSymptoms?: boolean | null;
    assistiveDevices?: string[];
  };
  currentChallenges?: {
    fatigue?: number | null;
    pain?: number | null;
    stairs?: number | null;
    dressing?: number | null;
    reachingUp?: number | null;
    walkingStability?: number | null;
  };
  notes?: string | null;
}

export interface PatientMeasurement {
  id: string;
  muscleGroup: string;
  metricKey?: string | null;
  bodyRegion?: string | null;
  side?: 'left' | 'right' | 'bilateral' | 'none' | null;
  strengthScore: number;
  method?: string | null;
  entryMode?: string | null;
  deviceUsed?: string | null;
  notes?: string | null;
  recordedAt: string;
  createdAt?: string;
  submissionId?: string | null;
}

export interface PatientFunctionTest {
  id: string;
  testType: string;
  measuredValue: number | null;
  side?: 'left' | 'right' | 'bilateral' | 'none' | null;
  protocol?: string | null;
  unit?: string | null;
  deviceUsed?: string | null;
  assistanceRequired?: boolean | null;
  notes?: string | null;
  performedAt: string;
  createdAt?: string;
  submissionId?: string | null;
}

export interface PatientSymptomScore {
  id: string;
  symptomKey: string;
  score: number;
  scaleMin: number;
  scaleMax: number;
  notes?: string | null;
  recordedAt: string;
  createdAt?: string;
  submissionId?: string | null;
}

export interface PatientDailyImpact {
  id: string;
  adlKey: string;
  difficultyLevel: number;
  needsAssistance?: boolean | null;
  notes?: string | null;
  recordedAt: string;
  createdAt?: string;
  submissionId?: string | null;
}

export interface PatientFollowupEvent {
  id: string;
  eventType: string;
  severity?: 'mild' | 'moderate' | 'severe' | null;
  occurredAt: string;
  resolvedAt?: string | null;
  description?: string | null;
  linkedDocumentId?: string | null;
  createdAt?: string;
  submissionId?: string | null;
}

export interface PatientDocument {
  id: string;
  documentType: string;
  title: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  storageUri: string;
  status: string;
  uploadedAt: string;
  checksum: string | null;
  submissionId?: string | null;
  /** What a LIST document carries. The API projects the stored payload
   *  down to these three keys — the model's raw `aiExtraction` read is
   *  two thirds of the blob and no list screen touches it, so it is not
   *  sent with the profile. Fetch one document to see the whole thing
   *  (getPatientDocumentOcr). */
  ocrPayload: {
    extractedText?: string;
    fields?: Record<string, string>;
    provider?: string;
  } | null;
}

export interface PatientProfile {
  id: string;
  fullName: string | null;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  patientCode?: string | null;
  diagnosisDate?: string | null;
  geneticMutation?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  regionProvince?: string | null;
  regionCity?: string | null;
  regionDistrict?: string | null;
  baseline?: BaselineProfilePayload | null;
  measurements: PatientMeasurement[];
  functionTests: PatientFunctionTest[];
  symptomScores: PatientSymptomScore[];
  dailyImpacts: PatientDailyImpact[];
  followupEvents: PatientFollowupEvent[];
  activityLogs: Array<{
    id: string;
    logDate: string;
    content: string | null;
    source?: string;
    moodScore?: number | null;
    createdAt: string;
    submissionId?: string | null;
  }>;
  documents: PatientDocument[];
  medications?: Array<{
    id: string;
    medicationName: string;
    status?: string | null;
    submissionId?: string | null;
  }>;
  updatedAt: string;
}

export interface BaselineProfileResponse {
  profileId: string;
  fullName: string | null;
  preferredName: string | null;
  baseline: BaselineProfilePayload | null;
  updatedAt: string;
}

export const getMyPatientProfile = () => apiRequest<PatientProfile>('/profiles/me');

export const getMyBaseline = () => apiRequest<BaselineProfileResponse>('/profiles/me/baseline');

export const updateMyBaseline = (payload: BaselineProfilePayload) =>
  apiRequest<BaselineProfileResponse>('/profiles/me/baseline', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export interface PassportBodyRegionDatum {
  intensity: number;
  label?: string;
}

export type PassportBodyRegionMap = Record<string, PassportBodyRegionDatum>;

export interface PassportFreshness {
  label: '最新' | '待更新' | '过期' | '缺失' | '未知';
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  date: string | null;
  daysSince: number | null;
}

export interface ClinicalPassportSummary {
  generatedAt: string;
  passportId: string;
  patientName: string;
  hasRecordedData: boolean;
  latestUpdatedAt: string | null;
  completion: {
    completed: number;
    total: number;
  };
  metrics: Array<{
    label: string;
    value: string;
    hint: string;
  }>;
  summaryCards: Array<{
    key: 'diagnosis' | 'motor' | 'imaging' | 'monitoring';
    title: string;
    ready: boolean;
    summary: string;
    meta: string;
  }>;
  diagnosis: {
    ready: boolean;
    latestSourceDate: string | null;
    latestDocumentId: string | null;
    freshness: PassportFreshness;
    geneticType: string;
    d4z4Repeats: string;
    methylationValue: string;
    diagnosisDate: string;
    geneEvidence: string;
  };
  motor: {
    ready: boolean;
    average: string;
    latestMeasurementAt: string | null;
    latestActivityAt: string | null;
    summary: string;
    highlights: string[];
    bodyRegions: PassportBodyRegionMap;
    activitySummary: string;
  };
  imaging: {
    ready: boolean;
    latestMriDate: string | null;
    latestDocumentId: string | null;
    freshness: PassportFreshness;
    summary: string;
    highlights: string[];
    bodyRegions: PassportBodyRegionMap;
  };
  monitoring: {
    ready: boolean;
    items: Array<{
      key: 'blood' | 'respiratory' | 'cardiac';
      title: string;
      available: boolean;
      summary: string;
      latestDate: string | null;
      latestDocumentId: string | null;
      freshness: PassportFreshness;
    }>;
  };
  nextSteps: Array<{
    title: string;
    description: string;
  }>;
  timeline: Array<{
    id: string;
    title: string;
    description: string;
    timestamp: string;
    tag: '报告' | '肌力' | '活动';
    documentId?: string | null;
  }>;
}

export interface ClinicalPassportExport {
  generatedAt: string;
  documentTitle: string;
  fileName: string;
  contentType: 'text/markdown';
  markdown: string;
}

export const getClinicalPassportSummary = () =>
  apiRequest<ClinicalPassportSummary>('/profiles/me/passport');

export const exportClinicalPassportSummary = () =>
  apiRequest<ClinicalPassportExport>('/profiles/me/passport/export');

export const addPatientMeasurement = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/measurements', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const addFunctionTest = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/function-tests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const addActivityLog = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/activity-logs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const addMedication = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/medications', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const addSymptomScore = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/symptom-scores', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const addDailyImpact = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/daily-impacts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const addFollowupEvent = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/followup-events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const getMedications = () => apiRequest('/profiles/me/medications');

export const getRiskSummary = () => apiRequest('/profiles/me/risk');

export type ConsentLevel = 'none' | 'basic' | 'precise';

export interface ConsentFlags {
  personal: boolean;
  thirdParty: boolean;
  preciseValues: boolean;
}

export interface ConsentTimestamps {
  personalAt: string | null;
  thirdPartyAt: string | null;
  preciseValuesAt: string | null;
}

/** Level + flags only. Mirrors the backend `ConsentStatus` shape
 *  used by `/api/ai/ask` when it returns a 403 — that body does not
 *  include the per-flag `_at` timestamps that `ConsentDetails` adds. */
export interface ConsentStatus {
  level: ConsentLevel;
  flags: ConsentFlags;
}

/** {@link ConsentStatus} plus per-flag grant timestamps, as returned
 *  by `GET /api/profiles/me/consent`. */
export interface ConsentDetails extends ConsentStatus {
  timestamps: ConsentTimestamps;
}

export interface ConsentUpdatePayload {
  personal?: boolean;
  thirdParty?: boolean;
  preciseValues?: boolean;
}

/** Fetch the calling user's AI consent state. Throws ApiError(404)
 *  when the user has no patient_profiles row yet (i.e. onboarding
 *  incomplete) — the caller should redirect to the profile setup. */
export const getMyConsent = () => apiRequest<ConsentDetails>('/profiles/me/consent');

/** Full data export (data-portability right): one JSON document with
 *  the profile + all nested records, document metadata, consent state
 *  and history, sharing preferences, submissions, and the scrubbed AI
 *  audit trail. Rendered opaque here — the settings screen hands the
 *  whole payload to a file download without interpreting it. Uses the
 *  slow-endpoint timeout: the server pages through submissions and
 *  audit rows before answering. */
export const exportMyData = () =>
  apiRequest<Record<string, unknown>>(
    '/profiles/me/data-export',
    { method: 'GET' },
    { timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS },
  );

/** Account-deletion lifecycle (right to erasure, 7-day cooling-off).
 *  Request demands the registered phone number retyped (400 on
 *  mismatch, 409 when one is already pending); cancel 404s when
 *  nothing is pending; status returns `{ deletion: null }` for
 *  accounts that never asked. */
export interface AccountDeletionStatus {
  status: 'pending' | 'cancelled' | 'purged';
  requestedAt: string;
  scheduledPurgeAt: string;
  cancelledAt: string | null;
}

export const requestAccountDeletion = (phoneNumber: string) =>
  apiRequest<AccountDeletionStatus>('/profiles/me/deletion-request', {
    method: 'POST',
    body: JSON.stringify({ phoneNumber }),
  });

export const cancelAccountDeletion = () =>
  apiRequest<AccountDeletionStatus>('/profiles/me/deletion-request/cancel', {
    method: 'POST',
  });

export const getAccountDeletionStatus = () =>
  apiRequest<{ deletion: AccountDeletionStatus | null }>('/profiles/me/deletion-request');

/** Patch one or more AI consent flags. The backend enforces the
 *  "precise requires personal+thirdParty" rule and returns 400 if the
 *  caller breaks it. */
export const updateMyConsent = (payload: ConsentUpdatePayload) =>
  apiRequest<ConsentDetails>('/profiles/me/consent', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

/** snake_case to match the DB CHECK constraint. The mobile UI maps
 *  this to a Chinese label in the consent-history card. */
export type ConsentEventFlag = 'personal' | 'third_party' | 'precise_values';

/** `user` = explicit toggle from the app; `admin` = future ops tool;
 *  `system` = auto-coerced (precise→false when the base pair drops). */
export type ConsentEventSource = 'user' | 'admin' | 'system';

export interface ConsentEvent {
  id: string;
  userId: string;
  flagName: ConsentEventFlag;
  fromValue: boolean;
  toValue: boolean;
  source: ConsentEventSource;
  note: string | null;
  changedAt: string;
}

export interface ConsentHistoryResponse {
  events: ConsentEvent[];
}

export interface GetMyConsentHistoryOptions {
  /** 1–500, server clamps. Default 100 on the server side. */
  limit?: number;
  offset?: number;
  flagName?: ConsentEventFlag;
}

/** Fetch the user's AI-consent grant/revoke history, newest first.
 *  Backed by `GET /api/profiles/me/consent/history`. Returns
 *  `{ events: [] }` (not 404) when the user has never toggled
 *  anything, so callers can render an empty state without a special
 *  branch — the 404 case is reserved for "no profile row at all". */
export const getMyConsentHistory = (opts: GetMyConsentHistoryOptions = {}) => {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.flagName) params.set('flagName', opts.flagName);
  const qs = params.toString();
  return apiRequest<ConsentHistoryResponse>(`/profiles/me/consent/history${qs ? `?${qs}` : ''}`);
};

/** The four data-sharing toggles that live next to AI consent on the
 *  privacy settings screen. Backed by columns added in DB
 *  migration 010. */
export interface SharingPreferenceFlags {
  clinicalTrial: boolean;
  dataDonation: boolean;
  hospitalSync: boolean;
  communityShare: boolean;
}

export interface SharingPreferenceTimestamps {
  clinicalTrialAt: string | null;
  dataDonationAt: string | null;
  hospitalSyncAt: string | null;
  communityShareAt: string | null;
}

export interface SharingPreferences {
  flags: SharingPreferenceFlags;
  timestamps: SharingPreferenceTimestamps;
}

export interface SharingPreferencesUpdatePayload {
  clinicalTrial?: boolean;
  dataDonation?: boolean;
  hospitalSync?: boolean;
  communityShare?: boolean;
}

/** Fetch the user's four data-sharing preferences. 404 means the
 *  user hasn't completed onboarding (no patient_profiles row) and
 *  the caller should route them to setup, the same way it does for
 *  {@link getMyConsent}. */
export const getMySharingPreferences = () =>
  apiRequest<SharingPreferences>('/profiles/me/sharing-preferences');

/** Patch one or more data-sharing toggles. At least one flag must
 *  be present in the payload; the backend rejects empty bodies with
 *  a 400. */
export const updateMySharingPreferences = (payload: SharingPreferencesUpdatePayload) =>
  apiRequest<SharingPreferences>('/profiles/me/sharing-preferences', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export interface AiCitation {
  chunkId: string;
  source: string;
  sourceFile?: string | null;
  chunkIndex?: number | null;
  snippet: string;
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Per-tool execution record from the orchestrator. Mirrors
 *  `apps/api/src/modules/ai-agents/orchestrator/types.ts`. Drives
 *  the "AI 思考过程" expansion in the QnA screen and the per-call
 *  chips in the audit history viewer.
 *
 *  Legacy audit rows persisted before ToolCallTrace landed are
 *  promoted server-side into this shape with `status='ok'`,
 *  `chunkCount=0`, `latencyMs=null` — the mobile UI doesn't need to
 *  branch on it. */
export interface AiToolCallSummary {
  name: string;
  toolCallId: string;
  status: 'ok' | 'error';
  chunkCount: number;
  latencyMs: number | null;
  errorDetail?: string;
}

export interface AiAskResponse {
  success: boolean;
  data: {
    question: string;
    answer: string;
    /** Sources the orchestrator used. May be empty when the planner
     *  answered directly without calling any retriever. */
    citations: AiCitation[];
    /** Per-tool execution summary in the order the planner emitted
     *  them. Empty when the planner answered directly. */
    toolCalls: AiToolCallSummary[];
    /** Field names from patient-scoped retrievers that survived
     *  redaction and made it into the final prompt. Empty when the
     *  call did not touch personal data. */
    fieldsUsed: string[];
    /** Drives the "本回答用到了你的..." hint in the UI. */
    usedPersonalData: boolean;
    consentLevel: ConsentLevel;
    redactionMode: 'strict' | 'precise';
    llmUsage?: AiUsage;
    latencyMs: number;
    /** Audit-row id; useful for support tickets. May be null if the
     *  audit insert failed (the orchestrator answer still ships). */
    auditId: string | null;
    progressId: string;
    timestamp: string;
  };
}

/** Body shape the /api/ai/ask route returns on 403 consent_required.
 *  Surface via the helper below so callers don't have to know the
 *  internal shape. The `consent` field is the timestamp-free
 *  {@link ConsentStatus}, not the richer {@link ConsentDetails}
 *  returned by `GET /api/profiles/me/consent`. */
export interface AiAskConsentDeniedBody {
  success: false;
  code: 'consent_required';
  message: string;
  consent: ConsentStatus;
  progressId: string;
}

export const isConsentRequiredError = (
  error: unknown,
): error is ApiError & { data: AiAskConsentDeniedBody } => {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 403) return false;
  const body = error.data as { code?: string } | null;
  return body?.code === 'consent_required';
};

export interface AiAskProgressStage {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  startedAt?: string;
  endedAt?: string;
}

export interface AiAskProgressResponse {
  success: boolean;
  data: {
    progressId: string;
    status: 'running' | 'done' | 'error';
    percent: number;
    stageId: string;
    stages: AiAskProgressStage[];
    error?: string;
    updatedAt: string;
  };
}

/** Trend keys the server will accept as `context.key`. Mirrors
 *  METRIC_LABELS in `apps/api/src/modules/ai-agents/security/
 *  ask-context.ts` — the server maps the key to the label itself, so
 *  the client never supplies prompt text. */
export type AiAskMetricKey = 'stair_climb' | 'sleep_quality' | 'fall_count' | 'muscle_strength';

/** What the patient was looking at when they asked. Lets 「这什么意思」
 *  work without the patient having to describe the thing first. */
export type AiAskContext =
  | { type: 'document'; id: string }
  | { type: 'followup_event'; id: string }
  | { type: 'metric'; key: AiAskMetricKey };

export const askAiQuestion = (question: string, progressId?: string, context?: AiAskContext) =>
  apiRequest<AiAskResponse>(
    '/ai/ask',
    {
      method: 'POST',
      body: JSON.stringify({ question, progressId, ...(context ? { context } : {}) }),
    },
    // LLM-backed: planner + retrieval + final answer legitimately
    // exceed the default deadline.
    { timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS },
  );

/** A structured draft the AI built from one spoken sentence. Every
 *  field is nullable: the server drops anything it couldn't validate
 *  rather than guessing, so a blank here means "you'll have to type
 *  this one", never "the model estimated it for you". */
export interface AiLogDraft {
  understanding: string | null;
  followup: {
    stairClimbSeconds?: number | null;
    sleepScore?: number | null;
    fallCount?: number | null;
    activityNote?: string | null;
  } | null;
  event: {
    /** Null when the model could not tell which kind of event this was.
     *  The server refuses to guess — see draft-log.ts: a `fall` the
     *  patient described being silently rewritten to `other` is the
     *  "repaired" value that file exists to not ship — so consumers get
     *  an unfilled field to complete, not a wrong one to notice. */
    eventType: string | null;
    severity: 'mild' | 'moderate' | 'severe' | null;
    occurredAt?: string | null;
    description?: string | null;
  } | null;
}

/** Draft an entry from plain language. Produces a form to review —
 *  never a database write. Saving still goes through the ordinary
 *  `addFunctionTest` / `addFollowupEvent` / … calls below. */
export const draftLogEntry = async (text: string): Promise<AiLogDraft> => {
  // The route answers `{ success: true, data: draft }` — same envelope
  // as /ai/ask. `apiRequest` hands back the whole body, so the `data`
  // hop is the caller's job. Getting this wrong is invisible to tsc
  // (the generic is an unchecked assertion) and shows up only as the
  // draft looking permanently empty, which reads to the patient as
  // "you didn't say anything I could record".
  const response = await apiRequest<{ success: boolean; data: AiLogDraft }>(
    '/ai/draft-log',
    { method: 'POST', body: JSON.stringify({ text }) },
    { timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS },
  );
  return response.data;
};

/** One frame of the orchestrator's SSE stream. Mirrors the backend
 *  `OrchestratorEvent` union in `apps/api/src/modules/ai-agents/
 *  orchestrator/types.ts`. The `done` event's `data` payload is the
 *  narrowed `AiAskResponse['data']` shape (NOT the full
 *  OrchestratorRunResult — server strips audit-internal fields). */
export type AiStreamEvent =
  | { type: 'planning' }
  | { type: 'plan_complete'; toolsPlanned: string[] }
  | { type: 'tool_start'; tool: string; toolCallId: string }
  | {
      type: 'tool_complete';
      tool: string;
      toolCallId: string;
      chunkCount: number;
      error?: string;
    }
  | {
      type: 'context_built';
      citationCount: number;
      fieldsUsed: string[];
      usedPersonalData: boolean;
    }
  | { type: 'answering' }
  | { type: 'answer_delta'; text: string }
  /** Throw away everything accumulated so far and show `text`.
   *
   *  `text` is empty when more will still stream (a gather round's note
   *  about fetching more, or the instant before a streamed retry) and
   *  non-empty when it is the finished answer. Assign in both cases —
   *  treating the empty one as "nothing to do" leaves the abandoned
   *  text on screen, which is the whole thing this frame exists to
   *  remove. */
  | { type: 'answer_reset'; text: string }
  | { type: 'done'; data: AiAskResponse['data'] }
  | { type: 'error'; message: string };

export interface StreamAiQuestionCallbacks {
  /** Fired once for every SSE frame. Use this to drive progress UI
   *  + accumulate `answer_delta` text into the message bubble. */
  onEvent: (event: AiStreamEvent) => void;
  /** Fired when the stream closes cleanly (after the `done` frame or
   *  after an `error` frame). The `data` payload is null when the
   *  stream ended without a `done` event (e.g. transport-level
   *  failure mid-stream). */
  onComplete: (data: AiAskResponse['data'] | null) => void;
  /** Fired when the transport itself fails (network error, 4xx/5xx
   *  before stream headers, etc). Mutually exclusive with onComplete
   *  on the happy path. */
  onError: (error: Error) => void;
}

export interface StreamAiQuestionHandle {
  /** Close the SSE connection immediately. Safe to call multiple
   *  times. Aborting after the stream has naturally completed is a
   *  no-op. */
  close: () => void;
}

export type AiAuditStatus = 'success' | 'error' | 'consent_denied';

export interface AiAuditEntry {
  id: string;
  userId: string | null;
  requestId: string | null;
  llmProvider: string;
  llmModel: string;
  consentLevel: ConsentLevel;
  redactionMode: 'strict' | 'precise';
  redactedPromptHash: string | null;
  promptCharLength: number | null;
  usedPersonalData: boolean;
  fieldsUsed: string[];
  /** Per-tool execution summary. Legacy audit rows (persisted before
   *  ToolCallTrace landed) are promoted server-side into this shape
   *  with `status='ok'`, `chunkCount=0`, `latencyMs=null` so callers
   *  don't need to special-case them. */
  toolsCalled: AiToolCallSummary[];
  latencyMs: number | null;
  status: AiAuditStatus;
  errorDetail: string | null;
  createdAt: string;
  /** Multi-turn: prior conversation turns replayed into this call
   *  (0 = single-turn; absent on rows from older servers). */
  historyMessageCount?: number;
}

export interface AiAuditListResponse {
  success: boolean;
  data: {
    items: AiAuditEntry[];
    count: number;
    hasMore: boolean;
  };
}

export interface GetMyAuditHistoryOptions {
  limit?: number;
  offset?: number;
  status?: AiAuditStatus;
}

/** Fetch the calling user's AI audit history, newest first. The
 *  server caps `limit` at 200; default page size is 50. */
export const getMyAuditHistory = (opts: GetMyAuditHistoryOptions = {}) => {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiRequest<AiAuditListResponse>(`/ai/audit${qs ? `?${qs}` : ''}`);
};

export const getAiAskProgress = (progressId: string) =>
  apiRequest<AiAskProgressResponse>(`/ai/ask/progress/${encodeURIComponent(progressId)}`);

export const initAiAskProgress = (progressId: string) =>
  apiRequest<{ success: boolean; data: { progressId: string } }>('/ai/ask/progress/init', {
    method: 'POST',
    body: JSON.stringify({ progressId }),
  });

export const createSubmission = (payload?: {
  submissionKind?: 'baseline' | 'followup' | 'event';
  summary?: string | null;
  changedSinceLast?: boolean | null;
}) =>
  apiRequest<{
    id: string;
    submissionKind: string;
    summary: string | null;
    changedSinceLast: boolean | null;
    createdAt: string;
  }>('/profiles/me/submissions', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });

export interface SubmissionItem {
  id: string;
  submissionKind: string;
  summary: string | null;
  changedSinceLast: boolean | null;
  createdAt: string;
  measurements: PatientMeasurement[];
  functionTests: PatientFunctionTest[];
  symptomScores: PatientSymptomScore[];
  dailyImpacts: PatientDailyImpact[];
  followupEvents: PatientFollowupEvent[];
  activityLogs: Array<{
    id: string;
    content: string | null;
    logDate: string;
    createdAt: string;
    submissionId?: string | null;
  }>;
  medications: Array<{
    id: string;
    medicationName: string;
    dosage: string | null;
    frequency: string | null;
    route: string | null;
    submissionId?: string | null;
  }>;
  documents: PatientDocument[];
}

export interface SubmissionTimelineResponse {
  page: number;
  pageSize: number;
  total: number;
  items: SubmissionItem[];
}

export const getSubmissionTimeline = (page = 1, pageSize = 10) =>
  apiRequest<SubmissionTimelineResponse>(
    `/profiles/me/submissions?page=${page}&pageSize=${pageSize}`,
  );

export const attachSubmissionDocuments = (submissionId: string, documentIds: string[]) =>
  apiRequest<{ updated: number }>(`/profiles/me/submissions/${submissionId}/documents`, {
    method: 'PATCH',
    body: JSON.stringify({ documentIds }),
  });

export interface MuscleInsight {
  muscleGroup: string;
  trend: Array<{
    recordedAt: string;
    strengthScore: number;
  }>;
  distribution: {
    muscleGroup: string;
    minScore: number;
    maxScore: number;
    medianScore: number;
    quartile25: number;
    quartile75: number;
    sampleCount: number;
  } | null;
  userLatestScore: number | null;
}

export const getMuscleInsight = (muscleGroup: string, limit = 8) =>
  apiRequest<MuscleInsight>(
    `/profiles/me/insights/muscle?muscleGroup=${encodeURIComponent(muscleGroup)}&limit=${limit}`,
  );

export interface ProgressionSummary {
  generatedAt: string;
  currentStatus: {
    headline: string;
    detail: string;
    lastFollowupAt: string | null;
    baselineReady: boolean;
    hasNewChanges: boolean | null;
  };
  changeCards: Array<{
    id: string;
    domain: 'upper_limb' | 'lower_limb' | 'face' | 'breathing' | 'symptoms' | 'events' | 'reports';
    title: string;
    detail: string;
    trend: 'better' | 'stable' | 'worse' | 'new';
    evidenceAt: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    title: string;
    description: string;
    timestamp: string;
    tag: '事件' | '报告';
    linkedDocumentId?: string | null;
  }>;
  recentReports: Array<{
    id: string;
    title: string;
    documentType: string;
    uploadedAt: string;
    summary: string;
  }>;
  lateralOverview: {
    leftDominant: string[];
    rightDominant: string[];
    bilateral: string[];
  };
  recommendedReviewItems: string[];
}

export const getProgressionSummary = () =>
  apiRequest<ProgressionSummary>('/profiles/me/progression-summary');

/** Exported so a screen holding a queue of picked files can type it
 *  without re-declaring the union (the entry screen used to carry its
 *  own copy, which drifts the moment this one changes). */
export type DocumentUploadFile =
  | {
      uri: string;
      name: string;
      type: string;
    }
  | File;

const isWebFile = (file: DocumentUploadFile): file is File => {
  return typeof File !== 'undefined' && file instanceof File;
};

export const uploadPatientDocument = async (input: {
  documentType: string;
  title?: string;
  submissionId?: string;
  file: DocumentUploadFile;
}): Promise<PatientDocument> => {
  const formData = new FormData();
  formData.append('documentType', input.documentType);
  if (input.title) {
    formData.append('title', input.title);
  }
  if (input.submissionId) {
    formData.append('submissionId', input.submissionId);
  }
  if (isWebFile(input.file)) {
    formData.append('file', input.file, input.file.name);
  } else {
    const nativeFile = input.file as unknown as Parameters<FormData['append']>[1];
    formData.append('file', nativeFile);
  }

  return apiRequest<PatientDocument>(
    '/profiles/me/documents/upload',
    { method: 'POST', body: formData },
    {
      isFormData: true,
    },
  );
};

export interface DocumentUploadBatchItem {
  /** Caller-side row identity, echoed back on the result. File names
   *  collide (two IMG_0001.jpg from two albums), so the caller cannot
   *  match results by name. */
  key: string;
  title?: string;
  file: DocumentUploadFile;
}

export interface DocumentUploadBatchResult {
  key: string;
  document: PatientDocument | null;
  error: Error | null;
}

/**
 * Upload a batch one file at a time.
 *
 * Serial, but not for the reason it looks like. OCR does *not* run
 * inside the upload request — `profile.controller.ts` inserts the row
 * as `processing`, returns 201 immediately, and runs the parse on a
 * background queue with its own concurrency cap
 * (`OCR_JOB_CONCURRENCY = 2`) and admission limit
 * (`OCR_MAX_IN_FLIGHT_JOBS = 10`). So `Promise.all` would *not* pin the
 * machine: the server throttles the expensive half regardless of what
 * the client does. An earlier version of this comment claimed
 * otherwise; it was wrong, and the「每份大约 1 分钟」copy that grew out
 * of it was wrong too — the network phase is milliseconds.
 *
 * The real reasons to keep it serial:
 *  - **Progress that means something.**「正在上传第 3 / 7 份」requires
 *    an order. A parallel batch can only show a spinner.
 *  - **Upload bandwidth.** These are photos of paper from a phone;
 *    seven concurrent multipart bodies on a clinic's wifi finish no
 *    sooner and fail more often.
 *  - **A failure that stays local.** One 429 from the queue-admission
 *    cap fails one file, and the rest of the batch still goes.
 */
export const uploadPatientDocumentsSerially = async (input: {
  documentType: string;
  submissionId?: string;
  items: DocumentUploadBatchItem[];
  onItemStart?: (item: DocumentUploadBatchItem, index: number) => void;
  onItemSettled?: (result: DocumentUploadBatchResult, index: number) => void;
}): Promise<DocumentUploadBatchResult[]> => {
  const results: DocumentUploadBatchResult[] = [];

  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    input.onItemStart?.(item, index);

    let result: DocumentUploadBatchResult;
    try {
      const document = await uploadPatientDocument({
        documentType: input.documentType,
        title: item.title,
        submissionId: input.submissionId,
        file: item.file,
      });
      result = { key: item.key, document, error: null };
    } catch (error) {
      result = {
        key: item.key,
        document: null,
        error: error instanceof Error ? error : new Error('上传失败'),
      };
    }

    results.push(result);
    input.onItemSettled?.(result, index);
  }

  return results;
};

export const getPatientDocumentOcr = (documentId: string) =>
  apiRequest<{
    documentId: string;
    /** Document-row status ('processing' | 'parsed' | 'needs_review'
     *  | 'parse_failed' | legacy 'uploaded'); the async pipeline keeps
     *  ocrPayload null while parsing, so poll on THIS. Optional for
     *  older API builds. */
    status?: string | null;
    /** The FULL stored payload, unlike the projected one on list
     *  documents — this is the endpoint the raw-payload view reads. */
    ocrPayload:
      | (NonNullable<PatientDocument['ocrPayload']> & {
          aiExtraction?: unknown;
          ai_extraction?: unknown;
          extracted_text?: string;
        })
      | null;
  }>(`/profiles/me/documents/${encodeURIComponent(documentId)}/ocr`);

/** Recover a failed/lost parse (202 → poll again). 409 when the
 *  document is already parsing or already parsed. */
export const reparsePatientDocument = (documentId: string) =>
  apiRequest<{ documentId: string; status: 'processing' }>(
    `/profiles/me/documents/${encodeURIComponent(documentId)}/reparse`,
    { method: 'POST' },
  );

/** Hand-correct whitelisted OCR fields on an owned report (reportName /
 *  reportTime / diagnosisType / d4z4Repeats / haplotype /
 *  methylationValue). 409 while the document is processing or failed;
 *  the server stamps manuallyEditedAt into the returned payload. */
export const patchPatientDocumentOcr = (documentId: string, fields: Record<string, string>) =>
  apiRequest<{ id: string; ocr_payload: { fields?: Record<string, string> } | null }>(
    `/profiles/me/documents/${encodeURIComponent(documentId)}/ocr`,
    { method: 'PATCH', body: JSON.stringify({ fields }) },
  );

export const deletePatientDocument = (documentId: string) =>
  apiRequest<{
    documentId: string;
    deleted: true;
    storageCleanupStatus: 'removed' | 'missing' | 'failed';
  }>(`/profiles/me/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });

export const generatePatientDocumentSummary = (documentId: string) =>
  apiRequest<{ documentId: string; summary: string }>(
    `/profiles/me/documents/${encodeURIComponent(documentId)}/summary`,
    { method: 'POST' },
    // LLM-backed summary generation routinely runs past the default
    // deadline; give it the slow-endpoint budget.
    { timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS },
  );

export interface AuthResponse {
  user: {
    id: string;
    phoneNumber: string;
    email: string | null;
    role: string;
    createdAt: string;
  };
  token: string;
}

export const login = (payload: { phoneNumber?: string; email?: string; password: string }) =>
  apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** Passwordless login: a fresh OTP (scene 'login') is the credential. */
export const loginWithOtp = (payload: { phoneNumber: string; code: string; requestId?: string }) =>
  apiRequest<AuthResponse>('/auth/login/otp', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** Self-service password reset authorized by an OTP (scene 'reset'). */
export const resetPassword = (payload: {
  phoneNumber: string;
  code: string;
  requestId?: string;
  newPassword: string;
}) =>
  apiRequest<{ ok: boolean }>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const register = (payload: {
  phoneNumber: string;
  otpCode: string;
  otpRequestId?: string;
  password: string;
  role?: string;
  email?: string;
}) =>
  apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export interface OtpSendResponse {
  provider: string;
  requestId: string;
  sentTo: string;
  mockCode?: string;
  /** Server-driven resend interval (OTP_RESEND_INTERVAL_SECONDS);
   *  optional for backward compatibility with older API builds. */
  retryAfterSeconds?: number;
}

export const sendOtp = (payload: { phoneNumber: string; scene?: 'register' | 'login' | 'reset' }) =>
  apiRequest<OtpSendResponse>('/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
