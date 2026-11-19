"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { FlashNumber } from "@/components/ui/FlashNumber";
import { cn, formatCurrency, formatCurrencyByUnit } from "@/lib/utils";
import type { PortfolioSummary } from "@/lib/riskEngine";
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Activity,
  Building2,
  Landmark,
  Layers,
  TrendingUp,
  UserCheck,
  Wallet,
  AlertTriangle,
} from "lucide-react";

type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y";

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: "1D", label: "1天" },
  { key: "1W", label: "1周" },
  { key: "1M", label: "1月" },
  { key: "3M", label: "3月" },
  { key: "6M", label: "6月" },
  { key: "1Y", label: "1年" },
];

type SnapshotSeries = Record<
  Timeframe,
  { valuePoints: ValueDataPoint[]; yieldPoints: YieldDataPoint[] }
>;

/* -------- CHART_COLORS + module-level formatters（引用稳定，避免 Recharts 每帧 new function） -------- */
const CHART_COLORS = {
  total: "#60a5fa",      // 总仓位 - 蓝 (primary-ish)
  institution: "#f97316", // 机构 - 橙 (warning-ish)
  client: "#22c55e",      // 客户 - 绿 (success)
  yieldTotal: "#a78bfa",  // 总收益率 - 紫
  yieldInst: "#ef4444",   // 机构收益率 - 红
  yieldClient: "#10b981", // 客户收益率 - 翠绿
};

const VALUE_LEGEND_MAP: Record<string, { label: string; color: string }> = {
  total: { label: "总仓位价值", color: CHART_COLORS.total },
  institution: { label: "WIN100 担保资产价值", color: CHART_COLORS.institution },
  client: { label: "客户资产价值", color: CHART_COLORS.client },
};

const YIELD_LEGEND_MAP: Record<string, { label: string; color: string }> = {
  total: { label: "资产总收益率", color: CHART_COLORS.yieldTotal },
  institution: { label: "WIN100 担保收益率", color: CHART_COLORS.yieldInst },
  client: { label: "客户总收益率", color: CHART_COLORS.yieldClient },
};

const formatCompactMoney = (v: number) =>
  "$" + v.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });

const formatCompactMoneyY = (v: number) =>
  "$" + v.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });

const valueTooltipFormatter = (v: number, n: string) => {
  const cfg = VALUE_LEGEND_MAP[n];
  return [formatCompactMoney(v), cfg?.label ?? n];
};

const valueLegendFormatter = (v: string) => {
  const cfg = VALUE_LEGEND_MAP[v];
  return cfg ? <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span> : v;
};

const yieldTooltipFormatter = (v: number, n: string) => {
  const cfg = YIELD_LEGEND_MAP[n];
  return [
    <span key={n} style={{ color: cfg?.color, fontWeight: 600 }}>
      {v >= 0 ? "+" : ""}
      {v.toFixed(2)}%
    </span>,
    cfg?.label ?? n,
  ];
};

const yieldLegendFormatter = (v: string) => {
  const cfg = YIELD_LEGEND_MAP[v];
  return cfg ? <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span> : v;
};

type ValueDataPoint = { label: string; tooltipLabel: string; total: number; institution: number; client: number };
type YieldDataPoint = { label: string; tooltipLabel: string; total: number; institution: number; client: number };

