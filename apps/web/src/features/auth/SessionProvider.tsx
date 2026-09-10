import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OwnerSummary } from '@devpractice/contracts';
import {
  ApiRequestError,
  apiGet,
  apiSend,
  fetchLoginCsrfToken,
  onSessionExpired,
  setCsrfToken,
} from '../../lib/api';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  owner: OwnerSummary | null;
  status: SessionStatus;
  /** True when a 401 arrived mid-session. The current route stays mounted. */
  expired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [owner, setOwner] = useState<OwnerSummary | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [expired, setExpired] = useState(false);
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    try {
      const me = await apiGet<OwnerSummary>('/auth/me');
      setCsrfToken(me.csrfToken);
      setOwner(me);
      setStatus('authenticated');
      setExpired(false);
    } catch {
      setOwner(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      onSessionExpired(() => {
        // Do NOT clear the route or any editor content: the owner signs in
        // again in place and keeps whatever they had typed (spec 6).
        setExpired(true);
      }),
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const csrfToken = await fetchLoginCsrfToken();
      const me = await apiSend<OwnerSummary>(
        'POST',
        '/auth/login',
        { email, password, csrfToken },
        csrfToken,
      );
      setCsrfToken(me.csrfToken);
      setOwner(me);
      setStatus('authenticated');
      setExpired(false);
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await apiSend<void>('POST', '/auth/logout');
    } catch (error) {
      // A already-dead session still ends locally.
      if (!(error instanceof ApiRequestError)) throw error;
    }
    setCsrfToken(null);
    setOwner(null);
    setStatus('anonymous');
    setExpired(false);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<SessionValue>(
    () => ({ owner, status, expired, signIn, signOut, refresh: load }),
    [owner, status, expired, signIn, signOut, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
