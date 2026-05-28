import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { ReactNode } from 'react';
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  PATIENT_SCOPED_CACHE_KEYS,
  type AuthResponse,
  registerOnUnauthorized,
  setAuthToken,
} from '../lib/api';
import { CLINICAL_COLORS } from '../lib/clinical-visuals';
import { getSessionValue, removeSessionValue, setSessionValue } from '../lib/session-storage';

type AuthUser = AuthResponse['user'];

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isHydrated: boolean;
  setSession: (session: AuthResponse) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          getSessionValue(AUTH_TOKEN_STORAGE_KEY),
          getSessionValue(AUTH_USER_STORAGE_KEY),
        ]);

        if (storedToken) {
          setToken(storedToken);
        }

        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser));
          } catch {
            setUser(null);
          }
        }
      } finally {
        setIsHydrated(true);
      }
    };

    hydrate();
  }, []);

  const setSession = async (session: AuthResponse) => {
    await Promise.all([
      setAuthToken(session.token),
      setSessionValue(AUTH_USER_STORAGE_KEY, JSON.stringify(session.user)),
    ]);
    setToken(session.token);
    setUser(session.user);
  };

  const logout = async () => {
    // Auth token (SecureStore) + auth user (SecureStore) + every
    // patient-scoped cache in plain AsyncStorage. The QnA chat cache
    // carries the user's RAG snippets and answer history; leaving it
    // around for the next signed-in user is a real privacy harm path
    // on shared devices.
    await Promise.all([
      setAuthToken(null),
      removeSessionValue(AUTH_USER_STORAGE_KEY),
      // multiRemove ignores missing keys so this is safe even when a
      // cache hasn't been written this session.
      AsyncStorage.multiRemove(PATIENT_SCOPED_CACHE_KEYS).catch(() => undefined),
    ]);
    setToken(null);
    setUser(null);
  };

  // Wire api.ts's 401 handler to this logout. Registered after the
  // function is defined so the closure captures the latest setState
  // bindings; cleared on unmount so a teardown doesn't fire stale
  // logouts. Without this hook, a server-side session expiry would
  // leave the app in a stale "logged in" UI until the next manual
  // logout.
  useEffect(() => {
    registerOnUnauthorized(() => logout());
    return () => {
      registerOnUnauthorized(null);
    };
    // Logout body uses only setters that are stable across renders,
    // so we deliberately leave the dep array empty — the handler
    // identity stays stable across the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isHydrated,
      setSession,
      logout,
    }),
    [token, user, isHydrated],
  );

  if (!isHydrated) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: CLINICAL_COLORS.background,
        }}
      >
        <ActivityIndicator size="large" color={CLINICAL_COLORS.accent} />
      </View>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
