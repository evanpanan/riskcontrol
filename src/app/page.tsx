"use client";

import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import { getMockData, refreshMockDataPrices, reloadMockData } from "@/lib/mockData";
import { calculatePortfolioSummary, getBatchMetrics, summarizeBatchMarginFromClients } from "@/lib/riskEngine";
import { toast } from "sonner";
import { KPICard } from "@/components/dashboard/KPICard";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { RiskLadderBar } from "@/components/dashboard/RiskLadderBar";
import { BatchCardV2 } from "@/components/dashboard/BatchCardV2";
import { RiskAlertDialog, RiskAlertItem } from "@/components/dashboard/RiskAlertDialog";
import { Batch, RiskLevel } from "@prisma/client";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import type { AppSessionUser, AppRole } from "@/types/auth";
import { filterBatchesForUser } from "@/lib/auth";
import {
  Building2,
  TrendingUp,
  AlertTriangle,
  Wallet,
  Layers,
  Shield,
  Target,
  Landmark,
  UserCheck,
  Flame,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getNYSEInfo } from "@/lib/liveQuote";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  acknowledgeAlert,
  clearAllAlerts,
  getAlertAcks,
  getWebAlertSettings,
} from "@/lib/webAlertSettings";

export default function DashboardPage() {
  const { user, role } = useCurrentUser();
  const [hydrated, setHydrated] = useState(false);
  const [mockError, setMockError] = useState<Error | null>(null);
  const mockDataRef = useRef<ReturnType<typeof getMockData> | null>(null);
  if (!mockDataRef.current) {
    try {
      mockDataRef.current = getMockData();
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      const devMode =
        process.env.NODE_ENV === "development" ||
        (typeof window !== "undefined" &&
          /localhost|127\.0\.0\.1|:300[0-9]$/.test(window.location.host));
      if (devMode && typeof window !== "undefined" && (window as any).__RISK_RESET_TEST_DATA__) {
        try {
          (window as any).__RISK_RESET_TEST_DATA__(true);
          reloadMockData();
          mockDataRef.current = getMockData();
        } catch {
          setMockError(err);
        }
      } else {
        setMockError(err);
      }
    }
  }
  const [tick, setTick] = useState(0);
  const rawBatches = useMemo(() => [...(mockDataRef.current?.batches ?? [])], [tick, hydrated]);
  const batches = useMemo(() => filterBatchesForUser(rawBatches, user ?? null), [rawBatches, user]);
  const stockHistory = useMemo(() => mockDataRef.current?.stockHistory ?? [], [tick, hydrated]);
  const summary = useMemo(() => calculatePortfolioSummary(batches), [batches]);
  const lockedCount = batches.filter((b) => b.status === "LOCKED").length;
  const tradingCount = batches.length - lockedCount;
  const totalClients = useMemo(
    () => batches.reduce((sum, b) => sum + (b.clients?.length || 0), 0),
    [batches]
  );

  const [yearFilter, setYearFilter] = useState<string>("ALL");
  const [monthFilter, setMonthFilter] = useState<string>("ALL");
  const [riskLevelFilter, setRiskLevelFilter] = useState<string>("ALL");

  const pad = (n: number) => n.toString().padStart(2, "0");
  const toMonthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  // ===== 实时股价联动 tick =====
  useEffect(() => {
    const s = getWebAlertSettings();
    if (!s.realtimeTickEnabled) return;
    const id = setInterval(() => {
      const nyse = getNYSEInfo();
      if (!nyse.shouldBreathe) return;
      try { refreshMockDataPrices(); } catch (err) {
        toast.error(err instanceof Error ? err.message : "行情更新失败");
        clearInterval(id);
        return;
      }
      mockDataRef.current = getMockData();
      setTick((t) => t + 1);
    }, Math.max(2000, s.realtimeTickIntervalSec * 1000));
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("risk-control:finance-changed", handler);
    return () => window.removeEventListener("risk-control:finance-changed", handler);
  }, []);

  // ===== 风险预警弹窗 ACK & 构建alert列表 =====
  const [alerts, setAlerts] = useState<RiskAlertItem[]>([]);
  const [webAlertSettings, setWebAlertSettings] = useState<ReturnType<typeof getWebAlertSettings>>({
    webAlertEnabled: true,
    webAlertSound: true,
    webAlertCriticalOnly: false,
    realtimeTickEnabled: true,
    realtimeTickIntervalSec: 8,
  });
  const acksRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setHydrated(true);
    acksRef.current = getAlertAcks();
    setWebAlertSettings(getWebAlertSettings());
    const onStorage = () => {
      acksRef.current = getAlertAcks();
      setWebAlertSettings(getWebAlertSettings());
      try {
        mockDataRef.current = getMockData();
        setTick((t) => t + 1);
      } catch (err) {
        const devMode =
          process.env.NODE_ENV === "development" ||
          /localhost|127\.0\.0\.1|:300[0-9]$/.test(window.location.host);
        if (devMode && (window as any).__RISK_RESET_TEST_DATA__) {
          (window as any).__RISK_RESET_TEST_DATA__(false);
        } else {
          toast.error(err instanceof Error ? err.message : "账本状态异常");
        }
      }
    };
    window.addEventListener("storage", onStorage);
    const id = setInterval(onStorage, 4000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const acks = acksRef.current;
    const next: RiskAlertItem[] = [];
    for (const b of batches as any as (Batch & {
      currentStockPrice?: number;
      currentDayChange?: number;
    })[]) {
      const margin = summarizeBatchMarginFromClients(b);
      const m = getBatchMetrics(b);
      const isCritical = m.riskLevel === RiskLevel.CRITICAL || margin.totalPending > 0;
      const isWarning = m.riskLevel === RiskLevel.WARNING;
      if (!isCritical && !isWarning) continue;
      if (webAlertSettings.webAlertCriticalOnly && !isCritical) continue;
      const alertKey = margin.totalPending > 0 ? `${b.id}:${margin.roundId}` : `${b.id}:warning`;
      if (acks[alertKey] && Date.now() - acks[alertKey] < 1000 * 60 * 30) continue;
      const initAmt = (b as import("@/lib/riskEngine").BatchLike).finance?.remainingCapital ?? b.initialTotalAmount ?? 0;
      const curMV = m.currentMarketValue;
      next.push({
        alertKey,
        batchId: b.id,
        batchNumber: (b as any).batchNumber,
        stockSymbol: (b as any).stockSymbol,
        stockName: (b as any).stockName,
        riskLevel: isCritical ? RiskLevel.CRITICAL : RiskLevel.WARNING,
        dropPercent: m.dropPercent,
        requiredMarginCall: margin.totalPending,
        signDate: new Date(b.signDate),
        clientCount: ((b as any).clients as any[])?.length ?? 0,
        initialTotalAmount: initAmt,
        currentMarketValue: curMV,
        firstSeenAt: Date.now(),
      });
    }
    next.sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) {
        return a.riskLevel === RiskLevel.CRITICAL ? -1 : 1;
      }
      return b.dropPercent - a.dropPercent;
    });
    setAlerts(next);
  }, [batches, webAlertSettings.webAlertCriticalOnly]);

  const handleDismissOne = (batchId: string) => {
    acknowledgeAlert(alerts.find((a) => a.batchId === batchId)?.alertKey ?? batchId);
    acksRef.current = getAlertAcks();
    setAlerts((prev) => prev.filter((a) => a.batchId !== batchId));
  };
  const handleDismissAll = () => {
    for (const a of alerts) acknowledgeAlert(a.alertKey);
    acksRef.current = getAlertAcks();
    setAlerts([]);
  };

  // 构建月份Tab列表（按签约月份聚合）
  const { yearGroups, monthGroups } = useMemo(() => {
    const mMap: Record<string, { key: string; label: string; year: string; batches: typeof batches }> = {};
    for (const b of batches) {
      const sign = new Date(b.signDate);
      const k = toMonthKey(sign);
      if (!mMap[k]) {
        mMap[k] = {
          key: k,
          label: `${sign.getFullYear()}年${pad(sign.getMonth() + 1)}月`,
          year: sign.getFullYear().toString(),
          batches: [],
        };
      }
      mMap[k].batches.push(b);
    }
    const months = Object.values(mMap).sort((a, b) => (a.key < b.key ? 1 : -1));
    const yMap: Record<string, { year: string; count: number }> = {};
    for (const m of months) {
      if (!yMap[m.year]) yMap[m.year] = { year: m.year, count: 0 };
      yMap[m.year].count += m.batches.length;
    }
    const years = Object.values(yMap).sort((a, b) => (a.year < b.year ? 1 : -1));
    return { monthGroups: months, yearGroups: years };
  }, [batches]);
  const yearOptions = useMemo(
    () => [{ value: "ALL", label: "全部年份", count: batches.length }, ...yearGroups.map((y) => ({ value: y.year, label: `${y.year}年`, count: y.count }))],
    [yearGroups, batches.length]
  );
  const shownMonthGroups = useMemo(
    () => (yearFilter === "ALL" ? monthGroups : monthGroups.filter((m) => m.year === yearFilter)),
    [monthGroups, yearFilter]
  );
  const yearMonthFilterActive = yearFilter !== "ALL" || monthFilter !== "ALL";
  const resetYearMonth = () => { setYearFilter("ALL"); setMonthFilter("ALL"); };

  const visibleBatches = useMemo(() => {
    const yearFiltered =
      yearFilter === "ALL"
        ? batches
        : batches.filter(
            (b) => new Date(b.signDate).getFullYear().toString() === yearFilter
          );
    const list =
      monthFilter === "ALL"
        ? yearFiltered
        : yearFiltered.filter((b) => toMonthKey(new Date(b.signDate)) === monthFilter);
    const weight: Record<string, number> = {
      [RiskLevel.CRITICAL]: 4,
      [RiskLevel.WARNING]: 3,
      [RiskLevel.NORMAL]: 2,
    };
    const withMeta = list.map((b) => {
      const metrics = getBatchMetrics(b);
      const isProfitable = metrics.totalPnLPercent > 0.01;
      return {
        b,
        isProfitable,
        baseWeight: isProfitable ? 1 : (weight[b.riskLevel] ?? 2),
        dropPercent: metrics.dropPercent,
      };
    });
    const filtered = riskLevelFilter === "ALL"
      ? withMeta
      : riskLevelFilter === "PROFIT"
        ? withMeta.filter((m) => m.isProfitable)
        : withMeta.filter((m) => !m.isProfitable && m.b.riskLevel === riskLevelFilter);
    return filtered
      .sort((a, z) => {
        if (a.baseWeight !== z.baseWeight) return z.baseWeight - a.baseWeight;
        return a.dropPercent - z.dropPercent;
      })
      .map((m) => m.b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, yearFilter, monthFilter, riskLevelFilter, tick]);

  const ladderSummary = {
    profitableCount: summary.profitableCount,
    normalCount: summary.normalCount,
    warningCount: summary.warningCount,
    criticalCount: summary.criticalCount,
    lockedCount,
    tradingCount,
    totalBatches: summary.totalBatches,
    totalClients,
    totalAUM: summary.totalAUM,
  };

  return (
    <div className="space-y-5 max-w-[1920px] mx-auto">
      {mockError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-destructive">
                本地账本校验失败
              </h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {mockError.message}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center justify-center rounded-lg bg-destructive text-destructive-foreground px-4 py-2 text-sm font-semibold hover:bg-destructive/90"
                onClick={() => {
                  if (typeof window !== "undefined" && (window as any).__RISK_RESET_TEST_DATA__) {
                    (window as any).__RISK_RESET_TEST_DATA__(false);
                  } else {
                    toast.error("未找到重置脚本，请手动清理 localStorage 后刷新。");
                  }
                }}
              >
                清空测试数据并重建
              </button>
            </div>
          </div>
          <div className="rounded-lg bg-background/60 p-3 text-[11.5px] text-muted-foreground space-y-1">
            <div>· 只会清理「纯测试账本」；存在真实结算 / 已执行补仓的账本不会被自动删除。</div>
            <div>· 清空前会先备份到 localStorage 里 <code className="font-mono">risk_control_test_backup_*</code> 前缀的 key，随时可回滚。</div>
            <div>· 也可在 DevTools Console 执行：<code className="font-mono">window.__RISK_RESET_TEST_DATA__()</code></div>
          </div>
        </div>
      ) : null}

      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">
              控制台
            </span>
            <span>/</span>
            <span>全局风控大盘</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            优先劣后股票产品
            <span className="text-gradient-primary ml-2">全景风控预警</span>
          </h1>
        </div>
      </div>

      {/* ===== 顶部：OKX 风格仪表盘双折线图 ===== */}
      <DashboardCharts summary={summary} />

      {/* ===== 中部：风险阶梯状态分布条 ===== */}
      <Suspense fallback={
        <div className="rounded-2xl border border-border/50 bg-card/40 p-5 opacity-60">
          <div className="h-8 w-56 bg-secondary/60 rounded animate-pulse mb-3" />
          <div className="h-16 w-full rounded-xl bg-secondary/40 animate-pulse" />
        </div>
      }>
        <RiskLadderBar batches={batches as any} summary={ladderSummary} />
      </Suspense>

      {/* ===== 下部：签约年份筛选 + 风险排序网格 ===== */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-danger" />
            <h2 className="text-sm font-bold tracking-wide">批次监控中心</h2>
            <span className="text-[11px] text-muted-foreground">
              · 默认排序：需补仓 → 预警 → 正常 → 盈利
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-success" /> PROFIT {summary.profitableCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-primary" /> NORMAL {summary.normalCount - summary.profitableCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-warning animate-breath-warning" /> WARNING {summary.warningCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-danger animate-breath-danger" /> CRITICAL {summary.criticalCount}
            </span>
          </div>
        </div>

        {/* ===== 风险状态筛选 ===== */}
        <div className="flex flex-wrap items-center gap-1.5 -mx-1 px-1">
          <FilterTab
            active={riskLevelFilter === "ALL"}
            onClick={() => setRiskLevelFilter("ALL")}
            left={<Layers className="h-3.5 w-3.5" />}
            label="全部状态"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">{batches.length}</Badge>}
          />
          <FilterTab
            active={riskLevelFilter === RiskLevel.CRITICAL}
            onClick={() => setRiskLevelFilter(RiskLevel.CRITICAL)}
            left={<Flame className="h-3.5 w-3.5 text-danger" />}
            label="需补仓（击穿）"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">{summary.criticalCount}</Badge>}
          />
          <FilterTab
            active={riskLevelFilter === RiskLevel.WARNING}
            onClick={() => setRiskLevelFilter(RiskLevel.WARNING)}
            left={<AlertTriangle className="h-3.5 w-3.5 text-warning" />}
            label="接近预警"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">{summary.warningCount}</Badge>}
          />
          <FilterTab
            active={riskLevelFilter === RiskLevel.NORMAL}
            onClick={() => setRiskLevelFilter(RiskLevel.NORMAL)}
            left={<Shield className="h-3.5 w-3.5 text-primary" />}
            label="正常安全"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">{summary.normalCount - summary.profitableCount}</Badge>}
          />
          <FilterTab
            active={riskLevelFilter === "PROFIT"}
            onClick={() => setRiskLevelFilter("PROFIT")}
            left={<TrendingUp className="h-3.5 w-3.5 text-success" />}
            label="盈利批次"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1 text-success border-success/40">{summary.profitableCount}</Badge>}
          />
        </div>

        {/* ===== 签约年份选项卡（原股票筛选位置）===== */}
        <div className="flex flex-wrap items-center gap-1.5 -mx-1 px-1">
          <FilterTab
            active={!yearMonthFilterActive}
            onClick={resetYearMonth}
            left={<Calendar className="h-3.5 w-3.5" />}
            label="全部年份"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">{batches.length}</Badge>}
          />
          {yearOptions.slice(1).map((y) => {
            const yBatches = batches.filter(b => new Date(b.signDate).getFullYear().toString() === y.value);
            const hasCrit = yBatches.some((b) => b.riskLevel === RiskLevel.CRITICAL);
            const hasWarn = yBatches.some((b) => b.riskLevel === RiskLevel.WARNING);
            return (
              <FilterTab
                key={`y-${y.value}`}
                active={yearFilter === y.value && monthFilter === "ALL"}
                onClick={() => { setYearFilter(y.value); setMonthFilter("ALL"); }}
                left={
                  <Calendar
                    className={cn(
                      "h-3.5 w-3.5",
                      hasCrit
                        ? "text-danger"
                        : hasWarn
                        ? "text-warning"
                        : "text-muted-foreground"
                    )}
                  />
                }
                label={y.label}
                right={
                  <div className="flex items-center gap-1.5 ml-1.5">
                    <Badge variant="outline" className="h-5 text-[10px] px-2">
                      {y.count}
                    </Badge>
                    {hasCrit && (
                      <span className="h-2 w-2 rounded-full bg-danger animate-breath-danger" />
                    )}
                    {!hasCrit && hasWarn && (
                      <span className="h-2 w-2 rounded-full bg-warning animate-breath-warning" />
                    )}
                  </div>
                }
              />
            );
          })}
        </div>

        {/* ===== 签约月份选项卡 ===== */}
        <div className="flex flex-wrap items-center gap-1.5 -mx-1 px-1 pt-1">
          <FilterTab
            active={yearFilter !== "ALL" && monthFilter === "ALL"}
            onClick={() => setMonthFilter("ALL")}
            left={<Calendar className="h-3.5 w-3.5" />}
            label={yearFilter === "ALL" ? "全部月份" : `${yearFilter}年全部月份`}
            right={
              <Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">
                {yearFilter === "ALL" ? batches.length : shownMonthGroups.reduce((s, m) => s + m.batches.length, 0)}
              </Badge>
            }
          />
          {shownMonthGroups.map((mg) => (
            <FilterTab
              key={mg.key}
              active={monthFilter === mg.key}
              onClick={() => setMonthFilter(mg.key)}
              left={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />}
              label={yearFilter !== "ALL" ? mg.label.replace(/^\d{4}年/, "") : mg.label}
              right={
                <Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">
                  {mg.batches.length}
                </Badge>
              }
            />
          ))}
        </div>

        {/* 批次网格 */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(() => {
            const seen: Record<string, boolean> = { profit: false, normal: false, warning: false, critical: false };
            return visibleBatches.map((b) => {
              const mv = b.currentMarketValue ?? b.initialTotalAmount ?? 0;
              const metrics = getBatchMetrics(b);
              const isProfitable = mv >= (b.initialTotalAmount ?? 0);
              let anchor: string | null = null;
              if (isProfitable && !seen.profit) { anchor = "anchor-profit"; seen.profit = true; }
              else if (!isProfitable && b.riskLevel === RiskLevel.NORMAL && !seen.normal) { anchor = "anchor-normal"; seen.normal = true; }
              else if (b.riskLevel === RiskLevel.WARNING && !seen.warning) { anchor = "anchor-warning"; seen.warning = true; }
              else if (b.riskLevel === RiskLevel.CRITICAL && !seen.critical) { anchor = "anchor-critical"; seen.critical = true; }
              const card = (
                <BatchCardV2
                  key={b.id}
                  batch={b as any}
                  onAction={() => setTick((x) => x + 1)}
                  viewerRole={role}
                  viewerUser={user ?? undefined}
                />
              );
              return (
                <div key={`wrap-${b.id}`} id={`batch-${b.id}`} className="scroll-mt-24">
                  {anchor ? <div id={anchor}>{card}</div> : card}
                </div>
              );
            });
          })()}
        </div>

        {visibleBatches.length === 0 && (
          <div className="text-center py-14 text-muted-foreground text-sm">
            当前筛选条件下没有批次
          </div>
        )}
      </div>

      {/* ===== 风险预警弹窗 ===== */}
      <RiskAlertDialog
        alerts={alerts}
        onDismissAll={handleDismissAll}
        onDismissOne={handleDismissOne}
        settingsEnabled={webAlertSettings.webAlertEnabled && alerts.length > 0}
      />
    </div>
  );
}

function FilterTab(props: {
  active: boolean;
  onClick: () => void;
  left: React.ReactNode;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "group inline-flex items-center gap-2 h-9 px-3.5 rounded-xl border transition-all",
        props.active
          ? "bg-primary/15 border-primary/40 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.3)_inset]"
          : "border-border/60 hover:border-primary/30 hover:bg-card/60 text-foreground/85 bg-card/30"
      )}
    >
      <span className={cn(props.active && "text-primary")}>{props.left}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-semibold tracking-wide">{props.label}</span>
        {props.sublabel && (
          <span className="text-[10.5px] text-muted-foreground truncate max-w-[140px] hidden sm:inline">
            {props.sublabel}
          </span>
        )}
      </div>
      {props.right}
    </button>
  );
}
