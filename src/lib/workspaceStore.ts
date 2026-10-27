/**
 * 业务工作区存储：批次/客户/补仓/结算等运行态数据的统一读写入口。
 *
 * 设计要点：
 * - 服务端 PostgreSQL（WorkspaceRecord 表）是唯一事实来源，多端共享同一份数据；
 * - 客户端持有内存缓存，对外仍暴露同步读接口，保证既有页面无需异步改造；
 * - 写入采用「先本地乐观更新 → 异步落库」并带 revision 乐观锁：
 *   服务端版本不一致时以服务端为准回滚，并派发冲突事件由页面重载。
 */

export type WorkspaceKind = 'ledger' | 'patches' | 'client_status' | 'config' | 'meta';

export const WORKSPACE_SYNCED_EVENT = 'risk-control:workspace-synced';
export const WORKSPACE_CONFLICT_EVENT = 'risk-control:workspace-conflict';
export const WORKSPACE_ERROR_EVENT = 'risk-control:workspace-error';

interface Slot {
  kind: WorkspaceKind;
  key: string;
  payload: unknown;
  /** 最近一次被服务端确认的版本号。 */
  serverRevision: number;
  /** 本地有未落库的修改。 */
  dirty: boolean;
  /** 该键正在写入中。 */
  inflight: boolean;
  retries: number;
}

interface RemoteRecord {
  kind: string;
  key: string;
  payload: unknown;
  revision: number;
}

const slotKey = (kind: string, key: string) => `${kind}\u0000${key}`;

const slots = new Map<string, Slot>();
let workspaceVersion: string | null = null;
let hydrated = false;
let hydrating: Promise<boolean> | null = null;
/** 会话不可用（未登录/过期）时停止一切写请求，避免错误风暴。 */
let writeBlocked = false;
let chain: Promise<void> = Promise.resolve();
/** 远端数据变更时通知调用方清空内存缓存。 */
let invalidator: (() => void) | null = null;
/** 多端轮询同步只启动一次。 */
let realtimeSyncStarted = false;

const isBrowser = () => typeof window !== 'undefined';

function dispatch(name: string, detail?: unknown): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* ignore */
  }
}

export function isWorkspaceHydrated(): boolean {
  return hydrated;
}

/**
 * 注册「远端数据变更」回调：用于清空调用方（如 mockData）的内存缓存，
 * 使页面下一次读取时重新从工作区缓存组装数据。
 */
export function registerWorkspaceInvalidator(fn: () => void): void {
  invalidator = fn;
}

/** 远端数据生效后广播业务事件，复用页面既有监听逻辑。 */
function announceRemoteChange(changed: boolean): void {
  if (!changed) return;
  try {
    invalidator?.();
  } catch {
    /* ignore */
  }
  dispatch(WORKSPACE_SYNCED_EVENT, {});
  dispatch('risk-control:finance-changed', {});
  dispatch('risk-control:client-status-changed', {});
}

export function getWorkspaceVersion(): string | null {
  return workspaceVersion;
}

/** 同步读取单条记录；未命中返回 null。 */
export function readWorkspaceRecord<T = unknown>(
  kind: WorkspaceKind,
  key: string
): { payload: T; revision: number } | null {
  const slot = slots.get(slotKey(kind, key));
  if (!slot) return null;
  return { payload: slot.payload as T, revision: slot.serverRevision };
}

/** 同步读取某一类别的全部记录（键 → payload）。 */
export function readWorkspaceKind<T = unknown>(kind: WorkspaceKind): Record<string, T> {
  const out: Record<string, T> = {};
  for (const slot of slots.values()) {
    if (slot.kind !== kind) continue;
    out[slot.key] = slot.payload as T;
  }
  return out;
}

export function hasWorkspaceKind(kind: WorkspaceKind): boolean {
  for (const slot of slots.values()) if (slot.kind === kind) return true;
  return false;
}

/**
 * 乐观写入：本地立即生效，随后异步落库。
 * 同一键的连续写入会合并为最后一次，避免高频操作打满请求。
 */
