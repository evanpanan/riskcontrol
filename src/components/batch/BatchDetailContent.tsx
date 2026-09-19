"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  calculateBatchRiskMetrics,
  calculateBatchPnLSplit,
  calculateRealtimeClientMetrics,
  calculateTotalShares,
  calculateClientMarginCall,
} from "@/lib/riskEngine";
import { triggerMarginCallAlert, triggerWarningAlert } from "@/lib/notifier";
import { cn, calculateTradingWindows, formatCurrency, formatDate, formatDateTime, formatPercent } from "@/lib/utils";
import { Batch, Client, ClientStatus, MarginCallStatus, RiskLevel } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoleGate } from "@/components/auth/RoleGate";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import type { APP_ROLES as APP_ROLES_TYPE, AppSessionUser } from "@/types/auth";
import { APP_ROLES } from "@/types/auth";
import {
  mergeClientStatusesOnClientList,
  mergeClientStatusOnClient,
  setClientStatus,
} from "@/lib/clientStatusStore";
import {
  filterBatchDetailClientsByRole,
  filterBdStatsByRole,
  type RedactedClientPlaceholder,
  type BdStatValue,
} from "@/lib/authz/dataScope";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AddClientDialog } from "@/components/clients/AddClientDialog";
import { ClientTable } from "@/components/clients/ClientTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  ChevronRight,
  Clock,
  DollarSign,
  Download,
  History,
  Landmark,
  Lock,
  Mail,
  MessageCircle,
  Search,
  Shield,
  Target,
  TrendingUp,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Zap,
  EyeOff,
  Users2,
} from "lucide-react";

export type BatchLikeForDetail = Batch & {
  clients?: Client[];
  marginCalls?: {
    id: string;
    requiredAmount: number;
    fulfilledAmount?: number;
    triggerMarketValue: number;
    dropPercent: number;
    triggerDate: Date;
    fulfilledDate?: Date;
    status: MarginCallStatus;
    note?: string;
  }[];
};

export type EnrichedDetailClient = Client &
  ReturnType<typeof calculateRealtimeClientMetrics> & {
    actualClientPnL: number;
    actualClientPnLPercent: number;
    requiredMarginCall?: number;
  };

interface BatchDetailContentProps {
  batch: BatchLikeForDetail;
  /** 当在 Drawer 中不显示 breadcrumb / 返回按钮 */
  compact?: boolean;
  onBack?: () => void;
  onChange?: () => void;
}

