import { backfillBatchHistory } from '@/lib/server/batchHistoryBackfill';
import { aggregateDailyHistory } from '@/lib/dashboardHistory';
import { replayBatchDay } from '@/lib/batchHistoryReplay';
import { marketDate, type BatchDailySummary } from '@/lib/batchDaily';
import type { BatchLike } from '@/lib/riskEngine';
import { ledgerOwnsBd } from '@/lib/server/workspaceScope';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonNoStore, resolveSessionUser, unauthorized, forbidden } from "@/lib/server/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardTimeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y";

type SnapshotPayload = {
  totalValue: number;
  institutionValue: number;
  clientValue: number;
  totalYieldPct: number;
  institutionYieldPct: number;
  clientYieldPct: number;
  totalPnL?: number;
  institutionPnL?: number;
  clientPnL?: number;
};

type SnapshotPoint = {
  label: string;
  tooltipLabel: string;
  total: number;
  institution: number;
  client: number;
};

type SnapshotRow = {
  bucketAt: Date;
  totalValue: number;
  institutionValue: number;
  clientValue: number;
  totalYieldPct: number;
  institutionYieldPct: number;
  clientYieldPct: number;
};

function resolveDashboardScope(user: Awaited<ReturnType<typeof resolveSessionUser>>) {
  if (!user) return null;
  if (user.role === "BD_MANAGER") {
    const bdName = user.bdManagerFullName?.trim();
    if (!bdName) return null;
    return { scopeType: "bd", scopeKey: bdName };
  }
  return { scopeType: "global", scopeKey: "all" };
}

function floorToHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfUtcWeek(date: Date): Date {
  const d = startOfUtcDay(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function formatPointLabel(tf: DashboardTimeframe, bucketAt: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = bucketAt.getUTCFullYear();
  const m = bucketAt.getUTCMonth() + 1;
  const d = bucketAt.getUTCDate();
  const hh = pad(bucketAt.getUTCHours());
  if (tf === "1D") {
    return {
      label: `${hh}:00`,
      tooltipLabel: `${y}年${m}月${d}日 ${hh}:00`,
    };
  }
  if (tf === "1W" || tf === "1M") {
    return {
      label: `${m}/${d}`,
      tooltipLabel: `${y}年${m}月${d}日`,
    };
  }
  return {
    label: `${String(y).slice(2)}年${m}月`,
    tooltipLabel: `${y}年${m}月${d}日当周`,
  };
}

function collapseRows(
  rows: SnapshotRow[],
  tf: DashboardTimeframe,
): { valuePoints: SnapshotPoint[]; yieldPoints: SnapshotPoint[] } {
  const now = new Date();
  const start =
    tf === "1D" ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
    : tf === "1W" ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    : tf === "1M" ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    : tf === "3M" ? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    : tf === "6M" ? new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
    : new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const filtered = rows.filter((row) => row.bucketAt >= start);
  const grouped = new Map<string, SnapshotRow>();
  for (const row of filtered) {
    const bucketKeyDate =
      tf === "1D" ? floorToHour(row.bucketAt)
      : tf === "1W" || tf === "1M" ? startOfUtcDay(row.bucketAt)
      : startOfUtcWeek(row.bucketAt);
    grouped.set(bucketKeyDate.toISOString(), row);
  }
  const ordered = Array.from(grouped.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, row]) => row);

  const valuePoints = ordered.map((row) => {
    const labels = formatPointLabel(tf, row.bucketAt);
    return {
      ...labels,
      total: Number(row.totalValue),
      institution: Number(row.institutionValue),
      client: Number(row.clientValue),
    };
  });
  const yieldPoints = ordered.map((row) => {
    const labels = formatPointLabel(tf, row.bucketAt);
    return {
      ...labels,
      total: Number(row.totalYieldPct),
      institution: Number(row.institutionYieldPct),
      client: Number(row.clientYieldPct),
    };
  });
  return { valuePoints, yieldPoints };
}

