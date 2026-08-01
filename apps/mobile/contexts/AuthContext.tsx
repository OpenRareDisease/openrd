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
import { COLOR } from '../lib/design';
import { PATIENT_SCOPED_SECURE_KEYS } from '../lib/draft-keys';
import { getSessionValue, removeSessionValue, setSessionValue } from '../lib/session-storage';

type AuthUser = AuthResponse['user'];

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isHydrated: boolean;
  setSession: (session: AuthResponse) => Promise<void>;
  logout: () => Promise<void>;
}

const splashStyle = {
  flex: 1,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: COLOR.paper,
};

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
    //
    // `allSettled`, not `all`: the cache and draft sweeps used to
    // swallow their own rejections with `.catch(() => undefined)`, so
    // a failed purge left another patient's chat history on a shared
    // device and told nobody. Every removal now reports, and one
    // failure no longer hides the outcome of the others.
    const results = await Promise.allSettled([
      setAuthToken(null),
      removeSessionValue(AUTH_USER_STORAGE_KEY),
      // multiRemove ignores missing keys so this is safe even when a
      // cache hasn't been written this session.
      AsyncStorage.multiRemove(PATIENT_SCOPED_CACHE_KEYS),
      // SecureStore drafts need their own removal path — multiRemove
      // above only touches AsyncStorage and silently misses these.
      ...PATIENT_SCOPED_SECURE_KEYS.map((key) => removeSessionValue(key)),
    ]);

    if (results.some((result) => result.status === 'rejected')) {
      // Deliberately keep the in-memory session on failure. Clearing
      // it would send the app to the login screen — which unmounts
      // every surface that could tell the user that their credential
      // or their cached answers are still sitting on this device. The
      // caller stays where it is, shows the error, and can retry;
      // every removal above is idempotent.
      throw new Error('本地登录信息或缓存未能全部清除，请重试。');
    }

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
    registerOnUnauthorized(async () => {
      try {
        await logout();
      } finally {
        // The server has already invalidated this session, so the UI
        // must not stay signed in even when local cleanup failed —
        // unlike the manual logout above, there is nothing to retry
        // and no usable session to preserve.
        setToken(null);
        setUser(null);
      }
    });
    return () => {
      registerOnUnauthorized(null);
    };
    // Logout body uses only setters that are stable across renders,
    // so we deliberately leave the dep array empty — the handler
    // identity stays stable across the app's lifetime.
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

  // The very first thing the app paints. It was the legacy palette's
  // #F8F2EA and #6E9F93, so every launch showed the old sand-and-sage
  // for a beat and then snapped to paper-and-teal on the first real
  // render — the app visibly changing its mind about what it looks
  // like before the user has touched anything.
  if (!isHydrated) {
    return (
      <View style={splashStyle}>
        <ActivityIndicator size="large" color={COLOR.accent} />
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