function ValueChart({
  currentMarketValueTotal,
  institutionValue,
  clientValue,
  totalAUMCost,
  institutionCost,
  clientCost,
  timeframe,
  onTimeframeChange,
  valueDataByTimeframe,
}: {
  currentMarketValueTotal: number;
  institutionValue: number;
  clientValue: number;
  totalAUMCost: number;
  institutionCost: number;
  clientCost: number;
  timeframe: Timeframe;
  onTimeframeChange: (t: Timeframe) => void;
  valueDataByTimeframe: Record<Timeframe, ValueDataPoint[]>;
}) {
  const data = valueDataByTimeframe[timeframe];
  const totalDelta = currentMarketValueTotal - totalAUMCost;
  const instDelta = institutionValue - institutionCost;
  const clientDelta = clientValue - clientCost;

  return (
    <ChartShell
      title="资产价值曲线"
      subtitle="按时间维度观察总仓位 / WIN100 担保 / 客户资产价值"
      icon={Layers}
      iconVariant="primary"
      leftHeader={
        <div className="flex items-baseline gap-2 flex-wrap min-w-[260px]">
          <span className="text-muted-foreground text-[11px] font-medium">当前</span>
          <FlashNumber
            value={currentMarketValueTotal}
            formatter="currency"
            className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap"
          />
        </div>
      }
      timeframe={timeframe}
      onTimeframeChange={onTimeframeChange}
    >
      {data.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">当前时段暂无真实历史数据</p>}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            {(["total", "institution", "client"] as const).map((k) => (
              <linearGradient
                key={`g-${k}`}
                id={`val-${k}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={CHART_COLORS[k]} stopOpacity={0.24} />
                <stop offset="100%" stopColor={CHART_COLORS[k]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.55)" />
          <XAxis
            dataKey="label"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
            tickLine={false}
            tickFormatter={formatCompactMoneyY}
            width={60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border) / 0.8)",
              borderRadius: 12,
              fontSize: 12,
              boxShadow: "0 10px 40px -10px hsl(0 0% 0% / 0.6)",
            }}
            labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
            labelFormatter={(_label: string, payload?: Array<{ payload?: any }>) => {
              const first = payload?.[0]?.payload as ValueDataPoint | undefined;
              return first?.tooltipLabel ?? _label;
            }}
            formatter={valueTooltipFormatter}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={valueLegendFormatter}
          />
          <Line
            type="monotone"
            dataKey="total"
            name="total"
            stroke={CHART_COLORS.total}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="institution"
            name="institution"
            stroke={CHART_COLORS.institution}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="client"
            name="client"
            stroke={CHART_COLORS.client}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* ===== 三条 summary tiles，对应三根线 ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-2">
        <MiniStat
          label="总仓位价值"
          value={currentMarketValueTotal}
          formatter="currency"
          color={CHART_COLORS.total}
          icon={Layers}
          trendAmount={totalDelta}
        />
        <MiniStat
          label="WIN100 担保资产价值"
          value={institutionValue}
          formatter="currency"
          color={CHART_COLORS.institution}
          icon={Landmark}
          trendAmount={instDelta}
        />
        <MiniStat
          label="客户资产价值"
          value={clientValue}
          formatter="currency"
          color={CHART_COLORS.client}
          icon={UserCheck}
          trendAmount={clientDelta}
        />
      </div>
    </ChartShell>
  );
}

/* -------- 收益率曲线图 -------- */
function YieldChart({
  totalPnLPercent,
  institutionPnLPercent,
  allClientsPnLPercent,
  totalPnL,
  institutionPnL,
  allClientsPnL,
  timeframe,
  onTimeframeChange,
  yieldDataByTimeframe,
}: {
  totalPnLPercent: number;
  institutionPnLPercent: number;
  allClientsPnLPercent: number;
  totalPnL: number;
  institutionPnL: number;
  allClientsPnL: number;
  timeframe: Timeframe;
  onTimeframeChange: (t: Timeframe) => void;
  yieldDataByTimeframe: Record<Timeframe, YieldDataPoint[]>;
}) {
  const data = yieldDataByTimeframe[timeframe];

  return (
    <ChartShell
      title="收益率曲线"
      subtitle="总收益率 / WIN100 担保收益率 / 客户收益率 三段对比"
      icon={Activity}
      iconVariant="success"
      leftHeader={
        <div className="flex items-baseline gap-2 flex-wrap min-w-[260px]">
          <span className="text-muted-foreground text-[11px] font-medium">综合</span>
          <FlashNumber
            value={totalPnLPercent}
            formatter="percent"
            digits={2}
            className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap"
          />
        </div>
      }
      timeframe={timeframe}
      onTimeframeChange={onTimeframeChange}
    >
      {data.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">当前时段暂无真实历史数据</p>}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            {(["total", "institution", "client"] as const).map((k) => (
              <linearGradient
                key={`yg-${k}`}
                id={`yield-${k}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={CHART_COLORS[k === "total" ? "yieldTotal" : k === "institution" ? "yieldInst" : "yieldClient"]} stopOpacity={0.24} />
                <stop offset="100%" stopColor={CHART_COLORS[k === "total" ? "yieldTotal" : k === "institution" ? "yieldInst" : "yieldClient"]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.55)" />
          <XAxis
            dataKey="label"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
            tickLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            width={60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border) / 0.8)",
              borderRadius: 12,
              fontSize: 12,
              boxShadow: "0 10px 40px -10px hsl(0 0% 0% / 0.6)",
            }}
            labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
            labelFormatter={(_label: string, payload?: Array<{ payload?: any }>) => {
              const first = payload?.[0]?.payload as YieldDataPoint | undefined;
              return first?.tooltipLabel ?? _label;
            }}
            formatter={yieldTooltipFormatter}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={yieldLegendFormatter}
          />
          <Line
            type="monotone"
            dataKey="total"
            name="total"
            stroke={CHART_COLORS.yieldTotal}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="institution"
            name="institution"
            stroke={CHART_COLORS.yieldInst}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="client"
            name="client"
            stroke={CHART_COLORS.yieldClient}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-2">
        <MiniStat
          label="总收益率"
          value={totalPnLPercent}
          formatter="percent"
          digits={2}
          color={CHART_COLORS.yieldTotal}
          icon={Activity}
          trendAmount={totalPnL}
        />
        <MiniStat
          label="WIN100 担保收益率"
          value={institutionPnLPercent}
          formatter="percent"
          digits={2}
          color={CHART_COLORS.yieldInst}
          icon={Building2}
          trendAmount={institutionPnL}
        />
        <MiniStat
          label="客户收益率"
          value={allClientsPnLPercent}
          formatter="percent"
          digits={2}
          color={CHART_COLORS.yieldClient}
          icon={Wallet}
          trendAmount={allClientsPnL}
        />
      </div>
    </ChartShell>
  );
}

