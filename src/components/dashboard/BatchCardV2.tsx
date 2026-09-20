"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { cn, calculateTradingWindows, formatCurrency, formatDate, formatCompactNumber } from "@/lib/utils";
import {
  calculateBatchRiskMetrics,
  calculateBatchPnLSplit,
  calculateTotalShares,
} from "@/lib/riskEngine";
import { triggerMarginCallAlert, triggerWarningAlert } from "@/lib/notifier";
import { Batch, Client, ClientStatus, MarginCall, MarginCallStatus, RiskLevel } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlashNumber } from "@/components/ui/FlashNumber";
import { RoleGate } from "@/components/auth/RoleGate";
import { APP_ROLES, type AppRole, type AppSessionUser } from "@/types/auth";
import { mergeClientStatusesOnClientList } from "@/lib/clientStatusStore";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Flame,
  Gauge,
  Landmark,
  Lock,
  Mail,
  MessageCircle,
  LineChart as SharesIcon,
  Building2,
  DollarSign,
  Unlock,
  UserCheck,
  Users,
  Wallet,
  Zap,
  Archive,
  CheckCircle2,
} from "lucide-react";

export type BatchLike = Batch & {
  clients?: Client[];
  marginCalls?: MarginCall[];
};

interface BatchCardV2Props {
  batch: BatchLike;
  onAction?: (type: "notify-email" | "notify-wa" | "fulfill-mc", id: string) => void;
  viewerRole?: AppRole;
  viewerUser?: AppSessionUser | null;
}

