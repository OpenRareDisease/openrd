import { PREGNANCY_DUE_DATE_KEY } from './draft-keys';
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
  // See lib/draft-keys.ts for why this one is declared there and not
  // beside the screen that writes it.
  PREGNANCY_DUE_DATE_KEY,
];

// Single source of truth for the API base URL. ai-streaming.ts and
// any other caller imports this rather than re-reading the env at
// the call site, so the dev default + env override path stays
// consistent across modules.
const DEV_FALLBACK_API_URL = 'http://localhost:4000/api';

/**
 * Resolve the API base URL, or refuse to start.
 *
 * `EXPO_PUBLIC_API_URL` is inlined by Metro at bundle time, and Expo
 * reads it from `apps/mobile/.env` — the *project root*, not the
 * repository root. The docs used to point at the repo-root `.env`,
 * which Expo never loads, so an operator who followed them got a
 * bundle that had silently fallen through to localhost. On a phone
 * that is not a misconfiguration the user can see: every request just
 * fails to a host that does not exist, and the app looks offline.
 *
 * So the fallback now only exists where it is actually correct — a
 * developer running `expo start` against a local API. A production
 * bundle with no configured URL throws here, at module load, on the
 * first launch after the build: loud, immediate, and traceable to the
 * build that produced it, instead of a support ticket a week later.
 *
 * The compose/web path never depends on this: Dockerfile.web takes
 * EXPO_PUBLIC_API_URL as a build ARG defaulting to `/api`, which is
 * correct behind Caddy. See apps/mobile/.env.example.
 */
const resolveApiBaseUrl = (): string => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. A production bundle must be built with it ' +
        '(apps/mobile/.env, an exported shell variable, or the Dockerfile.web build ARG) — ' +
        'the repository-root .env is NOT read by Expo. See apps/mobile/.env.example.',
    );
  }
  return DEV_FALLBACK_API_URL;
};

export const API_BASE_URL = resolveApiBaseUrl();

