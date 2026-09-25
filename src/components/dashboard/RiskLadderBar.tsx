"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { FlashNumber } from "@/components/ui/FlashNumber";
import { cn } from "@/lib/utils";
import { Batch, RiskLevel } from "@prisma/client";
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  Gauge,
  Layers,
  Lock,
  PlayCircle,
  PlusCircle,
  Calendar,
  TrendingUp as TrendingUpIcon,
  MousePointerClick,
  LineChart,
} from "lucide-react";
import { useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export type LadderAnchorTarget = "profit" | "normal" | "warning" | "critical";

export function jumpToId(id: string, withRing: boolean = true) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  if (withRing) {
    try {
      el.classList.add("ring-2", "ring-primary/70", "rounded-xl", "ring-offset-2", "ring-offset-background");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary/70", "rounded-xl", "ring-offset-2", "ring-offset-background");
      }, 1800);
    } catch {}
  }
}

interface RiskLadderBarProps {
  batches: Batch[];
  summary: {
    profitableCount: number;
    normalCount: number;
    warningCount: number;
    criticalCount: number;
    lockedCount: number;
    tradingCount: number;
    totalBatches: number;
    totalClients: number;
    totalAUM: number;
  };
  onJump?: (target: LadderAnchorTarget) => void;
}

function jumpTo(target: LadderAnchorTarget) {
  if (typeof document === "undefined") return;
  const map: Record<LadderAnchorTarget, string> = {
    profit: "anchor-profit",
    normal: "anchor-normal",
    warning: "anchor-warning",
    critical: "anchor-critical",
  };
  const id = map[target];
  jumpToId(id);
}

