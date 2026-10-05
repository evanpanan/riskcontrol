import type { AppRole, AppSessionUser } from '@/types/auth';

const AUDIT_LS_KEY = 'risk_control_audit_v1';
const MAX_ENTRIES = 2000;

export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'threshold_update'
  | 'account_create'
  | 'account_delete'
  | 'account_update'
  | 'client_edit'
  | 'client_delete'
  | 'margin_topup'
  | 'client_settle'
  | 'batch_notify'
  | 'auth_denied';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorId?: string | null;
  actorEmail?: string | null;
  role?: AppRole | null;
  resource?: string | null;
  detail?: Record<string, unknown> | null;
  createdAt: string;
}

function uid(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function getCurrentUser(): { id?: string | null; email?: string | null; role?: AppRole | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('rbac_mock_session_v1');
    if (!raw) return null;
    const p = JSON.parse(raw) as any;
    const roleRaw = p?.role;
    const role: AppRole | null = (roleRaw === "ADMIN" || roleRaw === "RISK_MANAGER" || roleRaw === "BD_MANAGER" || roleRaw === "OPERATIONS") ? roleRaw : null;
    return {
      id: p?.id ?? p?.userId ?? null,
      email: p?.email ?? null,
      role,
    };
  } catch {
    return null;
  }
}

export function getAuditLogs(): AuditLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AUDIT_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as AuditLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearAuditLogs(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUDIT_LS_KEY);
  } catch {
    /* ignore */
  }
}

export function logAudit(evt: {
  action: AuditAction;
  actorId?: string;
  actorEmail?: string;
  role?: AppRole;
  resource?: string;
  detail?: Record<string, unknown>;
}): void {
  try {
    const fallback = getCurrentUser();
    const entry: AuditLogEntry = {
      id: uid(),
      action: evt.action,
      actorId: evt.actorId ?? fallback?.id ?? null,
      actorEmail: evt.actorEmail ?? fallback?.email ?? null,
      role: evt.role ?? fallback?.role ?? null,
      resource: evt.resource ?? null,
      detail: evt.detail ?? null,
      createdAt: new Date().toISOString(),
    };
    if (typeof window !== 'undefined') {
      try {
        const existing = getAuditLogs();
        existing.unshift(entry);
        const trimmed = existing.slice(0, MAX_ENTRIES);
        window.localStorage.setItem(AUDIT_LS_KEY, JSON.stringify(trimmed));
        try { window.dispatchEvent(new CustomEvent("risk-control:audit-updated", { detail: { id: entry.id, action: entry.action } })); } catch {}
      } catch (err: any) {
        console.warn('[audit] persist failed', err?.message || err);
      }
    }
    if (typeof window !== 'undefined' && (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost' || /^127\.0\.0\.1$|:300[0-9]$/.test(window.location.host))) {
      console.log('[AUDIT]', JSON.stringify(entry));
    }
  } catch (outerErr: any) {
    try {
      console.warn('[audit] logAudit aborted, no side effects:', outerErr?.message || outerErr);
    } catch {
      /* nothing */
    }
  }
}

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
  logAudit({
    action: 'auth_denied',
    actorId: p.userId,
    role: p.role,
    resource: p.resource,
    detail: { denyAction: p.action, reason: p.reason || null },
  });
}