export class ApiError extends Error {
  status?: number;
  data?: unknown;
  /** Set for transport-level failures (no HTTP response): 'network'
   *  for fetch TypeErrors (offline, DNS, connection reset), 'timeout'
   *  when the request exceeded its deadline. */
  code?: 'network' | 'timeout' | 'sensitive_consent_required' | 'consent_check_unavailable';
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
const SLOW_ENDPOINT_TIMEOUT_MS = 60_000;
const NETWORK_RETRY_DELAY_MS = 300;

/**
 * Upload deadlines, scaled to the payload.
 *
 * This used to be a flat 60 s, which could not carry what the pickers
 * are allowed to hand it. The per-file cap is 10 MB (p-data_entry's
 * MAX_UPLOAD_BYTES, mirroring multer's limits.fileSize), and pushing
 * 10 MB inside 60 s needs a sustained ~1.4 Mbps uplink. A hospital
 * corridor's wifi or an indoor 4G cell at visiting hour routinely
 * gives a fraction of that — and this is a mutation, which apiRequest
 * deliberately never retries, so the deadline expiring is final for
 * that file: the row goes back to the queue and the patient has to
 * press 重试 by hand, against the same impossible budget.
 *
 * The budget below is a fixed part plus a per-byte part:
 *
 *  - **45 s fixed** covers what does not scale with size — radio
 *    wake-up, TLS, and the server's own work after the last byte
 *    (multer writes the file, the row is inserted, 201 comes back;
 *    OCR does not run inline, so that part is short).
 *  - **1 ms per 40 bytes** = 40 KB/s ≈ 320 kbit/s sustained. That is
 *    deliberately the low end of a congested indoor cell rather than
 *    an average: the cost of over-budgeting is a patient waiting
 *    longer for a failure, the cost of under-budgeting is an upload
 *    that can never succeed no matter how many times they retry.
 *  - **4-minute ceiling**, because past that the connection is not
 *    slow, it is gone. fetch gives no upload progress, so the patient
 *    is watching an indeterminate spinner the whole time; four
 *    minutes is about as long as that is honest.
 *
 * A typical camera scan (3-4 MB after the pickers' quality: 0.8) lands
 * around 2.5 minutes of budget and finishes in seconds; only a
 * near-cap file on a bad cell ever approaches the ceiling.
 */
const UPLOAD_TIMEOUT_BASE_MS = 45_000;
const UPLOAD_BYTES_PER_MS = 40;
const UPLOAD_TIMEOUT_MAX_MS = 240_000;

/** Mirrors p-data_entry's MAX_UPLOAD_BYTES / the API's multer cap. Used
 *  only as the budgeting assumption when the platform did not report a
 *  size (some Android content providers don't). */
const ASSUMED_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const uploadTimeoutMsForBytes = (sizeBytes: number | null | undefined): number => {
  const bytes =
    typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > 0
      ? sizeBytes
      : ASSUMED_MAX_UPLOAD_BYTES;
  return Math.min(UPLOAD_TIMEOUT_MAX_MS, UPLOAD_TIMEOUT_BASE_MS + bytes / UPLOAD_BYTES_PER_MS);
};

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
  // A FormData caller that does not declare a size gets the
  // cap-derived budget rather than a flat minute — the only thing this
  // app posts as multipart is a report scan of up to 10 MB, and
  // guessing low there is the failure mode described above
  // uploadTimeoutMsForBytes.
  const timeoutMs =
    config?.timeoutMs ??
    (config?.isFormData ? uploadTimeoutMsForBytes(undefined) : DEFAULT_TIMEOUT_MS);
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
    // Server-side consent codes, lifted out of `data` for the same
    // reason retryAfterSeconds is: the caller has to tell「你还没同意，
    // 这是同意书」apart from a generic 403, and every screen digging
    // through the body itself is how the gate ends up honoured in one
    // place and not another. requireSensitiveDataConsent (api) refuses
    // every route that stores health or genetic data; a client that
    // did not ask first lands here, and the right response is to show
    // the document rather than an error toast.
    const serverCode = (payload as { code?: unknown } | null)?.code;
    if (serverCode === 'sensitive_consent_required' || serverCode === 'consent_check_unavailable') {
      error.code = serverCode;
    }

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

/**
 * 「你的诊断走到哪一步了」 — the five rungs the baseline form writes.
 *
 * MIRRORED, NOT INVENTED. The wire values and the Chinese wording are
 * both owned by the API: apps/api/src/modules/patient-profile/
 * profile.schema.ts, `DIAGNOSIS_LADDER_STATES` and
 * `DIAGNOSIS_LADDER_LABELS`. There is no shared package between the two
 * apps, so this is a copy — keep it byte-identical to that file. The
 * server validates the value against its own enum (`z.enum`), so a
 * drifted string here is rejected at the write, not silently stored;
 * drifted *labels* are worse, because they would put a different
 * question in front of the patient than the one the passport answers.
 *
 * ORDER IS MEANINGFUL — index 0 is the most complete evidence, index 4
 * the least, and the form renders them in that order.
 */
export const DIAGNOSIS_LADDER_STATES = [
  'confirmed_with_report',
  'confirmed_report_unavailable',
  'clinical_only',
  'untested_wants_test',
  'untested_no_plan',
] as const;

export type DiagnosisLadderState = (typeof DIAGNOSIS_LADDER_STATES)[number];

export const DIAGNOSIS_LADDER_LABELS: Record<DiagnosisLadderState, string> = {
  confirmed_with_report: '已确诊，基因报告在手上',
  confirmed_report_unavailable: '已确诊，但报告不在手上',
  clinical_only: '临床诊断，还没做过基因检测',
  untested_wants_test: '还没测过，想测',
  untested_no_plan: '还没测过，暂时不打算测',
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
    /** See DIAGNOSIS_LADDER_STATES. Optional on the wire: the API's
     *  schema marks it `.optional().nullable()` so a handset still
     *  running an older web export — WeChat's in-app browser caches for
     *  days — keeps saving successfully with only `diagnosedFshd`. */
    diagnosisLadder?: DiagnosisLadderState | null;
    /** Derived server-side from `diagnosisLadder` whenever that is
     *  present (profile.schema.ts transforms the object), so the two
     *  halves cannot disagree on disk. Still sent by older clients. */
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

/** The four grades plus 未知 — the API's `GeneticEvidenceGrade`. It
 *  grades the EVIDENCE, never the person. */
/** The five the API can send. Kept as a value so the reader below can
 *  actually check against it — a type alone validates nothing at
 *  runtime, which is how the bare `as` got in. */
export const GENETIC_EVIDENCE_GRADES = [
  'not_tested',
  'method_not_applicable',
  'method_right_incomplete',
  'trial_ready',
  'unknown',
] as const;

export type GeneticEvidenceGrade = (typeof GENETIC_EVIDENCE_GRADES)[number];

export interface GeneticTestRequestSection {
  heading: string;
  body: string[];
  source: string;
}

/** 《检查申请说明》 — the page a patient hands across a clinic desk. */
export interface GeneticTestRequest {
  title: string;
  intro: string;
  sections: GeneticTestRequestSection[];
  /** The same content flattened, for print / copy. */
  printable: string;
}

export interface PassportGeneticEvidence {
  grade: GeneticEvidenceGrade;
  gradeLabel: string;
  headline: string;
  reason: string;
  action: string;
  /** Non-null only when the repeat count is in the 8–10 gray zone. */
  greyZoneNote: string | null;
  /** Null once the report already carries size AND haplotype — at that
   *  point there is nothing left to ask a clinic for. */
  testRequest: GeneticTestRequest | null;
  sources: string[];
}

// `asStringArray` is declared further down this file, next to the
// document/report readers. Used here rather than copied: two spellings
// of「keep only the strings」is two things to keep in step.

const asTestRequest = (raw: unknown): GeneticTestRequest | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  // `printable` is the carrier that leaves the app (print / copy), and
  // `title` names the document a patient is handing over. Without
  // either, the block would render a heading with nothing under it.
  if (typeof record.printable !== 'string' || typeof record.title !== 'string') return null;
  const sections = Array.isArray(record.sections)
    ? record.sections.flatMap((entry): GeneticTestRequestSection[] => {
        if (!entry || typeof entry !== 'object') return [];
        const section = entry as Record<string, unknown>;
        if (typeof section.heading !== 'string') return [];
        return [
          {
            heading: section.heading,
            body: asStringArray(section.body),
            // A clinical claim without its source is not shown as a
            // claim with a missing source — the empty string renders
            // nothing at all. See the reader in p-clinical_passport.
            source: typeof section.source === 'string' ? section.source : '',
          },
        ];
      })
    : [];
  return {
    title: record.title,
    intro: typeof record.intro === 'string' ? record.intro : '',
    sections,
    printable: record.printable,
  };
};

/**
 * `diagnosis.geneticEvidence`, unwrapped and shape-checked.
 *
 * `getClinicalPassportSummary` is an `apiRequest<T>` call, and that type
 * parameter is an UNCHECKED ASSERTION over whatever the server sent —
 * see lib/passport-share-api.ts's header for what that cost the share
 * screen. This block is new on the wire, and this app ships as a web
 * export that WeChat's in-app browser caches for days: a handset can
 * therefore be running today's bundle against an API build that has no
 * `geneticEvidence` at all. Reaching straight for `.gradeLabel` there
 * throws inside render and takes the whole passport — diagnosis,
 * reports, timeline — down with it.
 *
 * Returns null instead, and the screen renders nothing rather than a
 * half-built 《检查申请说明》. Every field a patient reads is required
 * here for the same reason: a grade with no headline, or a headline
 * with no next step, is not a shorter answer, it is a misleading one.
 */
export const readPassportGeneticEvidence = (raw: unknown): PassportGeneticEvidence | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.grade !== 'string' ||
    typeof record.gradeLabel !== 'string' ||
    typeof record.headline !== 'string' ||
    typeof record.reason !== 'string' ||
    typeof record.action !== 'string'
  ) {
    return null;
  }
  return {
    // Validated, not asserted. Every sibling field in this reader is
    // checked; `grade` was the one bare `as`, so any string the server
    // sent would have typed as one of five enum members. It happens to
    // be unread today (the screen renders `gradeLabel`), which is
    // exactly why it was worth fixing now: the next person to branch on
    // `grade === 'not_tested'` would reasonably assume it had been
    // checked. Unrecognised falls to 'unknown', which is a real member
    // and the one that promises nothing.
    grade: GENETIC_EVIDENCE_GRADES.includes(record.grade as GeneticEvidenceGrade)
      ? (record.grade as GeneticEvidenceGrade)
      : 'unknown',
    gradeLabel: record.gradeLabel,
    headline: record.headline,
    reason: record.reason,
    action: record.action,
    greyZoneNote: typeof record.greyZoneNote === 'string' ? record.greyZoneNote : null,
    testRequest: asTestRequest(record.testRequest),
    sources: asStringArray(record.sources),
  };
};

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
    /** 'genetic' 才是基因报告佐证过的；'self_reported' 是患者自己填的。
     *  打印页据此显示未确诊警示条——那张纸会递到一年只见三例 FSHD 的
     *  医生手里，患者的自述不能和基因结果长得一样。 */
    confirmation: 'genetic' | 'self_reported' | 'none';
    /** 患者自己在建档表上答的那一级，没答过就是 null。和 `confirmation`
     *  回答的不是同一个问题（「你怎么说」 vs 「报告怎么写」），护照两个
     *  都显示，不做调和。 */
    ladder?: DiagnosisLadderState | null;
    ladderLabel?: string | null;
    latestSourceDate: string | null;
    latestDocumentId: string | null;
    freshness: PassportFreshness;
    geneticType: string;
    d4z4Repeats: string;
    methylationValue: string;
    diagnosisDate: string;
    geneEvidence: string;
    /**
     * 对基因证据的分级读法，外加可以递给医生的《检查申请说明》。
     *
     * Typed as `unknown` on purpose. The server always sends this
     * object, but the type parameter on `getClinicalPassportSummary` is
     * an unchecked assertion and a cached WeChat bundle can be talking
     * to an API build that predates the field. `unknown` makes the
     * compiler refuse `.gradeLabel` until it has gone through
     * `readPassportGeneticEvidence`, which is the only thing that has
     * actually looked at the bytes.
     */
    geneticEvidence?: unknown;
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
      /** `unreadable` means a report IS on file but nothing structured
       *  came out of it — see the API's PassportMonitoringItemDTO. The
       *  anesthesia card must not collapse it into `absent`. */
      state: 'present' | 'unreadable' | 'absent';
      /** Whether this test is indicated at all — see the API's
       *  PassportMonitoringItemDTO. Not every slot is expected of every
       *  patient, and the panel used to imply otherwise. */
      note?: string;
    }>;
  };
  nextSteps: Array<{
    title: string;
    description: string;
    /** `record` completes the passport; `clinical` is something to
     *  raise at a visit. They render in separate cards — see the API's
     *  PassportNextStepDTO for why they must not be merged. */
    kind: 'record' | 'clinical';
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

/* ------------------------------------------------------------------ *
 * Instruments (Brooke / Vignos, and whatever the registry adds later)
 * ------------------------------------------------------------------ */

/**
 * The client half of the instrument engine.
 *
 * ONE SOURCE OF TRUTH FOR THE ANCHORS
 *
 * There is deliberately no table of level descriptions anywhere in
 * this app. The anchor wording IS the measurement — brooke.ts on the
 * API says so at length and freezes it at v1 — so a second copy here
 * would be a second definition of what「3 级」means, drifting silently
 * the first time either side was reworded. Instead:
 *
 *  - `getInstrumentCatalogue` fetches the anchors, the prompt, the
 *    citation, the licence and the documented limitations. The form
 *    renders what it fetched or it renders nothing.
 *  - Every stored administration comes back carrying `levelLabelZh`,
 *    resolved on the server against the version the patient actually
 *    answered. It is `null` when that version is not in the server's
 *    registry, and null propagates: a level with no words is dropped
 *    rather than shown as a bare number.
 */

export interface InstrumentCatalogueLevel {
  value: number;
  labelZh: string;
  /** The English the Chinese was translated from. Not rendered to
   *  patients; kept because it is what makes the translation
   *  checkable. */
  sourceEn: string | null;
}

export interface InstrumentCatalogueItem {
  code: string;
  version: string;
  promptZh: string;
  levels: InstrumentCatalogueLevel[];
}

export interface InstrumentCatalogueEntry {
  key: string;
  version: string;
  nameZh: string;
  descriptionZh: string;
  licenceStatus: string;
  sourceCitation: string;
  scoreMin: number | null;
  scoreMax: number | null;
  higherIsWorse: boolean | null;
  recallPeriod: string | null;
  adminMinutes: number | null;
  /** Documented weaknesses of the scale — floor effects, what it does
   *  not cover. The API's controller is explicit that these are served
   *  WITH the anchors rather than from a second endpoint, because a
   *  screen that renders a scale without its floor-effect warning
   *  tells a patient that a flat line means a stable disease. */
  limitationsZh: string[];
  /** How well patient self-report agrees with a clinician on this
   *  particular scale. Differs per instrument and must not be
   *  flattened into「经过验证」. */
  selfReportEvidenceZh: string;
  items: InstrumentCatalogueItem[];
}

export interface InstrumentResponseItem {
  itemCode: string;
  /** null when the patient skipped it, marked it 不适用, or the value
   *  could not be read. Never coerced to 0 — 1 is the best Brooke
   *  grade and 0 is not on the scale at all, so a 0 here would be a
   *  value no patient could have chosen. */
  responseValue: number | null;
  skipped: boolean;
  notApplicable: boolean;
}

export interface InstrumentAdministration {
  id: string | null;
  instrumentKey: string | null;
  instrumentVersion: string | null;
  instrumentNameZh: string | null;
  /** The graded level. */
  scoredValue: number | null;
  /** The anchor sentence for `scoredValue`, resolved by the server
   *  against the version answered. null when the server could not
   *  resolve it — see the class comment: null is preserved, never
   *  replaced with the number. */
  levelLabelZh: string | null;
  source: string | null;
  assistedBy: string | null;
  supersededById: string | null;
  administeredAt: string | null;
  createdAt: string | null;
  responses: InstrumentResponseItem[];
}

const asStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const asFiniteOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** Pull the array out of `{key: [...]}`, or accept a bare array. */
const listFrom = (payload: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
};

const normalizeCatalogueLevel = (raw: unknown): InstrumentCatalogueLevel | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const value = asFiniteOrNull(record.value);
  const labelZh = asStringOrNull(record.labelZh);
  // A level with no words is not a level this app can offer: the
  // patient would be picking a number whose meaning is not on screen.
  if (value === null || !labelZh) return null;
  return { value, labelZh, sourceEn: asStringOrNull(record.sourceEn) };
};

