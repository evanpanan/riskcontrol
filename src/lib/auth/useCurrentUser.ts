'use client';

import { useAuthContext } from './authProvider';
import { APP_ROLES, type AppRole, type AppSessionUser } from '@/types/auth';

export function useCurrentUser() {
  const ctx = useAuthContext();
  return {
    ...ctx,
    user: ctx.user as AppSessionUser,
    role: ctx.role as AppRole,
    isLoading: ctx.isLoading,
    switchToMockRole: ctx.switchToMockRole,
    forceLogout: ctx.forceLogout,
    logoutToLogin: ctx.logoutToLogin,
    loginAsCustom: ctx.loginAsCustom,
    updateCurrentUser: ctx.updateCurrentUser,
    hasRole: ctx.hasRole,
    hasAnyRole: ctx.hasAnyRole,
    isRiskManager: ctx.role === APP_ROLES.RISK_MANAGER,
    isBdManager: ctx.role === APP_ROLES.BD_MANAGER,
    bdManagerFullName: ctx.user?.bdManagerFullName,
  };
}
