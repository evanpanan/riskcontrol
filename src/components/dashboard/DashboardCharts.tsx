"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { FlashNumber } from "@/components/ui/FlashNumber";
import { cn } from "@/lib/utils";
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

const TIMEFRAME_POINTS: Record<Timeframe, number> = {
  "1D": 24,
  "1W": 7,
  "1M": 30,
  "3M": 13,
  "6M": 26,
  "1Y": 52,
};

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: "1D", label: "1天" },
  { key: "1W", label: "1周" },
  { key: "1M", label: "1月" },
  { key: "3M", label: "3月" },
  { key: "6M", label: "6月" },
  { key: "1Y", label: "1年" },
];

/* -------- 确定性伪随机（seeded, 同 tick/timeframe 下数据一致）-------- */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatTick(tf: Timeframe, i: number, total: number): string {
  if (tf === "1D") return `${i}:00`;
  if (tf === "1W") return ["一", "二", "三", "四", "五", "六", "日"][i % 7] ?? "";
  if (tf === "1M") return (i + 1).toString();
  if (tf === "3M" || tf === "6M") {
    const months = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
    const startMonth = new Date().getMonth();
    return months[(startMonth + i + 12) % 12] + "月";
  }
  return `W${i + 1}`;
}

/* -------- 合成历史（相对当前值沿时间轴回推，保持最新点为当前值）* 增加"月度新增批次 ramp"：早期批次少 → AUM 自然更低，后期每月新增 4 批 → AUM 阶梯抬升，* 让曲线形状体现"近半年每月都有新增 4 批"的真实增长。-------- */
function synthesizeHistory(
  totalBase: number,
  institutionBase: number,
  clientBase: number,
  timeframe: Timeframe,
  seed: number
) {
  const N = TIMEFRAME_POINTS[timeframe];
  const rnd = mulberry32(seed + TIMEFRAME_POINTS[timeframe] * 7);
  const vol =
    timeframe === "1D"
      ? 0.006
      : timeframe === "1W"
      ? 0.012
      : timeframe === "1M"
      ? 0.025
      : timeframe === "3M"
      ? 0.05
      : timeframe === "6M"
      ? 0.09
      : 0.16;

  /* --- 月度新增批次 ramp：6 个月 × 每月 4 批 → 第 i 个点归一化 0..1 对应 3月→8月 AUM 增长因子 --- * 若 tf < 6 个月，ramp 仍从 0.7 起点开始（部分月已在管），但保持最新点 = 1.0 */
  const rampPoints = (() => {
    const arr: number[] = [];
    for (let i = 0; i < N; i++) {
      const progress = N === 1 ? 1 : i / (N - 1); // 0 = 最早历史点, 1 = 最新点
      // 在 6M 时间框架下，ramp 应该准确对应 3月起点 33% → 8月终点 100%（每月 +1 单位 = 线性）
      // 其他时间框架：更小的动态 range 避免 1D 也 0.3→1 的假陡峭
      let ramp: number;
      if (timeframe === "6M") {
        // 26 点：3月 4 批（起点 4/24=0.167） → 每月 +4/24 线性到 8月 24/24=1.0
        ramp = 4 / 24 + progress * (20 / 24); // 0.167 → 1.0
      } else if (timeframe === "1Y") {
        ramp = 0.12 + progress * 0.88;
      } else if (timeframe === "3M") {
        // 3 个月 13 点：约 6月 40% → 8月 100%
        ramp = 0.45 + progress * 0.55;
      } else if (timeframe === "1M") {
        ramp = 0.82 + progress * 0.18;
      } else if (timeframe === "1W") {
        ramp = 0.93 + progress * 0.07;
      } else {
        // 1D：日内，ramp 很窄
        ramp = 0.98 + progress * 0.02;
      }
      arr.push(ramp);
    }
    // 保证最后一个点 = 1.0（归一化锚点）
    if (arr.length) arr[arr.length - 1] = 1.0;
    return arr;
  })();

  const walk: { t: number; total: number; institution: number; client: number }[] = [];
  let tR = 0,
    iR = 0,
    cR = 0;
  for (let i = 0; i < N; i++) {
    const drift = ((i + 1) / N) * vol * 0.6;
    const shock = (rnd() - 0.5) * 2 * vol;
    const shockI = (rnd() - 0.5) * 2 * vol * 1.15;
    const shockC = (rnd() - 0.5) * 2 * vol * 0.85;
    tR = drift + shock;
    iR = drift * 1.1 + shockI;
    cR = drift * 0.8 + shockC;
    walk.push({
      t: tR,
      total: -tR,
      institution: -iR,
      client: -cR,
    });
  }
  /* 最新点必须等于 current value；同时乘以 ramp 对应每月 AUM 增加 */
  const last = walk[walk.length - 1];
  const scaleT = 1 + (last.total ?? 0);
  const scaleI = 1 + (last.institution ?? 0);
  const scaleC = 1 + (last.client ?? 0);
  return walk.map((w, i) => {
    const ramp = rampPoints[i] ?? 1;
    const total = totalBase * (1 + w.total) / scaleT * ramp;
    const institution = institutionBase * (1 + w.institution) / scaleI * ramp;
    const client = clientBase * (1 + w.client) / scaleC * ramp;
    return {
      label: formatTick(timeframe, i, N),
      total: Math.max(0, total),
      institution: Math.max(0, institution),
      client: Math.max(0, client),
    };
  });
}