export function BatchCardV2({ batch, onAction, viewerRole = APP_ROLES.RISK_MANAGER, viewerUser }: BatchCardV2Props) {
  const mv = batch.currentMarketValue ?? batch.initialTotalAmount ?? 0;
  const metrics = calculateBatchRiskMetrics(
    batch.initialTotalAmount,
    mv,
    batch.cumulativeMarginCalls ?? 0
  );
  const tradingInfo = calculateTradingWindows(batch.signDate);
  const split = calculateBatchPnLSplit(batch, mv);

  const currentPrice =
    (batch as any).currentPrice ?? (batch as any).currentStockPrice ?? batch.stockPriceAtStart ?? 0;
  const avgBuyPrice = batch.stockPriceAtStart ?? 0;
  const shares =
    (batch as any).totalShares ??
    calculateTotalShares(batch.initialTotalAmount || 0, avgBuyPrice || 1);
  const priceChangePct =
    avgBuyPrice > 0 ? ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;

  const isCritical = batch.riskLevel === RiskLevel.CRITICAL;
  const isWarning = batch.riskLevel === RiskLevel.WARNING;

  const [hydrated, setHydrated] = React.useState(false);
  const [localClients, setLocalClients] = useState<Client[]>(() =>
    (batch.clients ?? []) as Client[]
  );

  React.useEffect(() => {
    setHydrated(true);
    setLocalClients(mergeClientStatusesOnClientList((batch.clients ?? []) as Client[]));
    const onStoreChange = () => {
      setLocalClients(mergeClientStatusesOnClientList((batch.clients ?? []) as Client[]));
    };
    window.addEventListener("storage", onStoreChange);
    window.addEventListener("risk-control:client-status-changed", onStoreChange);
    return () => {
      window.removeEventListener("storage", onStoreChange);
      window.removeEventListener("risk-control:client-status-changed", onStoreChange);
    };
  }, [batch.clients]);

  const clients = localClients;
  const isAllSettled = clients.length > 0 && clients.every((c) => c?.status === ClientStatus.SETTLED);
  const settledCount = clients.filter((c) => c?.status === ClientStatus.SETTLED).length;

  const chrome = isAllSettled
    ? "border-border/60 border-2 border-dashed bg-secondary/10 grayscale opacity-70 hover:opacity-80 transition-all"
    : isCritical
    ? "card-chrome-crit animate-card-crit"
    : isWarning
    ? "card-chrome-warn animate-card-warn"
    : "card-chrome hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-300";

  const isLocked = tradingInfo.isLocked;
  const windowOpen = tradingInfo.isTradingWindow;

  const safetyPct = Math.max(0, 20 + metrics.dropPercent);
  const gaugePct = Math.min(100, Math.max(0, (Math.max(0, 20 - Math.abs(metrics.dropPercent)) / 20) * 100));

  const statusBadge = isAllSettled ? (
    <Badge variant="secondary" className="gap-1 h-6 text-[10px] rounded-md border-border/60">
      <Archive className="h-3 w-3" />
      已归档 · {settledCount}/{clients.length}
    </Badge>
  ) : isLocked ? (
    <Badge variant="secondary" className="gap-1 h-6 text-[10px] rounded-md border-border/60">
      <Lock className="h-3 w-3" />
      锁仓期
    </Badge>
  ) : windowOpen ? (
    <Badge variant="success" className="gap-1 h-6 text-[10px] rounded-md">
      <Unlock className="h-3 w-3" />
      交易窗口
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 h-6 text-[10px] rounded-md">
      开放期
    </Badge>
  );

  const riskBadge = isAllSettled ? (
    <Badge variant="outline" className="gap-1 h-6 text-[10px] rounded-md text-muted-foreground border-dashed">
      <CheckCircle2 className="h-3 w-3" />
      全部已结算
    </Badge>
  ) : isCritical ? (
    <Badge variant="danger" className="gap-1 h-6 text-[10px] rounded-md">
      <Flame className="h-3 w-3" />
      击穿 · 需补仓
    </Badge>
  ) : isWarning ? (
    <Badge variant="warning" className="gap-1 h-6 text-[10px] rounded-md">
      <AlertTriangle className="h-3 w-3" />
      接近预警
    </Badge>
  ) : (
    <Badge variant="success" className="gap-1 h-6 text-[10px] rounded-md opacity-90">
      <span className="h-1.5 w-1.5 rounded-full bg-success mr-0.5" />
      正常
    </Badge>
  );

  const handleClick = () => {
    // 需求#2：直接跳转详情页，不再抽屉
    window.location.href = `/batch/${batch.id}`;
  };

  return (
    <Link
      href={`/batch/${batch.id}`}
      className={cn(
        "group relative rounded-2xl overflow-hidden cursor-pointer flex flex-col block min-h-[520px]",
        chrome
      )}
      onClick={handleClick}
      prefetch={true}
    >
      {/* ===== Header：股票符号 + 批次编号 ===== */}
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] font-mono text-muted-foreground tracking-wider">
              {batch.batchNumber}
            </p>
            {statusBadge}
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-bold tracking-tight leading-none">
              {batch.stockSymbol}
            </h3>
            <p className="text-[11px] text-muted-foreground truncate max-w-[140px]">
              {batch.stockName}
            </p>
          </div>
        </div>
        {riskBadge}
      </div>

      {/* ===== 股票持仓信息（需求#1新增5项）===== */}
      <div className="mx-5 mb-4 rounded-xl border border-border/55 bg-background/40 p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <DollarSign className="h-3 w-3" />
            买入均价
          </div>
          <p className="text-[11px] font-mono font-semibold tabular-nums">
            ${avgBuyPrice.toFixed(2)}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <Building2 className="h-3 w-3" />
            当前股价
          </div>
          <div className="flex items-center justify-end gap-2 ml-auto">
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10.5px] font-bold font-mono tabular-nums tracking-tight",
                priceChangePct > 0
                  ? "bg-success text-white shadow-[0_0_0_1px_hsl(var(--success)/0.4)_inset]"
                  : priceChangePct < 0
                  ? "bg-danger text-white shadow-[0_0_0_1px_hsl(var(--danger)/0.4)_inset]"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {priceChangePct > 0 ? "+" : ""}
              {priceChangePct.toFixed(2)}%
            </span>
            <FlashNumber
              value={currentPrice}
              formatter="number"
              digits={2}
              prefix="$"
              className="text-[12px] font-mono font-bold tabular-nums"
            />
          </div>
        </div>
        <div className="h-px bg-border/45 my-2" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <SharesIcon className="h-3 w-3" />
            持仓股数
          </div>
          <p className="text-[11px] font-mono font-semibold tabular-nums">
            {formatCompactNumber(shares)}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <Users className="h-3 w-3" />
            批次客户数
          </div>
          <p className="text-[11px] font-mono font-semibold tabular-nums">
            {batch.clients?.length ?? 0} 位
          </p>
        </div>
      </div>

      {/* ===== 距离补仓线 水位线 ===== */}
      <div className="px-5 pb-4">
        <div className="flex items-center justify-between text-[10px] mb-1.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Gauge className="h-3 w-3" />
            距离 20% 补仓线
          </div>
          <span
            className={cn(
              "font-mono font-bold tabular-nums",
              isCritical ? "text-danger" : isWarning ? "text-warning" : "text-success"
            )}
          >
            {isCritical ? "已击穿" : `缓冲 ${safetyPct.toFixed(1)}%`}
          </span>
        </div>
        <div className="relative h-2 w-full rounded-full overflow-hidden bg-secondary/60">
          <div className="absolute inset-y-0 left-0 right-0 risk-water-track opacity-70" />
          <div
            className="absolute inset-y-0 right-0 bg-foreground/10 backdrop-blur-sm"
            style={{ width: `${100 - gaugePct}%` }}
          />
          <div className="absolute top-0 bottom-0 w-[1.5px] bg-warning-foreground/80" style={{ left: "25%" }} />
          <div className="absolute top-0 bottom-0 w-[1.5px] bg-danger-foreground/90" style={{ left: "0%" }} />
          <div
            className="absolute -top-1 -translate-x-1/2 pointer-events-none transition-all duration-700"
            style={{ left: `${gaugePct}%` }}
          >
            <div
              className={cn(
                "h-4 w-[2px] rounded-sm",
                isCritical
                  ? "bg-danger shadow-[0_0_12px_-2px_hsl(var(--danger))]"
                  : isWarning
                  ? "bg-warning shadow-[0_0_10px_-2px_hsl(var(--warning))]"
                  : "bg-success shadow-[0_0_10px_-2px_hsl(var(--success))]"
              )}
            />
            <div
              className={cn(
                "absolute -bottom-0.5 -translate-x-1/2 h-2 w-2 rounded-full border-2 border-background",
                isCritical
                  ? "bg-danger"
                  : isWarning
                  ? "bg-warning"
                  : "bg-success"
              )}
            />
          </div>
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-mono text-muted-foreground/80">
          <span className="text-danger font-semibold">20%</span>
          <span className="text-warning">15%</span>
          <span className="text-success">0%</span>
        </div>
      </div>

      {/* ===== Stats row ===== */}
      <div className="px-5 pb-4 grid grid-cols-3 gap-3">
        <StatTile
          label="当前市值"
          valueNode={
            <FlashNumber value={mv} formatter="dollarCompact" className="text-[11px] font-bold font-mono" />
          }
        />
        <StatTile
          label="需补仓"
          value={metrics.requiredMarginCall}
          formatter="dollarCompact"
          accent={isCritical ? "danger" : isWarning ? "warning" : "muted"}
        />
        <StatTile
          label="补仓次数"
          value={
            (batch.marginCalls?.length ?? 0) > 0
              ? batch.marginCalls!.length
              : (batch.cumulativeMarginCalls ?? 0) > 0
              ? 1
              : 0
          }
          formatter="number"
          valueClassName="text-[12px] font-bold tabular-nums"
          icon={<Users className="h-3 w-3" />}
        />
      </div>

      {/* ===== P&L split ===== */}
      <div className="mx-5 mb-4 rounded-xl border border-border/50 bg-background/30 p-3.5">
        <div className="grid grid-cols-2 gap-3.5">
          <PnLChip
            icon={Landmark}
            label="机构"
            pnl={split.institutionTotalPnL}
            pnlPercent={split.institutionTotalPnLPercent}
          />
          <PnLChip
            icon={UserCheck}
            label="客户"
            pnl={split.clientTotalPnL}
            pnlPercent={split.clientTotalPnLPercent}
          />
        </div>
      </div>

      {/* ===== Footer ===== */}
      <div className="mt-auto px-5 pb-5 pt-2 flex items-center gap-3 border-t border-border/40">
        <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground min-w-0 shrink-0 flex-wrap">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Building2 className="h-3 w-3 shrink-0" />
            {formatDate(batch.signDate).slice(5)} → {formatDate(batch.maturityDate).slice(5)}
          </span>
          {(batch.cumulativeMarginCalls ?? 0) > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-warning whitespace-nowrap shrink-0">
                  <Wallet className="h-3 w-3 shrink-0" />
                  补仓 {formatCompactNumber(batch.cumulativeMarginCalls ?? 0)}
                </span>
              </TooltipTrigger>
              <TooltipContent>累计补仓 {formatCurrency(batch.cumulativeMarginCalls ?? 0)}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {isCritical ? (
          <div className="flex items-center gap-1 ml-auto shrink-0" onClick={(e) => e.preventDefault()}>
            <RoleGate
              allowed={[APP_ROLES.RISK_MANAGER]}
              auditResource={`batch:notify_email:${batch.id}`}
              auditAction="ui_component_denied"
            >
              <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/80"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const bds = Array.from(
                        new Set((batch.clients ?? []).map((c) => c.bdManager).filter(Boolean) as string[])
                      );
                      if ((batch.marginCalls ?? []).length > 0) {
                        for (const mc of batch.marginCalls!)
                          await triggerMarginCallAlert(batch as any, mc, bds);
                      } else {
                        await triggerWarningAlert(batch as any, metrics.dropPercent, 20);
                      }
                      onAction?.("notify-email", batch.id);
                    } catch (err) {
                      console.warn(err);
                    }
                  }}
                >
                  <Mail className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>一键 Email 通知 BD 及风控</TooltipContent>
            </Tooltip>
            </RoleGate>
            <RoleGate
              allowed={[APP_ROLES.RISK_MANAGER]}
              auditResource={`batch:notify_wa:${batch.id}`}
              auditAction="ui_component_denied"
            >
              <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/80"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onAction?.("notify-wa", batch.id);
                  }}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>一键 WhatsApp 提醒</TooltipContent>
            </Tooltip>
            </RoleGate>
            <RoleGate
              allowed={[APP_ROLES.RISK_MANAGER, APP_ROLES.ADMIN]}
              auditResource={`batch:fulfill_mc:${batch.id}`}
              auditAction="ui_component_denied"
            >
            <Button
              size="sm"
              variant="danger"
              className="h-7 gap-1 rounded-md text-[11px]"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const req = metrics.requiredMarginCall;
                if (
                  !confirm(
                    `确认处理补仓 $${req.toLocaleString()} ?\n批次 ${batch.batchNumber}\n补仓后市值将恢复至初始总值。`
                  )
                )
                  return;
                const mc = (batch.marginCalls ?? []).find(
                  (m) => m.status === MarginCallStatus.PENDING
                ) ?? (batch.marginCalls ?? [])[0];
                if (mc) {
                  (mc as any).status = MarginCallStatus.FULLFILLED;
                  (mc as any).fulfilledAmount = req;
                  (mc as any).fulfilledDate = new Date();
                } else if (Array.isArray((batch as any).marginCalls)) {
                  (batch as any).marginCalls.push({
                    id: `mc_${Date.now()}`,
                    batchId: batch.id,
                    requiredAmount: req,
                    fulfilledAmount: req,
                    status: MarginCallStatus.FULLFILLED,
                    triggerDate: new Date(),
                    fulfilledDate: new Date(),
                    createdAt: new Date(),
                  } as any);
                }
                (batch as any).cumulativeMarginCalls =
                  (batch.cumulativeMarginCalls ?? 0) + req;
                (batch as any).currentMarketValue =
                  (batch.currentMarketValue ?? batch.initialTotalAmount ?? 0) + req;
                const newMetrics = calculateBatchRiskMetrics(
                  batch.initialTotalAmount,
                  (batch as any).currentMarketValue,
                  (batch as any).cumulativeMarginCalls
                );
                (batch as any).riskLevel = newMetrics.riskLevel;
                (batch as any).totalPnL = newMetrics.totalPnL;
                const s =
                  (batch as any).totalShares ??
                  calculateTotalShares(batch.initialTotalAmount || 0, batch.stockPriceAtStart || 1);
                if (s > 0) {
                  (batch as any).currentStockPrice =
                    ((batch as any).currentMarketValue ?? 0) / s;
                  (batch as any).currentPrice = (batch as any).currentStockPrice;
                }
                onAction?.("fulfill-mc", batch.id);
                window.dispatchEvent(new CustomEvent("risk-control:margin-fulfilled", {
                  detail: { batchId: batch.id, amount: req },
                }));
              }}
            >
              <Zap className="h-3.5 w-3.5" />
              处理补仓
            </Button>
            </RoleGate>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground group-hover:text-primary transition-colors ml-auto shrink-0">
            查看详情
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
        )}
      </div>
    </Link>
  );
}

