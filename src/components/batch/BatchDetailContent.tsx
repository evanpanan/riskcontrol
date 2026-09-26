"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, memo } from "react";
import {
  getBatchMetrics,
  calculateBatchPnLSplit,
  calculateRealtimeClientMetrics,
  calculateTotalShares,
  calculateClientMarginCall,
  getClientProfitSplit,
  isVipClient,
  calculateRescueStats,
  getLockedBatchRequiredMargin,
  summarizeBatchMarginFromClients,
  executeInstitutionTopup,
  settleClientPosition,
  calculateClientSettlement,
  isTopupBlockedByLegacyLedger,
} from "@/lib/riskEngine";
import { LedgerRecovery } from "@/components/batch/LedgerRecovery";
import { commitBatchFinance, getMockData } from "@/lib/mockData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { ClientAvatar } from "@/components/branding/ClientAvatar";
import { notifyBatchChannel } from "@/lib/notifier";
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
  DialogFooter,
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
  TrendingDown,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Zap,
  EyeOff,
  Users2,
  Archive,
  Gauge,
} from "lucide-react";

const MONEY_EPS = 0.005;
function _signPct(v: number) {
  if (!Number.isFinite(v)) return "0.00%";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function _signMoney(v: number) {
  if (!Number.isFinite(v)) return "$0.00";
  return `${v >= 0 ? "+" : ""}${formatCurrency(v)}`;
}
function stageLabelForPnl(realized: number, unrealized: number) {
  if (Math.abs(realized) < MONEY_EPS && Math.abs(unrealized) < MONEY_EPS) return "—";
  if (Math.abs(realized) < MONEY_EPS) return unrealized >= 0 ? "浮盈" : "浮亏";
  if (Math.abs(unrealized) < MONEY_EPS) return realized >= 0 ? "已实现盈利" : "已实现亏损";
  const rSign = realized >= 0;
  const uSign = unrealized >= 0;
  if (rSign && uSign) return "已实现盈利 · 浮盈";
  if (!rSign && !uSign) return "已实现亏损 · 浮亏";
  if (!rSign && uSign) return "已实现亏损 · 浮盈";
  return "已实现盈利 · 浮亏";
}
function variantForPnlStage(realized: number, unrealized: number, clientSide: boolean) {
  const total = realized + unrealized;
  if (Math.abs(total) < MONEY_EPS) return "outline";
  if (realized < 0 && unrealized >= 0) return "warning";
  if (total >= 0) return "success";
  return clientSide ? "warning" : "danger";
}
const PnlStageBadge = memo(function PnlStageBadge({
  realized,
  unrealized,
  clientSide,
}: {
  realized: number;
  unrealized: number;
  clientSide: boolean;
}) {
  return (
    <Badge variant={variantForPnlStage(realized, unrealized, clientSide) as any} className="gap-1 px-2.5 py-1 text-xs whitespace-nowrap">
      {stageLabelForPnl(realized, unrealized)}
    </Badge>
  );
});
const PnlCompactRow = memo(function PnlCompactRow({
  label,
  valueMoney,
  valuePercent,
  baseDenominator,
  clientSide = false,
}: {
  label: string;
  valueMoney: number;
  valuePercent: number;
  baseDenominator: number;
  clientSide?: boolean;
}) {
  const neg = baseDenominator > 0 ? valuePercent < 0 : valueMoney < 0;
  const zero = Math.abs(valueMoney) < MONEY_EPS;
  const pct = baseDenominator > 0 ? valuePercent / baseDenominator * 100 : 0;
  const colorCls = zero
    ? "text-muted-foreground/80"
    : neg
    ? clientSide
      ? "text-warning"
      : "text-danger"
    : "text-success";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-3">
        <span className={cn("text-xs font-bold font-mono tabular-nums whitespace-nowrap", colorCls)}>
          {zero ? "0.00%" : _signPct(pct)}
        </span>
        <span className={cn("text-sm font-bold font-mono tabular-nums whitespace-nowrap", colorCls)}>
          {zero ? "$0.00" : _signMoney(valueMoney)}
        </span>
      </div>
    </div>
  );
});

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
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [bdFilter, setBdFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "ALL">("ALL");
  const [splitFilter, setSplitFilter] = useState<"ALL" | "VIP" | "STANDARD">("ALL");
  const [hydrated, setHydrated] = useState(false);
  const [tick, setTick] = useState(0);
  const { user, role, isBdManager, bdManagerFullName } = useCurrentUser();

  useEffect(() => {
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "risk_control_client_status_v1") setTick((t) => t + 1);
    };
    window.addEventListener("storage", onStorage);
    const onCustom = () => setTick((t) => t + 1);
    window.addEventListener("risk-control:client-status-changed", onCustom);
    const id = window.setInterval(onCustom, 3500);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("risk-control:client-status-changed", onCustom);
      window.clearInterval(id);
    };
  }, []);

  const mv = batch.currentMarketValue ?? batch.initialTotalAmount ?? 0;
  const marginSummary = summarizeBatchMarginFromClients(batch as any);
  const metrics = { ...getBatchMetrics(batch as any), requiredMarginCall: marginSummary.totalPending };
  const lockedBatchRequiredMargin = getLockedBatchRequiredMargin(batch as any);
  const split = calculateBatchPnLSplit(batch as any, mv);
  const rescueStats = calculateRescueStats(batch as any, batch.currentStockPrice ?? batch.stockPriceAtStart);
  const tradingInfo = calculateTradingWindows(batch.signDate);
  type TradeWin = typeof tradingInfo.tradingWindows[number];

  const isProfitable = metrics.totalPnLPercent > 0.01;
  const isCritical = batch.riskLevel === RiskLevel.CRITICAL;
  const isWarning = batch.riskLevel === RiskLevel.WARNING;
  const dropForGauge = isProfitable ? 0 : -metrics.dropPercent;
  let gaugePointer = 0;
  if (dropForGauge >= 0) gaugePointer = 0;
  else if (dropForGauge >= -5) gaugePointer = (-dropForGauge / 5) * 25;
  else if (dropForGauge >= -10) gaugePointer = 25 + (((-dropForGauge) - 5) / 5) * 25;
  else if (dropForGauge >= -15) gaugePointer = 50 + (((-dropForGauge) - 10) / 5) * 25;
  else if (dropForGauge >= -20) gaugePointer = 75 + (((-dropForGauge) - 15) / 5) * 25;
  else gaugePointer = 100;
  gaugePointer = Math.max(0, Math.min(100, gaugePointer));
  const gaugeStageLabel = isProfitable
    ? "盈利中"
    : isCritical
    ? "已击穿"
    : metrics.dropPercent >= 15
    ? `预警 缓冲 ${metrics.safetyBufferPercent.toFixed(1)}%`
    : `正常 缓冲 ${metrics.safetyBufferPercent.toFixed(1)}%`;
  const gaugeStageColor = isProfitable
    ? "text-success"
    : isCritical
    ? "text-danger"
    : metrics.dropPercent >= 15
    ? "text-warning"
    : "text-success";
  const gaugeCircleColor = isProfitable
    ? "bg-success"
    : isCritical
    ? "bg-danger"
    : metrics.dropPercent >= 15
    ? "bg-warning"
    : "bg-success";

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
    const base: Client[] = hydrated
      ? (batch.clients || []).map((c) => (c as any).__redacted ? c : mergeClientStatusOnClient(c as any)) as Client[]
      : (batch.clients || []) as Client[];
    // BD 视角：bdFilter 仅"ALL"和"我自己"生效（因为其他商务经理 客户端根本不可见）
    const { mergedRows } = filterBatchDetailClientsByRole(base, scopeUser);
    return mergedRows as (Client | RedactedClientPlaceholder)[];
  }, [batch, scopeUser, hydrated, tick]);

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
    if (splitFilter !== "ALL") {
      list = list.filter((c: any) => {
        if (c.__redacted) return true;
        return splitFilter === "VIP" ? isVipClient(c) : !isVipClient(c);
      });
    }
    // 每客户分摊的"机构补仓救援金名义值"（不扣减客户本金，仅展示）
    const cm = rescueStats.totalRescueAmount;
    const pr = batch.priorityAmount || batch.initialTotalAmount * 0.7;
    const enriched = list.map((client: any) => {
      if (client.__redacted) return client;
      const realtime = calculateRealtimeClientMetrics(client, batch as any, mv);
      const perClient = split.perClient.get(client.id);
      const mc = calculateClientMarginCall(
        client.investmentAmount || 0,
        batch.initialTotalAmount || 0,
        metrics.requiredMarginCall || 0
      );
      const rescueAllocation = client.settlement?.marginCallReturned ??
        (cm > 0 && pr > 0 ? cm * (client.investmentAmount / pr) : 0);
      return {
        ...client,
        ...realtime,
        actualClientPnL: perClient?.pnl ?? 0,
        actualClientPnLPercent: perClient?.pnlPercent ?? 0,
        clientIsProfitable: perClient?.isProfitable ?? false,
        requiredMarginCall: mc,
        rescueAllocation,
      } as EnrichedDetailClient;
    });
    // 默认排序：脱敏客户置底；真实客户按投资金额从大到小
    enriched.sort((a: any, b: any) => {
      if (!!a.__redacted !== !!b.__redacted) return a.__redacted ? 1 : -1;
      if (a.__redacted) return 0;
      return (b.investmentAmount || 0) - (a.investmentAmount || 0);
    });
    return enriched;
  }, [filteredBase, mv, search, bdFilter, statusFilter, splitFilter, split, batch, metrics]);

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
    if (isTopupBlockedByLegacyLedger(batch as any)) { setRecoveryOpen(true); return; }
    setFulfillOpen(true);
  };
  const handleNotify = async (channel: "email" | "whatsapp") => {
    if (user?.role !== APP_ROLES.ADMIN && user?.role !== APP_ROLES.RISK_MANAGER) {
      toast.error("仅管理员和风控总监可发送机构通知。");
      return;
    }
    try { toast.success(await notifyBatchChannel(batch as any, channel)); }
    catch (err) { toast.error(err instanceof Error ? err.message : "通知失败"); }
  };
  const doFulfill = () => {
    const canonical = getMockData().batches.find((b) => b.id === batch.id);
    if (!canonical) throw new Error("批次不存在，请刷新。");
    const applied = commitBatchFinance(canonical, (draft) => executeInstitutionTopup(draft, {
      amount: marginSummary.totalPending, expectedRoundId: marginSummary.roundId,
      operatorName: user?.displayName ?? user?.email,
    }));
    if (applied <= 0) throw new Error("本轮已完成，请刷新后查看。");
    window.dispatchEvent(
      new CustomEvent("risk-control:margin-fulfilled", {
        detail: { batchId: batch.id, amount: applied },
      })
    );
    setTick((t) => t + 1);
    setFulfillOpen(false);
    onChange?.();
  };

  const handleClientStatusChange = (clientId: string, newStatus: ClientStatus) => {
    if (!batch.clients) return;
    const target = batch.clients.find((c: any) => c.id === clientId);
    if (!target) return;
    if (newStatus === ClientStatus.SETTLED) {
      if ((batch as import("@/lib/riskEngine").BatchLike).finance?.legacyWarnings.length) {
        setRecoveryOpen(true);
        return;
      }
      setSettleTarget(clientId);
      return;
    }
    try {
      const canonical = getMockData().batches.find((b) => b.id === batch.id);
      if (!canonical) return;
      commitBatchFinance(canonical, (draft) => {
        const client = draft.clients!.find((c) => c.id === clientId)!;
        if (client.status === ClientStatus.SETTLED) throw new Error("已结算快照不可撤销或重新激活。");
        client.status = newStatus;
        client.settledAt = null;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "状态更新失败");
      return;
    }
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
      <LedgerRecovery batch={batch as any} open={recoveryOpen} onOpenChange={setRecoveryOpen} />
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
              <Button asChild variant="outline" className="h-10 gap-2 shrink-0 border-primary/50 bg-primary/10 text-foreground font-semibold hover:bg-primary/20 shadow-sm">
                <Link href="/"><ArrowLeft className="h-4 w-4" />返回风控大盘</Link>
              </Button>
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
              allowed={[APP_ROLES.RISK_MANAGER, APP_ROLES.ADMIN]}
              auditResource={`batch:notify_email:${batch.id}`}
              auditAction="ui_component_denied"
            >
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={() => handleNotify("email")}
            >
              <Mail className="h-3.5 w-3.5" />
              邮件通知商务经理
            </Button>
            </RoleGate>
            <RoleGate
              allowed={[APP_ROLES.RISK_MANAGER, APP_ROLES.ADMIN]}
              auditResource={`batch:notify_wa:${batch.id}`}
              auditAction="ui_component_denied"
            >
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={() => handleNotify("whatsapp")}
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
            {marginSummary.totalPending > 0 && (
              <RoleGate
                allowed={[APP_ROLES.RISK_MANAGER, APP_ROLES.ADMIN]}
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
              onClick={() => handleNotify("email")}
            >
              <Mail className="h-3 w-3" />
              Email
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-[11px]"
              onClick={() => handleNotify("whatsapp")}
            >
              <MessageCircle className="h-3 w-3" />
              WA
            </Button>
            {marginSummary.totalPending > 0 && (
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
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
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
        <Card className={cn(
          "border-border/50",
          rescueStats.totalRescueAmount > 0 && "border-warning/40 bg-warning/[0.04]"
        )}>
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Archive className="h-3 w-3 text-warning" /> 救援独立仓位
            </p>
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] text-muted-foreground">注资</span>
                <span className="font-mono text-[11px] font-semibold text-warning">
                  {formatCurrency(rescueStats.totalRescueAmount)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] text-muted-foreground">市值</span>
                <span className="font-mono text-[11px] font-semibold">
                  {formatCurrency(rescueStats.rescueCurrentValue)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] text-muted-foreground">浮PnL</span>
                <span className={cn(
                  "font-mono text-[11px] font-semibold",
                  rescueStats.rescuePnL > 0 && "text-success",
                  rescueStats.rescuePnL < 0 && "text-danger",
                  rescueStats.rescuePnL === 0 && "text-muted-foreground"
                )}>
                  {rescueStats.rescuePnL >= 0 ? "+" : ""}{formatCurrency(rescueStats.rescuePnL)}
                </span>
              </div>
              {rescueStats.totalRescueAmount > 0 && (
                <div className="pt-1 mt-1 border-t border-border/40 flex items-baseline justify-between">
                  <span className="text-[9px] text-muted-foreground">均价 / 份额</span>
                  <span className="font-mono text-[10px]">
                    ${rescueStats.weightedAverageEntryPrice.toFixed(2)} / {rescueStats.totalRescueShares.toFixed(0)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Users className="h-3 w-3" /> 客户
            </p>
            <p className="text-sm font-bold font-mono">{batch.clients?.length || 0} 位</p>
            <p className="text-[10px] text-muted-foreground">{Object.keys(investedByBD).length} 位商务经理</p>
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
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] mb-1 gap-2">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                <span>风险程度 · 账户收益率</span>
              </div>
              <span className={cn("font-mono font-bold tabular-nums whitespace-nowrap", gaugeStageColor)}>
                {gaugeStageLabel}
              </span>
            </div>
            <div className="relative w-full py-[3px]">
              <div className="relative h-2 w-full rounded-full overflow-hidden bg-secondary/60">
                <div className="absolute inset-y-0 left-0 w-[50%] bg-gradient-to-r from-success/95 via-success/70 to-warning/70" />
                <div className="absolute inset-y-0 left-[50%] w-[25%] bg-gradient-to-r from-warning/75 to-warning/60" />
                <div className="absolute inset-y-0 left-[75%] w-[25%] bg-gradient-to-r from-warning/65 via-danger/70 to-danger/95" />
                {!isProfitable && (
                  <div
                    className="absolute inset-y-0 bg-background/40 backdrop-blur-[1px]"
                    style={{ left: "0%", right: `${100 - gaugePointer}%` }}
                  />
                )}
              </div>
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none transition-all duration-700"
                style={{
                  left: `max(8px, min(calc(100% - 8px), ${gaugePointer}%))`,
                }}
              >
                <div
                  className={cn(
                    "h-4 w-4 rounded-full border-[2.5px] border-white shadow-[0_0_6px_rgba(0,0,0,0.5)] ring-1 ring-black/10",
                    gaugeCircleColor
                  )}
                />
              </div>
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums">
              <span className="text-success font-semibold">0%</span>
              <span className="text-danger font-semibold">20%</span>
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
              <PnlStageBadge
                realized={split.realizedInstitutionPnL}
                unrealized={split.unrealizedInstitutionPnL}
                clientSide={false}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-1 space-y-3">
            <div className="space-y-2">
              <PnlCompactRow
                label="已实现"
                valueMoney={split.realizedInstitutionPnL}
                valuePercent={split.realizedInstitutionBreakdown.initial + split.realizedInstitutionBreakdown.splitShare + split.realizedInstitutionBreakdown.rescue}
                baseDenominator={(batch.finance?.originalCapital ?? batch.initialTotalAmount) * 0.3 + (batch.cumulativeMarginCalls || 0)}
              />
              <PnlCompactRow
                label="未实现"
                valueMoney={split.unrealizedInstitutionPnL}
                valuePercent={split.unrealizedInstitutionBreakdown.initial + split.unrealizedInstitutionBreakdown.splitShare + split.unrealizedInstitutionBreakdown.rescue}
                baseDenominator={(batch.finance?.originalCapital ?? batch.initialTotalAmount) * 0.3 + (batch.cumulativeMarginCalls || 0)}
              />
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-border/50">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">合计</span>
                <div className="flex items-center gap-3">
                  <span className={cn("text-sm font-bold font-mono tabular-nums whitespace-nowrap", split.institutionTotalPnL >= 0 ? "text-success" : "text-danger")}>
                    {split.institutionTotalPnLPercent >= 0 ? "+" : ""}
                    {split.institutionTotalPnLPercent.toFixed(2)}%
                  </span>
                  <span className={cn("text-lg font-bold font-mono tabular-nums whitespace-nowrap", split.institutionTotalPnL >= 0 ? "text-success" : "text-danger")}>
                    {split.institutionTotalPnL >= 0 ? "+" : ""}
                    {formatCurrency(split.institutionTotalPnL)}
                  </span>
                </div>
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
              <PnlStageBadge
                realized={split.realizedClientPnL}
                unrealized={split.unrealizedClientPnL}
                clientSide
              />
            </div>
          </CardHeader>
          <CardContent className="pt-1 space-y-3">
            <div className="space-y-2">
              <PnlCompactRow
                label="已实现"
                valueMoney={split.realizedClientPnL}
                valuePercent={split.realizedClientPnL}
                baseDenominator={(batch.finance?.originalCapital ?? batch.initialTotalAmount) * 0.7}
                clientSide
              />
              <PnlCompactRow
                label="未实现"
                valueMoney={split.unrealizedClientPnL}
                valuePercent={split.unrealizedClientPnL}
                baseDenominator={(batch.finance?.originalCapital ?? batch.initialTotalAmount) * 0.7}
                clientSide
              />
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-border/50">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">合计</span>
                <div className="flex items-center gap-3">
                  <span className={cn("text-sm font-bold font-mono tabular-nums whitespace-nowrap", split.clientTotalPnL >= 0 ? "text-success" : "text-warning")}>
                    {split.clientTotalPnLPercent >= 0 ? "+" : ""}
                    {split.clientTotalPnLPercent.toFixed(2)}%
                  </span>
                  <span className={cn("text-lg font-bold font-mono tabular-nums whitespace-nowrap", split.clientTotalPnL >= 0 ? "text-success" : "text-warning")}>
                    {split.clientTotalPnL >= 0 ? "+" : ""}
                    {formatCurrency(split.clientTotalPnL)}
                  </span>
                </div>
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
                          {redactedCountInPage} 位其他商务经理 客户已脱敏
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
                      placeholder={isBdManager ? "搜索我名下客户" : "客户 / 商务经理搜索"}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <select
                    className="h-9 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
                    value={bdFilter}
                    onChange={(e) => setBdFilter(e.target.value)}
                  >
                    <option value="ALL">{isBdManager ? "仅我名下 / 全部" : "全部商务经理"}</option>
                    {bdManagers.map((bd) => {
                      const disabled = isBdManager && bd !== bdManagerFullName;
                      return (
                        <option key={bd} value={bd} disabled={disabled}>
                          {bd}{disabled ? "（其他商务经理 · 无权限）" : ""}
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
                    <option value="SETTLED">已结算</option>
                  </select>
                  <select
                    className="h-9 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    value={splitFilter}
                    onChange={(e) => setSplitFilter(e.target.value as any)}
                  >
                    <option value="ALL">全部分成档位</option>
                    <option value="VIP">VIP 档（按签约时门槛）</option>
                    <option value="STANDARD">普通档（按签约时门槛）</option>
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
                batchRequiredMarginCall={lockedBatchRequiredMargin > 0 ? lockedBatchRequiredMargin : metrics.requiredMarginCall}
                onClientStatusChange={handleClientStatusChange}
                batch={batch as any}
                onLedgerRecovery={() => setRecoveryOpen(true)}
                onBatchMutated={() => {
                  onChange?.();
                  setTick((t) => t + 1);
                }}
              />
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Building2 className="h-4 w-4 text-secondary-foreground" />
                商务经理资金分布
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
                          <div className="flex items-center gap-2 min-w-0">
                            <ClientAvatar name={bd} size="sm" />
                            <div className="min-w-0">
                              <Link href={`/bd/${encodeURIComponent(bd)}`} className="font-semibold text-xs hover:text-primary hover:underline focus-visible:outline focus-visible:outline-primary">{bd}</Link>
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
            <p className="text-xs text-muted-foreground">以下机构出资与客户原始本金独立记账，补仓仓位本金及全部收益归机构。</p>
            {((batch as import("@/lib/riskEngine").BatchLike).finance?.legacyWarnings ?? []).map((warning) => (
              <p key={warning} role="alert" className="text-xs text-warning">{warning}</p>
            ))}
            <div className="max-h-48 overflow-auto rounded-lg border border-border/50">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr><th className="p-2 text-left">机构成交时间</th><th>出资金额</th><th>成交价</th><th>买入份额</th></tr>
                </thead>
                <tbody>
                  {((batch as import("@/lib/riskEngine").BatchLike).finance?.trades ?? []).map((trade) => (
                    <tr key={trade.id} className="border-t border-border/40">
                      <td className="p-2">{formatDateTime(new Date(trade.createdAt))}</td>
                      <td className="text-right p-2">{formatCurrency(trade.amount)}</td>
                      <td className="text-right p-2">{trade.entryPrice ? formatCurrency(trade.entryPrice) : "待核对"}</td>
                      <td className="text-right p-2">{trade.entryPrice ? trade.shares.toFixed(4) : "待核对"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      {/* 确认补仓 AlertDialog */}
      <Dialog open={fulfillOpen} onOpenChange={setFulfillOpen}>
        <DialogContent className="sm:max-w-[460px] !p-0 overflow-hidden border-danger/30">
          <div className="bg-gradient-to-r from-danger/20 via-danger/10 to-transparent border-b border-border/60 px-6 py-4">
            <DialogHeader className="text-left sm:text-left">
              <DialogTitle className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-danger/20 text-danger">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                确认补仓操作
              </DialogTitle>
              <DialogDescription className="text-left">
                按本轮锁定缺口记录机构补仓。每笔按当前价格独立记录份额，本金和收益全部归机构。
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">批次号</p>
                <p className="font-mono font-bold text-sm">{batch.batchNumber}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">标的</p>
                <p className="font-mono font-bold text-sm">{batch.stockSymbol}</p>
              </div>
              <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-1 col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-danger">补仓金额</p>
                <p className="font-mono font-extrabold text-2xl text-danger">
                  ${metrics.requiredMarginCall.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-warning/5 border border-warning/30 p-2.5 text-[11px] text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-warning" />
              <div className="space-y-0.5">
                <p>补仓完成后将：</p>
                <p>· 累计补仓金额 + ${metrics.requiredMarginCall.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                <p>· 原始仓位和机构补仓仓位分别核算，股票价格不变</p>
                <p>· 客户保本进度与分成比例保持不变</p>
              </div>
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setFulfillOpen(false)} className="h-9 px-4">
              取消
            </Button>
            <Button type="button" variant="danger" onClick={() => {
              try { doFulfill(); } catch (err) { toast.error(err instanceof Error ? err.message : "补仓失败"); }
            }} className="h-9 px-4 gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              确认补仓 ${metrics.requiredMarginCall.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!settleTarget}
        onOpenChange={(open) => { if (!open) setSettleTarget(null); }}
        title="确认客户退出结算"
        description="按签约比例结算客户利润；对应机构原始仓位、历次补仓本金和收益同时按占比结清。结算后金额、价格和比例永久冻结，不可重新激活。"
        summary={(() => {
          const client = batch.clients?.find((c) => c.id === settleTarget);
          if (!client) return [];
          const result = calculateClientSettlement(client, batch as any, mv, batch.currentStockPrice ?? batch.stockPriceAtStart);
          return [
            { label: "客户原始本金", value: formatCurrency(client.investmentAmount) },
            { label: "客户实收", value: formatCurrency(result.clientReceives) },
            { label: "机构实收（含补仓）", value: formatCurrency(result.institutionReceives) },
            { label: "客户签约分成", value: `${result.splitRatioClient}%` },
          ];
        })()}
        onConfirm={() => {
          const canonical = getMockData().batches.find((b) => b.id === batch.id);
          if (!canonical || !settleTarget) throw new Error("客户不存在，请刷新。");
          commitBatchFinance(canonical, (draft) => settleClientPosition(draft, settleTarget));
          window.dispatchEvent(new CustomEvent("risk-control:client-status-changed"));
          setTick((t) => t + 1);
          onChange?.();
        }}
      />
    </div>
  );
}
