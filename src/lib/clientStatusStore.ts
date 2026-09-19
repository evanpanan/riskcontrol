import { ClientStatus } from "@prisma/client";

const STORE_KEY = "risk_control_client_status_v1";

export interface ClientStatusRecord {
  status: ClientStatus;
  settledAt?: string;
  updatedAt: string;
}

type StoreShape = Record<string, ClientStatusRecord>;

function getStore(): StoreShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoreShape) : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function getClientStatus(clientId: string): ClientStatusRecord | undefined {
  return getStore()[clientId];
}

export function setClientStatus(clientId: string, status: ClientStatus) {
  const store = getStore();
  const prev = store[clientId];
  store[clientId] = {
    status,
    settledAt: status === ClientStatus.SETTLED ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  };
  if (prev) {
    Object.assign(store[clientId], {
      status,
      settledAt: status === ClientStatus.SETTLED ? new Date().toISOString() : undefined,
    });
  }
  writeStore(store);
}

export function mergeClientStatusOnClient<T extends { id: string; status?: ClientStatus; settledAt?: Date | null }>(
  client: T
): T {
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
    const record = store[c.id];
    if (!record) return c;
    return {
      ...c,
      status: record.status,
      settledAt: record.settledAt ? new Date(record.settledAt) : null,
    } as T;
  });
}
