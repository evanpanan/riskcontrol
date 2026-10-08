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

// Safe storage helpers: typeof window guards + robust JSON.  These are the single point
// of contact with browser storage APIs so callers never see SSR errors and broken / empty
// JSON NEVER throws "Unexpected end of input".
const cache = {
  get(): AppSessionUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(SERVER_ME_CACHE_KEY);
      if (!raw || typeof raw !== 'string' || raw.length === 0) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && isAllowedRole(parsed.role)) {
        return parsed as AppSessionUser;
      }
    } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch { /* ignore */ }
    return null;
  },
  set(user: AppSessionUser | null): void {
    if (typeof window === 'undefined') return;
    try {
      if (!user) window.sessionStorage.removeItem(SERVER_ME_CACHE_KEY);
      else window.sessionStorage.setItem(SERVER_ME_CACHE_KEY, JSON.stringify(user));
    } catch { /* ignore */ }
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    try { window.sessionStorage.removeItem(SERVER_ME_CACHE_KEY); } catch { /* ignore */ }
  },
};

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
      if (!next) {
        if (!prev) return prev;
        cache.clear();
        return null;
      }
      const sameId = !!prev && next.id === prev.id;
      const base = sameId ? prev : null;
      const sanitizedRaw: Partial<AppSessionUser> & { id: string; email: string; role: AppRole } = {
        id: next.id,
        email: next.email,
        role: next.role,
      };
      if (next.displayName !== undefined) sanitizedRaw.displayName = next.displayName;
      else if (base && base.displayName) sanitizedRaw.displayName = base.displayName;
      if (next.avatarInitials !== undefined) sanitizedRaw.avatarInitials = next.avatarInitials;
      else if (base && base.avatarInitials) sanitizedRaw.avatarInitials = base.avatarInitials;
      if (next.avatarDataUrl !== undefined) sanitizedRaw.avatarDataUrl = next.avatarDataUrl;
      else if (base && base.avatarDataUrl) sanitizedRaw.avatarDataUrl = base.avatarDataUrl;
      if (next.bdManagerFullName !== undefined) sanitizedRaw.bdManagerFullName = next.bdManagerFullName;
      else if (base && base.bdManagerFullName) sanitizedRaw.bdManagerFullName = base.bdManagerFullName;
      const sanitized = sanitizedRaw as AppSessionUser;
      if (prev && JSON.stringify(prev) === JSON.stringify(sanitized)) return prev;
      cache.set(sanitized);
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: sanitized }));
        } catch {
          /* ignore */
        }
      }
      return sanitized;
    });
  }, []);

  const refreshMe = useCallback(async (): Promise<AppSessionUser | null> => {
    if (typeof window === 'undefined') return null;
    if (refreshingRef.current) return null;
    refreshingRef.current = true;
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
      });
      if (!res.ok) {
        cache.clear();
        setUser((prev) => (prev ? null : prev));
        return null;
      }
      const data = await res.json() as any;
      if (data?.ok && data?.user && typeof data.user === 'object' && isAllowedRole(data.user.role)) {
        const u = data.user as AppSessionUser;
        cache.set(u);
        setSession(u);
        return u;
      }
      cache.clear();
      setUser((prev) => (prev ? null : prev));
      return null;
    } catch {
      const cached = cache.get();
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
    if (typeof window === 'undefined') return;
    // For auth routes (/login, /signup etc.) NEVER block interaction behind the
    // server-side refreshMe round-trip.  The user must be able to click the
    // login button and get navigation timers scheduled before any HTTP fetch
    // resolves.  Otherwise a slow /api/auth/me + concurrent navigation
    // produces an isLoading deadlock (login → router.replace(/') → AppShell
    // isLoading=true blocks → redirect back to /login → login button dead).
    const isAuthRoute =
      typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/login') ||
        window.location.pathname.startsWith('/signup'));
    let cancelled = false;
    if (isAuthRoute) {
      firstHydrateDoneRef.current = true;
      setIsLoading(false);
      // Still call refreshMe for session cookie recovery (cross-tab login),
      // but do NOT keep isLoading=true while waiting.
      void refreshMe().finally(() => {
        if (cancelled) return;
        firstHydrateDoneRef.current = true;
        setIsLoading(false);
      });
      return () => { cancelled = true; };
    }
    (async () => {
      await refreshMe();
      if (cancelled) return;
      firstHydrateDoneRef.current = true;
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMe]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (evt: Event) => {
      const ce = evt as CustomEvent;
      if (!ce?.detail) return;
      setUser((prev) => {
        const next = ce.detail as AppSessionUser;
        if (!prev) return next;
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        cache.set(next);
        return next;
      });
    };
    window.addEventListener(SESSION_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, handler);
    };
  }, []);

  const serverLoginCredentials = useCallback(async (identifier: string, password: string): Promise<AppSessionUser | null> => {
    if (typeof window === 'undefined') return null;
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
        cache.clear();
        setUser((prev) => (prev ? null : prev));
        return null;
      }
      const data = await res.json() as { ok?: boolean; user?: AppSessionUser };
      if (!data?.ok || !data?.user) {
        cache.clear();
        setUser((prev) => (prev ? null : prev));
        return null;
      }
      const fetched: AppSessionUser = {
        id: data.user.id,
        email: data.user.email,
        role: isAllowedRole(data.user.role) ? data.user.role : APP_ROLES.RISK_MANAGER,
        displayName: data.user.displayName || data.user.email.split('@')[0] || 'User',
        avatarInitials: data.user.avatarInitials || (data.user.displayName || data.user.email || '??').slice(0, 2).toUpperCase(),
        avatarDataUrl: data.user.avatarDataUrl || undefined,
        bdManagerFullName: data.user.bdManagerFullName || undefined,
      };
      cache.set(fetched);
      setSession(fetched);
      return fetched;
    } catch {
      cache.clear();
      setUser((prev) => (prev ? null : prev));
      return null;
    }
  }, [setSession]);

  const serverLogin = useCallback(async (nextUser: AppSessionUser): Promise<boolean> => {
    if (!nextUser || !nextUser.id || !nextUser.email || !isAllowedRole(nextUser.role)) return false;
    cache.set(nextUser);
    setSession(nextUser);
    return true;
  }, [setSession]);

  const serverLogout = useCallback(async (): Promise<boolean> => {
    cache.clear();
    clearSession();
    if (typeof window !== 'undefined') {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        /* ignore */
      }
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
    cache.clear();
    void serverLogout().finally(() => {
      setSession(null);
      let dest = '/login';
      if (typeof window !== 'undefined') {
        const nextUrl = window.location.pathname + window.location.search;
        const qs = nextUrl && nextUrl !== '/' && !nextUrl.startsWith('/login')
          ? `?next=${encodeURIComponent(nextUrl)}`
          : '';
        dest = `/login${qs}`;
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
      cache.set(next);
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: next }));
        } catch {
          /* ignore */
        }
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

