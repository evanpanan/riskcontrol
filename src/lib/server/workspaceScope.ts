/**
 * 服务端工作区归属隔离（RBAC 数据范围）。
 *
 * 背景：WorkspaceRecord 以 (kind, key) 承载整批账本，客户归属信息藏在
 * payload.batch.clients[].bdManager，数据库层没有独立归属列。因此归属判定必须在
 * 服务端解析 payload，并且与客户端 src/lib/authz/dataScope.ts 保持同一口径：
 *   client.bdManager === session.bdManagerFullName
 *
 * 规则：
 * - 读（GET）：商务经理只能拿到「至少含一位自己客户」的批次账本；他人客户行在返回前
 *   被脱敏为占位行；他人批次、他人客户状态、他人补丁一律不下发。
 * - 写（PUT）：商务经理写入账本时，批次级字段、财务账本、他人客户行一律以服务端为准，
 *   仅可提交自有客户条目的变更；客户归属不可被改写。防止绕过界面直接篡改他人余额 / 归属。
 */

import { APP_ROLES, type AppSessionUser } from '@/types/auth';

export const REDACTED_CLIENT_NAME = '— 其他商务经理 客户（已脱敏）—';
export const REDACTED_BD_LABEL = '（已隐藏）';

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

export interface LedgerShape {
  root: Json;
  batch: Json;
  clients: Json[];
}

/** 解析账本 payload；结构不符返回 null。 */
export function readLedgerShape(payload: unknown): LedgerShape | null {
  const root = asRecord(payload);
  if (!root) return null;
  const batch = asRecord(root.batch);
  if (!batch) return null;
  const clients = Array.isArray(batch.clients)
    ? batch.clients.map((c) => asRecord(c)).filter((c): c is Json => c !== null)
    : [];
  return { root, batch, clients };
}

export function clientIdOf(c: Json): string | null {
  return typeof c.id === 'string' ? c.id : null;
}

export function clientBdOf(c: Json): string | null {
  return typeof c.bdManager === 'string' ? c.bdManager : null;
}

export function isBdManager(user: AppSessionUser | null | undefined): boolean {
  return !!user && user.role === APP_ROLES.BD_MANAGER;
}

/** 批次账本是否归属于该商务经理（至少一位自有客户）。 */
export function ledgerOwnsBd(payload: unknown, bdName: string | null | undefined): boolean {
  if (!bdName) return false;
  const shape = readLedgerShape(payload);
  if (!shape) return false;
  return shape.clients.some((c) => clientBdOf(c) === bdName);
}

/** 收集该商务经理可访问的批次 ID 与客户 ID 集合。 */
export function collectOwnedScope(
  ledgers: Array<{ key: string; payload: unknown }>,
  bdName: string | null | undefined
): { batchIds: Set<string>; clientIds: Set<string> } {
  const batchIds = new Set<string>();
  const clientIds = new Set<string>();
  if (!bdName) return { batchIds, clientIds };
  for (const row of ledgers) {
    const shape = readLedgerShape(row.payload);
    if (!shape) continue;
    let owns = false;
    for (const c of shape.clients) {
      if (clientBdOf(c) !== bdName) continue;
      owns = true;
      const id = clientIdOf(c);
      if (id) clientIds.add(id);
    }
    if (owns) batchIds.add(row.key);
  }
  return { batchIds, clientIds };
}

/** 判断给定客户 ID 是否属于该商务经理名下客户。 */
export function ledgersContainOwnedClient(
  ledgers: Array<{ payload: unknown }>,
  clientId: string,
  bdName: string | null | undefined
): boolean {
  if (!bdName || !clientId) return false;
  for (const row of ledgers) {
    const shape = readLedgerShape(row.payload);
    if (!shape) continue;
    if (shape.clients.some((c) => clientIdOf(c) === clientId && clientBdOf(c) === bdName)) return true;
  }
  return false;
}

function redactedClient(c: Json, index: number): Json {
  const id = clientIdOf(c) ?? 'unknown';
  return {
    id: `redacted-${index}-${id}`,
    __placeholder: true,
    __redacted: true,
    name: REDACTED_CLIENT_NAME,
    bdManager: REDACTED_BD_LABEL,
    investmentAmount: null,
    status: 'ACTIVE',
  };
}