/* -------- 资产价值曲线图 -------- */
const CHART_COLORS = {
  total: "#60a5fa",      // 总仓位 - 蓝 (primary-ish)
  institution: "#f97316", // 机构 - 橙 (warning-ish)
  client: "#22c55e",      // 客户 - 绿 (success)
  yieldTotal: "#a78bfa",  // 总收益率 - 紫
  yieldInst: "#ef4444",   // 机构收益率 - 红
  yieldClient: "#10b981", // 客户收益率 - 翠绿
};

function ValueChart({
  seed,
  currentMarketValueTotal,
  institutionValue,
  clientValue,
  totalAUMCost,
  institutionCost,
  clientCost,
}: {
  seed: number;
  currentMarketValueTotal: number;
  institutionValue: number;
  clientValue: number;
  totalAUMCost: number;
  institutionCost: number;
  clientCost: number;
}) {
  const [tf, setTf] = useState<Timeframe>("1M");
  const data = useMemo(
    () => synthesizeHistory(currentMarketValueTotal, institutionValue, clientValue, tf, seed),
    [currentMarketValueTotal, institutionValue, clientValue, tf, seed]
  );
  const totalDelta = currentMarketValueTotal - totalAUMCost;
  const instDelta = institutionValue - institutionCost;
  const clientDelta = clientValue - clientCost;
  const formatMoney = (v: number) =>
    "$" +
    v.toLocaleString(undefined, {
      notation: "compact",
      maximumFractionDigits: 2,
    });

  return (
    <ChartShell
      title="资产价值曲线"
      subtitle="按时间维度观察总仓位 / 机构 / 客户资产价值"
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
      timeframe={tf}
      onTimeframeChange={setTf}
    >
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
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
            tickLine={false}
            tickFormatter={(v) =>
              "$" + v.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 })
            }
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
            formatter={(v: number, n: string) => {
              const map: Record<string, string> = {
                total: "总仓位价值",
                institution: "机构资产价值",
                client: "客户资产价值",
              };
              return [formatMoney(v), map[n] ?? n];
            }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(v: string) => {
              const map: Record<string, { label: string; color: string }> = {
                total: { label: "总仓位价值", color: CHART_COLORS.total },
                institution: { label: "机构资产价值", color: CHART_COLORS.institution },
                client: { label: "客户资产价值", color: CHART_COLORS.client },
              };
              const cfg = map[v];
              return (
                <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
              );
            }}
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
          label="机构资产价值"
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
  seed,
  totalPnLPercent,
  institutionPnLPercent,
  allClientsPnLPercent,
  totalPnL,
  institutionPnL,
  allClientsPnL,
}: {
  seed: number;
  totalPnLPercent: number;
  institutionPnLPercent: number;
  allClientsPnLPercent: number;
  totalPnL: number;
  institutionPnL: number;
  allClientsPnL: number;
}) {
  const [tf, setTf] = useState<Timeframe>("1M");
  const data = useMemo(() => {
    const N = TIMEFRAME_POINTS[tf];
    const rnd = mulberry32(seed + TIMEFRAME_POINTS[tf] * 11);
    const vol =
      tf === "1D"
        ? 1.2
        : tf === "1W"
        ? 2.5
        : tf === "1M"
        ? 5
        : tf === "3M"
        ? 10
        : tf === "6M"
        ? 16
        : 28;
    const walk: { t: number; i: number; c: number }[] = [];
    for (let idx = 0; idx < N; idx++) {
      const k = (idx + 1) / N;
      walk.push({
        t: totalPnLPercent * k + (rnd() - 0.5) * vol,
        i: institutionPnLPercent * k + (rnd() - 0.5) * vol * 1.2,
        c: allClientsPnLPercent * k + (rnd() - 0.5) * vol * 0.85,
      });
    }
    /* 让最后一点等于当前百分比 */
    const last = walk[walk.length - 1];
    const adjT = totalPnLPercent - last.t;
    const adjI = institutionPnLPercent - last.i;
    const adjC = allClientsPnLPercent - last.c;
    return walk.map((w, i) => {
      const t = w.t + adjT * ((i + 1) / N);
      const inst = w.i + adjI * ((i + 1) / N);
      const cl = w.c + adjC * ((i + 1) / N);
      return {
        label: formatTick(tf, i, N),
        total: +t.toFixed(2),
        institution: +inst.toFixed(2),
        client: +cl.toFixed(2),
      };
    });
  }, [
    totalPnLPercent,
    institutionPnLPercent,
    allClientsPnLPercent,
    tf,
    seed,
  ]);

  return (
    <ChartShell
      title="收益率曲线"
      subtitle="总收益率 / 机构收益率 / 客户收益率 三段对比"
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
      timeframe={tf}
      onTimeframeChange={setTf}
    >
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
            formatter={(v: number, n: string) => {
              const map: Record<string, { label: string; color: string }> = {
                total: { label: "资产总收益率", color: CHART_COLORS.yieldTotal },
                institution: { label: "机构总收益率", color: CHART_COLORS.yieldInst },
                client: { label: "客户总收益率", color: CHART_COLORS.yieldClient },
              };
              const cfg = map[n];
              return [
                <span style={{ color: cfg.color, fontWeight: 600 }}>
                  {v >= 0 ? "+" : ""}
                  {v.toFixed(2)}%
                </span>,
                cfg.label,
              ];
            }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(v: string) => {
              const map: Record<string, { label: string; color: string }> = {
                total: { label: "资产总收益率", color: CHART_COLORS.yieldTotal },
                institution: { label: "机构总收益率", color: CHART_COLORS.yieldInst },
                client: { label: "客户总收益率", color: CHART_COLORS.yieldClient },
              };
              const cfg = map[v];
              return (
                <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
              );
            }}
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
          label="机构收益率"
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
      <CardContent className="p-5 lg:p-6 space-y-3">
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
              {subtitle && (
                <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="inline-flex items-center gap-1 bg-secondary/50 border border-border/70 rounded-full p-1 self-start shrink-0 overflow-x-auto max-w-full">
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
function MiniStat({
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
  return (
    <div
      className="rounded-xl border p-3 bg-card/70"
      style={{ borderColor: `${color}33` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="text-[10.5px] uppercase text-muted-foreground font-medium tracking-wide">
            {label}
          </p>
          <FlashNumber
            value={value}
            formatter={formatter}
            digits={digits}
            className={cn(
              "text-xl font-bold tracking-tight",
              formatter === "percent"
                ? value >= 0
                  ? "text-success"
                  : "text-danger"
                : "text-foreground"
            )}
          />
          {typeof trendAmount === "number" ? (
            <p
              className={cn(
                "text-[11px] font-mono font-semibold",
                trendAmount >= 0 ? "text-success" : "text-danger"
              )}
            >
              {trendAmount >= 0 ? "+" : ""}
              {trendAmount.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                notation: "compact",
                maximumFractionDigits: 2,
              })}
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
}

/* -------- 导出顶层组件 -------- */
export function DashboardCharts({
  summary,
  seedTick = 0,
}: {
  summary: PortfolioSummary;
  seedTick?: number;
}) {
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

  /* ================= 需求2 修复：曲线 seed 从 tick 脱离 ================= * 原先 seed = 1337 + seedTick，而 seedTick 每 3 秒 +1， * 导致 mulberry32 的合成历史每 3 秒被重新 seed → 曲线每隔几秒抖动。 *  * 新规则：seed 直接派生自 summary 的数值 hash（价格/仓位真正变动时才变）， * 和 seedTick 完全解耦。股价不动 = summary 数值不动 = seed 不动 = 曲线不动。 */
  const stableSeed = useMemo(() => {
    const raw = [
      summary.currentMarketValueTotal.toFixed(2),
      summary.institutionPnL.toFixed(2),
      summary.allClientsPnL.toFixed(2),
      summary.totalSubordinate.toFixed(2),
      summary.totalPriority.toFixed(2),
      summary.totalMarginCalls?.toFixed(2) ?? "0",
    ].join("|");
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 42;
  }, [
    summary.currentMarketValueTotal,
    summary.institutionPnL,
    summary.allClientsPnL,
    summary.totalSubordinate,
    summary.totalPriority,
    summary.totalMarginCalls,
  ]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <ValueChart
        seed={stableSeed}
        currentMarketValueTotal={summary.currentMarketValueTotal}
        institutionValue={institutionValue}
        clientValue={clientValue}
        totalAUMCost={summary.totalAUM}
        institutionCost={institutionCost}
        clientCost={clientCost}
      />
      <YieldChart
        seed={stableSeed}
        totalPnLPercent={summary.totalPnLPercent}
        institutionPnLPercent={summary.institutionPnLPercent}
        allClientsPnLPercent={summary.allClientsPnLPercent}
        totalPnL={summary.totalPnL}
        institutionPnL={summary.institutionPnL}
        allClientsPnL={summary.allClientsPnL}
      />
    </div>
  );
}

export default DashboardCharts;
