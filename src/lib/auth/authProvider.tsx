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
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: readonly AppRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveInitial(): AppSessionUser {
  const existing = getStoredSession();
  if (existing) {
    if (isAllowedRole(existing.role)) return existing;
    clearSession();
  }
  const def = createDefaultRiskManagerSession();
  saveSession(def);
  return def;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppSessionUser | null>(() =>
    typeof window === 'undefined' ? null : resolveInitial()
  );
  const [isLoading, setIsLoading] = useState(typeof window === 'undefined');

  // 监听其它 tab / 其它组件 dispatch SESSION_UPDATED_EVENT 同步
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      const s = getStoredSession();
      if (s) setUser(s);
      else {
        const def = createDefaultRiskManagerSession();
        saveSession(def);
        setUser(def);
      }
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
    role: user?.role ?? APP_ROLES.RISK_MANAGER,
    isLoading,
    switchToMockRole,
    forceLogout,
    hasRole,
    hasAnyRole,
  }), [user, isLoading, switchToMockRole, forceLogout, hasRole, hasAnyRole]);

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