const normalizeCatalogueItem = (raw: unknown): InstrumentCatalogueItem | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const code = asStringOrNull(record.code);
  if (!code) return null;
  const levels = (Array.isArray(record.levels) ? record.levels : [])
    .map(normalizeCatalogueLevel)
    .filter((level): level is InstrumentCatalogueLevel => level !== null);
  if (levels.length === 0) return null;
  return {
    code,
    version: asStringOrNull(record.version) ?? '',
    promptZh: asStringOrNull(record.promptZh) ?? '',
    levels,
  };
};

/**
 * Coerce the catalogue response into something renderable.
 *
 * Every drop here is a refusal to render half a scale: an entry with
 * no key, no items, or no levels with words would put a control on
 * screen that a patient cannot answer meaningfully. `[]` is the
 * correct outcome when the engine has not shipped — the screens treat
 * it as "nothing to offer" and say so.
 */
export const normalizeInstrumentCatalogue = (payload: unknown): InstrumentCatalogueEntry[] => {
  const entries: InstrumentCatalogueEntry[] = [];
  for (const raw of listFrom(payload, ['instruments', 'items', 'data'])) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const key = asStringOrNull(record.key);
    if (!key) continue;
    const items = (Array.isArray(record.items) ? record.items : [])
      .map(normalizeCatalogueItem)
      .filter((item): item is InstrumentCatalogueItem => item !== null);
    if (items.length === 0) continue;
    entries.push({
      key,
      version: asStringOrNull(record.version) ?? '',
      nameZh: asStringOrNull(record.nameZh) ?? key,
      descriptionZh: asStringOrNull(record.descriptionZh) ?? '',
      licenceStatus: asStringOrNull(record.licenceStatus) ?? '',
      sourceCitation: asStringOrNull(record.sourceCitation) ?? '',
      scoreMin: asFiniteOrNull(record.scoreMin),
      scoreMax: asFiniteOrNull(record.scoreMax),
      higherIsWorse: typeof record.higherIsWorse === 'boolean' ? record.higherIsWorse : null,
      recallPeriod: asStringOrNull(record.recallPeriod),
      adminMinutes: asFiniteOrNull(record.adminMinutes),
      limitationsZh: asStringArray(record.limitationsZh),
      selfReportEvidenceZh: asStringOrNull(record.selfReportEvidenceZh) ?? '',
      items,
    });
  }
  return entries;
};