/* -------- OKX 风格通用 chart shell（卡头 + 时间维度胶囊 + 内容区） -------- */
function ChartShell({
  title,
  subtitle,
  icon: Icon,
  iconVariant,
  leftHeader,
  timeframe,
  onTimeframeChange,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: any;
  iconVariant?: "primary" | "success" | "warning" | "danger" | "secondary";
  leftHeader?: React.ReactNode;
  timeframe: Timeframe;
  onTimeframeChange: (t: Timeframe) => void;
  children: React.ReactNode;
}) {
  const variantClass = {
    primary: "bg-primary/15 text-primary border-primary/25",
    success: "bg-success/15 text-success border-success/25",
    warning: "bg-warning/15 text-warning border-warning/25",
    danger: "bg-danger/15 text-danger border-danger/25",
    secondary: "bg-secondary/70 text-muted-foreground border-border/60",
  }[iconVariant || "primary"];

  return (
    <Card className="card-chrome overflow-hidden">
      <CardContent className="p-4 lg:p-5 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                "h-10 w-10 rounded-xl border flex items-center justify-center shrink-0",
                variantClass
              )}
            >
              <Icon className="h-4.5 w-4.5" />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-[15px] font-semibold tracking-tight shrink-0">{title}</h3>
                {leftHeader}
              </div>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 bg-secondary/50 border border-border/70 rounded-lg p-1 self-start shrink-0 overflow-x-auto max-w-full">
            {TIMEFRAMES.map((tf) => {
              const active = tf.key === timeframe;
              return (
                <button
                  key={tf.key}
                  type="button"
                  onClick={() => onTimeframeChange(tf.key)}
                  className={cn(
                    "h-7 min-w-[44px] px-2.5 rounded-full text-[11px] font-semibold tracking-wide transition-all whitespace-nowrap shrink-0",
                    active
                      ? "bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.4)_inset,0_6px_18px_-6px_hsl(var(--primary)/0.45)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/* -------- Chart 下方的 mini stat tile -------- */
const MiniStat = memo(function MiniStat({
  label,
  value,
  formatter,
  digits,
  color,
  icon: Icon,
  trendAmount,
}: {
  label: string;
  value: number;
  formatter?: "currency" | "percent" | "number";
  digits?: number;
  color: string;
  icon: any;
  trendAmount?: number;
}) {
  const trendStr = useMemo(() => {
    if (typeof trendAmount !== "number") return null;
    return trendAmount > 0 ? `+${formatCurrencyByUnit(trendAmount)}` : formatCurrencyByUnit(trendAmount);
  }, [trendAmount]);
  const fullValueTitle = formatter === "currency" ? formatCurrency(value) : undefined;
  const fullTrendTitle =
    typeof trendAmount === "number"
      ? `${trendAmount >= 0 ? "+" : ""}${formatCurrency(trendAmount)}`
      : undefined;
  return (
    <div
      className="rounded-xl border p-3 bg-card/70"
      style={{ borderColor: `${color}33` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="text-[10.5px] text-muted-foreground font-medium tracking-wide">
            {label}
          </p>
          <FlashNumber
            value={value}
            formatter={formatter === "currency" ? "currencyUnit" : formatter}
            digits={digits}
            className={cn(
              "block max-w-full whitespace-nowrap text-xl font-bold tracking-tight",
              formatter === "percent"
                ? value >= 0
                  ? "text-success"
                  : "text-danger"
                : "text-foreground"
            )}
            title={fullValueTitle}
          />
          {trendStr !== null ? (
            <p
              className={cn(
                "max-w-full whitespace-nowrap text-[11px] font-mono font-semibold",
                (trendAmount ?? 0) >= 0 ? "text-success" : "text-danger"
              )}
              title={fullTrendTitle}
            >
              {trendStr}
            </p>
          ) : null}
        </div>
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
});

/* -------- 导出顶层组件 -------- */
export function DashboardCharts({
  summary,
}: {
  summary: PortfolioSummary;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const [snapshotSeries, setSnapshotSeries] = useState<SnapshotSeries | null>(null);
  const persistRef = useRef<{ at: number; fingerprint: string }>({ at: 0, fingerprint: "" });
  /* 派生当前价值：机构 = 原始机构投入 + 累计补仓 + 机构盈亏； 客户 = 原始客户投入 + 客户盈亏 */
  const institutionValue = useMemo(
    () =>
      Math.max(
        0,
        summary.totalSubordinate + summary.totalMarginCalls + summary.institutionPnL
      ),
    [summary.totalSubordinate, summary.totalMarginCalls, summary.institutionPnL]
  );
  const clientValue = useMemo(
    () => Math.max(0, summary.totalPriority + summary.allClientsPnL),
    [summary.totalPriority, summary.allClientsPnL]
  );
  const institutionCost = summary.totalSubordinate + summary.totalMarginCalls;
  const clientCost = summary.totalPriority;

  const snapshotPayload = useMemo(
    () => ({
      totalValue: summary.currentMarketValueTotal,
      institutionValue,
      clientValue,
      totalYieldPct: summary.totalPnLPercent,
      institutionYieldPct: summary.institutionPnLPercent,
      clientYieldPct: summary.allClientsPnLPercent,
      totalPnL: summary.totalPnL,
      institutionPnL: summary.institutionPnL,
      clientPnL: summary.allClientsPnL,
    }),
    [
      summary.currentMarketValueTotal,
      summary.totalPnLPercent,
      summary.institutionPnLPercent,
      summary.allClientsPnLPercent,
      summary.totalPnL,
      summary.institutionPnL,
      summary.allClientsPnL,
      institutionValue,
      clientValue,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/dashboard/snapshots", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.ok || !data?.timeframes) return;
        setSnapshotSeries(data.timeframes as SnapshotSeries);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [summary.totalBatches]);

  useEffect(() => {
    if (summary.totalBatches <= 0) return;
    const fingerprint = [
      snapshotPayload.totalValue.toFixed(2),
      snapshotPayload.institutionValue.toFixed(2),
      snapshotPayload.clientValue.toFixed(2),
      snapshotPayload.totalYieldPct.toFixed(2),
      snapshotPayload.institutionYieldPct.toFixed(2),
      snapshotPayload.clientYieldPct.toFixed(2),
    ].join("|");
    const now = Date.now();
    if (
      fingerprint === persistRef.current.fingerprint &&
      now - persistRef.current.at < 20_000
    ) {
      return;
    }
    if (now - persistRef.current.at < 20_000) {
      return;
    }
    persistRef.current = { at: now, fingerprint };
    void fetch("/api/dashboard/snapshots", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshotPayload),
    }).catch(() => {
      /* ignore */
    });
  }, [snapshotPayload, summary.totalBatches]);

  const { valueDataByTimeframe, yieldDataByTimeframe } = useMemo(() => {
    const v = {} as Record<Timeframe, ValueDataPoint[]>;
    const y = {} as Record<Timeframe, YieldDataPoint[]>;
    for (const k of ["1D", "1W", "1M", "3M", "6M", "1Y"] as Timeframe[]) {
      v[k] = snapshotSeries?.[k]?.valuePoints ?? [];
      y[k] = snapshotSeries?.[k]?.yieldPoints ?? [];
    }
    return { valueDataByTimeframe: v, yieldDataByTimeframe: y };
  }, [snapshotSeries]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <ValueChart
        currentMarketValueTotal={summary.currentMarketValueTotal}
        institutionValue={institutionValue}
        clientValue={clientValue}
        totalAUMCost={summary.totalAUM}
        institutionCost={institutionCost}
        clientCost={clientCost}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        valueDataByTimeframe={valueDataByTimeframe}
      />
      <YieldChart
        totalPnLPercent={summary.totalPnLPercent}
        institutionPnLPercent={summary.institutionPnLPercent}
        allClientsPnLPercent={summary.allClientsPnLPercent}
        totalPnL={summary.totalPnL}
        institutionPnL={summary.institutionPnL}
        allClientsPnL={summary.allClientsPnL}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        yieldDataByTimeframe={yieldDataByTimeframe}
      />
    </div>
  );
}

export default DashboardCharts;