export async function GET() {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  const scope = resolveDashboardScope(user);
  if (!scope) return unauthorized();

  const reset = await prisma.workspaceRecord.findUnique({
    where: { kind_key: { kind: "meta", key: "empty" } },
    select: { payload: true, updatedAt: true },
  });
  const historyStart = Date.now() - 370 * 24 * 60 * 60 * 1000;
  const clearedAt = (reset?.payload as { empty?: boolean } | undefined)?.empty === true
    ? reset!.updatedAt.getTime()
    : 0;
  const rows = await prisma.dashboardSnapshot.findMany({
    where: {
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      bucketAt: { gte: new Date(Math.max(historyStart, clearedAt)) },
    },
    orderBy: { bucketAt: "asc" },
    select: {
      bucketAt: true,
      totalValue: true,
      institutionValue: true,
      clientValue: true,
      totalYieldPct: true,
      institutionYieldPct: true,
      clientYieldPct: true,
    },
  });

  const ledgers = await prisma.workspaceRecord.findMany({ where: { kind: 'ledger' }, select: { key: true, payload: true } });
  const visible = ledgers.filter(l => scope.scopeType !== 'bd' || ledgerOwnsBd(l.payload, scope.scopeKey));
  const series = [];
  let historyWarning: string | null = null;
  // Reuse the same archived closes and replay as batch detail. No ledger writes.
  for (const ledger of visible) {
    const batch = (ledger.payload as any)?.batch as BatchLike | undefined;
    if (!batch?.clients?.length) continue;
    const stored = await prisma.batchDailySnapshot.findMany({ where: { batchId: ledger.key }, select: { tradingDate: true, summary: true } });
    let calculated: BatchDailySummary[] = [];
    try { calculated = await backfillBatchHistory(batch, new Set(stored.map(r => r.tradingDate))); }
    catch { historyWarning = '部分历史收盘价暂不可用，仅展示完整留存日期'; }
    const actual = stored.map(r => {
      const summary = r.summary as unknown as BatchDailySummary;
      const enriched = replayBatchDay(batch, r.tradingDate, summary.price);
      return { ...enriched, ...summary } as BatchDailySummary;
    });
    const firstClient = batch.clients.map(c => marketDate(new Date(c.signDate))).sort()[0];
    const start = [marketDate(new Date(batch.signDate)), firstClient].sort().at(-1)!;
    series.push({ start, rows: [...calculated, ...actual] });
  }
  const dailyRows = aggregateDailyHistory(series);
  // Intraday samples stay intraday. Longer views use daily close history exclusively.
  const timeframes: Record<DashboardTimeframe, { valuePoints: SnapshotPoint[]; yieldPoints: SnapshotPoint[] }> = {
    "1D": collapseRows(rows, "1D"),
    "1W": collapseRows(dailyRows, "1W"),
    "1M": collapseRows(dailyRows, "1M"),
    "3M": collapseRows(dailyRows, "3M"),
    "6M": collapseRows(dailyRows, "6M"),
    "1Y": collapseRows(dailyRows, "1Y"),
  };

  return jsonNoStore({
    ok: true,
    scope,
    timeframes,
    warning: historyWarning,
    latestBucketAt: rows[rows.length - 1]?.bucketAt?.toISOString() ?? null,
  });
}

export async function POST(req: Request) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role === "OPERATIONS") return forbidden("运营账号仅可查看");
  const scope = resolveDashboardScope(user);
  if (!scope) return unauthorized();

  const body = (await req.json().catch(() => null)) as SnapshotPayload | null;
  if (!body) return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });

  const bucketAt = floorToHour(new Date());
  const toNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const saved = await prisma.dashboardSnapshot.upsert({
    where: {
      scopeType_scopeKey_bucketAt: {
        scopeType: scope.scopeType,
        scopeKey: scope.scopeKey,
        bucketAt,
      },
    },
    create: {
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      bucketAt,
      totalValue: toNum(body.totalValue),
      institutionValue: toNum(body.institutionValue),
      clientValue: toNum(body.clientValue),
      totalYieldPct: toNum(body.totalYieldPct),
      institutionYieldPct: toNum(body.institutionYieldPct),
      clientYieldPct: toNum(body.clientYieldPct),
      totalPnL: toNum(body.totalPnL),
      institutionPnL: toNum(body.institutionPnL),
      clientPnL: toNum(body.clientPnL),
    },
    update: {
      totalValue: toNum(body.totalValue),
      institutionValue: toNum(body.institutionValue),
      clientValue: toNum(body.clientValue),
      totalYieldPct: toNum(body.totalYieldPct),
      institutionYieldPct: toNum(body.institutionYieldPct),
      clientYieldPct: toNum(body.clientYieldPct),
      totalPnL: toNum(body.totalPnL),
      institutionPnL: toNum(body.institutionPnL),
      clientPnL: toNum(body.clientPnL),
    },
    select: {
      bucketAt: true,
      scopeType: true,
      scopeKey: true,
    },
  });

  return jsonNoStore({
    ok: true,
    scope,
    bucketAt: saved.bucketAt.toISOString(),
  });
}
