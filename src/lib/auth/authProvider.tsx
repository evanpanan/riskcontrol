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
import { usePathname } from 'next/navigation';
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
import { hydrateWorkspace, startWorkspaceRealtimeSync } from '@/lib/workspaceStore';
import { bootstrapSharedSettings } from '@/lib/settingsStore';

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
  const pathname = usePathname();
  const [user, setUser] = useState<AppSessionUser | null>(() => resolveInitial());
  const [isLoading, setIsLoading] = useState(true);
  const refreshingRef = useRef(false);
  const firstHydrateDoneRef = useRef(false);
  const userRef = useRef<AppSessionUser | null>(null);
  const currentPathRef = useRef<string>('/');
  const lastPageViewRef = useRef<string>('');

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      currentPathRef.current = pathname;
      return;
    }
    currentPathRef.current = `${pathname}${window.location.search || ''}`;
  }, [pathname]);

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
      // 会话就绪后再同步工作区数据（批次/客户/补仓/结算），
      // 保证首屏读取到的就是服务端共享账本，而非空的本地占位。
      try {
        await hydrateWorkspace();
        // 把浏览器中已成型的机构级配置（阈值/收件人/档位/行情源/Logo）带上服务端，
        // 实现老配置无缝迁移；服务端已有该键时不覆盖。
        await bootstrapSharedSettings();
      } catch {
        /* 同步失败时退化为本地运行，不阻塞界面 */
      }
      if (cancelled) return;
      startWorkspaceRealtimeSync();
      firstHydrateDoneRef.current = true;
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMe]);

  // 兜底：若在登录页完成登录后以 SPA 方式进入业务页，补做一次工作区同步。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user) return;
    const path = window.location.pathname;
    if (path.startsWith('/login') || path.startsWith('/signup')) return;
    let cancelled = false;
    (async () => {
      try {
        await hydrateWorkspace();
        await bootstrapSharedSettings();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      startWorkspaceRealtimeSync();
    })();
    return () => { cancelled = true; };
  }, [user]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isLoading || !user?.id) return;
    const fullPath = `${pathname}${window.location.search || ''}`;
    if (!fullPath || lastPageViewRef.current === fullPath) return;
    lastPageViewRef.current = fullPath;
    logAudit({
      action: 'page_view',
      actorId: user.id,
      actorEmail: user.email,
      role: user.role,
      resource: fullPath,
      detail: { source: 'router', title: typeof document !== 'undefined' ? document.title : null },
    });
  }, [isLoading, pathname, user?.email, user?.id, user?.role]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      let parsedUrl: URL | null = null;
      try {
        parsedUrl = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      } catch {
        parsedUrl = null;
      }
      const pathname = parsedUrl?.pathname ?? '';
      const shouldTrackMutation =
        !!userRef.current?.id &&
        method !== 'GET' &&
        method !== 'HEAD' &&
        !!parsedUrl &&
        parsedUrl.origin === window.location.origin &&
        pathname.startsWith('/api/') &&
        pathname !== '/api/audit' &&
        pathname !== '/api/auth/login' &&
        pathname !== '/api/auth/logout';
      try {
        const response = await originalFetch(input as any, init);
        if (shouldTrackMutation) {
          logAudit({
            action: 'api_mutation',
            actorId: userRef.current?.id ?? undefined,
            actorEmail: userRef.current?.email ?? undefined,
            role: userRef.current?.role ?? undefined,
            resource: pathname,
            detail: {
              method,
              status: response.status,
              ok: response.ok,
              fromPath: currentPathRef.current,
            },
          });
        }
        return response;
      } catch (error) {
        if (shouldTrackMutation) {
          logAudit({
            action: 'api_mutation',
            actorId: userRef.current?.id ?? undefined,
            actorEmail: userRef.current?.email ?? undefined,
            role: userRef.current?.role ?? undefined,
            resource: pathname || 'fetch:unknown',
            detail: {
              method,
              status: 'network_error',
              ok: false,
              fromPath: currentPathRef.current,
            },
          });
        }
        throw error;
      }
    }) as typeof window.fetch;
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

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