export function RiskLadderBar({ batches, summary, onJump }: RiskLadderBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    const batchAnchor = searchParams?.get("focus_batch");
    if (batchAnchor) {
      const t = setTimeout(() => jumpToId(`batch-${batchAnchor}`), 120);
      return () => clearTimeout(t);
    }
  }, [searchParams]);

  const total = Math.max(1, summary.totalBatches);
  const profitCount = Math.max(0, summary.profitableCount);
  const normalCount = Math.max(0, summary.normalCount - profitCount);
  const warnCount = summary.warningCount;
  const critCount = summary.criticalCount;
  const MIN_SEG = 5;
  const rawProfit = profitCount / total * 100;
  const rawNormal = normalCount / total * 100;
  const rawWarn = warnCount / total * 100;
  const rawCrit = critCount / total * 100;
  const needMinProfit = rawProfit < MIN_SEG;
  const needMinNormal = rawNormal < MIN_SEG;
  const needMinWarn = rawWarn < MIN_SEG;
  const needMinCrit = rawCrit < MIN_SEG;
  const minAllocated =
    (needMinProfit ? MIN_SEG : 0) +
    (needMinNormal ? MIN_SEG : 0) +
    (needMinWarn ? MIN_SEG : 0) +
    (needMinCrit ? MIN_SEG : 0);
  const remaining = 100 - minAllocated;
  const rawBigSum =
    (needMinProfit ? 0 : rawProfit) +
    (needMinNormal ? 0 : rawNormal) +
    (needMinWarn ? 0 : rawWarn) +
    (needMinCrit ? 0 : rawCrit) || 1;
  const profitW = needMinProfit ? MIN_SEG : (rawProfit / rawBigSum) * remaining;
  const normalW = needMinNormal ? MIN_SEG : (rawNormal / rawBigSum) * remaining;
  const warnW = needMinWarn ? MIN_SEG : (rawWarn / rawBigSum) * remaining;
  const critW = needMinCrit ? MIN_SEG : (rawCrit / rawBigSum) * remaining;

  const critBatches = batches
    .filter((b) => b.riskLevel === RiskLevel.CRITICAL)
    .slice(0, 3);
  const warnBatches = batches
    .filter((b) => b.riskLevel === RiskLevel.WARNING)
    .slice(0, 3);

  // ====== 近 6 月月度新增批次统计（4月 / 5月 / 6月 / 7月 / 8月 / 9月）======
  const monthlySeries = (() => {
    const byMonthKey = new Map<string, { label: string; count: number; cumAUM: number }>();
    for (const b of batches) {
      const d = new Date(b.signDate ?? b.createdAt ?? 0);
      if (!isFinite(d.valueOf())) continue;
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const existing = byMonthKey.get(key) ?? { label: `${y}年${m}月`, count: 0, cumAUM: 0 };
      existing.count += 1;
      existing.cumAUM += Number(b.initialTotalAmount ?? b.currentMarketValue ?? 0);
      byMonthKey.set(key, existing);
    }
    const keysSorted = Array.from(byMonthKey.keys()).sort();
    const last6 = keysSorted.slice(-6);
    const maxCount = Math.max(1, ...last6.map((k) => byMonthKey.get(k)!.count));
    let runningTotal = 0;
    return last6.map((key, idx) => {
      const item = byMonthKey.get(key)!;
      runningTotal += item.count;
      const [_y, _m] = key.split("-");
      return {
        key,
        label: `${Number(_m)}月`,
        monthFullLabel: item.label,
        count: item.count,
        cumAUM: item.cumAUM,
        heightPct: Math.round((item.count / maxCount) * 100),
        runningTotal,
        isLast: idx === last6.length - 1,
        yearLabel: idx === 0 || _m === "01" ? _y : undefined,
      };
    });
  })();
  const thisMonthLabel = monthlySeries[monthlySeries.length - 1]?.monthFullLabel ?? "";
  const thisMonthCount = monthlySeries[monthlySeries.length - 1]?.count ?? 0;
  const lastMonthCount = monthlySeries[monthlySeries.length - 2]?.count ?? 0;
  const sixMonthCreatedTotal = monthlySeries.reduce((s, m) => s + m.count, 0);

  const handleSeg = (t: LadderAnchorTarget) => {
    jumpTo(t);
    if (onJump) onJump(t);
  };

  return (
    <Card className="card-chrome overflow-hidden">
      <CardContent className="p-5 lg:p-6">
        {/* ===== Header row with 4 mini KPIs ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-5">
          <MiniTile
            icon={Layers}
            label="在管批次"
            value={summary.totalBatches}
            formatter="number"
            digits={0}
            sub={`${summary.totalClients} 位客户`}
          />
          <MiniTile
            icon={Lock}
            label="锁仓 / 交易"
            value={`${summary.lockedCount} / ${summary.tradingCount}`}
            sub="前 6 月为锁仓期"
            iconVariant="secondary"
            isLabel
          />
          <MiniTile
            icon={Flame}
            label="需关注批次"
            value={summary.warningCount + summary.criticalCount}
            formatter="number"
            digits={0}
            sub={`预警 ${summary.warningCount} · 击穿 ${summary.criticalCount}`}
            iconVariant="danger"
            highlight={summary.criticalCount > 0}
          />
          <MiniTile
            icon={PlusCircle}
            label={`${thisMonthLabel} 新增批次`}
            value={thisMonthCount}
            formatter="number"
            digits={0}
            sub={`上月 +${lastMonthCount} · 近 6 月共 +${sixMonthCreatedTotal}`}
            iconVariant="success"
            highlight={thisMonthCount > 0}
          />
        </div>

        {/* ===== Ladder segments bar ===== */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-foreground/90" />
              <p className="text-xs font-semibold tracking-wide text-foreground">
                风险阶梯分布
              </p>
              <span className="inline-flex items-center gap-1 text-[10px] text-foreground/90 font-mono">
                <MousePointerClick className="h-3 w-3 opacity-80" />
                点击分段直达批次
              </span>
            </div>
            <p className="text-[11px] text-foreground/95 font-mono">
              击穿{">"}20% · 预警15-20% · 正常{"<"}15% · 盈利≥0%
            </p>
          </div>

          <div className="relative h-14 w-full rounded-xl overflow-hidden border border-border/70 bg-secondary/40">
            <div className="absolute inset-y-0 left-0 flex items-stretch w-full">
              <button
                type="button"
                onClick={() => handleSeg("critical")}
                className="group relative flex items-center justify-center px-1.5 text-white bg-danger hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer"
                style={{ width: `${critW}%` }}
                aria-label={`击穿批次 ${critCount}，点击直达`}
              >
                <div className="flex items-center gap-1 text-[11px] font-bold whitespace-nowrap drop-shadow-sm">
                  <Flame className="h-3 w-3 shrink-0" />
                  击穿 {critCount}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSeg("warning")}
                className="group relative flex items-center justify-center px-1.5 text-white bg-warning hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer"
                style={{ width: `${warnW}%` }}
                aria-label={`预警批次 ${warnCount}，点击直达`}
              >
                <div className="flex items-center gap-1 text-[11px] font-bold whitespace-nowrap drop-shadow-sm">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  预警 {warnCount}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSeg("normal")}
                className="group relative flex items-center justify-center px-1.5 text-white bg-primary hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer"
                style={{ width: `${normalW}%` }}
                aria-label={`正常批次 ${normalCount}，点击直达`}
              >
                <div className="flex items-center gap-1 text-[11px] font-bold whitespace-nowrap drop-shadow-sm">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  正常 {normalCount}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSeg("profit")}
                className="group relative flex items-center justify-center px-1.5 text-white bg-success hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer"
                style={{ width: `${profitW}%` }}
                aria-label={`盈利批次 ${profitCount}，点击直达`}
              >
                <div className="flex items-center gap-1 text-[11px] font-bold whitespace-nowrap drop-shadow-md">
                  盈利 {profitCount}
                  <TrendingUpIcon className="h-3 w-3 shrink-0" />
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* ===== Critical / Warning focus rows ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FocusPanel
            title="需补仓批次"
            icon={Flame}
            accent="danger"
            count={summary.criticalCount}
            batches={critBatches}
            router={router}
            pathname={pathname}
            searchParams={searchParams}
          />
          <FocusPanel
            title="接近预警线"
            icon={AlertTriangle}
            accent="warning"
            count={summary.warningCount}
            batches={warnBatches}
            router={router}
            pathname={pathname}
            searchParams={searchParams}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== sub-components ========== */
