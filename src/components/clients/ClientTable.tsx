"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { Client, ClientStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  cn,
  formatCurrency,
  formatPercent,
  formatSplitRatio,
} from "@/lib/utils";
import type { AppRole, AppSessionUser } from "@/types/auth";
import { APP_ROLES } from "@/types/auth";
import {
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle,
  Hourglass,
  Landmark,
  PlusCircle,
  EyeOff,
  LogOut,
  CheckSquare,
  RotateCcw,
  Archive,
  AlertCircle,
  Zap,
  History,
  DollarSign,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getClientProfitSplit,
  isVipClient,
  allocateClientMarginRequirements,
  executeInstitutionTopup,
  isTopupBlockedByLegacyLedger,
  summarizeBatchMarginFromClients,
  getLockedBatchRequiredMargin,
  type BatchLike,
  type ClientMarginState,
} from "@/lib/riskEngine";
import { commitBatchFinance } from "@/lib/mockData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ClientAvatar } from "@/components/branding/ClientAvatar";

export interface EnrichedClient extends Omit<Client, 'realtimePnL' | 'estimatedExitAmount'> {
  __redacted?: boolean;
  realtimePnL?: number | null;
  estimatedExitAmount?: number | null;
  marketValueShare?: number;
  actualClientPnL?: number;
  actualClientPnLPercent?: number;
  requiredMarginCall?: number;
}

interface ClientTableProps {
  clients: EnrichedClient[];
  batchInitialAmount: number;
  viewerRole?: AppRole;
  viewerUser?: AppSessionUser | null;
  batchRequiredMarginCall?: number;
  onClientStatusChange?: (clientId: string, newStatus: ClientStatus) => void;
  batch?: BatchLike;
  onBatchMutated?: (payload: {
    type: "client_single_margin";
    clientId: string;
    amount: number;
    totalAddedCumulative: number;
  }) => void;
  onClientInvestmentRefresh?: () => void;
  onLedgerRecovery?: () => void;
}

