import AsyncStorage from '@react-native-async-storage/async-storage';

export const AUTH_TOKEN_STORAGE_KEY = 'openrd.authToken';
export const AUTH_USER_STORAGE_KEY = 'openrd.authUser';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  status?: number;
  data?: unknown;
}

const buildHeaders = async (headers?: HeadersInit) => {
  const mergedHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

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
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: await buildHeaders(options.headers),
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