const normalizeInstrumentResponse = (raw: unknown): InstrumentResponseItem | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const itemCode = asStringOrNull(record.itemCode);
  if (!itemCode) return null;
  return {
    itemCode,
    responseValue: asFiniteOrNull(record.responseValue),
    skipped: record.skipped === true,
    notApplicable: record.notApplicable === true,
  };
};

export const normalizeInstrumentAdministrations = (
  payload: unknown,
): InstrumentAdministration[] => {
  const administrations: InstrumentAdministration[] = [];
  for (const raw of listFrom(payload, ['administrations', 'items', 'data', 'results'])) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    administrations.push({
      id: asStringOrNull(record.id),
      instrumentKey: asStringOrNull(record.instrumentKey),
      instrumentVersion: asStringOrNull(record.instrumentVersion),
      instrumentNameZh: asStringOrNull(record.instrumentNameZh),
      scoredValue: asFiniteOrNull(record.scoredValue),
      levelLabelZh: asStringOrNull(record.levelLabelZh),
      source: asStringOrNull(record.source),
      assistedBy: asStringOrNull(record.assistedBy),
      supersededById: asStringOrNull(record.supersededById),
      administeredAt: asStringOrNull(record.administeredAt),
      createdAt: asStringOrNull(record.createdAt),
      responses: (Array.isArray(record.responses) ? record.responses : [])
        .map(normalizeInstrumentResponse)
        .filter((item): item is InstrumentResponseItem => item !== null),
    });
  }
  return administrations;
};

