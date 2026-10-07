import type { AppRole, AppSessionUser } from '@/types/auth';

const AUDIT_LS_KEY = 'risk_control_audit_v1';
const AUDIT_PENDING_LS_KEY = 'risk_control_audit_pending_v1';
const MAX_ENTRIES = 2000;
const MAX_PENDING = 50;
const PENDING_FLUSH_THROTTLE_MS = 10 * 1000;

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

let lastPendingFlushAt = 0;

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

function getPending(): AuditLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AUDIT_PENDING_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as AuditLogEntry[]) : [];
  } catch {
    return [];
  }
}

function setPending(list: AuditLogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = Array.isArray(list) ? list.slice(0, MAX_PENDING) : [];
    window.localStorage.setItem(AUDIT_PENDING_LS_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

function pushPending(entry: AuditLogEntry): void {
  const list = getPending();
  list.unshift(entry);
  setPending(list);
}

async function postAuditSingle(entry: AuditLogEntry): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  try {
    const body = JSON.stringify({
      id: entry.id,
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      role: entry.role ?? null,
      resource: entry.resource ?? null,
      detail: entry.detail ?? null,
      createdAt: entry.createdAt,
    });
    const res = await fetch('/api/audit', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
      body,
    });
    if (!res.ok) return false;
    return true;
  } catch {
    return false;
  }
}

function flushPending(force = false): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (!force && now - lastPendingFlushAt < PENDING_FLUSH_THROTTLE_MS) return;
  const list = getPending();
  if (list.length === 0) {
    lastPendingFlushAt = now;
    return;
  }
  lastPendingFlushAt = now;
  // 最多刷 MAX_PENDING 条，逐个发，成功移除
  const work = list.slice(0, MAX_PENDING);
  void (async () => {
    const failed: AuditLogEntry[] = [];
    for (const e of work) {
      try {
        const ok = await postAuditSingle(e);
        if (!ok) failed.push(e);
      } catch {
        failed.push(e);
      }
    }
    const rest = list.slice(work.length);
    setPending([...failed, ...rest]);
  })();
}

function submitServer(entry: AuditLogEntry): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  void (async () => {
    try {
      const ok = await postAuditSingle(entry);
      if (!ok) pushPending(entry);
    } catch {
      pushPending(entry);
    }
  })();
  void flushPending(false);
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
    // 服务端双写：不阻塞 localStorage 主流程，失败写入 pending 缓冲
    submitServer(entry);

    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development' && (window.location.hostname === 'localhost' || /^127\.0\.0\.1$|:300[0-9]$/.test(window.location.host))) {
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
    | 'card_removed'
    | 'login_denied';
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

// 页面加载时尝试 flush 一次 pending（跨刷新补写）
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', () => {
    if (typeof setTimeout === 'function') {
      setTimeout(() => flushPending(true), 2000);
    }
  });
  // 空闲时也 flush（浏览器提供）
  if (typeof (window as any).requestIdleCallback === 'function') {
    try {
      (window as any).requestIdleCallback(() => flushPending(false), { timeout: 3000 });
    } catch {}
  }
}
