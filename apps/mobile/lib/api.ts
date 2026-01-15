import AsyncStorage from '@react-native-async-storage/async-storage';

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
    await AsyncStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    await AsyncStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
};

export const getAuthToken = async () => {
  return AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
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

export const getMyPatientProfile = () => apiRequest('/profiles/me');

export const addPatientMeasurement = (payload: Record<string, unknown>) =>
  apiRequest('/profiles/me/measurements', {
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

export const createSubmission = () =>
  apiRequest<{ id: string; createdAt: string }>('/profiles/me/submissions', {
    method: 'POST',
  });

export interface SubmissionItem {
  id: string;
  createdAt: string;
  measurements: Array<{
    id: string;
    muscleGroup: string;
    strengthScore: number;
    recordedAt: string;
  }>;
  activityLogs: Array<{
    id: string;
    content: string | null;
    logDate: string;
    createdAt: string;
  }>;
  medications: Array<{
    id: string;
    medicationName: string;
    dosage: string | null;
    frequency: string | null;
    route: string | null;
  }>;
  documents: Array<{
    id: string;
    documentType: string;
    title: string | null;
    fileName: string | null;
    uploadedAt: string;
  }>;
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
  ocrPayload: {
    extractedText?: string;
    fields?: Record<string, string>;
    provider?: string;
  } | null;
}

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
  file: DocumentUploadFile;
}): Promise<PatientDocument> => {
  const formData = new FormData();
  formData.append('documentType', input.documentType);
  if (input.title) {
    formData.append('title', input.title);
  }
  if (isWebFile(input.file)) {
    formData.append('file', input.file, input.file.name);
  } else {
    formData.append('file', input.file as any);
  }

  return apiRequest<PatientDocument>(
    '/profiles/me/documents/upload',
    { method: 'POST', body: formData },
    {
      isFormData: true,
    },
  );
};

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
  password: string;
  role?: string;
  email?: string;
}) =>
  apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
