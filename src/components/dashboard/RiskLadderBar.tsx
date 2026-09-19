"use client";

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
  TrendingUp as TrendingUpIcon,
  MousePointerClick,
} from "lucide-react";

export type LadderAnchorTarget = "profit" | "normal" | "warning" | "critical";

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
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    try {
      el.classList.add("ring-2", "ring-primary/60", "rounded-xl");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/60", "rounded-xl"), 1600);
    } catch {}
  }
}

export function RiskLadderBar({ batches, summary, onJump }: RiskLadderBarProps) {
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

  const handleSeg = (t: LadderAnchorTarget) => {
    jumpTo(t);
    if (onJump) onJump(t);
  };

  return (
    <Card className="card-chrome overflow-hidden">
      <CardContent className="p-5 lg:p-6">
        {/* ===== Header row with 4 mini KPIs ===== */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <MiniTile
            icon={Layers}
            label="在管批次"
            value={summary.totalBatches}
            formatter="number"
            sub={`${summary.totalClients} 位客户`}
          />
          <MiniTile
            icon={Gauge}
            label="资产总规模"
            value={summary.totalAUM}
            formatter="currency"
            sub="优先 70% · 劣后 30%"
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
            sub={`预警 ${summary.warningCount} · 击穿 ${summary.criticalCount}`}
            iconVariant="danger"
            highlight={summary.criticalCount > 0}
          />
        </div>

        {/* ===== Ladder segments bar ===== */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold tracking-wide text-foreground/90">
                风险阶梯分布
              </p>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/80 font-mono">
                <MousePointerClick className="h-3 w-3 opacity-70" />
                点击分段直达批次
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-mono">
              击穿{">"}20% · 预警15-20% · 正常{"<"}15% · 盈利≥0%
            </p>
          </div>

          <div className="relative h-14 w-full rounded-xl overflow-hidden border border-border/70 bg-secondary/40">
            <div className="absolute inset-y-0 left-0 flex items-stretch w-full">
              <button
                type="button"
                onClick={() => handleSeg("critical")}
                className="group relative flex items-center justify-start px-4 text-danger-foreground bg-gradient-to-r from-danger/75 via-danger/60 to-danger/45 hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer border-r border-foreground/5"
                style={{ width: `${critW}%` }}
                aria-label={`击穿批次 ${critCount}，点击直达`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold min-w-0 truncate">
                  <Flame className="h-3.5 w-3.5 shrink-0" />
                  击穿 {critCount}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSeg("warning")}
                className="group relative flex items-center justify-center px-3 text-warning-foreground bg-gradient-to-r from-warning/55 via-warning/45 to-warning/35 hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer border-r border-foreground/5"
                style={{ width: `${warnW}%` }}
                aria-label={`预警批次 ${warnCount}，点击直达`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold min-w-0 truncate">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  预警 {warnCount}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSeg("normal")}
                className="group relative flex items-center justify-center px-3 text-primary-foreground bg-gradient-to-r from-primary/60 via-primary/48 to-primary/35 hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer border-r border-foreground/5"
                style={{ width: `${normalW}%` }}
                aria-label={`正常批次 ${normalCount}，点击直达`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold min-w-0 truncate">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  正常 {normalCount}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSeg("profit")}
                className="group relative flex items-center justify-end px-4 text-emerald-50 bg-gradient-to-r from-emerald-500/40 via-emerald-600/50 to-emerald-500/70 hover:brightness-110 hover:scale-[1.01] transition-all cursor-pointer"
                style={{ width: `${profitW}%` }}
                aria-label={`盈利批次 ${profitCount}，点击直达`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold min-w-0 truncate drop-shadow-sm">
                  盈利 {profitCount}
                  <TrendingUpIcon className="h-3.5 w-3.5 shrink-0" />
                </div>
              </button>
            </div>

            {/* marker lines at 15% & 20% */}
            <div className="absolute top-0 bottom-0 w-px bg-foreground/10 pointer-events-none" style={{ left: "50%" }} />
            <div className="absolute top-0 bottom-0 w-px bg-foreground/10 pointer-events-none" style={{ left: "75%" }} />
            <div className="absolute -bottom-0 left-0 right-0 flex text-[10px] font-mono text-muted-foreground/80 px-3 pb-1 pointer-events-none">
              <span>0%</span>
              <span className="ml-auto mr-[25%]">15%</span>
              <span className="ml-auto">20%</span>
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
          />
          <FocusPanel
            title="接近预警线"
            icon={AlertTriangle}
            accent="warning"
            count={summary.warningCount}
            batches={warnBatches}
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
}) {
  const Icon = props.icon;
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
        <ul className="space-y-1.5">
          {props.batches.map((b) => {
            const initAmt = b.initialTotalAmount ?? 0;
            const curMV = b.currentMarketValue ?? initAmt;
            const drop = initAmt > 0 ? ((curMV - initAmt) / initAmt) * 100 : 0;
            return (
              <li
                key={b.id}
                className="group flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded-md hover:bg-background/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground w-16 shrink-0">
                    {b.batchNumber}
                  </span>
                  <span className="font-semibold tracking-tight">{b.stockSymbol}</span>
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                    {b.stockName}
                  </span>
                </div>
                <FlashNumber
                  value={drop}
                  formatter="percent"
                  digits={2}
                  className="text-[11px] font-bold font-mono"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