function MiniTile(props: {
  icon: any;
  label: string;
  value: any;
  formatter?: "currency" | "percent" | "number";
  digits?: number;
  sub?: string;
  iconVariant?: "primary" | "success" | "warning" | "danger" | "secondary";
  highlight?: boolean;
  isLabel?: boolean;
}) {
  const Icon = props.icon;
  const variantClass = {
    primary: "bg-primary/15 text-primary border-primary/25",
    success: "bg-success/15 text-success border-success/25",
    warning: "bg-warning/15 text-warning border-warning/25",
    danger: "bg-danger/15 text-danger border-danger/25",
    secondary: "bg-secondary/70 text-muted-foreground border-border/60",
  }[props.iconVariant || "primary"];

  return (
    <div className="group relative rounded-xl border border-border/60 bg-card/60 p-3.5 hover:border-primary/30 hover:bg-card/90 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground tracking-wide uppercase font-medium">
            {props.label}
          </p>
          <div className="min-h-[26px] flex items-baseline">
            {props.isLabel ? (
              <span className="text-lg font-bold font-mono tracking-tight">{props.value}</span>
            ) : (
              <FlashNumber
                value={typeof props.value === "number" ? props.value : 0}
                formatter={props.formatter}
                digits={props.digits}
                className="text-lg font-bold tracking-tight"
              />
            )}
          </div>
          {props.sub && (
            <p className="text-[11px] text-muted-foreground truncate">{props.sub}</p>
          )}
        </div>
        <div
          className={cn(
            "h-9 w-9 rounded-lg border flex items-center justify-center shrink-0",
            variantClass,
            props.highlight && "animate-breath-danger"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function FocusPanel(props: {
  title: string;
  icon: any;
  accent: "warning" | "danger";
  count: number;
  batches: Batch[];
  router: ReturnType<typeof useRouter>;
  pathname: string;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const Icon = props.icon;
  const router = props.router;
  const pathname = props.pathname;
  const searchParams = props.searchParams;
  const accentClass =
    props.accent === "danger"
      ? "text-danger border-danger/30 bg-danger/[0.04]"
      : "text-warning border-warning/30 bg-warning/[0.04]";
  return (
    <div className={cn("rounded-xl border p-4", accentClass)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <p className="text-xs font-semibold tracking-wide">{props.title}</p>
        </div>
        <span className="text-xs font-mono font-bold">{props.count}</span>
      </div>

      {props.batches.length === 0 ? (
        <div className="flex items-center gap-2 py-5 justify-center text-[11px] text-muted-foreground">
          <PlayCircle className="h-4 w-4 opacity-60" />
          当前无 {props.accent === "danger" ? "击穿" : "预警"} 批次
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {props.batches.map((b) => {
            const initAmt = b.initialTotalAmount ?? 0;
            const curMV = b.currentMarketValue ?? initAmt;
            const drop = initAmt > 0 ? ((curMV - initAmt) / initAmt) * 100 : 0;
            return (
              <li
                key={b.id}
                className="group flex items-center justify-between text-[12px] rounded-md cursor-pointer"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const next = new URLSearchParams(searchParams?.toString() ?? "");
                    next.set("focus_batch", b.id);
                    router.replace(`${pathname}?${next.toString()}#batch-${b.id}`, { scroll: false });
                    setTimeout(() => jumpToId(`batch-${b.id}`), 10);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-background/60 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold w-32 shrink-0">
                      {b.batchNumber}
                    </span>
                  </div>
                  <FlashNumber
                    value={drop}
                    formatter="percent"
                    digits={2}
                    className="text-[11px] font-bold font-mono"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
