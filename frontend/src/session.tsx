// THE SESSION: who is signed in, what they may do, and what happens when the
// server stops recognising them (accounts-spec §8).
//
// One fetch of `/api/auth/me` per page load, held in context. Everything else
// reads it: the header's links, the route guard, and — through `usePolicy()` —
// every gated control in the editor.
//
// The 401 handler lives here too, because only this provider can both refresh
// the session and send the browser to /login: `api.ts` reports the 401 and
// keeps no opinion about it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { Me, Policy } from './types';
import { DEFAULT_POLICY } from './types';
import { ApiError, fetchCsrf, getMe, logout as logoutRequest, setUnauthorizedHandler } from './api';

export interface SessionValue {
  /** The signed-in user, or null when nobody is. */
  user: Me | null;
  /** The effective policy: the student's, or "everything allowed". */
  policy: Policy;
  /** True until the first `/api/auth/me` has answered. */
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

// The default matters: a component rendered outside a provider — a unit test,
// say — sees a signed-out session under the individual's policy rather than
// crashing, so nothing is gated by accident.
const SessionContext = createContext<SessionValue>({
  user: null,
  policy: DEFAULT_POLICY,
  loading: false,
  refresh: async () => {},
  logout: async () => {},
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/** The signed-in user, or null. */
export function useUser(): Me | null {
  return useSession().user;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  // Where the browser is right now, for the 401 handler's `next` — read from a
  // ref so installing the handler does not depend on every navigation.
  const hereRef = useRef(location);
  hereRef.current = location;
  // One bounce per lost session: several requests failing together must not
  // stack up several navigations.
  const bouncing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me);
      bouncing.current = false;
    } catch (err) {
      // A 401 here is the ordinary signed-out case, not a failure.
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // The CSRF cookie first (so the first POST of the page load has its token),
  // then who is signed in.
  useEffect(() => {
    let cancelled = false;
    void fetchCsrf()
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) return refresh();
        return undefined;
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // A 401 anywhere: the session is gone. Drop the user, and send them to the
  // sign-in page with where they were, so signing back in returns them.
  useEffect(() => {
    return setUnauthorizedHandler(() => {
      if (bouncing.current) return;
      bouncing.current = true;
      setUser(null);
      const here = hereRef.current;
      const next = `${here.pathname}${here.search}`;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    });
  }, [navigate]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Signing out is a local fact too: a failed call must not strand anyone.
    }
    setUser(null);
    navigate('/login');
  }, [navigate]);

  const value = useMemo<SessionValue>(
    () => ({ user, policy: user?.policy ?? DEFAULT_POLICY, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The guard on everything that is somebody's own work. While the session is
 * still loading nothing is decided — bouncing a signed-in reader to /login for
 * the length of one fetch is worse than a moment's "Loading…".
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <p className="muted">Loading…</p>;
  if (user === null) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
