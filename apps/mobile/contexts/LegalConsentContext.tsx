import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getLegalAcceptances } from '../lib/api';
import { buildConsentAsks, type ConsentAsk } from '../lib/legal-updates';
import { useAuth } from './AuthContext';

/**
 * 「这个账号还欠哪些同意？」 — read once per session, shared by the gate
 * in app/_layout and by the screen that asks.
 *
 * Deliberately shaped like ProfileContext, because it answers the same
 * kind of question for the same gate and gets the same two things
 * wrong if it is written twice: what a failed probe means, and how the
 * gate learns that the user has just answered.
 *
 * Status semantics (they are the gate's contract):
 * - 'loading' — no token yet, or the probe is in flight. Gate waits.
 * - 'ready'   — nothing outstanding this build can ask about.
 * - 'pending' — at least one document needs re-consent. Gate sends the
 *               user to /p-legal_update.
 * - 'error'   — network/5xx. FAIL-OPEN, and this direction is the
 *               right one here: an unreachable API is also an API that
 *               cannot record the acceptance, so a fail-closed gate
 *               would park an offline patient on a consent screen
 *               whose only button is guaranteed to fail. The debt does
 *               not disappear — the server keeps reporting it, and the
 *               next successful probe asks.
 *
 * WHAT THIS IS NOT: it is not an access check. Nothing here decides
 * what the API will serve. The Art. 29 sensitive-data gate
 * (require-consent.ts) is the middleware that refuses health writes
 * without consent, and it is unaffected by this file.
 */
export type LegalConsentStatus = 'loading' | 'ready' | 'pending' | 'error';

interface LegalConsentContextValue {
  status: LegalConsentStatus;
  /** The documents to ask about, in a fixed order. Empty unless
   *  `status === 'pending'`. */
  asks: ConsentAsk[];
  /** True once the user has said 暂不同意 in this session. */
  deferred: boolean;
  /**
   * Stop the gate re-asking for the rest of this session.
   *
   * DECLINING MUST NOT LOCK A PATIENT OUT OF THEIR OWN RECORD. The
   * whole point of the re-consent is that the answer may be no, and a
   * no that costs someone access to the data they are being asked
   * about would make the question coercive. Deferral is memory-only:
   * a full page reload (a fresh visit, not an in-app navigation) asks
   * again, because the consent is genuinely still owed.
   */
  defer: () => void;
  /** Re-read the ledger — what the screen calls after recording an
   *  acceptance, so the gate stops sending the user back. */
  refresh: () => Promise<void>;
}

const LegalConsentContext = createContext<LegalConsentContextValue | null>(null);

export const LegalConsentProvider = ({ children }: { children: ReactNode }) => {
  const { token, isHydrated } = useAuth();
  const [status, setStatus] = useState<LegalConsentStatus>('loading');
  const [asks, setAsks] = useState<ConsentAsk[]>([]);
  const [deferred, setDeferred] = useState(false);

  const probe = useCallback(async () => {
    try {
      const summary = await getLegalAcceptances();
      const next = buildConsentAsks(summary);
      setAsks(next);
      setStatus(next.length > 0 ? 'pending' : 'ready');
    } catch {
      // Any failure — offline, 401 mid-sweep, 500 — is fail-open. See
      // the status semantics above.
      setAsks([]);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (!token) {
      // Logged out (or a 401 sweep): forget the deferral too, so the
      // next person to sign in on this device is asked about their own
      // account rather than inheriting a decision.
      setAsks([]);
      setDeferred(false);
      setStatus('loading');
      return;
    }
    setStatus('loading');
    void probe();
  }, [token, isHydrated, probe]);

  const defer = useCallback(() => setDeferred(true), []);

  const value = useMemo(
    () => ({ status, asks, deferred, defer, refresh: probe }),
    [status, asks, deferred, defer, probe],
  );

  return <LegalConsentContext.Provider value={value}>{children}</LegalConsentContext.Provider>;
};

export const useLegalConsentContext = (): LegalConsentContextValue => {
  const context = useContext(LegalConsentContext);
  if (!context) {
    throw new Error('useLegalConsentContext must be used within LegalConsentProvider');
  }
  return context;
};