function StatTile(props: {
  label: string;
  value?: number;
  valueNode?: React.ReactNode;
  formatter?: "dollarCompact" | "number" | "currency";
  accent?: "danger" | "warning" | "success" | "muted";
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  const accent =
    props.accent === "danger"
      ? "text-danger"
      : props.accent === "warning"
      ? "text-warning"
      : props.accent === "success"
      ? "text-success"
      : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground uppercase tracking-wider font-medium">
        {props.icon}
        {props.label}
      </div>
      <div className="mt-1 min-h-[16px] flex items-center">
        {props.valueNode
          ? props.valueNode
          : props.value !== undefined && (
              <FlashNumber
                value={props.value}
                formatter={props.formatter || "dollarCompact"}
                className={cn("font-mono", accent, props.valueClassName)}
                digits={0}
              />
            )}
      </div>
    </div>
  );
}

function PnLChip(props: {
  icon: any;
  label: string;
  pnl: number;
  pnlPercent: number;
}) {
  const Icon = props.icon;
  const positive = props.pnl >= 0;
  const z = props.pnl === 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-between gap-2 rounded-md bg-background/50 border border-border/40 px-3 py-2 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-1.5 min-w-0 shrink-0">
            <Icon
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                z ? "text-muted-foreground" : positive ? "text-success" : "text-danger"
              )}
            />
            <span className="text-[10.5px] text-muted-foreground font-medium whitespace-nowrap">
              {props.label}
            </span>
          </div>
          <div className="flex flex-col items-end min-w-0">
            <span
              className={cn(
                "text-[11px] font-bold font-mono leading-none whitespace-nowrap overflow-hidden text-ellipsis max-w-full",
                z ? "text-muted-foreground" : positive ? "text-success" : "text-danger"
              )}
            >
              {positive && !z ? "+" : ""}
              {props.pnl.toLocaleString(undefined, {
                notation: "compact",
                maximumFractionDigits: 2,
                minimumFractionDigits: 1,
                style: "currency",
                currency: "USD",
              })}
            </span>
            <span
              className={cn(
                "text-[9.5px] font-mono leading-none mt-1 whitespace-nowrap",
                z ? "text-muted-foreground/80" : positive ? "text-success/90" : "text-danger/90"
              )}
            >
              {props.pnlPercent >= 0 && !z ? "+" : ""}
              {props.pnlPercent.toFixed(2)}%
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="text-[11px]">
        {props.label}端累计 {props.label === "客户" ? "保本+分成" : "劣后+补仓"}
      </TooltipContent>
    </Tooltip>
  );
}