/** 是否为读脱敏占位行：只用于展示，写入时一律忽略并以服务端数据为准。 */
export function isRedactionPlaceholder(c: Json): boolean {
  return c.__redacted === true;
}

/**
 * 读脱敏：他人客户行替换为占位行（保留数组长度，避免前端按客户数取值错位）。
 * 指纹表中的他人键一并剔除，避免泄露客户 ID。
 */
export function redactLedgerForBd(payload: unknown, bdName: string): unknown {
  const shape = readLedgerShape(payload);
  if (!shape) return payload;
  const ownIds = new Set<string>();
  const clients = shape.clients.map((c, i) => {
    if (clientBdOf(c) === bdName) {
      const id = clientIdOf(c);
      if (id) ownIds.add(id);
      return c;
    }
    return redactedClient(c, i);
  });
  const fingerprints = asRecord(shape.root.clientFingerprints);
  const nextRoot: Json = { ...shape.root, batch: { ...shape.batch, clients } };
  if (fingerprints) {
    const kept: Json = {};
    for (const [id, value] of Object.entries(fingerprints)) {
      if (ownIds.has(id)) kept[id] = value;
    }
    nextRoot.clientFingerprints = kept;
  }
  return nextRoot;
}

export interface ScopeMergeResult {
  ok: boolean;
  payload?: unknown;
  error?: string;
}

/**
 * 写合并：商务经理仅可提交自有客户条目的变更。
 * 批次级字段、财务账本、他人客户行、指纹一律以服务端为准。
 */
export function mergeLedgerWriteForBd(
  serverPayload: unknown,
  incomingPayload: unknown,
  bdName: string | null | undefined
): ScopeMergeResult {
  const server = readLedgerShape(serverPayload);
  if (!server) return { ok: false, error: '服务端账本数据格式异常，已拒绝写入' };
  if (!bdName) return { ok: false, error: '当前账号未绑定商务经理身份，无法写入账本' };
  const incoming = readLedgerShape(incomingPayload);
  if (!incoming) return { ok: false, error: '账本数据格式无效' };

  const ownServerIds = new Set<string>();
  for (const c of server.clients) {
    const id = clientIdOf(c);
    if (id && clientBdOf(c) === bdName) ownServerIds.add(id);
  }
  if (ownServerIds.size === 0) return { ok: false, error: '仅可修改本人名下客户所属的批次' };

  const serverIds = new Set<string>();
  for (const c of server.clients) {
    const id = clientIdOf(c);
    if (id) serverIds.add(id);
  }
  const incomingById = new Map<string, Json>();
  for (const c of incoming.clients) {
    const id = clientIdOf(c);
    if (!id) continue;
    // 读脱敏占位行只用于展示，不参与写入；真实数据一律以服务端为准。
    if (isRedactionPlaceholder(c)) continue;
    // 商务经理无创建客户权限：只接受服务端已存在的客户，杜绝注入他人客户行
    if (!serverIds.has(id)) return { ok: false, error: '不可新增客户或改写他人客户' };
    incomingById.set(id, c);
  }

  const mergedClients = server.clients.map((sc) => {
    const id = clientIdOf(sc);
    if (!id || !ownServerIds.has(id)) return sc; // 他人客户：以服务端为准
    const inc = incomingById.get(id);
    if (!inc || isRedactionPlaceholder(inc)) return sc; // 缺失即视为未变更（不可删除客户）
    const bd = clientBdOf(inc);
    return bd === bdName ? inc : { ...inc, bdManager: bdName }; // 客户归属不可被改写
  });

  const serverFinance = asRecord(server.batch.finance);
  const incomingFinance = asRecord(incoming.batch.finance);
  const batch: Json = { ...server.batch, clients: mergedClients };
  if (serverFinance) {
    batch.finance = {
      ...serverFinance,
      // 仅接受前端推进的账本版本号，保证客户端乐观锁自检一致；其余财务字段以服务端为准。
      revision:
        incomingFinance && typeof incomingFinance.revision === 'number'
          ? incomingFinance.revision
          : serverFinance.revision,
    };
  }
  return { ok: true, payload: { ...server.root, batch } };
}
