'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  APP_ROLES,
  type AppRole,
  type AppSessionUser,
  type MockUserKey,
  MOCK_USER_META,
  isAllowedRole,
} from '@/types/auth';
import {
  clearSession,
  createDefaultRiskManagerSession,
  createMockSessionByKey,
} from './providers/mockProvider';
import { logAuthDeny, logAudit } from './audit';

export const SESSION_UPDATED_EVENT = 'rbac:session-updated';

const SERVER_ME_CACHE_KEY = '__rc_me_cache_v1';

interface AuthContextValue {
  user: AppSessionUser | null;
  role: AppRole;
  isLoading: boolean;
  switchToMockRole: (key: MockUserKey) => Promise<void>;
  forceLogout: () => void;
  logoutToLogin: () => void;
  loginAsCustom: (user: AppSessionUser) => void;
  // NOTE: serverLogin(AppSessionUser) was historically used for role-switcher and
  // custom-local accounts.  Real, credentialed login must go through
  // serverLoginCredentials(identifier, password).
  serverLogin: (user: AppSessionUser) => Promise<boolean>;
  serverLoginCredentials: (identifier: string, password: string) => Promise<AppSessionUser | null>;
  serverLogout: () => Promise<boolean>;
  refreshMe: () => Promise<AppSessionUser | null>;
  updateCurrentUser: (patch: Partial<AppSessionUser>) => void;
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: readonly AppRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveInitial(): AppSessionUser | null {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/login')) {
    return null;
  }
  if (process.env.NODE_ENV !== 'development') return null;
  const def = createDefaultRiskManagerSession();
  return def;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppSessionUser | null>(() => resolveInitial());
  const [isLoading, setIsLoading] = useState(true);
  const refreshingRef = useRef(false);
  const firstHydrateDoneRef = useRef(false);