export function ClientTable({
  clients,
  batchInitialAmount,
  viewerRole = APP_ROLES.RISK_MANAGER,
  viewerUser,
  batchRequiredMarginCall = 0,
  onClientStatusChange,
  batch,
  onBatchMutated,
  onLedgerRecovery,
}: ClientTableProps) {
  const totalInvestment = clients
    .filter((c) => !(c as any).__redacted)
    .reduce((s, c) => s + c.investmentAmount, 0);

  const isBd = viewerRole === APP_ROLES.BD_MANAGER;
  const bdFullName = viewerUser?.bdManagerFullName;
  const institutionRole = viewerRole === APP_ROLES.RISK_MANAGER || viewerRole === APP_ROLES.ADMIN;
  const nonRedactedClients = clients.filter(c => !(c as any).__redacted);
  const shouldMergeProfitCols = nonRedactedClients.every(c => {
    const rt = c.realtimePnL ?? 0;
    const ap = c.actualClientPnL ?? 0;
    return Math.abs(rt - ap) < 0.01;
  });

  const canEditClient = (c: EnrichedClient): boolean => {
    if ((c as any).__redacted) return false;
    if (viewerRole === APP_ROLES.RISK_MANAGER) return true;
    if (isBd && bdFullName && c.bdManager === bdFullName) return true;
    return false;
  };

  const canDeleteClient = (c: EnrichedClient): boolean => {
    if ((c as any).__redacted) return false;
    return viewerRole === APP_ROLES.RISK_MANAGER;
  };

  const getStatusConfig = (status: ClientStatus) => {
    switch (status) {
      case ClientStatus.ACTIVE:
        return {
          variant: "success" as const,
          label: "持仓中",
          Icon: CheckCircle,
        };
      case ClientStatus.EXIT_REQUESTED:
        return {
          variant: "warning" as const,
          label: "申请退出",
          Icon: Hourglass,
        };
      case ClientStatus.SETTLED:
        return {
          variant: "secondary" as const,
          label: "已结算",
          Icon: ShieldCheck,
        };
      default:
        return {
          variant: "secondary" as const,
          label: status,
          Icon: Minus,
        };
    }
  };

  const [marginDialogOpen, setMarginDialogOpen] = useState(false);
  const [marginDialogClientId, setMarginDialogClientId] = useState<string | null>(null);
  const [marginInputValue, setMarginInputValue] = useState<string>("");
  const [marginDialogTick, setMarginDialogTick] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  const effectiveLockedRequired = batch ? getLockedBatchRequiredMargin(batch) : batchRequiredMarginCall;

  const batchSummary = useMemo(() => {
    if (!batch) return null;
    const s = summarizeBatchMarginFromClients(batch);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, marginDialogTick, clients, renderTick]);

  const perClientStateMap: Map<string, ClientMarginState> = useMemo(() => {
    const fallbackMap = new Map<string, ClientMarginState>();
    if (batch) {
      const lockedFromRef = effectiveLockedRequired;
      const sm = batchSummary?.perClient;
      if (sm) {
        return sm;
      }
      const lockedRequired = lockedFromRef > 0 ? lockedFromRef : getLockedBatchRequiredMargin(batch);
      const effectiveBatchRequired = lockedRequired > 0 ? lockedRequired : batchRequiredMarginCall;
      const alloc = allocateClientMarginRequirements(batch, effectiveBatchRequired, batch.cumulativeMarginCalls ?? 0);
      return alloc;
    }
    const effectiveInitial = Math.max(batchInitialAmount || 0, totalInvestment);
    for (const c of clients) {
      const inv = c.investmentAmount ?? 0;
      const ratio = effectiveInitial > 0 ? inv / effectiveInitial : 0;
      const required = batchRequiredMarginCall * ratio;
      const existing: ClientMarginState | undefined = (c as any).marginState;
      fallbackMap.set(c.id, {
        initialInvestment: inv,
        required,
        fulfilled: existing?.fulfilled ?? 0,
        history: existing?.history ?? [],
      });
    }
    return fallbackMap;
  }, [batch, batchRequiredMarginCall, batchInitialAmount, totalInvestment, clients, batchSummary, renderTick, effectiveLockedRequired]);

  const marginDialogClient: EnrichedClient | null = useMemo(() => {
    if (!marginDialogClientId) return null;
    return clients.find((c) => c.id === marginDialogClientId) ?? null;
  }, [clients, marginDialogClientId, marginDialogTick, renderTick]);

  const showMarginCallCol = (batchSummary ? batchSummary.totalRequired > 0 : batchRequiredMarginCall > 0);
  const anyRescueAllocation = clients.some(
    (c) => typeof (c as any).rescueAllocation === "number" && (c as any).rescueAllocation > 0.01
  );
  const showRescueCol = showMarginCallCol || anyRescueAllocation;
  const clientTotalMarginPending = batchSummary?.totalPending ?? Math.max(0, batchRequiredMarginCall);

  const sortedClients = useMemo(() => {
    const statusRank = (c: EnrichedClient): number => {
      switch (c.status as ClientStatus) {
        case ClientStatus.EXIT_REQUESTED: return 0;
        case ClientStatus.ACTIVE: return 1;
        case ClientStatus.SETTLED: return 99;
        default: return 50;
      }
    };
    return [...clients].sort((a, b) => {
      const sa = statusRank(a);
      const sb = statusRank(b);
      if (sa !== sb) return sa - sb;
      const isAVip = (a as any).splitTier === "VIP" || a.investmentAmount >= 100000;
      const isBVip = (b as any).splitTier === "VIP" || b.investmentAmount >= 100000;
      if (isAVip !== isBVip) return isAVip ? -1 : 1;
      if (b.investmentAmount !== a.investmentAmount) return b.investmentAmount - a.investmentAmount;
      return (a.name ?? "").localeCompare(b.name ?? "", "zh-Hans-CN");
    });
  }, [clients]);

  if (!clients.length) {
    return (
      <div className="text-center py-16 border border-dashed border-border/50 rounded-xl">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
        <p className="text-muted-foreground">暂无客户数据</p>
        <p className="text-xs text-muted-foreground/70 mt-0.5">
          请点击「新增客户」录入该批次的客户信息
        </p>
      </div>
    );
  }

  const sortedClientsFinal = sortedClients;

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <Table>
        <TableHeader className="bg-secondary/30">
          <TableRow className="hover:bg-secondary/30 border-border/50">
            <TableHead className="w-[180px]">客户信息</TableHead>
            <TableHead>
              <div className="flex items-center">
                商务经理
              </div>
            </TableHead>
            <TableHead className="text-right">投资金额</TableHead>
            <TableHead className="text-center">分成比例</TableHead>
            {shouldMergeProfitCols ? (
              <TableHead className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  <Landmark className="h-3.5 w-3.5 text-primary" />
                  客户最终盈利
                </div>
              </TableHead>
            ) : (
              <>
                <TableHead className="text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <TrendingUp className="h-3.5 w-3.5" />
                    实时浮盈
                  </div>
                </TableHead>
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 justify-end cursor-help">
                        <Landmark className="h-3.5 w-3.5 text-primary" />
                        <span className="whitespace-nowrap">实际分成盈利</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs w-[260px]">
                        仅当 <span className="font-semibold">当前股价超过买入价</span> 时客户才有客户PnL，否则保本不显示任何盈利数字；机构补仓不改变客户盈亏，本金独立核算归机构</p>
                    </TooltipContent>
                  </Tooltip>
                </TableHead>
              </>
            )}
            {showRescueCol && (
              <TableHead className="text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 justify-end cursor-help">
                      <Archive className="h-3.5 w-3.5 text-warning" />
                      <span className="whitespace-nowrap text-warning font-semibold">机构补仓分摊</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs w-[220px]">
                      机构补仓救援金（独立核算：本金及盈利全归机构，客户不参与。本列仅显示该客户按出资比例对应的名义救援分摊金额
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
            )}
            <TableHead className="text-right">
              <div className="flex items-center gap-1 justify-end">
                <ShieldCheck className="h-3.5 w-3.5" />
                预估退出金额
              </div>
            </TableHead>
            <TableHead className="text-center w-[100px]">状态</TableHead>
            <TableHead className="text-center w-[180px]">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedClientsFinal.map((client) => {
            const isRedacted = !!(client as any).__redacted;
            const statusConfig = getStatusConfig(client.status as ClientStatus);
            const StatusIcon = statusConfig.Icon;
            const realtimePnL = client.realtimePnL || 0;
            const estExit = client.estimatedExitAmount ?? client.investmentAmount;
            const isSettled = client.status === ClientStatus.SETTLED;
            const unverifiedSettlement = isSettled && !(client as any).settlement;
            const split = getClientProfitSplit(client);
            const actualPnL = client.actualClientPnL ?? 0;
            const actualPnLPct = client.actualClientPnLPercent ?? 0;
            const clientRatio = totalInvestment > 0
              ? ((client.investmentAmount || 0) / totalInvestment) * 100
              : 0;
            const canEdit = canEditClient(client);
            const canDelete = canDeleteClient(client);
            const ms = perClientStateMap.get(client.id);
            const clientRequired = ms?.required ?? 0;
            const clientFulfilled = ms?.fulfilled ?? 0;
            const clientPending = Math.max(0, clientRequired - clientFulfilled);
            const historyCount = ms?.history?.length ?? 0;
            const clientMarginProgressPct = clientRequired > 0 ? Math.min(100, (clientFulfilled / clientRequired) * 100) : 0;
            const clientMarginPctOfTotal = (batchSummary?.totalRequired ?? 0) > 0
              ? (clientRequired / (batchSummary?.totalRequired ?? 1)) * 100
              : clientRatio;

            return (
              <TableRow
                key={client.id}
                className={cn(
                  "group h-[68px]",
                  isRedacted &&
                    "opacity-60 bg-secondary/10 hover:bg-secondary/15 pointer-events-none select-none",
                  !isRedacted && client.status === ClientStatus.EXIT_REQUESTED &&
                    "opacity-70 bg-yellow-950/10 hover:bg-yellow-950/20",
                  !isRedacted && client.status === ClientStatus.SETTLED &&
                    "opacity-60 bg-secondary/15 hover:bg-secondary/20 grayscale"
                )}
              >
                <TableCell>
                  {isRedacted ? (
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-secondary/60 border border-dashed border-border/60 flex items-center justify-center shrink-0">
                        <EyeOff className="h-4 w-4 text-muted-foreground/70" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm italic text-muted-foreground">
                          {client.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground/80 font-mono">
                          其他商务经理 客户 · 已脱敏
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <ClientAvatar name={client.name} size="md" rounded="xl" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-sm truncate">{client.name}</p>
                          {isVipClient(client) && (
                            <Badge variant="primary" className="text-[9px] px-1.5 py-0 h-4 font-mono">
                              VIP
                            </Badge>
                          )}
                          {client.investmentAmount >= 200000 && (
                            <Badge variant="warning" className="text-[9px] px-1.5 py-0 h-4 font-mono">
                              大额
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          占优先池 {clientRatio.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {isRedacted ? (
                    <span className="text-sm text-muted-foreground italic">—</span>
                  ) : (
                    <Link
                      href={`/bd/${encodeURIComponent(client.bdManager)}`}
                      className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 hover:underline underline-offset-2 transition-colors"
                      title={`查看 ${client.bdManager} 的所有客户`}
                    >
                      <ClientAvatar name={client.bdManager} size="xs" />
                      <span>{client.bdManager}</span>
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="text-muted-foreground italic">—</span>
                  ) : (
                    <div>
                      <p className="font-mono font-bold text-sm">
                        {formatCurrency(client.investmentAmount)}
                      </p>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {isRedacted ? (
                    <span className="text-muted-foreground italic">—</span>
                  ) : (
                      <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help">
                          <p className="text-xs font-mono font-semibold">
                            客户 {Number((split.client * 100).toFixed(2))}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            / 机构 {Number((split.institution * 100).toFixed(2))}%
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs space-y-0.5 w-[220px]">
                          <p className="font-semibold">分成规则说明</p>
                          <p className="text-muted-foreground">
                            投资金额 ${client.investmentAmount?.toLocaleString?.()}
                          </p>
                          <p className="text-muted-foreground">
                            签约比例：客户 {Number((split.client * 100).toFixed(2))}% /
                            机构 {Number((split.institution * 100).toFixed(2))}%
                          </p>
                          <p className="pt-1 text-[10px] text-primary">
                            * 客户亏损全额由机构劣后资金承担
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                {shouldMergeProfitCols ? (
                  <TableCell className="text-right">
                    {isRedacted ? (
                      <span className="text-muted-foreground italic">—</span>
                    ) : (
                      <div className="w-[140px] ml-auto">
                        <p
                          className={cn(
                            "font-mono font-bold text-sm",
                            actualPnL > 0 && "text-success",
                            actualPnL === 0 && "text-muted-foreground"
                          )}
                        >
                          {actualPnL > 0 ? (
                            <span className="flex items-center gap-0.5 justify-end">
                              <PlusCircle className="h-3 w-3" />
                              +{formatCurrency(actualPnL)}
                            </span>
                          ) : (
                            <span className="flex items-center gap-0.5 justify-end text-primary/80">
                              <ShieldCheck className="h-3 w-3" /> {unverifiedSettlement ? "待核对" : isSettled ? "已结算" : "保本中"}
                            </span>
                          )}
                        </p>
                        {actualPnL > 0 ? (
                          <p className="text-[10px] font-mono mt-0.5 text-success/80 text-right">
                            +{formatPercent(actualPnLPct)}
                          </p>
                        ) : (
                          (() => {
                            if (isSettled) return null;
                            const mv = (client.marketValueShare ?? 0);
                            const inv = client.investmentAmount || 0;
                            const progress = inv > 0
                              ? Math.max(0, Math.min(100, (mv / inv) * 100))
                              : 100;
                            return (
                              <div className="mt-1.5">
                                <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-1 font-mono">
                                  <span>回本进度</span>
                                  <span className="text-primary/80 font-semibold">{progress.toFixed(0)}%</span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all duration-700",
                                      progress >= 100
                                        ? "bg-gradient-to-r from-success to-success/70"
                                        : progress >= 90
                                        ? "bg-gradient-to-r from-primary to-primary/70"
                                        : progress >= 75
                                        ? "bg-gradient-to-r from-warning/90 to-warning/60"
                                        : "bg-gradient-to-r from-danger/80 to-danger/50"
                                    )}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    )}
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-right">
                      {isRedacted ? (
                        <span className="text-muted-foreground italic">—</span>
                      ) : (
                        <div className="w-[140px] ml-auto">
                          <p
                            className={cn(
                              "font-mono font-bold text-sm",
                              realtimePnL > 0 && "text-success",
                              realtimePnL < 0 && "text-danger",
                              realtimePnL === 0 && ""
                            )}
                          >
                            {realtimePnL > 0 ? (
                              <span className="flex items-center gap-0.5 justify-end">
                                <TrendingUp className="h-3 w-3" />
                                +{formatCurrency(realtimePnL)}
                              </span>
                            ) : realtimePnL < 0 ? (
                              <span className="flex items-center gap-0.5 justify-end">
                                <TrendingDown className="h-3 w-3" />
                                {formatCurrency(realtimePnL)}
                              </span>
                            ) : (
                              <span className="flex items-center gap-0.5 justify-end text-primary/80">
                                <ShieldCheck className="h-3 w-3" /> 保本
                              </span>
                            )}
                          </p>
                          {realtimePnL > 0 ? (
                            <p className="text-[10px] font-mono mt-0.5 text-success/80 text-right">
                              +{formatPercent((realtimePnL / (client.investmentAmount || 1)) * 100)}
                            </p>
                          ) : realtimePnL < 0 ? (
                            <p className="text-[10px] font-mono mt-0.5 text-danger/80 text-right">
                              {formatPercent((realtimePnL / (client.investmentAmount || 1)) * 100)}
                            </p>
                          ) : (
                            (() => {
                              if (isSettled) return null;
                              const mv = (client.marketValueShare ?? 0);
                              const inv = client.investmentAmount || 0;
                              const progress = inv > 0
                                ? Math.max(0, Math.min(100, (mv / inv) * 100))
                                : 100;
                              return (
                                <div className="mt-1.5">
                                  <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-1 font-mono">
                                    <span>回本进度</span>
                                    <span className="text-primary/80 font-semibold">{progress.toFixed(0)}%</span>
                                  </div>
                                  <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
                                    <div
                                      className={cn(
                                        "h-full rounded-full transition-all duration-700",
                                        progress >= 100
                                          ? "bg-gradient-to-r from-success to-success/70"
                                          : progress >= 90
                                          ? "bg-gradient-to-r from-primary to-primary/70"
                                          : progress >= 75
                                          ? "bg-gradient-to-r from-warning/90 to-warning/60"
                                          : "bg-gradient-to-r from-danger/80 to-danger/50"
                                      )}
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })()
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isRedacted ? (
                        <span className="text-muted-foreground italic">—</span>
                      ) : (
                        <div className="w-[140px] ml-auto">
                          <p
                            className={cn(
                              "font-mono font-bold text-sm",
                              actualPnL > 0 && "text-success",
                              actualPnL === 0 && "text-muted-foreground"
                            )}
                          >
                            {actualPnL > 0 ? (
                              <span className="flex items-center gap-0.5 justify-end">
                                <PlusCircle className="h-3 w-3" />
                                +{formatCurrency(actualPnL)}
                              </span>
                            ) : (
                              <span className="flex items-center gap-0.5 justify-end text-primary/80">
                                <ShieldCheck className="h-3 w-3" /> 保本
                              </span>
                            )}
                          </p>
                          {actualPnL > 0 ? (
                            <p className="text-[10px] font-mono mt-0.5 text-success/80 text-right">
                              +{formatPercent(actualPnLPct)}
                            </p>
                          ) : (
                            (() => {
                              if (isSettled) return null;
                              const mv = (client.marketValueShare ?? 0);
                              const inv = client.investmentAmount || 0;
                              const progress = inv > 0
                                ? Math.max(0, Math.min(100, (mv / inv) * 100))
                                : 100;
                              return (
                                <div className="mt-1.5">
                                  <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-1 font-mono">
                                    <span>回本进度</span>
                                    <span className="text-primary/80 font-semibold">{progress.toFixed(0)}%</span>
                                  </div>
                                  <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
                                    <div
                                      className={cn(
                                        "h-full rounded-full transition-all duration-700",
                                        progress >= 100
                                          ? "bg-gradient-to-r from-success to-success/70"
                                          : progress >= 90
                                          ? "bg-gradient-to-r from-primary to-primary/70"
                                          : progress >= 75
                                          ? "bg-gradient-to-r from-warning/90 to-warning/60"
                                          : "bg-gradient-to-r from-danger/80 to-danger/50"
                                      )}
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })()
                          )}
                        </div>
                      )}
                    </TableCell>
                  </>
                )}
                {showRescueCol && (
                  <TableCell className="text-right">
                    {isRedacted ? (
                      <span className="text-muted-foreground italic">—</span>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help w-[170px] ml-auto">
                            <div className="flex items-center justify-end gap-2">
                              <p className={cn(
                                "font-mono font-bold text-sm",
                                clientRequired > 0
                                  ? clientPending > 0.01
                                    ? "text-danger"
                                    : clientFulfilled > 0
                                      ? "text-success"
                                      : "text-muted-foreground"
                                  : ((client as any).rescueAllocation ?? 0) > 0
                                    ? "text-warning"
                                    : "text-muted-foreground"
                              )}>
                                {clientRequired > 0 ? (
                                  <span className="flex items-center gap-0.5 justify-end">
                                    {clientPending > 0.01 ? (
                                      <>
                                        <AlertCircle className="h-3 w-3" />
                                        {formatCurrency(clientPending)}
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle className="h-3 w-3" />
                                        {formatCurrency(clientFulfilled)}
                                      </>
                                    )}
                                  </span>
                                ) : ((client as any).rescueAllocation ?? 0) > 0 ? (
                                  <span className="flex items-center gap-0.5 justify-end">
                                    <Archive className="h-3 w-3" />
                                    {formatCurrency((client as any).rescueAllocation ?? 0)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/60">—</span>
                                )}
                              </p>
                            </div>
                            {clientRequired > 0 && (
                              <>
                                <div className="flex items-center justify-between text-[9px] font-mono mt-1">
                                  <span className="text-muted-foreground">
                                    {clientFulfilled > 0 ? `到账 ${clientMarginProgressPct.toFixed(0)}%${historyCount > 0 ? ` · ${historyCount}次` : ""}` : `待补${clientMarginPctOfTotal.toFixed(1)}%批次总`}
                                  </span>
                                  <span className={cn(clientFulfilled > 0 ? "text-success" : "text-warning")}>
                                    上限 {formatCurrency(clientRequired)}
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-secondary/60 mt-1 overflow-hidden">
                                  <div
                                    className={cn(
                                      "h-full transition-all duration-500",
                                      clientMarginProgressPct >= 99.99
                                        ? "bg-gradient-to-r from-success to-success/70"
                                        : clientFulfilled > 0
                                        ? "bg-gradient-to-r from-primary to-success/80"
                                        : "bg-gradient-to-r from-danger/80 to-danger/50"
                                    )}
                                    style={{ width: `${clientMarginProgressPct}%` }}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="end" className="w-[300px]">
                          <div className="text-xs space-y-1.5">
                            {clientRequired > 0 ? (
                              <>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">个体需补仓</span>
                                  <span className="font-mono font-semibold text-danger">{formatCurrency(clientRequired)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">单独已补仓</span>
                                  <span className="font-mono font-semibold text-success">{formatCurrency(clientFulfilled)}{historyCount > 0 ? ` · ${historyCount}次` : ""}</span>
                                </div>
                                <div className="flex items-center justify-between border-t border-border/50 pt-1">
                                  <span className="font-semibold">当前缺口</span>
                                  <span className="font-mono font-bold text-danger">{formatCurrency(clientPending)}</span>
                                </div>
                                {((client as any).rescueAllocation ?? 0) > 0.01 && (
                                  <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-1">
                                    <p className="font-semibold text-warning flex items-center gap-1">
                                      <Archive className="h-3 w-3" />机构补仓救援（名义分摊）
                                    </p>
                                    <p className="text-muted-foreground text-[11px]">
                                      机构已出资 {formatCurrency(batch?.cumulativeMarginCalls ?? 0)} 救援补仓，本客户按出资比例名义分摊 {formatCurrency((client as any).rescueAllocation ?? 0)}。救援金本金及盈利全部归机构，客户不参与分成，本金 100% 保底。
                                    </p>
                                  </div>
                                )}
                                {ms?.history && ms.history.length > 0 && (
                                  <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-1 max-h-[84px] overflow-y-auto">
                                    <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                                      <History className="h-3 w-3" /> 单独补仓历史
                                    </p>
                                    {[...ms.history].reverse().slice(0, 5).map((h) => (
                                      <div key={h.id} className="flex items-center justify-between text-[10.5px]">
                                        <span className={cn(
                                          "font-mono",
                                          h.source === "batch_one_click" ? "text-primary" : "text-success"
                                        )}>
                                          {h.source === "batch_one_click" ? "批次分配" : "单独补仓"}
                                        </span>
                                        <span className="flex items-center gap-1.5 font-mono font-semibold">
                                          {formatCurrency(h.amount)}
                                          <span className="text-muted-foreground">
                                            {new Date(h.fulfilledAt).toLocaleDateString("zh-CN")}
                                          </span>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            ) : ((client as any).rescueAllocation ?? 0) > 0 ? (
                              <>
                                <p className="font-semibold text-warning flex items-center gap-1">
                                  <Archive className="h-3 w-3" />机构补仓救援（名义分摊）
                                </p>
                                <p className="text-muted-foreground text-[11px]">
                                  机构已出资 {formatCurrency(batch?.cumulativeMarginCalls ?? 0)} 救援补仓，本客户按出资比例名义分摊 {formatCurrency((client as any).rescueAllocation ?? 0)}。救援金本金及盈利全部归机构，客户不参与分成，本金 100% 保底。
                                </p>
                              </>
                            ) : null}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="text-muted-foreground italic">—</span>
                  ) : (
                    <div>
                      <p className="font-mono font-bold text-sm text-gradient-primary">
                        {unverifiedSettlement ? "待核对" : formatCurrency(estExit)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {unverifiedSettlement ? "缺少历史结算快照" : isSettled ? "已冻结结算金额" : "本金 + 真实盈利"}
                      </p>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {isRedacted ? (
                    <Badge variant="outline" className="gap-1 px-2.5 py-1 text-[11px] border-dashed text-muted-foreground italic">
                      <EyeOff className="h-3 w-3" />
                      已脱敏
                    </Badge>
                  ) : (
                    <>
                      <Badge
                        variant={statusConfig.variant as any}
                        className="gap-1 px-2.5 py-1 text-[11px]"
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusConfig.label}
                      </Badge>
                      {client.settledAt && (
                        <p className="text-[9px] text-muted-foreground font-mono mt-1">
                          {new Date(client.settledAt).toLocaleDateString('zh-CN')}
                        </p>
                      )}
                    </>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {!isRedacted && (
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      {!isSettled && showRescueCol && clientRequired > 0 && clientPending > 0.01 && institutionRole && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="warning"
                              size="sm"
                              className="h-7 gap-1.5 px-2.5 text-[11px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (batch && isTopupBlockedByLegacyLedger(batch)) {
                                  if (onLedgerRecovery) onLedgerRecovery();
                                  else window.location.assign(`/batch/${encodeURIComponent(batch.id)}`);
                                  return;
                                }
                                setMarginDialogClientId(client.id);
                                setMarginInputValue(clientPending.toFixed(2));
                                setMarginDialogOpen(true);
                              }}
                            >
                              <Zap className="h-3.5 w-3.5" />
                              单独补仓
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-[11px]">仅为该客户单独补仓 {formatCurrency(clientPending)}，其他客户保持缺口不变</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {client.status === ClientStatus.ACTIVE && institutionRole && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1.5 px-2.5 text-[11px] hover:border-warning hover:text-warning"
                                disabled={!onClientStatusChange}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onClientStatusChange?.(client.id, ClientStatus.EXIT_REQUESTED);
                                }}
                              >
                                <LogOut className="h-3.5 w-3.5" />
                                申请退出
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[11px]">向风控发起客户退出申请，等待结算</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-7 gap-1.5 px-2.5 text-[11px]"
                                disabled={!onClientStatusChange}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onClientStatusChange?.(client.id, ClientStatus.SETTLED);
                                }}
                              >
                                <CheckSquare className="h-3.5 w-3.5" />
                                标记结算
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[11px]">确认资金已转出，标记客户已结算</p>
                            </TooltipContent>
                          </Tooltip>
                        </>
                      )}
                      {client.status === ClientStatus.EXIT_REQUESTED && institutionRole && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
                                disabled={!onClientStatusChange}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onClientStatusChange?.(client.id, ClientStatus.ACTIVE);
                                }}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                撤销
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[11px]">取消客户退出申请</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-7 gap-1.5 px-2.5 text-[11px]"
                                disabled={!onClientStatusChange}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onClientStatusChange?.(client.id, ClientStatus.SETTLED);
                                }}
                              >
                                <CheckSquare className="h-3.5 w-3.5" />
                                确认结算
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[11px]">确认资金已转出，标记客户已结算归档</p>
                            </TooltipContent>
                          </Tooltip>
                        </>
                      )}
                      {client.status === ClientStatus.SETTLED && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2.5 text-[11px] text-muted-foreground"
                              >
                                <Archive className="h-3.5 w-3.5" />
                                已归档
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[11px]">客户已结算完成，不可再修改</p>
                            </TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Summary Footer */}
      <div className="bg-secondary/40 border-t border-border/50 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">本页合计投资:</span>
          <span className="font-mono font-bold text-sm">{formatCurrency(totalInvestment)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">客户数:</span>
          <span className="font-mono font-bold">{clients.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">实际分成盈利合计:</span>
          <span className="font-mono font-bold text-sm text-success">
            +{formatCurrency(
              clients.reduce((s, c) => s + (c.actualClientPnL ?? 0), 0)
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">预计总退出金额:</span>
          <span className="font-mono font-bold text-sm text-primary">
            {formatCurrency(
              clients.reduce((s, c) => s + (c.investmentAmount + (c.actualClientPnL ?? 0)), 0)
            )}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-success" />
            客户本金 100% 保底
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-success" />
            盈利按比例分成
          </span>
          {(batchSummary || clientTotalMarginPending > 0) && (
            <span className="flex items-center gap-1 pl-3 border-l border-border/60 ml-2">
              <Zap className="h-3 w-3 text-warning" />
              批次补仓缺口:{" "}
              <span className="font-mono font-semibold text-danger">
                {formatCurrency(clientTotalMarginPending)}
              </span>
              <span className="text-muted-foreground/70">
                / 总需 {formatCurrency(batchSummary?.totalRequired ?? batchRequiredMarginCall)}
              </span>
              {batchSummary && batchSummary.clientCountWithSingleTopup > 0 && (
                <span className="text-success/80">
                  · 已单独补仓 {batchSummary.clientCountWithSingleTopup} 位
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {marginDialogClient && perClientStateMap.has(marginDialogClient.id) && (
        <ConfirmDialog
          open={marginDialogOpen}
          onOpenChange={(v) => {
            setMarginDialogOpen(v);
            if (!v) {
              // 延迟清空避免关闭动画最后一帧闪烁
              setTimeout(() => {
                setMarginDialogClientId(null);
                setMarginInputValue("");
              }, 150);
            }
          }}
          tone="warning"
          title={`为 ${marginDialogClient.name ?? "该客户"} 单独补仓`}
          description="机构为该客户对应缺口单独出资，其他客户需补额不变，批次剩余缺口同步扣减。补仓本金及收益全部归机构，与客户原始本金分开记录。"
          summary={
            (() => {
              const mm = perClientStateMap.get(marginDialogClient.id);
              const req = mm?.required ?? 0;
              const ful = mm?.fulfilled ?? 0;
              const pending = Math.max(0, req - ful);
              const parsed = Number(marginInputValue.replace(/[^0-9.]/g, ""));
              const safeAmount = Number.isFinite(parsed) && parsed > 0 ? parsed : pending;
              const applyAmount = Math.min(pending, Math.max(0, safeAmount));
              return [
                { label: "客户投资本金", value: formatCurrency(mm?.initialInvestment ?? marginDialogClient.investmentAmount ?? 0), accent: "muted" as const },
                { label: "个体需补仓", value: formatCurrency(req), accent: "danger" as const },
                { label: "单独已补仓", value: formatCurrency(ful) + (mm?.history?.length ? ` · ${mm.history.length} 次` : ""), accent: "success" as const },
                { label: "本次单独补仓", value: formatCurrency(applyAmount), accent: "warning" as const },
                { label: "补仓后剩余缺口", value: formatCurrency(Math.max(0, pending - applyAmount)), accent: applyAmount >= pending ? "success" : "danger" as const },
                { label: "归属 商务经理", value: marginDialogClient.bdManager ?? "—", accent: "primary" as const },
              ];
            })()
          }
          footerExtra={
            <div className="flex items-center gap-2 w-full">
              <div className="relative flex-1">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  inputMode="decimal"
                  className="h-10 pl-8 pr-3 font-mono font-semibold tabular-nums text-[13px]"
                  value={marginInputValue}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                    const parts = raw.split(".");
                    if (parts.length > 2) return;
                    if (parts[1] && parts[1].length > 2) return;
                    setMarginInputValue(raw);
                  }}
                  onBlur={() => {
                    const mm = perClientStateMap.get(marginDialogClient.id);
                    const pending = Math.max(0, (mm?.required ?? 0) - (mm?.fulfilled ?? 0));
                    const parsed = Number(marginInputValue);
                    if (!Number.isFinite(parsed) || parsed <= 0) {
                      setMarginInputValue(pending.toFixed(2));
                      return;
                    }
                    const clamped = Math.min(pending, parsed);
                    setMarginInputValue(clamped.toFixed(2));
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const mm = perClientStateMap.get(marginDialogClient.id);
                  const pending = Math.max(0, (mm?.required ?? 0) - (mm?.fulfilled ?? 0));
                  setMarginInputValue(pending.toFixed(2));
                }}
              >
                剩余全额
              </Button>
            </div>
          }
          confirmText={(() => {
            const mm = perClientStateMap.get(marginDialogClient.id);
            const pending = Math.max(0, (mm?.required ?? 0) - (mm?.fulfilled ?? 0));
            const parsed = Number(marginInputValue.replace(/[^0-9.]/g, ""));
            const amount = Number.isFinite(parsed) && parsed > 0 ? Math.min(pending, parsed) : 0;
            return amount > 0 ? `单独补仓 ${formatCurrency(amount)}` : "确认单独补仓";
          })()}
          cancelText="取消"
          onConfirm={async () => {
            const c = clients.find((x) => x.id === marginDialogClient.id);
            if (!c) return;
            const mm = perClientStateMap.get(c.id);
            const pending = Math.max(0, (mm?.required ?? 0) - (mm?.fulfilled ?? 0));
            const parsed = Number(marginInputValue.replace(/[^0-9.]/g, ""));
            const amount = Math.min(pending, Math.max(0, Number.isFinite(parsed) && parsed > 0 ? parsed : pending));
            if (!batch || !Number.isFinite(parsed) || parsed <= 0 || amount < 0.01) {
              throw new Error("请输入有效补仓金额。");
            }
            const applied = commitBatchFinance(batch, (draft) => executeInstitutionTopup(draft, {
              amount, clientId: c.id, expectedRoundId: mm?.roundId,
              operatorName: viewerUser?.displayName ?? viewerUser?.email,
            }));
            if (applied <= 0) throw new Error("本轮缺口已更新，请刷新后重新确认。");
            onBatchMutated?.({
              type: "client_single_margin",
              clientId: c.id,
              amount: applied,
              totalAddedCumulative: applied,
            });
            setMarginDialogTick((t) => t + 1);
            setRenderTick((t) => t + 1);
            window.dispatchEvent(
              new CustomEvent("risk-control:client-single-margin", {
                detail: { batchId: batch.id, clientId: c.id, amount: applied },
              })
            );
            setMarginDialogOpen(false);
            setTimeout(() => {
              setMarginDialogClientId(null);
              setMarginInputValue("");
            }, 120);
          }}
        />
      )}
    </div>
  );
}
