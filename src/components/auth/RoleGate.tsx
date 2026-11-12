'use client';

import { useEffect, useRef, type ReactNode } from 'react';
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
  const permitted = allowed.includes(role);
  const lastDenied = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (permitted) { lastDenied.current = null; return; }
    const identity = `${user?.id}:${role}:${auditResource}:${auditAction}`;
    if (lastDenied.current === identity) return;
    lastDenied.current = identity;
    try { onDeny?.(); } catch { /* A consumer callback must not break rendering. */ }
    logAuthDeny({ action: auditAction, resource: auditResource, reason: `role_not_in_allowed_list:${role}`, userId: user?.id, role });
  }, [isLoading, permitted, user?.id, role, auditResource, auditAction, onDeny]);
  if (!isLoading && permitted) return <>{children}</>;
  return <>{fallback}</>;
}
