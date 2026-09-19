'use client';

import type { ReactNode } from 'react';
import { useCurrentUser } from '@/lib/auth/useCurrentUser';
import { logAuthDeny } from '@/lib/auth/audit';
import type { AppRole, AppSessionUser } from '@/types/auth';

interface RoleGateProps {
  allowed: readonly AppRole[];
  children: ReactNode;
  fallback?: ReactNode;
  onDeny?: () => void;
  auditAction?:
    | 'ui_component_denied'
    | 'operation_denied'
    | 'button_hidden'
    | 'card_removed'
    | 'route_blocked'
    | 'data_scope_filtered';
  auditResource?: string;
}

export function RoleGate({
  allowed,
  children,
  fallback = null,
  onDeny,
  auditAction = 'ui_component_denied',
  auditResource = 'unknown',
}: RoleGateProps) {
  const { user, role, isLoading } = useCurrentUser() as {
    user: AppSessionUser | null;
    role: AppRole;
    isLoading: boolean;
  };
  // 加载中保守：不渲染 children，避免瞬时泄露
  if (isLoading) {
    return <>{fallback}</>;
  }
  if (allowed.includes(role)) {
    return <>{children}</>;
  }
  if (onDeny) {
    try {
      onDeny();
    } catch {
      /* ignore */
    }
  }
  logAuthDeny({
    action: auditAction,
    resource: auditResource,
    reason: `role_not_in_allowed_list:${role}`,
    userId: user?.id,
    role,
  });
  return <>{fallback}</>;
}