export function upsertWorkspaceRecord(kind: WorkspaceKind, key: string, payload: unknown): void {
  const k = slotKey(kind, key);
  const existing = slots.get(k);
  if (existing) {
    existing.payload = payload;
    existing.dirty = true;
  } else {
    slots.set(k, { kind, key, payload, serverRevision: 0, dirty: true, inflight: false, retries: 0 });
  }
  scheduleFlush(k);
}

/** 删除本地记录并异步落库为「空」不适用；此处仅用于本地清理（服务端删除走 clear 接口）。 */
export function deleteWorkspaceRecords(kind: WorkspaceKind): void {
  for (const [k, slot] of slots.entries()) {
    if (slot.kind === kind) slots.delete(k);
  }
}

function scheduleFlush(k: string): void {
  if (!isBrowser() || writeBlocked) return;
  chain = chain.then(() => flushSlot(k)).catch(() => { /* 单个键失败不影响后续 */ });
}

async function flushSlot(k: string): Promise<void> {
  const slot = slots.get(k);
  if (!slot || slot.inflight || !slot.dirty) return;
  slot.inflight = true;
  slot.dirty = false;
  const snapshot = slot.payload;
  const baseRevision = slot.serverRevision;
  try {
    const res = await fetch('/api/data/store', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ kind: slot.kind, key: slot.key, payload: snapshot, baseRevision }),
    });
    slot.inflight = false;
    if (res.status === 401) {
      writeBlocked = true;
      slot.dirty = true;
      return;
    }
    if (res.status === 409) {
      const data = (await res.json().catch(() => null)) as
        | { current?: { payload?: unknown; revision?: number } }
        | null;
      const current = data?.current;
      if (current) {
        slot.payload = current.payload;
        slot.serverRevision = typeof current.revision === 'number' ? current.revision : slot.serverRevision;
      }
      slot.dirty = false;
      slot.retries = 0;
      workspaceVersion = null;
      dispatch(WORKSPACE_CONFLICT_EVENT, { kind: slot.kind, key: slot.key });
      return;
    }
    if (!res.ok) {
      slot.dirty = true;
      slot.retries += 1;
      if (slot.retries > 3) {
        slot.retries = 0;
        dispatch(WORKSPACE_ERROR_EVENT, { kind: slot.kind, key: slot.key, message: '数据保存失败，请刷新页面重试' });
      } else {
        await new Promise((r) => setTimeout(r, 400 * slot.retries));
        scheduleFlush(k);
      }
      return;
    }
    const data = (await res.json().catch(() => null)) as { revision?: number; version?: string } | null;
    if (typeof data?.revision === 'number') slot.serverRevision = data.revision;
    if (typeof data?.version === 'string') workspaceVersion = data.version;
    slot.retries = 0;
    if (slot.dirty) scheduleFlush(k);
  } catch {
    slot.inflight = false;
    slot.dirty = true;
    slot.retries += 1;
    if (slot.retries > 3) {
      slot.retries = 0;
      dispatch(WORKSPACE_ERROR_EVENT, { kind: slot.kind, key: slot.key, message: '网络异常，数据尚未保存' });
    } else {
      await new Promise((r) => setTimeout(r, 400 * slot.retries));
      scheduleFlush(k);
    }
  }
}

/** 等待当前所有待落库写入完成（用于关键操作后的收尾）。 */
export async function flushWorkspaceWrites(): Promise<void> {
  await chain;
}

function applyRemoteRecords(records: RemoteRecord[], replaceAll: boolean): boolean {
  const seen = new Set<string>();
  let changed = false;
  for (const rec of records) {
    const k = slotKey(rec.kind, rec.key);
    seen.add(k);
    const slot = slots.get(k);
    if (!slot) {
      slots.set(k, {
        kind: rec.kind as WorkspaceKind,
        key: rec.key,
        payload: rec.payload,
        serverRevision: rec.revision,
        dirty: false,
        inflight: false,
        retries: 0,
      });
      changed = true;
      continue;
    }
    if (slot.dirty || slot.inflight) continue; // 本地有未落库修改，保留本地
    if (slot.serverRevision !== rec.revision) {
      slot.payload = rec.payload;
      slot.serverRevision = rec.revision;
      changed = true;
    }
  }
  if (replaceAll) {
    for (const [k, slot] of slots.entries()) {
      if (seen.has(k)) continue;
      if (slot.dirty || slot.inflight) continue;
      slots.delete(k);
      changed = true;
    }
  }
  return changed;
}

