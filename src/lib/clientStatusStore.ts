import { ClientStatus } from "@prisma/client";
import { isWorkspaceHydrated, readWorkspaceKind, upsertWorkspaceRecord } from "./workspaceStore";

const STORE_KEY = "risk_control_client_status_v1";

export interface ClientStatusRecord {
  status: ClientStatus;
  settledAt?: string;
  updatedAt: string;
}

type StoreShape = Record<string, ClientStatusRecord>;

/** 本地镜像读取：仅用于未完成工作区同步（如本地校验脚本）或离线兜底。 */
function readLocalStore(): StoreShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoreShape) : {};
  } catch {
    return {};
  }
}

/**
 * 读取客户状态覆盖表。
 * 工作区已就绪时以服务端数据为准（多端共享）；否则回退本地镜像。
 */
function getStore(): StoreShape {
  if (typeof window === "undefined") return {};
  if (isWorkspaceHydrated()) return readWorkspaceKind<ClientStatusRecord>("client_status");
  return readLocalStore();
}

/** 写入本地镜像，保证跨标签页 storage 事件与本地校验脚本仍可读取。 */
function mirrorLocal(record: ClientStatusRecord, clientId: string): void {
  if (typeof window === "undefined") return;
  try {
    const store = readLocalStore();
    store[clientId] = record;
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / SSR */
  }
}

export function getClientStatus(clientId: string): ClientStatusRecord | undefined {
  return getStore()[clientId];
}

export function setClientStatus(clientId: string, status: ClientStatus) {
  const record: ClientStatusRecord = {
    status,
    settledAt: status === ClientStatus.SETTLED ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  };
  if (isWorkspaceHydrated()) {
    upsertWorkspaceRecord("client_status", clientId, record);
  }
  mirrorLocal(record, clientId);
}

export function mergeClientStatusOnClient<T extends { id: string; status?: ClientStatus; settledAt?: Date | null }>(
  client: T
): T {
  if ((client as any).__financeManaged || (client as any).settlement) return client;
  if (typeof window === "undefined") return client;
  const record = getClientStatus(client.id);
  if (!record) return client;
  return {
    ...client,
    status: record.status,
    settledAt: record.settledAt ? new Date(record.settledAt) : null,
  } as T;
}

export function mergeClientStatusesOnClientList<
  T extends { id: string; status?: ClientStatus; settledAt?: Date | null }
>(clients: T[]): T[] {
  if (typeof window === "undefined") return clients;
  const store = getStore();
  if (Object.keys(store).length === 0) return clients;
  return clients.map((c) => {
    if ((c as any).__financeManaged || (c as any).settlement) return c;
    const record = store[c.id];
    if (!record) return c;
    return {
      ...c,
      status: record.status,
      settledAt: record.settledAt ? new Date(record.settledAt) : null,
    } as T;
  });
}
