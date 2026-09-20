'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  getStoredSession,
  saveSession,
} from './providers/mockProvider';
import { logAuthDeny } from './audit';

export const SESSION_UPDATED_EVENT = 'rbac:session-updated';

interface AuthContextValue {
  user: AppSessionUser | null;
  role: AppRole;
  isLoading: boolean;
  switchToMockRole: (key: MockUserKey) => Promise<void>;
  forceLogout: () => void;
  logoutToLogin: () => void;
  loginAsCustom: (user: AppSessionUser) => void;
  updateCurrentUser: (patch: Partial<AppSessionUser>) => void;
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: readonly AppRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveInitial(): AppSessionUser | null {
  const existing = getStoredSession();
  if (existing) {
    if (isAllowedRole(existing.role)) return existing;
    clearSession();
  }
  // On /login route, allow null session so login page shows
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/login')) {
    return null;
  }
  const def = createDefaultRiskManagerSession();
  saveSession(def);
  return def;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppSessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // SSR/Client Hydrate 一致性：组件挂载后才从 localStorage 恢复 session
  useEffect(() => {
    const existing = getStoredSession();
    if (existing && isAllowedRole(existing.role)) {
      setUser(existing);
    } else {
      clearSession();
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  // 监听其它 tab / 其它组件 dispatch SESSION_UPDATED_EVENT 同步
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      const s = getStoredSession();
      if (s) setUser(s);
      else setUser(null);
    };
    window.addEventListener(SESSION_UPDATED_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const switchToMockRole = useCallback(async (key: MockUserKey) => {
    const next = createMockSessionByKey(key);
    saveSession(next);
    setUser(next);
    try {
      window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: next }));
    } catch (e) {
      /* ignore */
    }
  }, []);

  const forceLogout = useCallback(() => {
    logAuthDeny({
      action: 'operation_denied',
      resource: 'session',
      reason: 'force_logout_demo_mode_restored_risk_manager',
      userId: user?.id,
      role: user?.role,
    });
    const def = createDefaultRiskManagerSession();
    clearSession();
    saveSession(def);
    setUser(def);
  }, [user?.id, user?.role]);

  const logoutToLogin = useCallback(() => {
    clearSession();
    setUser(null);
    try {
      window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: null }));
    } catch (e) {
      /* ignore */
    }
    const nextUrl = typeof window !== 'undefined' ? window.location.pathname : '/';
    const qs = nextUrl && nextUrl !== '/' && !nextUrl.startsWith('/login')
      ? `?next=${encodeURIComponent(nextUrl)}`
      : '';
    const dest = `/login${qs}`;
    if (typeof window !== 'undefined') {
      try { window.location.replace(dest); } catch { window.location.href = dest; }
    }
  }, []);

  const loginAsCustom = useCallback((nextUser: AppSessionUser) => {
    if (!nextUser || !nextUser.id || !nextUser.email || !isAllowedRole(nextUser.role)) return;
    saveSession(nextUser);
    setUser(nextUser);
    try {
      window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: nextUser }));
    } catch (e) {
      /* ignore */
    }
  }, []);

  const updateCurrentUser = useCallback((patch: Partial<AppSessionUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next: AppSessionUser = { ...prev, ...patch };
      saveSession(next);
      try {
        window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT, { detail: next }));
      } catch (e) {
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
    updateCurrentUser,
    hasRole,
    hasAnyRole,
  }), [user, isLoading, switchToMockRole, forceLogout, logoutToLogin, loginAsCustom, updateCurrentUser, hasRole, hasAnyRole]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__RC_DEBUG__ = {
      getSession: () => getStoredSession(),
      clearSession,
      logoutToLogin,
      switchToMockRole,
      loginAsCustom,
      updateCurrentUser,
    };
  }, [logoutToLogin, switchToMockRole, loginAsCustom, updateCurrentUser]);

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