  const setSession = useCallback((next: AppSessionUser | null) => {
    setUser((prev) => {
      if (!next && !prev) return prev;
      if (next && prev && JSON.stringify(next) === JSON.stringify(prev)) return prev;
      // only dispatch event for NON-null transitions to avoid setSession(null) → refreshMe() 401 → setSession(null) infinite recursion
      if (next) {
        try {
          window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: next }));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  const refreshMe = useCallback(async (): Promise<AppSessionUser | null> => {
    if (refreshingRef.current) return null;
    refreshingRef.current = true;
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
      });
      if (!res.ok) {
        try { sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch {}
        // Don't setSession(null) here to avoid self-recursion via SESSION_UPDATED.
        // Simply clear server cache; caller (logout / loginFail) will set null explicitly.
        setUser((prev) => (prev ? null : prev));
        return null;
      }
      const data = await res.json() as any;
      if (data?.ok && data?.user && typeof data.user === 'object' && isAllowedRole(data.user.role)) {
        const u = data.user as AppSessionUser;
        try { sessionStorage.setItem(SERVER_ME_CACHE_KEY, JSON.stringify(u)); } catch {}
        setSession(u);
        return u;
      }
      try { sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch {}
      setUser((prev) => (prev ? null : prev));
      return null;
    } catch {
      let cached: AppSessionUser | null = null;
      try {
        const raw = sessionStorage.getItem(SERVER_ME_CACHE_KEY);
        if (raw) {
          const p = JSON.parse(raw) as AppSessionUser;
          if (isAllowedRole(p.role)) cached = p;
        }
      } catch { cached = null; }
      if (cached) {
        setSession(cached);
      } else {
        setUser((prev) => (prev ? null : prev));
      }
      return cached;
    } finally {
      refreshingRef.current = false;
    }
  }, [setSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshMe();
      if (cancelled) return;
      firstHydrateDoneRef.current = true;
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (evt: Event) => {
      const ce = evt as CustomEvent;
      // Skip SESSION_UPDATED dispatch for nulls (which we blocked above anyway) and only refresh for a new user that's non-null
      if (!ce?.detail) return;
      // Avoid re-entrant: if we just setSession(u) and dispatched from the SAME tab, do nothing.
      // Only apply state change if the new user differs (cross-tab sync signal).
      // DO NOT call refreshMe() here → that causes infinite recursion.
      setUser((prev) => {
        const next = ce.detail as AppSessionUser;
        if (!prev) return next;
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        try { sessionStorage.setItem(SERVER_ME_CACHE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    };
    window.addEventListener(SESSION_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, handler);
    };
  }, []);

  const serverLoginCredentials = useCallback(async (identifier: string, password: string): Promise<AppSessionUser | null> => {
    if (!identifier || !password) return null;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        try { sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch {}
        setUser((prev) => (prev ? null : prev));
        return null;
      }
      const data = await res.json() as { ok?: boolean; user?: AppSessionUser };
      if (!data?.ok || !data?.user) {
        try { sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch {}
        setUser((prev) => (prev ? null : prev));
        return null;
      }
      const fetched: AppSessionUser = {
        id: data.user.id,
        email: data.user.email,
        role: isAllowedRole(data.user.role) ? data.user.role : APP_ROLES.RISK_MANAGER,
        displayName: data.user.displayName,
        avatarInitials: data.user.avatarInitials,
        avatarDataUrl: data.user.avatarDataUrl,
        bdManagerFullName: data.user.bdManagerFullName,
      };
      try { sessionStorage.setItem(SERVER_ME_CACHE_KEY, JSON.stringify(fetched)); } catch {}
      setSession(fetched);
      return fetched;
    } catch {
      try { sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch {}
      setUser((prev) => (prev ? null : prev));
      return null;
    }
  }, [setSession]);

  // Legacy shim: serverLogin(user) was used by client-side role switcher and custom user
  // paths.  Credentialed (real) login must use serverLoginCredentials.
  const serverLogin = useCallback(async (nextUser: AppSessionUser): Promise<boolean> => {
    if (!nextUser || !nextUser.id || !nextUser.email || !isAllowedRole(nextUser.role)) return false;
    try { sessionStorage.setItem(SERVER_ME_CACHE_KEY, JSON.stringify(nextUser)); } catch {}
    setSession(nextUser);
    return true;
  }, [setSession]);

  const serverLogout = useCallback(async (): Promise<boolean> => {
    try { sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch {}
    clearSession();
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      /* ignore */
    }
    setUser(null);
    return true;
  }, []);

  const switchToMockRole = useCallback(async (key: MockUserKey) => {
    const next = createMockSessionByKey(key);
    const ok = await serverLogin(next);
    if (!ok) setSession(next);
  }, [serverLogin, setSession]);

  const forceLogout = useCallback(() => {
    logAudit({
      action: "logout",
      actorId: user?.id ?? undefined,
      actorEmail: user?.email ?? undefined,
      role: user?.role ?? undefined,
      resource: "auth:logout",
      detail: { source: "forceLogout_dev_mode", replacedWith: "RISK_MANAGER" },
    });
    logAuthDeny({
      action: 'operation_denied',
      resource: 'session',
      reason: 'force_logout_demo_mode_restored_risk_manager',
      userId: user?.id,
      role: user?.role,
    });
    const def = createDefaultRiskManagerSession();
    clearSession();
    if (process.env.NODE_ENV === 'development') {
      void serverLogin(def);
    } else {
      setSession(null);
    }
  }, [user?.id, user?.role, user?.email, serverLogin, setSession]);

  const logoutToLogin = useCallback(() => {
    const snap = user;
    if (snap?.id || snap?.email) {
      logAudit({
        action: "logout",
        actorId: snap?.id ?? undefined,
        actorEmail: snap?.email ?? undefined,
        role: snap?.role ?? undefined,
        resource: "auth:logout",
        detail: { source: "logoutToLogin" },
      });
    }
    clearSession();
    try { sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch {}
    void serverLogout().finally(() => {
      setSession(null);
      const nextUrl = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
      const qs = nextUrl && nextUrl !== '/' && !nextUrl.startsWith('/login')
        ? `?next=${encodeURIComponent(nextUrl)}`
        : '';
      const dest = `/login${qs}`;
      if (typeof window !== 'undefined') {
        try { window.location.replace(dest); } catch { window.location.href = dest; }
      }
    });
  }, [user, serverLogout, setSession]);

  const loginAsCustom = useCallback((nextUser: AppSessionUser) => {
    if (!nextUser || !nextUser.id || !nextUser.email || !isAllowedRole(nextUser.role)) return;
    void serverLogin(nextUser);
  }, [serverLogin]);

  const updateCurrentUser = useCallback((patch: Partial<AppSessionUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next: AppSessionUser = { ...prev, ...patch };
      try { sessionStorage.setItem(SERVER_ME_CACHE_KEY, JSON.stringify(next)); } catch {}
      try {
        window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: next }));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const hasRole = useCallback(
    (r: AppRole) => !!user && user.role === r,
    [user]
  );

  const hasAnyRole = useCallback(
    (rs: readonly AppRole[]) => {
      if (!user) return false;
      return rs.includes(user.role);
    },
    [user]
  );

  const value = useMemo<AuthContextValue>(() => ({
    user,
    role: user?.role ?? APP_ROLES.OPERATIONS,
    isLoading,
    switchToMockRole,
    forceLogout,
    logoutToLogin,
    loginAsCustom,
    serverLogin,
    serverLoginCredentials,
    serverLogout,
    refreshMe,
    updateCurrentUser,
    hasRole,
    hasAnyRole,
  }), [user, isLoading, switchToMockRole, forceLogout, logoutToLogin, loginAsCustom, serverLogin, serverLoginCredentials, serverLogout, refreshMe, updateCurrentUser, hasRole, hasAnyRole]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'development') return;
    (window as any).__RC_DEBUG__ = {
      refreshMe,
      serverLogin,
      serverLoginCredentials,
      serverLogout,
      logoutToLogin,
      switchToMockRole,
      loginAsCustom,
      updateCurrentUser,
    };
  }, [logoutToLogin, switchToMockRole, loginAsCustom, updateCurrentUser, refreshMe, serverLogin, serverLoginCredentials, serverLogout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('[RBAC] useAuthContext must be used inside <AuthProvider />');
  }
  return ctx;
}

export { MOCK_USER_META, type MockUserKey };