interface StoreResponse {
  ok?: boolean;
  unchanged?: boolean;
  version?: string;
  records?: RemoteRecord[];
}

async function fetchStore(version?: string | null): Promise<StoreResponse | null> {
  const qs = version ? `?version=${encodeURIComponent(version)}` : '';
  const res = await fetch(`/api/data/store${qs}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
  });
  if (!res.ok) return null;
  return (await res.json()) as StoreResponse;
}

/** 从服务端全量拉取并重建本地缓存；本地未落库的修改予以保留。 */
export async function pullWorkspace(): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    const data = await fetchStore(null);
    if (!data?.ok || !Array.isArray(data.records)) return false;
    const changed = applyRemoteRecords(data.records, true);
    workspaceVersion = data.version ?? null;
    return changed;
  } catch {
    return false;
  }
}

/**
 * 启动时全量拉取工作区数据；幂等，多次调用复用同一 Promise。
 * 返回是否已就绪（即使服务端不可用也会标记为已就绪，退化为纯本地运行）。
 */
export async function hydrateWorkspace(): Promise<boolean> {
  if (hydrated) return true;
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const data = await fetchStore(null);
      if (data?.ok && Array.isArray(data.records)) {
        applyRemoteRecords(data.records, true);
        workspaceVersion = data.version ?? null;
      } else {
        writeBlocked = true;
      }
    } catch {
      writeBlocked = true;
    }
    hydrated = true;
    hydrating = null;
    return true;
  })();
  return hydrating;
}

/** 版本号未变化时直接跳过，减少多端轮询的数据传输。 */
export async function refreshWorkspaceIfChanged(): Promise<boolean> {
  if (!isBrowser() || hydrated === false) return false;
  try {
    const data = await fetchStore(workspaceVersion);
    if (!data?.ok) return false;
    if (data.unchanged) return false;
    if (!Array.isArray(data.records)) return false;
    const changed = applyRemoteRecords(data.records, true);
    workspaceVersion = data.version ?? null;
    announceRemoteChange(changed);
    return changed;
  } catch {
    return false;
  }
}

/**
 * 启动多端增量同步：定时带版本号轮询服务端，仅在他人修改后拉取并广播变更，
 * 使不同浏览器/设备之间的批次、客户与补仓数据保持一致。
 */
export function startWorkspaceRealtimeSync(intervalMs = 5000): void {
  if (!isBrowser() || realtimeSyncStarted) return;
  realtimeSyncStarted = true;
  const tick = () => {
    void refreshWorkspaceIfChanged();
  };
  setInterval(tick, intervalMs);
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', tick);
}

export async function bootstrapWorkspace(
  records: Array<{ kind: WorkspaceKind; key: string; payload: unknown }>
): Promise<void> {
  if (!isBrowser() || writeBlocked || records.length === 0) return;
  // 先本地占位，保证随后的同步读取可立即拿到数据。
  for (const rec of records) {
    const k = slotKey(rec.kind, rec.key);
    if (!slots.has(k)) {
      slots.set(k, {
        kind: rec.kind,
        key: rec.key,
        payload: rec.payload,
        serverRevision: 1,
        dirty: false,
        inflight: false,
        retries: 0,
      });
    }
  }
  try {
    await fetch('/api/data/store/bootstrap', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ records }),
    });
    workspaceVersion = null;
    await pullWorkspace();
  } catch {
    /* 初始化失败时保持本地可用，下次加载重试 */
  }
}

/** 清空服务端业务数据并同步本地缓存。 */
export async function clearWorkspace(
  kinds?: WorkspaceKind[],
  options?: { markEmpty?: boolean }
): Promise<boolean> {
  if (!isBrowser()) return false;
  const body: { kinds?: WorkspaceKind[]; markEmpty?: boolean } = {};
  if (kinds) body.kinds = kinds;
  if (options && typeof options.markEmpty === 'boolean') body.markEmpty = options.markEmpty;
  try {
    const res = await fetch('/api/data/store/clear', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    slots.clear();
    workspaceVersion = null;
    await pullWorkspace();
    return true;
  } catch {
    return false;
  }
}
