"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { FlashNumber } from "@/components/ui/FlashNumber";
import { cn } from "@/lib/utils";
import { Batch, RiskLevel } from "@prisma/client";
import {
  AlertTriangle,
  Flame,
  Gauge,
  Layers,
  Lock,
  PlayCircle,
  PlusCircle,
  Calendar,
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
  selectedRisk: string;
  onJump: (target: LadderAnchorTarget | "all") => void;
  onFocusBatch: () => void;
}

export function RiskLadderBar({ batches, summary, selectedRisk, onJump, onFocusBatch }: RiskLadderBarProps) {
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

  const segments = [
    { id: "all", label: "全部", count: summary.totalBatches, color: "bg-muted-foreground" },
    { id: "critical", label: "击穿", count: summary.criticalCount, color: "bg-danger" },
    { id: "warning", label: "预警", count: summary.warningCount, color: "bg-warning" },
    { id: "normal", label: "正常", count: Math.max(0, summary.normalCount - summary.profitableCount), color: "bg-primary" },
    { id: "profit", label: "盈利", count: summary.profitableCount, color: "bg-success" },
  ] as const;

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

        <div className="mb-5">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <Gauge className="h-4 w-4" />
            风险阶梯分布
          </p>
          <div className="mb-2 flex h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
            {segments.slice(1).filter(({ count }) => count > 0).map(({ id, count, color }) => (
              <span key={id} className={color} style={{ flexGrow: count }} />
            ))}
          </div>
          <div className="grid grid-cols-5 gap-1" role="group" aria-label="筛选监控批次">
            {segments.map(({ id, label, count, color }) => (
              <button
                key={id}
                type="button"
                aria-pressed={selectedRisk === id}
                onClick={() => onJump(id)}
                className={cn(
                  "flex min-w-0 flex-wrap items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs hover:bg-secondary/70",
                  selectedRisk === id ? "border-primary bg-secondary font-semibold" : "border-border/60",
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", color)} />
                <span>{label}</span>
                <span className="font-mono">{count}</span>
              </button>
            ))}
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
            onFocusBatch={onFocusBatch}
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
            onFocusBatch={onFocusBatch}
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
  onFocusBatch: () => void;
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
                    props.onFocusBatch();
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
