import { prisma } from "@/lib/prisma";
import { calculatePortfolioSummary, type PortfolioSummary } from "@/lib/riskEngine";

type DashboardScope = {
  scopeType: "global" | "bd";
  scopeKey: string;
};

type BatchLedgerPayload = Record<string, unknown> & {
  id?: string;
  status?: string;
  stockSymbol?: string;
  clients?: Array<Record<string, unknown>>;
};

function floorToHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function toBatchLike(payload: unknown): BatchLedgerPayload | null {
  const root = payload as { batch?: unknown } | null;
  if (!root || typeof root !== "object") return null;
  const batch = root.batch;
  if (!batch || typeof batch !== "object") return null;
  return batch as BatchLedgerPayload;
}

function batchHasBdClient(batch: BatchLedgerPayload, bdName: string): boolean {
  const clients = Array.isArray(batch.clients) ? batch.clients : [];
  return clients.some((client) => {
    if (!client || typeof client !== "object") return false;
    const value =
      typeof client.bdManager === "string"
        ? client.bdManager
        : typeof client.bdManagerFullName === "string"
          ? client.bdManagerFullName
          : "";
    return value === bdName;
  });
}

function summaryToSnapshotPayload(summary: PortfolioSummary) {
  const institutionValue = Math.max(
    0,
    summary.totalSubordinate + summary.totalMarginCalls + summary.institutionPnL
  );
  const clientValue = Math.max(0, summary.totalPriority + summary.allClientsPnL);
  return {
    totalValue: Number(summary.currentMarketValueTotal || 0),
    institutionValue,
    clientValue,
    totalYieldPct: Number(summary.totalPnLPercent || 0),
    institutionYieldPct: Number(summary.institutionPnLPercent || 0),
    clientYieldPct: Number(summary.allClientsPnLPercent || 0),
    totalPnL: Number(summary.totalPnL || 0),
    institutionPnL: Number(summary.institutionPnL || 0),
    clientPnL: Number(summary.allClientsPnL || 0),
  };
}

async function loadLedgerBatches(): Promise<BatchLedgerPayload[]> {
  const rows = await prisma.workspaceRecord.findMany({
    where: { kind: "ledger" },
    select: { payload: true },
  });
  return rows
    .map((row) => toBatchLike(row.payload))
    .filter((batch): batch is BatchLedgerPayload => !!batch);
}

async function loadBdScopeNames(): Promise<string[]> {
  const rows = await prisma.appUser.findMany({
    where: {
      role: "BD_MANAGER",
      enabled: true,
      bdManagerFullName: { not: null },
    },
    select: { bdManagerFullName: true },
  });
  return rows
    .map((row) => row.bdManagerFullName?.trim() || "")
    .filter(Boolean);
}

export interface DashboardSnapshotCycleResult {
  scopes: number;
  snapshotsUpserted: number;
  notes: string[];
}

export async function runDashboardSnapshotCycle(
  now: Date = new Date()
): Promise<DashboardSnapshotCycleResult> {
  const [batches, bdNames] = await Promise.all([
    loadLedgerBatches(),
    loadBdScopeNames(),
  ]);

  const result: DashboardSnapshotCycleResult = {
    scopes: 0,
    snapshotsUpserted: 0,
    notes: [],
  };

  if (batches.length === 0) {
    result.notes.push("没有可采样的账本批次。");
    return result;
  }

  const bucketAt = floorToHour(now);
  const scopes: Array<{ scope: DashboardScope; batches: BatchLedgerPayload[] }> = [
    {
      scope: { scopeType: "global", scopeKey: "all" },
      batches,
    },
  ];

  for (const bdName of bdNames) {
    const scopedBatches = batches.filter((batch) => batchHasBdClient(batch, bdName));
    if (scopedBatches.length === 0) continue;
    scopes.push({
      scope: { scopeType: "bd", scopeKey: bdName },
      batches: scopedBatches,
    });
  }

  result.scopes = scopes.length;

  for (const item of scopes) {
    const summary = calculatePortfolioSummary(item.batches as any);
    const payload = summaryToSnapshotPayload(summary);
    await prisma.dashboardSnapshot.upsert({
      where: {
        scopeType_scopeKey_bucketAt: {
          scopeType: item.scope.scopeType,
          scopeKey: item.scope.scopeKey,
          bucketAt,
        },
      },
      create: {
        scopeType: item.scope.scopeType,
        scopeKey: item.scope.scopeKey,
        bucketAt,
        totalValue: payload.totalValue,
        institutionValue: payload.institutionValue,
        clientValue: payload.clientValue,
        totalYieldPct: payload.totalYieldPct,
        institutionYieldPct: payload.institutionYieldPct,
        clientYieldPct: payload.clientYieldPct,
        totalPnL: payload.totalPnL,
        institutionPnL: payload.institutionPnL,
        clientPnL: payload.clientPnL,
      },
      update: {
        totalValue: payload.totalValue,
        institutionValue: payload.institutionValue,
        clientValue: payload.clientValue,
        totalYieldPct: payload.totalYieldPct,
        institutionYieldPct: payload.institutionYieldPct,
        clientYieldPct: payload.clientYieldPct,
        totalPnL: payload.totalPnL,
        institutionPnL: payload.institutionPnL,
        clientPnL: payload.clientPnL,
      },
    });
    result.snapshotsUpserted += 1;
  }

  return result;
}
