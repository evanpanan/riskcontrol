"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatCurrency, formatPercent, formatDate, calculateTradingWindows } from "@/lib/utils";
import {
  calculateBatchRiskMetrics,
  calculateBatchPnLSplit,
  WARNING_DROP_THRESHOLD,
  CRITICAL_DROP_THRESHOLD,
} from "@/lib/riskEngine";
import { Batch, RiskLevel, Client, MarginCall } from "@prisma/client";
import {
  Lock,
  Unlock,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  Users,
  History,
  TrendingDown,
  TrendingUp,
  Zap,
  DollarSign,
  Landmark,
  UserCheck,
} from "lucide-react";

interface BatchGridCardProps {
  batch: Batch & { clients?: Client[]; marginCalls?: MarginCall[] };
}

const statusBadge = {
  normal: { variant: "success" as const, label: "正常", icon: null },
  warning: { variant: "warning" as const, label: "接近预警", icon: AlertTriangle },
  critical: { variant: "danger" as const, label: "需补仓", icon: AlertCircle },
};

export function BatchGridCard({ batch }: BatchGridCardProps) {
  const mv = batch.currentMarketValue || batch.initialTotalAmount;
  const metrics = calculateBatchRiskMetrics(
    batch.initialTotalAmount,
    mv,
    batch.cumulativeMarginCalls || 0
  );
  const split = calculateBatchPnLSplit(batch, mv);
  const tradingInfo = calculateTradingWindows(batch.signDate);

  const riskKey = batch.riskLevel === RiskLevel.NORMAL ? "normal" :
                  batch.riskLevel === RiskLevel.WARNING ? "warning" : "critical";
  const badge = statusBadge[riskKey];
  const StatusIcon = badge.icon;

  const borderColorByRisk = cn(
    batch.riskLevel === RiskLevel.CRITICAL && "border-danger/60 shadow-lg shadow-danger/10",
    batch.riskLevel === RiskLevel.WARNING && "border-warning/60 shadow-md shadow-warning/10",
    batch.riskLevel === RiskLevel.NORMAL && "border-border/60"
  );

  const progressVariant =
    batch.riskLevel === RiskLevel.CRITICAL
      ? "danger"
      : batch.riskLevel === RiskLevel.WARNING
      ? "warning"
      : "success";

  const dayChange = batch.currentDayChange || 0;

  return (
    <Card className={cn(
      "group overflow-hidden transition-all duration-300 hover:shadow-xl border-border/50",
      borderColorByRisk,
      batch.riskLevel === RiskLevel.CRITICAL && "animate-breath-danger",
      batch.riskLevel === RiskLevel.WARNING && "animate-breath-warning"
    )}>
      <CardContent className="p-0">
        {/* HEADER */}
        <div className={cn(
          "p-4 border-b border-border/50",
          batch.riskLevel === RiskLevel.CRITICAL && "bg-danger/5",
          batch.riskLevel === RiskLevel.WARNING && "bg-warning/5"
        )}>
          <div className="flex items-start justify-between mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-muted-foreground tracking-wide">
                  {batch.batchNumber}
                </span>
                <Badge
                  variant={tradingInfo.isLocked ? "secondary" : "success"}
                  className={cn(
                    "gap-1 px-2 py-0 text-[10px]",
                    tradingInfo.isLocked ? "bg-muted text-muted-foreground" : "bg-success/15 text-success border-success/30"
                  )}
                >
                  {tradingInfo.isLocked ? (
                    <><Lock className="h-2.5 w-2.5" /> 锁仓期</>
                  ) : tradingInfo.isTradingWindow ? (
                    <><Zap className="h-2.5 w-2.5" /> 交易窗口</>
                  ) : (
                    <><Unlock className="h-2.5 w-2.5" /> 开放期</>
                  )}
                </Badge>
              </div>
              <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="text-xl font-bold tracking-tight truncate">
                  {batch.stockSymbol}
                </h3>
                {batch.stockName && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                        {batch.stockName}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{batch.stockName}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            <Badge variant={badge.variant as any} className="gap-1 shrink-0">
              {StatusIcon && <StatusIcon className="h-3 w-3" />}
              {badge.label}
            </Badge>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono">
                  ${batch.currentStockPrice?.toFixed(2) || "--"}
                </span>
                <span className={cn(
                  "flex items-center gap-0.5 text-xs font-semibold font-mono",
                  dayChange >= 0 ? "text-success" : "text-danger"
                )}>
                  {dayChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {formatPercent(dayChange)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                入场价 ${batch.stockPriceAtStart.toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                签约 / 到期
              </p>
              <p className="text-xs font-mono font-medium">
                {formatDate(batch.signDate)} → {formatDate(batch.maturityDate)}
              </p>
            </div>
          </div>
        </div>

        {/* METRICS */}
        <div className="p-4 space-y-4">
          {/* Market Value vs Initial */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                当前市值
              </p>
              <p className={cn(
                "text-sm font-bold font-mono",
                metrics.totalPnL < 0 ? "text-danger" : "text-success"
              )}>
                {formatCurrency(mv)}
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                初始总资
              </p>
              <p className="text-sm font-mono font-semibold">
                {formatCurrency(batch.initialTotalAmount)}
              </p>
            </div>
          </div>

          {/* Safety Buffer Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                安全缓冲 (距 20% 补仓线)
              </span>
              <span className={cn(
                "text-xs font-bold font-mono",
                metrics.safetyBufferPercent <= 5 && "text-danger",
                metrics.safetyBufferPercent > 5 && metrics.safetyBufferPercent <= 10 && "text-warning",
                metrics.safetyBufferPercent > 10 && "text-success"
              )}>
                {metrics.safetyBufferPercent > 0
                  ? `${metrics.safetyBufferPercent.toFixed(1)}%`
                  : "已击穿"}
              </span>
            </div>
            <div className="relative">
              <div className="absolute inset-0 h-2 rounded-full overflow-hidden">
                <div className="h-full w-full bg-gradient-to-r from-danger/40 via-warning/40 to-success/40" />
              </div>
              <Progress
                value={Math.max(0, metrics.safetyBufferPercent)}
                max={CRITICAL_DROP_THRESHOLD * 100}
                variant={progressVariant}
                className="h-2 bg-transparent"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 h-4 w-0.5 bg-foreground/60 -ml-px"
                style={{ left: `${(WARNING_DROP_THRESHOLD / CRITICAL_DROP_THRESHOLD) * 100}%` }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="absolute h-4 w-0.5 -ml-px bg-dashed" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">15% 预警线</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* P&L and Margin Calls */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> 累计浮动盈亏
              </p>
              <p className={cn(
                "text-sm font-bold font-mono",
                metrics.totalPnL < 0 ? "text-danger" : metrics.totalPnL > 0 ? "text-success" : "text-foreground"
              )}>
                {formatPercent(metrics.totalPnLPercent)}
                <span className="text-[10px] ml-1 opacity-80">
                  ({metrics.totalPnL >= 0 ? "+" : ""}
                  {formatCurrency(metrics.totalPnL)})
                </span>
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1 justify-end">
                <History className="h-3 w-3" /> 机构补仓
              </p>
              <p className={cn(
                "text-sm font-bold font-mono",
                batch.cumulativeMarginCalls > 0 ? "text-warning" : "text-muted-foreground"
              )}>
                {formatCurrency(batch.cumulativeMarginCalls || 0)}
              </p>
            </div>
          </div>

          {/* CRITICAL: Show Required Margin Call */}
          {batch.riskLevel === RiskLevel.CRITICAL && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-danger shrink-0" />
                <span className="text-xs font-bold text-danger">
                  需补仓金额
                </span>
              </div>
              <p className="text-lg font-bold text-danger font-mono pl-6">
                {formatCurrency(metrics.requiredMarginCall)}
              </p>
            </div>
          )}

          {/* P&L SPLIT MINI TAGS — 机构/客户分层盈利（需求4） */}
          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/40">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10.5px] font-mono",
                  split.institutionTotalPnL >= 0
                    ? "bg-success/5 border-success/20 text-success"
                    : "bg-danger/5 border-danger/20 text-danger"
                )}>
                  <Landmark className="h-3 w-3 shrink-0" />
                  <span className="truncate font-semibold">
                    机 {split.institutionTotalPnL >= 0 ? "+" : ""}
                    {split.institutionTotalPnL.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2, style: "currency", currency: "USD" }).replace("USD", "")}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="font-semibold mb-0.5">机构盈利拆分</p>
                <p className="text-[11px] text-muted-foreground">
                  收益率 {split.institutionTotalPnLPercent >= 0 ? "+" : ""}{split.institutionTotalPnLPercent.toFixed(2)}%
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10.5px] font-mono justify-self-end",
                  split.clientTotalPnL >= 0
                    ? "bg-success/5 border-success/20 text-success"
                    : "bg-warning/5 border-warning/25 text-warning"
                )}>
                  <UserCheck className="h-3 w-3 shrink-0" />
                  <span className="truncate font-semibold">
                    客 {split.clientTotalPnL >= 0 ? "+" : ""}
                    {split.clientTotalPnL.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2, style: "currency", currency: "USD" }).replace("USD", "")}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="font-semibold mb-0.5">客户盈利拆分</p>
                <p className="text-[11px] text-muted-foreground">
                  收益率 {split.clientTotalPnLPercent >= 0 ? "+" : ""}{split.clientTotalPnLPercent.toFixed(2)}%
                </p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Clients & Footer */}
          <div className="flex items-center justify-between pt-3 mt-1 border-t border-border/40">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                <span className="font-medium">{batch.clients?.length || 0} 位客户</span>
              </div>
              {batch.marginCalls && batch.marginCalls.length > 0 && (
                <div className="flex items-center gap-1 text-warning">
                  <History className="h-3.5 w-3.5" />
                  <span>{batch.marginCalls.length} 次补仓</span>
                </div>
              )}
            </div>

            <Link href={`/batch/${batch.id}`} className="shrink-0">
              <Button size="sm" variant="ghost" className="gap-1 h-8 px-2.5 hover:bg-primary/10 hover:text-primary">
                穿透查看
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