export function BatchDetailContent({ batch, compact = false, onBack, onChange }: BatchDetailContentProps) {
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [mcDialog, setMcDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [bdFilter, setBdFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "ALL">("ALL");
  const { user, role, isBdManager, bdManagerFullName } = useCurrentUser();

  const mv = batch.currentMarketValue || batch.initialTotalAmount || 0;
  const metrics = calculateBatchRiskMetrics(
    batch.initialTotalAmount,
    mv,
    batch.cumulativeMarginCalls || 0
  );
  const split = calculateBatchPnLSplit(batch as any, mv);
  const tradingInfo = calculateTradingWindows(batch.signDate);
  type TradeWin = typeof tradingInfo.tradingWindows[number];

  const bdManagers = useMemo(() => {
    const set = new Set((batch.clients || []).map((c) => c.bdManager));
    return Array.from(set);
  }, [batch]);

  const scopeUser = (user ?? {
    id: 'fallback_risk',
    role: APP_ROLES.RISK_MANAGER,
    email: 'fallback@risk.com',
    displayName: 'Fallback Risk',
    avatarInitials: 'FR',
  }) as AppSessionUser;

  const filteredBase: (Client | RedactedClientPlaceholder)[] = useMemo(() => {
    const base: Client[] = (batch.clients || []).map((c) => (c as any).__redacted ? c : mergeClientStatusOnClient(c as any)) as Client[];
    // BD 视角：bdFilter 仅"ALL"和"我自己"生效（因为其他 BD 客户端根本不可见）
    const { mergedRows } = filterBatchDetailClientsByRole(base, scopeUser);
    return mergedRows as (Client | RedactedClientPlaceholder)[];
  }, [batch, scopeUser]);

  const filteredClients: EnrichedDetailClient[] = useMemo(() => {
    let list = filteredBase as any[];
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (c: any) =>
          !c.__redacted &&
          ((c.name && c.name.toLowerCase().includes(q)) ||
            (c.bdManager && c.bdManager.toLowerCase().includes(q)))
      );
    }
    if (bdFilter !== "ALL") list = list.filter((c: any) => !c.__redacted && c.bdManager === bdFilter);
    if (statusFilter !== "ALL") list = list.filter((c: any) => !c.__redacted && c.status === statusFilter);
    return list.map((client: any) => {
      if (client.__redacted) return client;
      const realtime = calculateRealtimeClientMetrics(client, batch as any, mv);
      const perClient = split.perClient.get(client.id);
      const mc = calculateClientMarginCall(
        client.investmentAmount || 0,
        batch.initialTotalAmount || 0,
        metrics.requiredMarginCall || 0
      );
      return {
        ...client,
        ...realtime,
        actualClientPnL: perClient?.pnl ?? 0,
        actualClientPnLPercent: perClient?.pnlPercent ?? 0,
        requiredMarginCall: mc,
      } as EnrichedDetailClient;
    });
  }, [filteredBase, mv, search, bdFilter, statusFilter, split, batch, metrics]);

  const investedByBD = useMemo(() => {
    const map: Record<string, BdStatValue> = {};
    (batch.clients || []).forEach((c) => {
      if (!map[c.bdManager]) {
        map[c.bdManager] = { count: 0, amount: 0, pnl: 0 };
      }
      map[c.bdManager].count += 1;
      map[c.bdManager].amount += c.investmentAmount;
      const clientPnl = split.perClient.get(c.id)?.pnl ?? 0;
      map[c.bdManager].pnl += clientPnl;
    });
    return map;
  }, [batch, split]);

  const bdStatsResult = useMemo(
    () => filterBdStatsByRole(investedByBD, scopeUser),
    [investedByBD, scopeUser]
  );

  const StatusBadge = () => {
    if (batch.riskLevel === RiskLevel.CRITICAL) {
      return (
        <Badge variant="danger" className="gap-1.5 px-3 py-1 text-xs animate-breath-danger">
          <AlertCircle className="h-3.5 w-3.5" />
          已触发补仓警报 · 跌幅 {metrics.dropPercent.toFixed(2)}%
        </Badge>
      );
    }
    if (batch.riskLevel === RiskLevel.WARNING) {
      return (
        <Badge variant="warning" className="gap-1.5 px-3 py-1 text-xs">
          <AlertTriangle className="h-3.5 w-3.5" />
          接近预警线 · 跌幅 {metrics.dropPercent.toFixed(2)}%
        </Badge>
      );
    }
    return (
      <Badge variant="success" className="gap-1.5 px-3 py-1 text-xs">
        <Shield className="h-3.5 w-3.5" />
        状态正常 · 安全缓冲 {metrics.safetyBufferPercent.toFixed(1)}%
      </Badge>
    );
  };

  const handleFulfill = () => {
    const req = metrics.requiredMarginCall;
    if (!confirm(`确认补仓 $${req.toLocaleString()} ?\n批次 ${batch.batchNumber}\n补仓后市值将恢复至初始总值。`)) return;
    const mcs = (batch as any).marginCalls ?? [];
    const pending = mcs.find((x: any) => x.status === MarginCallStatus.PENDING) ?? mcs[0];
    if (pending) {
      pending.status = MarginCallStatus.FULLFILLED;
      pending.fulfilledAmount = req;
      pending.fulfilledDate = new Date();
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
      });
    }
    (batch as any).cumulativeMarginCalls = (batch.cumulativeMarginCalls || 0) + req;
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
    console.log("[补仓] 确认补仓成功:", req, "新风险等级:", newMetrics.riskLevel);
    window.dispatchEvent(
      new CustomEvent("risk-control:margin-fulfilled", {
        detail: { batchId: batch.id, amount: req },
      })
    );
    onChange?.();
  };

  const handleClientStatusChange = (clientId: string, newStatus: ClientStatus) => {
    if (!batch.clients) return;
    const target = batch.clients.find((c: any) => c.id === clientId);
    if (!target) return;
    (target as any).status = newStatus;
    if (newStatus === ClientStatus.SETTLED) {
      (target as any).settledAt = new Date();
    } else {
      (target as any).settledAt = null;
    }
    setClientStatus(clientId, newStatus);
    console.log("[客户状态变更]", clientId, "→", newStatus);
    window.dispatchEvent(
      new CustomEvent("risk-control:client-status-changed", {
        detail: { batchId: batch.id, clientId, newStatus },
      })
    );
    onChange?.();
  };

  const redactedCountInPage = filteredClients.filter((c: any) => c.__redacted).length;
  const visibleOwnCountInPage = filteredClients.length - redactedCountInPage;
  const totalOriginalClientCount = batch.clients?.length || 0;

  return (
    <div className={cn("space-y-6", compact ? "max-w-full" : "max-w-[1800px] mx-auto")}>
      {/* Breadcrumb & Back */}
      {!compact ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link href="/" className="hover:text-primary transition-colors">
                风控大盘
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="font-mono text-foreground font-medium">{batch.batchNumber}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="sm" className="gap-1.5 h-8">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  返回
                </Button>
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">
                {batch.stockSymbol}
                {batch.stockName && (
                  <span className="text-muted-foreground font-normal text-lg ml-2">{batch.stockName}</span>
                )}
              </h1>
              <StatusBadge />
            </div>
            <p className="text-sm text-muted-foreground">
              批次号：<span className="font-mono ml-1 mr-4">{batch.batchNumber}</span>
              创建时间：<span className="font-mono ml-1">{formatDateTime(batch.createdAt)}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <RoleGate
              allowed={[APP_ROLES.RISK_MANAGER]}
              auditResource={`batch:notify_email:${batch.id}`}
              auditAction="ui_component_denied"
            >
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={async () => {
                try {
                  const mcs = (batch as any).marginCalls ?? [];
                  const bds = Array.from(
                    new Set(((batch.clients?.map((c) => c.bdManager).filter(Boolean)) ?? []) as string[])
                  ) as string[];
                  if (mcs.length > 0) {
                    for (const mc of mcs) await triggerMarginCallAlert(batch as any, mc, bds);
                  } else {
                    await triggerWarningAlert(batch as any, metrics.dropPercent, 20);
                  }
                  console.log("[通知] 邮件通知BD完成:", batch.batchNumber, bds);
                } catch (e) {
                  console.warn(e);
                }
              }}
            >
              <Mail className="h-3.5 w-3.5" />
              邮件通知 BD
            </Button>
            </RoleGate>
            <RoleGate
              allowed={[APP_ROLES.RISK_MANAGER]}
              auditResource={`batch:notify_wa:${batch.id}`}
              auditAction="ui_component_denied"
            >
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={() => console.log("[通知] WhatsApp提醒已推送至风控:", batch.batchNumber)}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp 提醒
            </Button>
            </RoleGate>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={() => setMcDialog(true)}
            >
              <History className="h-3.5 w-3.5" />
              补仓记录
              {batch.marginCalls?.length ? (
                batch.marginCalls.some((m) => m.status === MarginCallStatus.PENDING) ? (
                  <Badge variant="danger" className="text-[9px] h-4 ml-0.5 px-1.5 py-0 min-w-[18px]">
                    {batch.marginCalls.filter((m) => m.status === MarginCallStatus.PENDING).length}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] h-4 ml-0.5 px-1.5 py-0 min-w-[18px]">
                    {batch.marginCalls.length}
                  </Badge>
                )
              ) : null}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={() => console.log("[导出] 导出批次明细 CSV/Excel:", batch.batchNumber)}
            >
              <Download className="h-3.5 w-3.5" />
              导出明细
            </Button>
            {batch.riskLevel === RiskLevel.CRITICAL && (
              <RoleGate
                allowed={[APP_ROLES.RISK_MANAGER]}
                auditResource={`batch:fulfill_mc:${batch.id}`}
                auditAction="ui_component_denied"
              >
              <Button variant="danger" size="sm" className="gap-1.5 h-9" onClick={handleFulfill}>
                <Zap className="h-3.5 w-3.5" />
                确认补仓 ${metrics.requiredMarginCall.toLocaleString()}
              </Button>
              </RoleGate>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">{batch.batchNumber}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <h1 className="text-xl font-bold tracking-tight truncate">
                  {batch.stockSymbol}
                </h1>
                <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                  {batch.stockName}
                </span>
                <StatusBadge />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-[11px]"
              onClick={async () => {
                try {
                  const mcs = (batch as any).marginCalls ?? [];
                  const bds = Array.from(
                    new Set(((batch.clients?.map((c) => c.bdManager).filter(Boolean)) ?? []) as string[])
                  ) as string[];
                  if (mcs.length > 0) {
                    for (const mc of mcs) await triggerMarginCallAlert(batch as any, mc, bds);
                  } else {
                    await triggerWarningAlert(batch as any, metrics.dropPercent, 20);
                  }
                } catch (e) {
                  console.warn(e);
                }
              }}
            >
              <Mail className="h-3 w-3" />
              Email
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-[11px]"
              onClick={() => console.log("[WA]", batch.batchNumber)}
            >
              <MessageCircle className="h-3 w-3" />
              WA
            </Button>
            {batch.riskLevel === RiskLevel.CRITICAL && (
              <Button variant="danger" size="sm" className="gap-1.5 h-8 text-[11px]" onClick={handleFulfill}>
                <Zap className="h-3 w-3" />
                补仓
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Trading Window Countdown Banner */}
      <Card
        className={cn(
          "border-border/50 overflow-hidden",
          tradingInfo.isLocked
            ? "bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-purple-500/10 border-blue-500/30"
            : tradingInfo.isTradingWindow
            ? "bg-gradient-to-r from-emerald-500/10 via-green-500/5 to-teal-500/10 border-emerald-500/30"
            : "bg-card"
        )}
      >
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "h-12 w-12 rounded-xl flex items-center justify-center shrink-0",
                  tradingInfo.isLocked
                    ? "bg-blue-500/20 border border-blue-500/30"
                    : tradingInfo.isTradingWindow
                    ? "bg-emerald-500/20 border border-emerald-500/30 animate-pulse"
                    : "bg-secondary"
                )}
              >
                {tradingInfo.isLocked ? (
                  <Lock className="h-6 w-6 text-blue-400" />
                ) : tradingInfo.isTradingWindow ? (
                  <Zap className="h-6 w-6 text-emerald-400" />
                ) : (
                  <Unlock className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-base">
                    {tradingInfo.isLocked
                      ? "🔒 批次处于锁仓期"
                      : tradingInfo.isTradingWindow
                      ? "🟢 交易窗口已开放"
                      : "当前处于观望期"}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {tradingInfo.isLocked
                    ? "锁仓期内禁止一切交易。6 个月后首次开放交易窗口。"
                    : tradingInfo.isTradingWindow
                    ? "本次开放窗口持续 14 天，可执行部分或全部退出操作。"
                    : `第 ${tradingInfo.nextTradingMonth} 个月开放，每 3 个月一个交易周期。`}
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1 sm:justify-end">
                <Clock className="h-3 w-3" />
                下次交易窗口
              </p>
              <p className="text-xl font-bold font-mono text-gradient-primary">
                {tradingInfo.countdownText}
              </p>
              {tradingInfo.nextTradingDate && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  预计 {formatDate(tradingInfo.nextTradingDate)} 开放
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-border/40">
            <div className="relative">
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-secondary rounded-full" />
              <div
                className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                style={{ width: `${Math.min(100, (tradingInfo.monthsElapsed / 24) * 100)}%` }}
              />
              <div className="relative flex justify-between">
                {tradingInfo.tradingWindows.map((w: TradeWin) => (
                  <div key={w.month} className="flex flex-col items-center">
                    <div
                      className={cn(
                        "h-5 w-5 rounded-full border-2 z-10 transition-all",
                        w.passed
                          ? "bg-primary border-primary"
                          : tradingInfo.nextTradingMonth === w.month
                          ? "bg-background border-emerald-500 scale-125 shadow-md shadow-emerald-500/30 animate-pulse"
                          : "bg-card border-border"
                      )}
                    />
                    <p
                      className={cn(
                        "mt-2 text-[10px] font-mono font-semibold",
                        tradingInfo.nextTradingMonth === w.month && "text-emerald-400",
                        w.passed && "text-primary",
                        !w.passed && tradingInfo.nextTradingMonth !== w.month && "text-muted-foreground"
                      )}
                    >
                      第 {w.month} 月
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TOP KPI CARDS */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <Card className="border-border/50">
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> 签约 / 到期
            </p>
            <p className="text-xs font-mono font-semibold">{formatDate(batch.signDate)}</p>
            <p className="text-[10px] text-muted-foreground">→ {formatDate(batch.maturityDate)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> 初始总资
            </p>
            <p className="text-sm font-bold font-mono">{formatCurrency(batch.initialTotalAmount)}</p>
            <p className="text-[10px] text-muted-foreground">
              70%/30% = {formatCurrency(batch.priorityAmount)} / {formatCurrency(batch.subordinateAmount)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> 实时股价
            </p>
            <p className="text-sm font-bold font-mono">
              ${((batch as any).currentPrice ?? (batch as any).currentStockPrice ?? 0).toFixed(2)}
            </p>
            <p
              className={cn(
                "text-[10px] font-mono",
                (batch.currentDayChange || 0) >= 0 ? "text-success" : "text-danger"
              )}
            >
              {(batch.currentDayChange || 0) >= 0 ? "+" : ""}
              {formatPercent(batch.currentDayChange || 0)} (入场 ${batch.stockPriceAtStart.toFixed(2)})
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Building2 className="h-3 w-3" /> 当前总市值
            </p>
            <p className="text-sm font-bold font-mono">{formatCurrency(mv)}</p>
            <p className={cn("text-[10px] font-mono", metrics.totalPnL >= 0 ? "text-success" : "text-danger")}>
              {metrics.totalPnL >= 0 ? "盈利" : "浮亏"} {formatPercent(metrics.totalPnLPercent)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <History className="h-3 w-3" /> 累计补仓
            </p>
            <p className={cn("text-sm font-bold font-mono", batch.cumulativeMarginCalls > 0 ? "text-warning" : "")}>
              {formatCurrency(batch.cumulativeMarginCalls || 0)}
            </p>
            <p className="text-[10px] text-muted-foreground">{batch.marginCalls?.length || 0} 次记录</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Users className="h-3 w-3" /> 客户
            </p>
            <p className="text-sm font-bold font-mono">{batch.clients?.length || 0} 位</p>
            <p className="text-[10px] text-muted-foreground">{Object.keys(investedByBD).length} 位 BD</p>
          </CardContent>
        </Card>
      </div>

      {/* Safety Buffer Section */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              风控安全监控
            </CardTitle>
            <Badge
              variant={
                batch.riskLevel === RiskLevel.CRITICAL
                  ? "danger"
                  : batch.riskLevel === RiskLevel.WARNING
                  ? "warning"
                  : "success"
              }
              className="gap-1 px-3 py-1 text-xs"
            >
              当前跌幅 {metrics.dropPercent.toFixed(2)}%
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">安全缓冲距离（距 20% 补仓线）</span>
              <span
                className={cn(
                  "font-bold font-mono",
                  metrics.safetyBufferPercent <= 5 && "text-danger",
                  metrics.safetyBufferPercent > 5 && metrics.safetyBufferPercent <= 10 && "text-warning",
                  metrics.safetyBufferPercent > 10 && "text-success"
                )}
              >
                {metrics.safetyBufferPercent > 0
                  ? `${metrics.safetyBufferPercent.toFixed(2)}%`
                  : "已击穿补仓线"}
              </span>
            </div>
            <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
              <div className="absolute inset-0 flex">
                <div className="w-[75%] h-full bg-success/20" />
                <div className="w-[25%] h-full bg-warning/20" />
              </div>
              <Progress
                value={Math.max(0, metrics.safetyBufferPercent)}
                max={20}
                variant={
                  batch.riskLevel === RiskLevel.CRITICAL
                    ? "danger"
                    : batch.riskLevel === RiskLevel.WARNING
                    ? "warning"
                    : "success"
                }
                className="h-3 bg-transparent absolute inset-0"
              />
              <div className="absolute top-0 bottom-0 w-px bg-amber-400/80 z-10" style={{ left: "25%" }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="h-full w-1 -ml-0.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-[11px] font-semibold">15% 预警线</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="absolute top-0 bottom-0 w-px bg-danger z-10" style={{ left: "0%" }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="h-full w-1 -ml-0.5" />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="text-[11px] font-semibold">20% 补仓线</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>补仓 20%</span>
              <span>预警 15%</span>
              <span>安全 0%</span>
            </div>
          </div>

          <div className="grid gap-3 grid-cols-1 md:grid-cols-3 pt-4 border-t border-border/40">
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">初始市值</p>
              <p className="text-sm font-mono font-semibold">{formatCurrency(batch.initialTotalAmount)}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">80% 预警阈值</p>
              <p className="text-sm font-mono font-semibold text-warning">
                {formatCurrency(batch.initialTotalAmount * 0.8)}
              </p>
            </div>
            <div
              className={cn(
                "rounded-lg p-3 border",
                batch.riskLevel === RiskLevel.CRITICAL
                  ? "bg-danger/10 border-danger/30"
                  : "bg-secondary/50"
              )}
            >
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                需补仓金额 (击穿20%)
              </p>
              <p
                className={cn(
                  "text-sm font-mono font-bold",
                  batch.riskLevel === RiskLevel.CRITICAL ? "text-danger" : "text-muted-foreground"
                )}
              >
                {formatCurrency(metrics.requiredMarginCall)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* P&L SPLIT PANEL */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Card className={cn("border-border/50 overflow-hidden relative")}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center">
                  <Landmark className="h-4 w-4 text-primary" />
                </div>
                🏦 机构盈利拆分
              </CardTitle>
              <Badge variant={split.institutionTotalPnL >= 0 ? "success" : "danger"} className="gap-1 px-2.5 py-1 text-xs">
                {split.institutionTotalPnL >= 0 ? "浮盈" : "浮亏"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-1 space-y-3">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  机构收益率
                </p>
                <p className={cn("text-2xl font-bold font-mono", split.institutionTotalPnL >= 0 ? "text-success" : "text-danger")}>
                  {split.institutionTotalPnLPercent >= 0 ? "+" : ""}
                  {split.institutionTotalPnLPercent.toFixed(2)}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">绝对金额</p>
                <p className={cn("text-lg font-bold font-mono", split.institutionTotalPnL >= 0 ? "text-success" : "text-danger")}>
                  {split.institutionTotalPnL >= 0 ? "+" : ""}
                  {formatCurrency(split.institutionTotalPnL)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/40 text-[11px]">
              <div className="space-y-1 rounded-lg bg-secondary/50 p-2.5">
                <p className="text-muted-foreground flex items-center gap-1">
                  <Target className="h-3 w-3" /> 劣后本金
                </p>
                <p className="font-mono font-semibold">{formatCurrency(batch.subordinateAmount)}</p>
              </div>
              <div className="space-y-1 rounded-lg bg-secondary/50 p-2.5">
                <p className="text-muted-foreground flex items-center gap-1">
                  <Wallet className="h-3 w-3" /> 累计补仓
                </p>
                <p className="font-mono font-semibold text-warning">
                  {formatCurrency(batch.cumulativeMarginCalls || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center">
                  <UserCheck className="h-4 w-4 text-emerald-400" />
                </div>
                👥 客户盈利拆分
              </CardTitle>
              <Badge variant={split.clientTotalPnL >= 0 ? "success" : "warning"} className="gap-1 px-2.5 py-1 text-xs">
                {split.clientTotalPnL >= 0 ? "浮盈" : "保本"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-1 space-y-3">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">客户收益率</p>
                <p className={cn("text-2xl font-bold font-mono", split.clientTotalPnL >= 0 ? "text-success" : "text-warning")}>
                  {split.clientTotalPnLPercent >= 0 ? "+" : ""}
                  {split.clientTotalPnLPercent.toFixed(2)}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">绝对金额</p>
                <p className={cn("text-lg font-bold font-mono", split.clientTotalPnL >= 0 ? "text-success" : "text-warning")}>
                  {split.clientTotalPnL >= 0 ? "+" : ""}
                  {formatCurrency(split.clientTotalPnL)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/40 text-[11px]">
              <div className="space-y-1 rounded-lg bg-secondary/50 p-2.5">
                <p className="text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" /> 优先本金
                </p>
                <p className="font-mono font-semibold">{formatCurrency(batch.priorityAmount)}</p>
              </div>
              <div className="space-y-1 rounded-lg bg-secondary/50 p-2.5">
                <p className="text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" /> 客户数量
                </p>
                <p className="font-mono font-semibold text-primary">{batch.clients?.length || 0} 位</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CLIENTS TABLE (Full Width) */}
      <div className="space-y-4">
        <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    客户明细穿透
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    显示{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {visibleOwnCountInPage}
                    </span>{" "}
                    位真实客户
                    {isBdManager && redactedCountInPage > 0 && (
                      <>
                        {" · "}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/60 border border-border/50 text-muted-foreground/90">
                          <EyeOff className="h-3 w-3" />
                          {redactedCountInPage} 位其他 BD 客户已脱敏
                        </span>
                      </>
                    )}
                    {" · "}
                    批次全部合计 {totalOriginalClientCount} 位{" · "}
                    合计投资{" "}
                    <span className="font-mono font-semibold">
                      {formatCurrency(
                        filteredClients
                          .filter((c: any) => !c.__redacted)
                          .reduce((s: number, c: any) => s + c.investmentAmount, 0)
                      )}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-9 pl-8 pr-3 rounded-lg border border-input bg-background text-xs w-[180px] focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={isBdManager ? "搜索我名下客户" : "客户 / BD 搜索"}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <select
                    className="h-9 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
                    value={bdFilter}
                    onChange={(e) => setBdFilter(e.target.value)}
                  >
                    <option value="ALL">{isBdManager ? "仅我名下 / 全部" : "全部 BD"}</option>
                    {bdManagers.map((bd) => {
                      const disabled = isBdManager && bd !== bdManagerFullName;
                      return (
                        <option key={bd} value={bd} disabled={disabled}>
                          {bd}{disabled ? "（其他 BD · 无权限）" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    className="h-9 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                  >
                    <option value="ALL">全部状态</option>
                    <option value="ACTIVE">持仓中</option>
                    <option value="EXIT_REQUESTED">申请退出</option>
                    <option value="SETTLED">已结算</option>
                  </select>
                  <Button
                    size="sm"
                    className="gap-1.5 h-9"
                    onClick={() => setAddClientOpen(true)}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    新增客户
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ClientTable
                clients={filteredClients as any}
                batchInitialAmount={batch.initialTotalAmount}
                viewerRole={role}
                viewerUser={user ?? undefined}
                batchRequiredMarginCall={metrics.requiredMarginCall}
                onClientStatusChange={handleClientStatusChange}
              />
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Building2 className="h-4 w-4 text-secondary-foreground" />
                BD 经理资金分布
                {isBdManager && (
                  <Badge variant="outline" className="text-[9px] ml-1 font-mono">
                    仅我可见范围
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {bdStatsResult.visibleEntries
                  .sort((a, b) => b[1].amount - a[1].amount)
                  .map(([bd, v], idx) => {
                    const { count, amount, pnl } = v;
                    const pct = (amount / batch.priorityAmount) * 100;
                    return (
                      <div
                        key={bd}
                        className={cn(
                          "rounded-xl border border-border/50 bg-secondary/30 p-3.5 hover:bg-secondary/50 transition-colors",
                          isBdManager && bd === bdManagerFullName && "ring-1 ring-primary/40 bg-primary/5"
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                              {idx + 1}
                            </div>
                            <div>
                              <p className="font-semibold text-xs">{bd}</p>
                              <p className="text-[10px] text-muted-foreground">{count} 位客户</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold font-mono text-sm">{formatCurrency(amount)}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{pct.toFixed(1)}%</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                          <span>旗下客户 PnL:</span>
                          <span className={cn(
                            "font-mono font-semibold",
                            pnl > 0 ? "text-success" : pnl < 0 ? "text-danger" : ""
                          )}>
                            {pnl > 0 ? "+" : ""}{formatCurrency(pnl)}
                          </span>
                        </div>
                        <Progress value={pct} variant="primary" className="h-1.5" />
                      </div>
                    );
                  })}
                {bdStatsResult.aggregatedOthers && (
                  <div
                    className={cn(
                      "rounded-xl border border-dashed border-border/60 bg-secondary/20 p-3.5 opacity-90"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center text-xs text-muted-foreground border border-border/60">
                          <Users2 className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-xs text-muted-foreground italic">
                            {bdStatsResult.aggregatedOthers.label}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {bdStatsResult.aggregatedOthers.count} 位客户 · 聚合显示
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold font-mono text-sm text-muted-foreground italic">
                          {formatCurrency(bdStatsResult.aggregatedOthers.amount)}
                        </p>
                        <p className="text-[10px] text-muted-foreground/80 font-mono">
                          {((bdStatsResult.aggregatedOthers.amount / batch.priorityAmount) * 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                      <span>合计旗下客户 PnL:</span>
                      <span className="font-mono font-semibold text-muted-foreground/90 italic">
                        {formatCurrency(bdStatsResult.aggregatedOthers.pnl)}
                      </span>
                    </div>
                    <Progress
                      value={(bdStatsResult.aggregatedOthers.amount / batch.priorityAmount) * 100}
                      variant="secondary"
                      className="h-1.5 opacity-70"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
      </div>

      <AddClientDialog
        open={addClientOpen}
        onOpenChange={(v) => {
          setAddClientOpen(v);
          if (!v) onChange?.();
        }}
        batchPriorityAmount={batch.priorityAmount}
        batchId={batch.id}
        lockedBdManager={isBdManager ? bdManagerFullName : undefined}
      />

      {/* 补仓记录 Dialog */}
      <Dialog open={mcDialog} onOpenChange={setMcDialog}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-warning" />
              机构补仓记录
              <Badge variant="secondary" className="text-[10px] ml-1">
                {batch.marginCalls?.length || 0} 条
              </Badge>
            </DialogTitle>
            <DialogDescription>
              批次 {batch.batchNumber} · {batch.stockSymbol}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!batch.marginCalls?.length ? (
              <div className="text-center py-12 text-muted-foreground border rounded-xl border-dashed border-border/60">
                <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">暂无补仓记录</p>
                <p className="text-xs mt-0.5">状态良好，未触发补仓</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[520px] overflow-y-auto scrollbar-thin pr-1">
                {batch.marginCalls.map((mc, idx) => (
                  <div
                    key={mc.id}
                    className={cn(
                      "rounded-xl p-3.5 border space-y-3",
                      mc.status === "PENDING"
                        ? "bg-danger/5 border-danger/30"
                        : mc.status === "FULLFILLED"
                        ? "bg-success/5 border-success/30"
                        : "bg-secondary/30 border-border"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground font-mono">补仓 #{idx + 1}</p>
                        <p className="font-bold font-mono">{formatCurrency(mc.requiredAmount)}</p>
                      </div>
                      <Badge
                        variant={
                          mc.status === "PENDING"
                            ? "danger"
                            : mc.status === "FULLFILLED"
                            ? "success"
                            : "secondary"
                        }
                        className="text-[10px] gap-1"
                      >
                        {mc.status === "PENDING"
                          ? "待处理"
                          : mc.status === "FULLFILLED"
                          ? "已完成"
                          : "已过期"}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="space-y-0.5">
                        <p className="text-muted-foreground">触发时市值</p>
                        <p className="font-mono font-semibold">{formatCurrency(mc.triggerMarketValue)}</p>
                      </div>
                      <div className="space-y-0.5 text-right">
                        <p className="text-muted-foreground">跌幅</p>
                        <p className="font-mono font-semibold text-danger">
                          -{(mc.dropPercent * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-muted-foreground">触发日期</p>
                        <p className="font-mono">{formatDate(mc.triggerDate)}</p>
                      </div>
                      {mc.fulfilledDate && (
                        <div className="space-y-0.5 text-right">
                          <p className="text-muted-foreground">到账日期</p>
                          <p className="font-mono">{formatDate(mc.fulfilledDate)}</p>
                        </div>
                      )}
                      {mc.fulfilledAmount !== undefined && mc.fulfilledAmount !== null && (
                        <div className="space-y-0.5 col-span-2">
                          <p className="text-muted-foreground">实际补仓 / 应补</p>
                          <p className="font-mono font-semibold">
                            {formatCurrency(mc.fulfilledAmount)} / {formatCurrency(mc.requiredAmount)}
                            <Progress
                              value={(mc.fulfilledAmount / mc.requiredAmount) * 100}
                              variant={mc.fulfilledAmount >= mc.requiredAmount ? "success" : "warning"}
                              className="mt-1.5"
                            />
                          </p>
                        </div>
                      )}
                    </div>
                    {mc.note && (
                      <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                        📝 {mc.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
