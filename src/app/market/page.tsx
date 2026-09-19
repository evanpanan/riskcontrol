"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlashNumber } from "@/components/ui/FlashNumber";
import { getMockData, refreshMockDataPrices } from "@/lib/mockData";
import {
  cn,
  formatCurrency,
  formatPercent,
  formatCompactNumber,
} from "@/lib/utils";
import {
  calculateBatchRiskMetrics,
  calculateBatchPnLSplit,
  calculatePortfolioSummary,
} from "@/lib/riskEngine";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Legend,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import {
  RefreshCw,
  RadioTower,
  TrendingUp,
  TrendingDown,
  Search,
  Download,
  AlertTriangle,
  Eye,
  Building2,
  Wallet,
  Landmark,
  Target,
  Shield,
  Layers3,
  Users,
  Flame,
  PieChart as PieChartIcon,
  Activity,
  Clock,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { fetchStockQuote } from "@/lib/stockFetcher";
import { RiskLevel } from "@prisma/client";
import { getWebAlertSettings } from "@/lib/webAlertSettings";

function generateSparklineData(base: number, points = 30) {
  const data: { day: string; price: number }[] = [];
  let price = base * 0.9;
  for (let i = 0; i < points; i++) {
    price = price * (1 + (Math.random() - 0.48) * 0.02);
    data.push({
      day: `D${i + 1}`,
      price: Number(price.toFixed(2)),
    });
  }
  return data;
}

function generatePortfolioAndInstitutionHistory(
  initial: number,
  subordinateInitial: number,
  marginCallsTotal: number,
  days = 60
) {
  const data: {
    date: string;
    组合总市值: number;
    机构资金池: number;
    累计补仓: number;
    机构PnL: number;
    预警线: number;
    初始线: number;
  }[] = [];
  let value = initial;
  let institutionSub = subordinateInitial + marginCallsTotal;
  let instPnL = 0;
  for (let i = 0; i < days; i++) {
    const shock =
      i >= days - 20 ? (Math.random() - 0.55) * 0.018 : (Math.random() - 0.46) * 0.012;
    value = value * (1 + shock);
    const mvDelta = value - initial;
    instPnL = mvDelta * 0.7 - marginCallsTotal;
    data.push({
      date: `D${i + 1}`,
      组合总市值: Number(value.toFixed(0)),
      机构资金池: Number(Math.max(0, subordinateInitial + instPnL).toFixed(0)),
      累计补仓: marginCallsTotal,
      机构PnL: Number(instPnL.toFixed(0)),
      预警线: Number((initial * 0.8).toFixed(0)),
      初始线: initial,
    });
  }
  return data;
}

function generateInstitutionRiskByMonth() {
  const months = [
    "25/05",
    "25/07",
    "25/10",
    "25/12",
    "26/02",
    "26/03",
    "26/04",
    "26/05",
    "26/06",
    "26/07",
    "26/08",
    "26/09",
  ];
  return months.map((m, i) => ({
    month: m,
    风险敞口: Math.round(500000 + Math.random() * 1800000 - i * 30000),
    机构补仓: i < 3 ? 0 : Math.round(Math.random() * 500000 * (i / 8)),
  }));
}

const MARKET_OPEN_HOURS = { startHour: 21, endHour: 4 }; // HK/US crossover 模拟

function isMarketOpen(now = new Date()) {
  const h = now.getUTCHours() + 8;
  return (h >= 9 && h < 12) || (h >= 13 && h < 16) || (h >= 21 && h <= 23);
}

export default function MarketPage() {
  const mockDataRef = useRef(getMockData());
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const batches = useMemo(() => mockDataRef.current.batches, [tick]);
  const stockHistory = useMemo(() => mockDataRef.current.stockHistory, [tick]);

  const settings = useMemo(() => {
    try { return getWebAlertSettings(); } catch { return null; }
  }, [tick]);

  // 实时行情刷新（开盘时段加密）
  useEffect(() => {
    const s = settings ?? { realtimeTickEnabled: true, realtimeTickIntervalSec: 8 };
    if (!s.realtimeTickEnabled) return;
    const sec = Math.max(2, s.realtimeTickIntervalSec);
    const interval = setInterval(() => {
      refreshMockDataPrices();
      mockDataRef.current = getMockData();
      setTick((t) => t + 1);
    }, sec * 1000);
    return () => clearInterval(interval);
  }, [settings]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      refreshMockDataPrices();
      mockDataRef.current = getMockData();
      setTick((t) => t + 1);
      setRefreshing(false);
    }, 900);
  };

  const summary = useMemo(() => calculatePortfolioSummary(batches), [batches]);

  const totalInitial = summary.totalAUM;
  const totalMV = summary.currentMarketValueTotal;
  const totalDayChange = batches.reduce(
    (s, b) =>
      s +
      ((b.currentMarketValue || b.initialTotalAmount) * (b.currentDayChange || 0)) /
        100,
    0
  );

  // 机构视角拆分
  const institutionMetrics = useMemo(() => {
    let totalInjected = 0;
    let totalRecovered = 0;
    let worstExposure = 0;
    for (const b of batches) {
      const mv = b.currentMarketValue || b.initialTotalAmount;
      const metrics = calculateBatchRiskMetrics(
        b.initialTotalAmount,
        mv,
        b.cumulativeMarginCalls || 0
      );
      const split = calculateBatchPnLSplit(b, mv);
      totalInjected += b.subordinateAmount + (b.cumulativeMarginCalls || 0);
      if (metrics.dropPercent <= -20) {
        totalRecovered += 0; // 击穿还没回收
      } else if (metrics.dropPercent > -20 && (b.cumulativeMarginCalls || 0) > 0) {
        totalRecovered += (b.cumulativeMarginCalls || 0) * 0.4;
      }
      worstExposure = Math.max(worstExposure, metrics.requiredMarginCall);
    }
    return {
      totalInjected,
      totalRecovered,
      outstanding: Math.max(0, summary.totalMarginCalls - totalRecovered),
      worstExposure,
      institutionPnL: summary.institutionPnL,
      institutionPnLPercent: summary.institutionPnLPercent,
    };
  }, [batches, summary]);

  const riskBreakdown = useMemo(() => {
    const mvByRisk = { CRITICAL: 0, WARNING: 0, NORMAL: 0, PROFITABLE: 0 };
    for (const b of batches) {
      const mv = b.currentMarketValue || b.initialTotalAmount;
      if (mv >= b.initialTotalAmount) mvByRisk.PROFITABLE += mv;
      else if (b.riskLevel === RiskLevel.CRITICAL) mvByRisk.CRITICAL += mv;
      else if (b.riskLevel === RiskLevel.WARNING) mvByRisk.WARNING += mv;
      else mvByRisk.NORMAL += mv;
    }
    return mvByRisk;
  }, [batches]);

  const holdings = batches
    .map((b) => ({
      name: b.stockSymbol,
      value: b.initialTotalAmount,
      mv: b.currentMarketValue || b.initialTotalAmount,
      pnl: (b.currentMarketValue || b.initialTotalAmount) - b.initialTotalAmount,
    }))
    .sort((a, b) => b.value - a.value);

  const portfolioHistory = generatePortfolioAndInstitutionHistory(
    summary.totalAUM,
    summary.totalSubordinate,
    summary.totalMarginCalls,
    90
  ).map((row) => ({
    ...row,
    instPnLFill:
      (row.机构PnL ?? 0) >= 0
        ? "hsl(142 72% 40% / 0.55)"
        : "hsl(0 63% 45% / 0.55)",
  }));

  const riskMonthly = generateInstitutionRiskByMonth();

  const marketOpenNow = isMarketOpen();

  return (
    <div className="space-y-6 max-w-[1800px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground font-semibold">
              行情中心
            </span>
            <span>/</span>
            <span>机构版行情分析</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            股票行情监控中心
          </h1>
          <p className="text-sm text-muted-foreground">
            机构老板视角：组合走势 + 劣后资金池 + 风险敞口 + 实时股价联动
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={marketOpenNow ? "success" : "secondary"}
            className="gap-1.5 px-3 py-1"
          >
            <Clock className="h-3 w-3" />
            {marketOpenNow ? "美股 / 港股 开盘中" : "全球市场休市"}
          </Badge>
          <Badge variant="success" className="gap-1.5 px-3 py-1">
            <RadioTower
              className={cn(
                "h-3 w-3",
                marketOpenNow && "animate-pulse-green"
              )}
            />
            Yahoo Finance {marketOpenNow ? "实时" : "盘前"}
          </Badge>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Search className="h-3.5 w-3.5" />
            搜索股票
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            导出行情
          </Button>
          <Button
            size="sm"
            variant="gradient"
            className="gap-1.5"
            onClick={handleRefresh}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            刷新行情
          </Button>
        </div>
      </div>

      {/* ===== 机构老板视角 KPI 卡片 (6列) ===== */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <div className="card-chrome rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              AUM 总规模
            </p>
            <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
              <Building2 className="h-4 w-4 text-primary" />
            </div>
          </div>
          <FlashNumber
            value={summary.totalAUM}
            formatter="currency"
            className="text-xl font-bold font-mono tracking-tight"
          />
          <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Shield className="h-3 w-3" /> 优
            </span>
            <span className="font-mono font-semibold">
              {formatCompactNumber(summary.totalPriority)}
            </span>
            <span className="inline-flex items-center gap-1 ml-2">
              <Target className="h-3 w-3" /> 劣
            </span>
            <span className="font-mono font-semibold">
              {formatCompactNumber(summary.totalSubordinate)}
            </span>
          </div>
        </div>

        <div className="card-chrome rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              机构累计注入
            </p>
            <div className="h-8 w-8 rounded-lg bg-warning/15 border border-warning/20 flex items-center justify-center">
              <Wallet className="h-4 w-4 text-warning" />
            </div>
          </div>
          <FlashNumber
            value={institutionMetrics.totalInjected}
            formatter="currency"
            className="text-xl font-bold font-mono tracking-tight"
          />
          <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>劣后本金</span>
            <span className="font-mono font-semibold">
              {formatCompactNumber(summary.totalSubordinate)}
            </span>
            <span className="ml-1">补仓</span>
            <span className="font-mono font-semibold text-warning">
              +{formatCompactNumber(summary.totalMarginCalls)}
            </span>
          </div>
        </div>

        <div className="card-chrome rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              待回收补仓
            </p>
            <div className="h-8 w-8 rounded-lg bg-danger/15 border border-danger/20 flex items-center justify-center">
              <Flame className="h-4 w-4 text-danger" />
            </div>
          </div>
          <FlashNumber
            value={institutionMetrics.outstanding}
            formatter="currency"
            className="text-xl font-bold font-mono tracking-tight text-danger"
          />
          <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>已回收</span>
            <span className="font-mono font-semibold text-success">
              {formatCompactNumber(institutionMetrics.totalRecovered)}
            </span>
            <span>合计补仓</span>
            <span className="font-mono font-semibold">
              {formatCompactNumber(summary.totalMarginCalls)}
            </span>
          </div>
        </div>

        <div className="card-chrome rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              机构收益率
            </p>
            <div
              className={cn(
                "h-8 w-8 rounded-lg border flex items-center justify-center",
                summary.institutionPnL >= 0
                  ? "bg-success/15 border-success/20"
                  : "bg-danger/15 border-danger/20"
              )}
            >
              <Landmark
                className={cn(
                  "h-4 w-4",
                  summary.institutionPnL >= 0 ? "text-success" : "text-danger"
                )}
              />
            </div>
          </div>
          <FlashNumber
            value={summary.institutionPnLPercent}
            formatter="percent"
            digits={2}
            className={cn(
              "text-xl font-bold font-mono tracking-tight",
              summary.institutionPnL >= 0 ? "text-success" : "text-danger"
            )}
          />
          <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <span>绝对PnL</span>
            <FlashNumber
              value={summary.institutionPnL}
              formatter="currency"
              className={cn(
                "font-mono font-semibold",
                summary.institutionPnL >= 0 ? "text-success" : "text-danger"
              )}
            />
          </div>
        </div>

        <div className="card-chrome rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              客户收益率
            </p>
            <div
              className={cn(
                "h-8 w-8 rounded-lg border flex items-center justify-center",
                summary.allClientsPnL >= 0
                  ? "bg-success/15 border-success/20"
                  : "bg-warning/15 border-warning/20"
              )}
            >
              <Users
                className={cn(
                  "h-4 w-4",
                  summary.allClientsPnL >= 0 ? "text-success" : "text-warning"
                )}
              />
            </div>
          </div>
          <FlashNumber
            value={summary.allClientsPnLPercent}
            formatter="percent"
            digits={2}
            className={cn(
              "text-xl font-bold font-mono tracking-tight",
              summary.allClientsPnL >= 0 ? "text-success" : "text-warning"
            )}
          />
          <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>客户 78 位</span>
            <span className="font-mono font-semibold">
              批次 {summary.totalBatches}
            </span>
          </div>
        </div>

        <div className="card-chrome rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              最大敞口/批次
            </p>
            <div className="h-8 w-8 rounded-lg bg-warning/15 border border-warning/20 flex items-center justify-center animate-breath-warning">
              <Activity className="h-4 w-4 text-warning" />
            </div>
          </div>
          <FlashNumber
            value={institutionMetrics.worstExposure}
            formatter="currency"
            className="text-xl font-bold font-mono tracking-tight text-warning"
          />
          <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>击穿批次</span>
            <span className="font-mono font-semibold text-danger">
              {summary.criticalCount}
            </span>
            <span>预警</span>
            <span className="font-mono font-semibold text-warning">
              {summary.warningCount}
            </span>
          </div>
        </div>
      </div>

      {/* ===== 组合历史走势 + 机构资金 ===== */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                组合走势 + 机构资金曲线
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                组合总市值（蓝实线面积） · 机构劣后资金池（紫实线） · 累计补仓（橙虚线） ·
                机构PnL（绿/红柱）· 近 90 交易日
              </p>
            </div>
            <div className="flex items-center gap-5 text-xs flex-wrap">
              <div>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  组合总市值
                </p>
                <FlashNumber
                  value={totalMV}
                  formatter="currency"
                  className="font-mono font-bold text-lg text-primary"
                />
              </div>
              <div>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  今日浮动
                </p>
                <p
                  className={cn(
                    "font-mono font-bold text-lg flex items-center gap-1",
                    totalDayChange >= 0 ? "text-success" : "text-danger"
                  )}
                >
                  {totalDayChange >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <FlashNumber
                    value={totalDayChange}
                    formatter="currency"
                  />
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  相对初始
                </p>
                <FlashNumber
                  value={((totalMV - totalInitial) / totalInitial) * 100}
                  formatter="percent"
                  digits={2}
                  prefix={totalMV >= totalInitial ? "+" : ""}
                  className={cn(
                    "font-mono font-bold text-lg",
                    totalMV >= totalInitial ? "text-success" : "text-danger"
                  )}
                />
              </div>
              <div>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  风险敞口比
                </p>
                <FlashNumber
                  value={(institutionMetrics.outstanding / summary.totalSubordinate) * 100}
                  formatter="percent"
                  digits={1}
                  className="font-mono font-bold text-lg text-warning"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={portfolioHistory}
                margin={{ top: 10, right: 15, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="mvGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="instPoolGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(265 89% 70%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(265 89% 70%)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                  interval={Math.floor(portfolioHistory.length / 10)}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                  tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "hsl(142 76% 45%)" }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                  tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                />
                <ReTooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(v: any, name: string) =>
                    [
                      formatCurrency(Number(v)),
                      name === "机构PnL"
                        ? "机构浮盈/浮亏"
                        : name,
                    ] as any
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                  iconType="line"
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="预警线"
                  stroke="hsl(var(--danger))"
                  strokeDasharray="5 5"
                  fill="transparent"
                  strokeWidth={1.5}
                  name="补仓预警线"
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="初始线"
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="5 5"
                  fill="transparent"
                  strokeWidth={1.5}
                  name="初始AUM"
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="组合总市值"
                  stroke="hsl(217 91% 60%)"
                  strokeWidth={2.5}
                  fill="url(#mvGrad2)"
                  name="组合总市值"
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="机构资金池"
                  stroke="hsl(265 89% 70%)"
                  strokeWidth={2}
                  fill="url(#instPoolGrad)"
                  name="机构劣后资金池"
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="累计补仓"
                  stroke="hsl(30 100% 55%)"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                  dot={false}
                  name="机构累计补仓额"
                />
                <Bar
                  yAxisId="right"
                  dataKey="机构PnL"
                  name="机构PnL(右轴)"
                  radius={[2, 2, 0, 0]}
                  barSize={6}
                  fill="hsl(142 72% 40% / 0.55)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 pt-2 border-t border-border/40 grid grid-cols-2 md:grid-cols-4 gap-3 text-[10.5px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-3 w-4 rounded bg-primary/40 border border-primary/60" />
              组合总市值（面积）
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-0.5 w-4 bg-purple-400" />
              机构劣后资金池
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-orange-400" />
              机构累计补仓
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-3 w-4 rounded bg-success/50 border border-success/60" />
              机构单期PnL（右）
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== 风险敞口月度 + 风险分布 ===== */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Shield className="h-4 w-4 text-warning" />
              机构风险敞口 & 补仓月度分布
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              柱体：风险敞口（蓝）· 补仓执行（橙柱）· 过去 12 个月
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riskMonthly} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={65}
                    tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                  />
                  <ReTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    formatter={(v: any) => formatCurrency(Number(v))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="风险敞口"
                    name="机构风险敞口"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                  >
                    <defs>
                      <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(217 91% 60%)" />
                        <stop offset="100%" stopColor="hsl(239 84% 67%)" />
                      </linearGradient>
                    </defs>
                  </Bar>
                  <Bar
                    dataKey="机构补仓"
                    name="机构当月补仓"
                    stackId="a"
                    fill="hsl(30 100% 55%)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-primary" />
              按风险分布（市值权重）
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              击穿 → 预警 → 正常 → 盈利
            </p>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {[
              {
                label: "击穿 (CRITICAL)",
                color: "bg-danger",
                border: "border-danger/30",
                value: riskBreakdown.CRITICAL,
                total: totalMV,
                accent: "text-danger",
              },
              {
                label: "预警 (WARNING)",
                color: "bg-warning",
                border: "border-warning/30",
                value: riskBreakdown.WARNING,
                total: totalMV,
                accent: "text-warning",
              },
              {
                label: "正常 (NORMAL)",
                color: "bg-primary",
                border: "border-primary/30",
                value: riskBreakdown.NORMAL,
                total: totalMV,
                accent: "text-primary",
              },
              {
                label: "盈利 (PROFITABLE)",
                color: "bg-success",
                border: "border-success/30",
                value: riskBreakdown.PROFITABLE,
                total: totalMV,
                accent: "text-success",
              },
            ].map((seg) => {
              const pct = seg.total > 0 ? (seg.value / seg.total) * 100 : 0;
              return (
                <div
                  key={seg.label}
                  className={cn(
                    "rounded-xl border p-3 bg-card/50",
                    seg.border
                  )}
                >
                  <div className="flex items-center justify-between mb-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <span className={cn("h-2.5 w-2.5 rounded-full", seg.color)} />
                      {seg.label}
                    </span>
                    <span className={cn("font-mono font-bold", seg.accent)}>
                      {formatPercent(pct, 1)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary/50 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", seg.color)}
                      style={{ width: `${Math.max(pct, 1.5)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground font-mono">
                    <span>市值</span>
                    <span className="font-semibold">
                      {formatCompactNumber(seg.value)}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* ===== 个股实时行情表 ===== */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Eye className="h-4 w-4" />
            个股实时行情表（含机构视角）
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border/50">
              <div className="col-span-2">标的</div>
              <div className="col-span-2 text-right">实时价格 / 今日</div>
              <div className="col-span-2 text-center">近 30 日走势</div>
              <div className="col-span-2 text-right">机构PnL / 补仓</div>
              <div className="col-span-1 text-center">风险</div>
              <div className="col-span-1 text-right">客户</div>
              <div className="col-span-2 text-right">操作</div>
            </div>
            <div className="divide-y divide-border/40">
              {batches.map((b) => {
                const spark = generateSparklineData(b.stockPriceAtStart);
                const last = spark[spark.length - 1].price;
                const first = spark[0].price;
                const sparkChange = ((last - first) / first) * 100;
                const change = b.currentDayChange || 0;
                const mv = b.currentMarketValue || b.initialTotalAmount;
                const split = calculateBatchPnLSplit(b, mv);
                const metrics = calculateBatchRiskMetrics(
                  b.initialTotalAmount,
                  mv,
                  b.cumulativeMarginCalls || 0
                );
                return (
                  <div
                    key={b.id}
                    className="grid grid-cols-12 items-center px-4 py-3 hover:bg-secondary/30 transition-colors"
                    onClick={() =>
                      setSelectedStock(
                        selectedStock === b.stockSymbol ? null : b.stockSymbol
                      )
                    }
                  >
                    <div className="col-span-2">
                      <p className="font-bold text-sm tracking-tight">
                        {b.stockSymbol}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                        {b.stockName}
                      </p>
                    </div>
                    <div className="col-span-2 text-right">
                      <FlashNumber
                        value={b.currentStockPrice ?? 0}
                        formatter="number"
                        digits={2}
                        prefix="$"
                        className="font-mono font-bold text-sm"
                      />
                      <p
                        className={cn(
                          "text-[11px] font-mono font-semibold flex items-center justify-end gap-0.5",
                          change >= 0 ? "text-success" : "text-danger"
                        )}
                      >
                        {change >= 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {formatPercent(change)}
                      </p>
                    </div>
                    <div className="col-span-2 px-2">
                      <div className="h-10">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={spark}>
                            <Line
                              type="monotone"
                              dataKey="price"
                              stroke={
                                sparkChange >= 0
                                  ? "hsl(142 76% 36%)"
                                  : "hsl(0 63% 45%)"
                              }
                              strokeWidth={1.5}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="col-span-2 text-right space-y-0.5">
                      <FlashNumber
                        value={split.institutionTotalPnL}
                        formatter="currency"
                        prefix=""
                        className={cn(
                          "font-mono text-[11px] font-semibold",
                          split.institutionTotalPnL >= 0
                            ? "text-success"
                            : "text-danger"
                        )}
                      />
                      {metrics.requiredMarginCall > 0 && (
                        <p className="font-mono text-[10.5px] text-warning font-semibold">
                          补仓 {formatCompactNumber(metrics.requiredMarginCall)}
                        </p>
                      )}
                    </div>
                    <div className="col-span-1 text-center">
                      <Badge
                        variant={
                          b.riskLevel === "NORMAL"
                            ? "success"
                            : b.riskLevel === "WARNING"
                            ? "warning"
                            : "danger"
                        }
                        className="text-[10px] px-2"
                      >
                        {b.riskLevel === "NORMAL"
                          ? "低"
                          : b.riskLevel === "WARNING"
                          ? "中"
                          : "高"}
                      </Badge>
                    </div>
                    <div className="col-span-1 text-right font-mono text-xs font-semibold">
                      {b.clients?.length ?? 0} 位
                    </div>
                    <div className="col-span-2 flex justify-end gap-1">
                      <Link href={`/batch/${b.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                          <Layers3 className="h-3.5 w-3.5" />
                          批次详情
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
