import type { AppRole, AppSessionUser } from '@/types/auth';

export interface AuditDenyParams {
  action:
    | 'route_blocked'
    | 'ui_component_denied'
    | 'data_scope_filtered'
    | 'operation_denied'
    | 'button_hidden'
    | 'card_removed';
  resource: string;
  reason?: string;
  userId?: string;
  role?: AppRole;
}

export function logAuthDeny(p: AuditDenyParams): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      ts: new Date().toISOString(),
      event: 'auth_denied',
      userId: p.userId || null,
      role: p.role || null,
      action: p.action,
      resource: p.resource,
      reason: p.reason || null,
    };
    // eslint-disable-next-line no-console
    console.log('[RBAC]', JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
