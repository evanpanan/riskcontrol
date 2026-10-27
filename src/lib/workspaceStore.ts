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
/** 服务端判定会话已失效（过期 / 被撤销 / 账号被停用）：通知上层登出。 */
export const WORKSPACE_UNAUTHORIZED_EVENT = 'risk-control:session-invalid';

/**
 * 待落库写入项：payload 与提交元信息（幂等键 / 审计意图）绑定为一个不可变整体。
 * 每次写入独立入队，发送与确认一一对应，绝不被后续写入覆盖或清除。
 */
interface PendingWrite {
  payload: unknown;
  /** 资金操作幂等键；普通（非资金）写入为空，可与相邻普通写入合并。 */
  opId?: string;
  audits?: CommitAuditIntent[];
}

interface Slot {
  kind: WorkspaceKind;
  key: string;
  /** 本地最新视图（供同步读取）。 */
  payload: unknown;
  /** 最近一次被服务端确认的版本号。 */
  serverRevision: number;
  /** 该键正在写入中。 */
  inflight: boolean;
  retries: number;
  /**
   * 待落库写入队列：按序发送，队列项一旦入队即不可变。
   * 资金操作的 opId / 审计意图随该项一起发送与确认，不会因同键的后续写入而丢失。
   */
  queue: PendingWrite[];
}

/** 随资金写入原子提交的审计意图（由调用方在捕获期间收集）。 */
export interface CommitAuditIntent {
  action: string;
  resource?: string;
  detail?: Record<string, unknown>;
}

/** 资金写入的提交元信息：幂等键 + 审计意图。 */
export interface WorkspaceCommitMeta {
  opId: string;
  audits?: CommitAuditIntent[];
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
 * 服务端是否已不可写（未登录 / 会话失效 / 首次同步失败）。
 * 资金类操作必须据此拒绝本地记账，避免出现「本地成功、服务端未保存」的假成功。
 */
export function isWorkspaceWriteBlocked(): boolean {
  return writeBlocked;
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
 * - 资金写入（携带 commit.opId）作为独立不可变队列项入队，幂等键与审计意图随该项一起发送与确认；
 *   与普通写入不同，它绝不与后续写入合并，避免「连续操作丢失后一次提交的元信息」。
 * - 普通写入（无 opId）与相邻的普通写入合并为最后一次，避免高频操作打满请求。
 */
export function upsertWorkspaceRecord(
  kind: WorkspaceKind,
  key: string,
  payload: unknown,
  commit?: WorkspaceCommitMeta
): void {
  const k = slotKey(kind, key);
  let slot = slots.get(k);
  if (!slot) {
    slot = {
      kind,
      key,
      payload,
      serverRevision: 0,
      inflight: false,
      retries: 0,
      queue: [],
    };
    slots.set(k, slot);
  }
  slot.payload = payload;
  if (commit?.opId) {
    slot.queue.push({ payload, opId: commit.opId, audits: commit.audits });
  } else {
    const last = slot.queue[slot.queue.length - 1];
    if (last && !last.opId) last.payload = payload;
    else slot.queue.push({ payload });
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
  if (!slot || slot.inflight || slot.queue.length === 0) return;
  slot.inflight = true;
  // 只消费队首队列项；该队列项不可变，其 opId / 审计意图不会被同键的后续写入改写。
  const item = slot.queue[0];
  const snapshot = item.payload;
  const baseRevision = slot.serverRevision;
  // 重试沿用同一 opId 与审计意图：服务端据此识别重放，且审计与账本写入同事务提交。
  const opId = item.opId;
  const audits = item.audits;
  try {
    const res = await fetch('/api/data/store', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        kind: slot.kind,
        key: slot.key,
        payload: snapshot,
        baseRevision,
        opId: opId ?? undefined,
        audit: audits && audits.length > 0 ? audits : undefined,
      }),
    });
    slot.inflight = false;
    if (res.status === 401) {
      // 保留队列项：会话恢复后按原样重试，幂等键不变，不会重复记账。
      writeBlocked = true;
      dispatch(WORKSPACE_UNAUTHORIZED_EVENT, {});
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
      // 服务端为准：放弃本地未落库的整个队列（后续队列项都基于已过期的服务端版本）。
      slot.queue = [];
      slot.retries = 0;
      workspaceVersion = null;
      dispatch(WORKSPACE_CONFLICT_EVENT, { kind: slot.kind, key: slot.key });
      return;
    }
    if (res.status === 403) {
      // 无权限写入（如商务经理写入他人批次）：重试不会改变结果，直接终止并提示。
      slot.queue = [];
      slot.retries = 0;
      const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
      dispatch(WORKSPACE_ERROR_EVENT, {
        kind: slot.kind,
        key: slot.key,
        message:
          typeof data?.error === 'string' && data.error
            ? data.error
            : '当前账号无权修改该数据',
      });
      return;
    }
    if (!res.ok) {
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
    // 该队列项已被服务端确认（或幂等命中）：出队后继续消费后续写入。
    slot.queue.shift();
    if (slot.queue.length > 0) scheduleFlush(k);
  } catch {
    slot.inflight = false;
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
        inflight: false,
        retries: 0,
        queue: [],
      });
      changed = true;
      continue;
    }
    if (slot.queue.length > 0 || slot.inflight) continue; // 本地有未落库修改，保留本地
    if (slot.serverRevision !== rec.revision) {
      slot.payload = rec.payload;
      slot.serverRevision = rec.revision;
      changed = true;
    }
  }
  if (replaceAll) {
    for (const [k, slot] of slots.entries()) {
      if (seen.has(k)) continue;
      if (slot.queue.length > 0 || slot.inflight) continue;
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
  if (res.status === 401) {
    // 会话已被服务端撤销 / 账号被停用：停止写入并通知上层回登录页。
    writeBlocked = true;
    dispatch(WORKSPACE_UNAUTHORIZED_EVENT, {});
    return null;
  }
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
    // 轮询成功说明服务端已恢复：解除写入封锁，让资金操作重新可用。
    writeBlocked = false;
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
        inflight: false,
        retries: 0,
        queue: [],
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
