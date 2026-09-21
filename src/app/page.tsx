"use client";

import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import { getMockData, refreshMockDataPrices } from "@/lib/mockData";
import { calculatePortfolioSummary, getBatchMetrics, summarizeBatchMarginFromClients } from "@/lib/riskEngine";
import { toast } from "sonner";
import { KPICard } from "@/components/dashboard/KPICard";
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
  Layers3,
  ArrowDownUp,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  const mockDataRef = useRef(getMockData());
  const [tick, setTick] = useState(0);
  const rawBatches = useMemo(() => [...mockDataRef.current.batches], [tick]);
  const batches = useMemo(() => filterBatchesForUser(rawBatches, user ?? null), [rawBatches, user]);
  const stockHistory = useMemo(() => mockDataRef.current.stockHistory, [tick]);
  const summary = calculatePortfolioSummary(batches);
  const lockedCount = batches.filter((b) => b.status === "LOCKED").length;
  const tradingCount = batches.length - lockedCount;
  const totalClients = useMemo(
    () => batches.reduce((sum, b) => sum + (b.clients?.length || 0), 0),
    [batches]
  );

  const [stockFilter, setStockFilter] = useState<string>("ALL");
  const [yearFilter, setYearFilter] = useState<string>("ALL");
  const [monthFilter, setMonthFilter] = useState<string>("ALL");

  const pad = (n: number) => n.toString().padStart(2, "0");
  const toMonthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  // ===== 实时股价联动 tick =====
  useEffect(() => {
    const s = getWebAlertSettings();
    if (!s.realtimeTickEnabled) return;
    const id = setInterval(() => {
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
  const [hydrated, setHydrated] = useState(false);
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
      const isCritical = b.riskLevel === RiskLevel.CRITICAL || margin.totalPending > 0;
      const isWarning = b.riskLevel === RiskLevel.WARNING;
      if (!isCritical && !isWarning) continue;
      if (webAlertSettings.webAlertCriticalOnly && !isCritical) continue;
      const alertKey = margin.totalPending > 0 ? `${b.id}:${margin.roundId}` : `${b.id}:warning`;
      if (acks[alertKey] && Date.now() - acks[alertKey] < 1000 * 60 * 30) continue;
      const initAmt = b.initialTotalAmount ?? 0;
      const curMV = (b as any).currentMarketValue ?? initAmt;
      const m = getBatchMetrics(b);
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
  const resetStockFilter = () => setStockFilter("ALL");
  const resetYearMonth = () => { setYearFilter("ALL"); setMonthFilter("ALL"); };

  // 构建股票Tab列表（按股票聚合批次）
  const stockGroups = useMemo(() => {
    const map: Record<string, { symbol: string; name: string; batches: typeof batches; risk: number }> = {};
    for (const b of batches) {
      const key = b.stockSymbol ?? "UNKNOWN";
      if (!map[key]) {
        map[key] = { symbol: b.stockSymbol ?? "UNKNOWN", name: b.stockName ?? b.stockSymbol ?? "未知", batches: [], risk: 0 };
      }
      map[key].batches.push(b);
      const w =
        b.riskLevel === RiskLevel.CRITICAL
          ? 100
          : b.riskLevel === RiskLevel.WARNING
          ? 50
          : 10;
      map[key].risk += w;
    }
    return Object.values(map).sort((a, b) => b.risk - a.risk);
  }, [batches]);

  const visibleBatches = useMemo(() => {
    const stockFiltered =
      stockFilter === "ALL" ? batches : batches.filter((b) => b.stockSymbol === stockFilter);
    const yearFiltered =
      yearFilter === "ALL"
        ? stockFiltered
        : stockFiltered.filter(
            (b) => new Date(b.signDate).getFullYear().toString() === yearFilter
          );
    const list =
      monthFilter === "ALL"
        ? yearFiltered
        : yearFiltered.filter((b) => toMonthKey(new Date(b.signDate)) === monthFilter);
    const weight: Record<string, number> = {
      [RiskLevel.CRITICAL]: 3,
      [RiskLevel.WARNING]: 2,
      [RiskLevel.NORMAL]: 1,
    };
    return [...list].sort((a, b) => {
      const wa = weight[a.riskLevel] ?? 0;
      const wb = weight[b.riskLevel] ?? 0;
      if (wa !== wb) return wb - wa;
      const aMV = a.currentMarketValue ?? a.initialTotalAmount ?? 0;
      const bMV = b.currentMarketValue ?? b.initialTotalAmount ?? 0;
      const aDrop = getBatchMetrics(a).dropPercent;
      const bDrop = getBatchMetrics(b).dropPercent;
      return aDrop - bDrop;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, stockFilter, yearFilter, monthFilter, tick]);

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

      {/* ===== 顶部：极简风控核心 KPI ===== */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          title="总管理资产 AUM"
          value={summary.totalAUM}
          icon={Building2}
          iconVariant="primary"
          footer={
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-muted-foreground flex items-center gap-1">
                <Shield className="h-3 w-3" /> 优
              </span>
              <span className="font-mono font-semibold">
                {summary.totalPriority.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })}
              </span>
              <span className="text-muted-foreground flex items-center gap-1 ml-2">
                <Target className="h-3 w-3" /> 劣
              </span>
              <span className="font-mono font-semibold">
                {summary.totalSubordinate.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })}
              </span>
            </div>
          }
        />
        <KPICard
          title="当前总市值"
          value={summary.currentMarketValueTotal}
          icon={Layers}
          iconVariant="secondary"
          trend={{
            value: summary.currentMarketValueTotal - summary.totalAUM,
            label: "vs AUM",
            formatter: "currency",
          }}
        />
        <KPICard
          title="机构累计补仓"
          value={summary.totalMarginCalls}
          icon={Wallet}
          iconVariant="warning"
          footer={
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-muted-foreground">客户</span>
              <span className="font-mono font-semibold">{totalClients}</span>
              <span className="text-muted-foreground ml-2">关注批次</span>
              <span className="font-mono font-semibold text-warning">
                {summary.warningCount + summary.criticalCount}
              </span>
            </div>
          }
        />
        <KPICard
          title="组合收益率"
          value={summary.totalPnLPercent}
          formatter="percent"
          icon={summary.totalPnL >= 0 ? TrendingUp : AlertTriangle}
          iconVariant={summary.totalPnL >= 0 ? "success" : "warning"}
          trend={{ value: summary.totalPnL, formatter: "currency" }}
        />
        <KPICard
          title="机构收益率"
          value={summary.institutionPnLPercent}
          formatter="percent"
          icon={Landmark}
          iconVariant={summary.institutionPnL >= 0 ? "success" : "danger"}
          trend={{ value: summary.institutionPnL, formatter: "currency" }}
        />
        <KPICard
          title="客户收益率"
          value={summary.allClientsPnLPercent}
          formatter="percent"
          icon={UserCheck}
          iconVariant={summary.allClientsPnL >= 0 ? "success" : "warning"}
          trend={{ value: summary.allClientsPnL, formatter: "currency" }}
        />
      </div>

      {/* ===== 中部：风险阶梯状态分布条 ===== */}
      <Suspense fallback={
        <div className="rounded-2xl border border-border/50 bg-card/40 p-5 opacity-60">
          <div className="h-8 w-56 bg-secondary/60 rounded animate-pulse mb-3" />
          <div className="h-16 w-full rounded-xl bg-secondary/40 animate-pulse" />
        </div>
      }>
        <RiskLadderBar batches={batches as any} summary={ladderSummary} />
      </Suspense>

      {/* ===== 下部：股票分组选项卡 + 风险排序网格 ===== */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-danger" />
            <h2 className="text-sm font-bold tracking-wide">批次监控中心</h2>
            <span className="text-[11px] text-muted-foreground">
              · 按风险等级自动排序列（击穿 / 预警 / 正常）
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-success" /> NORMAL {summary.normalCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-warning animate-breath-warning" /> WARNING {summary.warningCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-danger animate-breath-danger" /> CRITICAL {summary.criticalCount}
            </span>
          </div>
        </div>

        {/* ===== 股票选项卡 ===== */}
        <div className="flex flex-wrap items-center gap-1.5 -mx-1 px-1">
          <StockTab
            active={stockFilter === "ALL"}
            onClick={() => setStockFilter("ALL")}
            left={<Layers3 className="h-3.5 w-3.5" />}
            label="全部股票"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">{batches.length}</Badge>}
          />
          {stockGroups.map((sg) => {
            const hasCrit = sg.batches.some((b) => b.riskLevel === RiskLevel.CRITICAL);
            const hasWarn = sg.batches.some((b) => b.riskLevel === RiskLevel.WARNING);
            return (
              <StockTab
                key={sg.symbol}
                active={stockFilter === sg.symbol}
                onClick={() => setStockFilter(sg.symbol)}
                left={
                  <ArrowDownUp
                    className={cn(
                      "h-3.5 w-3.5",
                      hasCrit
                        ? "text-danger"
                        : hasWarn
                        ? "text-warning"
                        : "text-success"
                    )}
                  />
                }
                label={sg.symbol}
                sublabel={sg.name}
                right={
                  <div className="flex items-center gap-1.5 ml-1.5">
                    <Badge variant="outline" className="h-5 text-[10px] px-2">
                      {sg.batches.length}
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

        {/* ===== 年份选项卡 + 月份选项卡 ===== */}
        <div className="flex flex-wrap items-center gap-1.5 -mx-1 px-1 pt-1">
          <StockTab
            active={!yearMonthFilterActive}
            onClick={resetYearMonth}
            left={<Calendar className="h-3.5 w-3.5" />}
            label="全部时间"
            right={<Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">{batches.length}</Badge>}
          />
          {yearGroups.length > 1 && yearOptions.slice(1).map((y) => (
            <StockTab
              key={`y-${y.value}`}
              active={yearFilter === y.value && monthFilter === "ALL"}
              onClick={() => { setYearFilter(y.value); setMonthFilter("ALL"); }}
              left={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />}
              label={y.label}
              right={
                <Badge variant="outline" className="h-5 text-[10px] px-2 ml-1">
                  {y.count}
                </Badge>
              }
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 -mx-1 px-1 pt-1">
          <StockTab
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
            <StockTab
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

function StockTab(props: {
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
