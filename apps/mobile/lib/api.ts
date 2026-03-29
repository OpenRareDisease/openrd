import { getSessionValue, removeSessionValue, setSessionValue } from './session-storage';

export const AUTH_TOKEN_STORAGE_KEY = 'openrd.authToken';
export const AUTH_USER_STORAGE_KEY = 'openrd.authUser';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  status?: number;
  data?: unknown;
}

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

export const apiRequest = async <T = unknown>(
  path: string,
  options: RequestInit = {},
  config?: {
    isFormData?: boolean;
  },
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: await buildHeaders(options.headers, config),
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new ApiError((payload as { error?: string })?.error ?? '请求失败');
    error.status = response.status;
    error.data = payload;
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
  ocrPayload: {
    extractedText?: string;
    fields?: Record<string, string>;
    provider?: string;
    aiExtraction?: unknown;
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

export interface AiAskResponse {
  success: boolean;
  data: {
    question: string;
    answer: string;
    timestamp: string;
    progressId?: string;
  };
}

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

export const askAiQuestion = (
  question: string,
  userContext?: Record<string, unknown>,
  progressId?: string,
) =>
  apiRequest<AiAskResponse>('/ai/ask', {
    method: 'POST',
    body: JSON.stringify({ question, userContext, progressId }),
  });

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

type DocumentUploadFile =
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

export const getPatientDocumentOcr = (documentId: string) =>
  apiRequest<{ documentId: string; ocrPayload: PatientDocument['ocrPayload'] | null }>(
    `/profiles/me/documents/${encodeURIComponent(documentId)}/ocr`,
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
}

export const sendOtp = (payload: { phoneNumber: string; scene?: 'register' | 'login' | 'reset' }) =>
  apiRequest<OtpSendResponse>('/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
