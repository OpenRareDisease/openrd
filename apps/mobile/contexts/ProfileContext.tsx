import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, getMyPatientProfile, type PatientProfile } from '../lib/api';
import { useAuth } from './AuthContext';

/**
 * Single source of truth for "does this logged-in user have a patient
 * profile yet?" — the question the onboarding gate in app/_layout
 * asks on every route change.
 *
 * Status semantics (they are the gate's contract):
 * - 'loading'  — no token yet, or the probe is in flight. Gate waits.
 * - 'ready'    — profile row exists. Gate lets everything through.
 * - 'missing'  — server said 404: the user must complete onboarding.
 *                Gate redirects to p-register_profile?mode=onboarding.
 * - 'error'    — network/5xx. FAIL-OPEN: the gate does NOT redirect,
 *                because locking an offline user out of cached screens
 *                over a transient blip is worse than letting a
 *                profile-less user see empty states for one session.
 *                Screens keep their own 404 handling as the backstop.
 */
export type ProfileStatus = 'loading' | 'ready' | 'missing' | 'error';

interface ProfileContextValue {
  profileStatus: ProfileStatus;
  profile: PatientProfile | null;
  /** Re-probe the server (e.g. pull-to-refresh on a gate-exempt screen). */
  refresh: () => Promise<void>;
  /** Flip to ready without a second request — call with the profile
   *  the onboarding save just created/returned. */
  markReady: (profile: PatientProfile | null) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export const ProfileProvider = ({ children }: { children: ReactNode }) => {
  const { token, isHydrated } = useAuth();
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<PatientProfile | null>(null);

  const probe = useCallback(async () => {
    try {
      const result = await getMyPatientProfile();
      setProfile(result ?? null);
      setProfileStatus(result ? 'ready' : 'missing');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setProfile(null);
        setProfileStatus('missing');
        return;
      }
      // Transient/network/5xx → fail-open (see status semantics).
      setProfile(null);
      setProfileStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (!token) {
      // Logged out (or 401 sweep): reset so the next login re-probes.
      setProfile(null);
      setProfileStatus('loading');
      return;
    }
    setProfileStatus('loading');
    void probe();
  }, [token, isHydrated, probe]);

  const markReady = useCallback((next: PatientProfile | null) => {
    setProfile(next);
    setProfileStatus('ready');
  }, []);

  const value = useMemo(
    () => ({ profileStatus, profile, refresh: probe, markReady }),
    [profileStatus, profile, probe, markReady],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};

export const useProfileContext = (): ProfileContextValue => {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfileContext must be used within ProfileProvider');
  }
  return context;
};