export const getInstrumentCatalogue = async (): Promise<InstrumentCatalogueEntry[]> =>
  normalizeInstrumentCatalogue(await apiRequest<unknown>('/profiles/me/instruments'));

export interface InstrumentAdministrationQuery {
  instrumentKey?: string;
  limit?: number;
  offset?: number;
  includeSuperseded?: boolean;
}

export const getInstrumentAdministrations = async (
  query: InstrumentAdministrationQuery = {},
): Promise<InstrumentAdministration[]> => {
  const params = new URLSearchParams();
  if (query.instrumentKey) params.set('instrumentKey', query.instrumentKey);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') params.set('offset', String(query.offset));
  if (query.includeSuperseded) params.set('includeSuperseded', 'true');
  const suffix = params.toString();
  return normalizeInstrumentAdministrations(
    await apiRequest<unknown>(
      `/profiles/me/instruments/administrations${suffix ? `?${suffix}` : ''}`,
    ),
  );
};

export interface RecordInstrumentAdministrationPayload {
  instrumentKey: string;
  responses: Array<{
    itemCode: string;
    responseValue?: number | null;
    skipped?: boolean;
    notApplicable?: boolean;
  }>;
  source?: 'self' | 'clinician' | 'proxy';
  assistedBy?: 'none' | 'family' | 'caregiver' | 'clinician' | 'other';
  /** The correction pointer. An administration is immutable; fixing a
   *  mis-tap means recording a new one that names the row it replaces. */
  supersedesId?: string;
  administeredAt?: string;
}

