import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View } from 'react-native';
import type { ReactNode } from 'react';
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  type AuthResponse,
  setAuthToken,
} from '../lib/api';

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
          AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY),
          AsyncStorage.getItem(AUTH_USER_STORAGE_KEY),
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
      AsyncStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(session.user)),
    ]);
    setToken(session.token);
    setUser(session.user);
  };

  const logout = async () => {
    await Promise.all([setAuthToken(null), AsyncStorage.removeItem(AUTH_USER_STORAGE_KEY)]);
    setToken(null);
    setUser(null);
  };

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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#969FFF" />
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