/**
 * POST one administration.
 *
 * Returns the normalized administration, or null if the response did
 * not contain one. Null means「保存了，但读不回来」, and the caller must
 * not synthesise a reading from what it just sent — the server is the
 * one that decides the score and resolves its anchor.
 */
export const recordInstrumentAdministration = async (
  payload: RecordInstrumentAdministrationPayload,
): Promise<InstrumentAdministration | null> => {
  const result = await apiRequest<unknown>('/profiles/me/instruments/administrations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  const administration = record?.administration ?? record;
  return normalizeInstrumentAdministrations([administration])[0] ?? null;
};

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
  /** Payload size, when the picker reported one. Only used to set the
   *  deadline (see uploadTimeoutMsForBytes) — null/omitted budgets for
   *  the 10 MB cap rather than assuming the file is small. */
  sizeBytes?: number | null;
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

  // Prefer the size the File object already knows over whatever the
  // caller passed: on web it is authoritative, and a caller that
  // forgot to thread it through would otherwise silently get the
  // cap-sized budget for a 200 KB file.
  const sizeBytes = isWebFile(input.file) ? input.file.size : (input.sizeBytes ?? null);

  return apiRequest<PatientDocument>(
    '/profiles/me/documents/upload',
    { method: 'POST', body: formData },
    {
      isFormData: true,
      timeoutMs: uploadTimeoutMsForBytes(sizeBytes),
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
  /** null when the platform declined to report a size — forwarded as
   *  such so the deadline budgets for the cap instead of guessing. */
  sizeBytes?: number | null;
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
        sizeBytes: item.sizeBytes,
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

/**
 * Delete one report.
 *
 * A 200 means the database row is gone. It does NOT mean the stored
 * file is: the API deletes the row first and then tries the blob, and
 * reports the outcome separately as `storageCleanupStatus` —
 * 'removed' (gone), 'missing' (was already absent), or 'failed' (the
 * scan is still sitting in storage). See
 * profile.controller.ts#deleteDocument.
 *
 * KNOWN DEFECT, not fixed here: both call sites — p-report_management's
 * `runDeleteReport` and p-report_detail's `runDelete` — `await` this
 * and throw the result away, so a 'failed' cleanup is announced to the
 * patient as「已删除…这份报告已移除」. For a genetic or MRI scan that is
 * the app telling them their document is gone when the server just
 * said it could not remove it. Those two screens are outside this
 * change's scope; the field is documented here so the next person to
 * open either one has the contract in front of them.
 */
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

/** The agreement-acceptance ledger (PIPL evidence trail). */
export interface LegalAcceptanceSummary {
  acceptances: Array<{ document: string; version: string; acceptedAt: string }>;
  current: Record<string, string>;
  outstanding: string[];
}

export const getLegalAcceptances = () => apiRequest<LegalAcceptanceSummary>('/legal/acceptances');

export const recordLegalAcceptance = (document: string, version: string) =>
  apiRequest<{ document: string; version: string; acceptedAt: string }>('/legal/acceptances', {
    method: 'POST',
    body: JSON.stringify({ document, version }),
  });

/** Withdraw consent to a document. Idempotent — `withdrawn` is 0 when
 *  there was nothing live to withdraw, which is not an error: the user's
 *  intent is satisfied either way. */
export const withdrawLegalAcceptance = (document: string) =>
  apiRequest<{ document: string; withdrawn: number }>('/legal/acceptances/withdraw', {
    method: 'POST',
    body: JSON.stringify({ document }),
  });
