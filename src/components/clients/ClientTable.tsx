"use client";

import { toast } from "sonner";
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
} from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import type { AppRole, AppSessionUser } from "@/types/auth";
import { APP_ROLES } from "@/types/auth";
import {
  ShieldCheck,
  Minus,
  CheckCircle,
  Hourglass,
  Landmark,
  Building2,
  User,
  EyeOff,
  LogOut,
  CheckSquare,
  Archive,
  AlertCircle,
  Zap,
  DollarSign,
  X,
  Wallet,
  TrendingUp,
  TrendingDown,
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
  isVipClient,
  allocateClientMarginRequirements,
  executeInstitutionTopup,
  isTopupBlockedByLegacyLedger,
  summarizeBatchMarginFromClients,
  getLockedBatchRequiredMargin,
  calculateClientSettlement,
  getAccountMarketValue,
  getExitEligibility,
  type BatchLike,
  type ClientMarginState,
} from "@/lib/riskEngine";
import { commitBatchFinance } from "@/lib/mockData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ClientAvatar } from "@/components/branding/ClientAvatar";

export interface EnrichedClient {
  id: string;
  batchId: string;
  name: string;
  investmentAmount: number;
  bdManager: string;
  bdUserId?: string | null;
  signDate: Date | string;
  profitSplitClient?: number;
  profitSplitInstitution?: number;
  status?: ClientStatus | keyof typeof ClientStatus | string;
  settledAt?: Date | string | null;
  settlementNote?: string | null;
  clientNo?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  __redacted?: boolean;
  __placeholder?: boolean;
  realtimePnL?: number | null;
  estimatedExitAmount?: number | null;
  marketValueShare?: number;
  actualClientPnL?: number;
  actualClientPnLPercent?: number;
  requiredMarginCall?: number;
  initialInvestment?: number;
  entryStockPrice?: number;
  signedVipThreshold?: number;
  marginState?: any;
  marginHistory?: any[];
  settlement?: any;
  [k: string]: any;
}

interface ClientTableProps {
  clients: EnrichedClient[];
  batchInitialAmount: number;
  viewerRole?: AppRole;
  viewerUser?: AppSessionUser | null;
  batchRequiredMarginCall?: number;
  onClientStatusChange?: (clientId: string, newStatus: ClientStatus) => void;
  onRequestExit?: (clientId: string) => void;
  onCancelExit?: (clientId: string) => void;
  batch?: BatchLike;
  onBatchMutated?: (payload: {
    type: "client_single_margin";
    clientId: string;
    amount: number;
    totalAddedCumulative: number;
  }) => void;
  onClientInvestmentRefresh?: () => void;
  onLedgerRecovery?: () => void;
  showOverviewCards?: boolean;
  showSectionTabs?: boolean;
}

export function ClientTable({
  clients,
  batchInitialAmount,
  viewerRole = APP_ROLES.RISK_MANAGER,
  viewerUser,
  batchRequiredMarginCall = 0,
  onClientStatusChange,
  onRequestExit,
  onCancelExit,
  batch,
  onBatchMutated,
  onLedgerRecovery,
  showOverviewCards = true,
  showSectionTabs = true,
}: ClientTableProps) {
  const { role } = useCurrentUser();
  const totalInvestment = clients
    .filter((c) => !(c as any).__redacted)
    .reduce((s, c) => s + c.investmentAmount, 0);
  const totalEstimatedExit = clients.reduce(
    (s, c) => s + (c.investmentAmount + (c.actualClientPnL ?? 0)),
    0
  );
  const totalPnL = totalEstimatedExit - totalInvestment;
  const activeClientCount = clients.filter(
    (c) => !(c as any).__redacted && c.status === ClientStatus.ACTIVE
  ).length;
  const warningClientCount = clients.filter(
    (c) => !(c as any).__redacted && c.status === ClientStatus.EXIT_REQUESTED
  ).length;
  const settledClientCount = clients.filter(
    (c) => !(c as any).__redacted && c.status === ClientStatus.SETTLED
  ).length;
  const protectedPrincipalRatio = totalInvestment > 0
    ? ((clients.filter((c) => !(c as any).__redacted && c.status !== ClientStatus.SETTLED).length || clients.length) / clients.length) * 100
    : 0;

  const institutionRole = viewerRole === APP_ROLES.RISK_MANAGER || viewerRole === APP_ROLES.ADMIN;
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

  const [marginCollateralType, setMarginCollateralType] = useState<"stock" | "cash">("stock");
  const [marginDialogOpen, setMarginDialogOpen] = useState(false);
  const [marginDialogClientId, setMarginDialogClientId] = useState<string | null>(null);
  const [marginInputValue, setMarginInputValue] = useState<string>("");
  const [marginDialogTick, setMarginDialogTick] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  const mountedAtRef = useRef<number>(Date.now());
  const prevSettledByIdRef = useRef<Record<string, number>>({});
  const [newlySettledIds, setNewlySettledIds] = useState<Record<string, number>>({});
  const scrolledSettledRef = useRef<Set<string>>(new Set());
  const effectiveLockedRequired = batch ? getLockedBatchRequiredMargin(batch) : batchRequiredMarginCall;

  useEffect(() => {
    const currentMap: Record<string, number> = {};
    const newly: Record<string, number> = {};
    for (const c of clients) {
      const id = c.id;
      if ((c as any).__redacted) continue;
      if (c.status === ClientStatus.SETTLED && c.settledAt) {
        const ts = new Date(c.settledAt as any).getTime();
        currentMap[id] = ts;
        const prev = prevSettledByIdRef.current[id];
        if (!prev || prev !== ts) newly[id] = ts;
      }
    }
    prevSettledByIdRef.current = currentMap;
    const hasNew = Object.keys(newly).length > 0;
    if (hasNew) {
      setNewlySettledIds((prev) => ({ ...prev, ...newly }));
      window.setTimeout(() => {
        setNewlySettledIds((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(newly)) delete next[id];
          return next;
        });
      }, 3200);
      window.requestAnimationFrame(() => {
        for (const id of Object.keys(newly)) {
          if (scrolledSettledRef.current.has(id)) continue;
          scrolledSettledRef.current.add(id);
          const el = document.getElementById(`client-row-${id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          }
        }
      });
    }
  }, [clients]);

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
    <div className="overflow-hidden rounded-[26px] border border-primary/10 bg-card shadow-[0_22px_54px_rgba(2,8,23,0.42)]">
      {showOverviewCards && (
      <div className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-1 rounded-[24px] border border-primary/20 bg-card px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] xl:basis-[30%] xl:flex-[1.45]">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-white/90">
              <Wallet className="h-4 w-4 text-primary" />
              客户总览
            </div>
            <div className="mt-5 grid grid-cols-2 gap-5">
              <div>
                  <p className="font-mono text-[38px] font-bold leading-none tracking-tight text-white">{clients.length}</p>
                <p className="mt-2 text-xs text-white/70">客户总数</p>
              </div>
              <div className="min-w-0 border-l border-white/10 pl-5">
                  <p className="font-mono text-[clamp(17px,1.55vw,24px)] font-bold leading-tight tracking-tight text-white">
                  {formatCurrency(totalInvestment)}
                </p>
                <p className="mt-2 text-xs text-white/70">客户总权益</p>
              </div>
            </div>
          </div>

          <div className="min-w-[152px] flex-1 rounded-[24px] border border-emerald-400/15 bg-card px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:basis-0">
            <div className="flex items-center gap-2 text-[11px] tracking-[0.12em] text-emerald-300/80">
              <Landmark className="h-3.5 w-3.5" />
              投资金额
            </div>
            <p className="mt-5 font-mono text-[clamp(16px,1.3vw,19px)] font-bold leading-tight tracking-tight text-foreground">{formatCurrency(totalInvestment)}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">客户本金保底口径</p>
          </div>

          <div className="min-w-[152px] flex-1 rounded-[24px] border border-sky-400/15 bg-card px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:basis-0">
            <div className="flex items-center gap-2 text-[11px] tracking-[0.12em] text-sky-300/80">
              <TrendingUp className="h-3.5 w-3.5" />
              预计退出
            </div>
            <p className="mt-5 font-mono text-[clamp(16px,1.3vw,19px)] font-bold leading-tight tracking-tight text-foreground">{formatCurrency(totalEstimatedExit)}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">按当前口径测算</p>
          </div>

          <div className="min-w-[152px] flex-1 rounded-[24px] border border-rose-400/15 bg-card px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:basis-0">
            <div className="flex items-center gap-2 text-[11px] tracking-[0.12em] text-rose-300/80">
              <TrendingDown className="h-3.5 w-3.5" />
              已实现亏损
            </div>
            <p className={cn(
              "mt-5 font-mono text-[clamp(16px,1.3vw,19px)] font-bold leading-tight tracking-tight",
              totalPnL > 0 ? "text-success" : totalPnL < 0 ? "text-danger" : "text-foreground"
            )}>
              {totalPnL > 0 ? "+" : ""}{formatCurrency(totalPnL)}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">客户与机构合并口径</p>
          </div>

          <div className="min-w-[152px] flex-1 rounded-[24px] border border-amber-400/15 bg-card px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:basis-0">
            <div className="flex items-center gap-2 text-[11px] tracking-[0.12em] text-amber-300/80">
              <ShieldCheck className="h-3.5 w-3.5" />
              机构补仓缺口
            </div>
            <p className={cn(
              "mt-5 font-mono text-[clamp(16px,1.3vw,19px)] font-bold leading-tight tracking-tight",
              clientTotalMarginPending > 0 ? "text-danger" : "text-success"
            )}>
              {formatCurrency(clientTotalMarginPending)}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">仅机构承担补仓</p>
          </div>

          <div className="min-w-[104px] rounded-[24px] border border-cyan-400/15 bg-card px-3 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:w-[116px] xl:flex-none">
            <div className="mx-auto flex w-fit flex-col items-center">
              <div
                className="relative flex h-20 w-20 items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(rgba(34,211,238,0.95) 0 ${Math.max(6, Math.min(100, protectedPrincipalRatio))}%, rgba(148,163,184,0.18) ${Math.max(6, Math.min(100, protectedPrincipalRatio))}% 100%)`,
                }}
              >
                <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <span className="font-mono text-[24px] font-bold text-white">
                    {Math.round(protectedPrincipalRatio)}%
                  </span>
                </div>
              </div>
              <p className="mt-3 text-xs font-medium text-foreground">整体保本率</p>
            </div>
          </div>
        </div>
      </div>
      )}

      {showSectionTabs && (
      <div className="border-b border-white/[0.06] px-4 pt-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                className="relative rounded-t-2xl bg-card px-5 py-2.5 text-sm font-semibold text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              >
                客户明细
                <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-primary" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>风险预警</span>
              {warningClientCount > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger/90 px-1.5 text-[11px] font-semibold text-white">
                  {warningClientCount}
                </span>
              ) : null}
            </div>
            <span className="text-sm text-muted-foreground">动态提醒</span>
            <span className="text-sm text-muted-foreground">资金流水</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>持仓中 {activeClientCount}</span>
            <span className="text-white/20">|</span>
            <span>已结算 {settledClientCount}</span>
          </div>
        </div>
      </div>
      )}

        <div className="px-4 pb-1 pt-2 sm:px-5">
            <Table className="table-fixed [&_th]:px-2 [&_td]:px-2 [&_th]:py-3 [&_td]:py-3 [&_td]:whitespace-normal">
        <TableHeader className="bg-[rgba(255,255,255,0.018)]">
          <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead className="w-[156px] text-[12px] font-medium text-muted-foreground">客户信息</TableHead>
              <TableHead className="w-[112px] text-[12px] font-medium text-muted-foreground">商务经理</TableHead>
              <TableHead className="w-[78px] text-[12px] font-medium text-muted-foreground">账户类型</TableHead>
              <TableHead className="w-[112px] text-right text-[12px] font-medium text-muted-foreground">客户权益</TableHead>
              <TableHead className="w-[136px] text-right text-[12px] font-medium text-muted-foreground">投资金额</TableHead>
              <TableHead className="w-[140px] text-right text-[12px] font-medium text-muted-foreground">盈亏 (USD)</TableHead>
              <TableHead className="w-[90px] text-right text-[12px] font-medium text-muted-foreground">收益率</TableHead>
              <TableHead className="w-[140px] text-right text-[12px] font-medium text-muted-foreground">预计退出金额</TableHead>
              <TableHead className="w-[94px] text-center text-[12px] font-medium text-muted-foreground">状态</TableHead>
              <TableHead className="w-[96px] text-center text-[12px] font-medium text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedClientsFinal.map((client) => {
            const isRedacted = !!(client as any).__redacted;
            const statusConfig = getStatusConfig(client.status as ClientStatus);
            const StatusIcon = statusConfig.Icon;
            const estExit = client.estimatedExitAmount ?? client.investmentAmount;
            const isSettled = client.status === ClientStatus.SETTLED;
            const settledTs = isSettled && client.settledAt ? new Date(client.settledAt as any).getTime() : 0;
            const justSettled = !!newlySettledIds[client.id] &&
              settledTs >= (mountedAtRef.current - 1500);
            const unverifiedSettlement = isSettled && !(client as any).settlement;
            const clientRatio = totalInvestment > 0
              ? ((client.investmentAmount || 0) / totalInvestment) * 100
              : 0;
            const ms = perClientStateMap.get(client.id);
            const clientRequired = ms?.required ?? 0;
            const clientFulfilled = ms?.fulfilled ?? 0;
            const clientPending = Math.max(0, clientRequired - clientFulfilled);
            const clientWeight = (batch?.priorityAmount ?? 0) > 0
              ? (client.investmentAmount || 0) / Math.max(batch?.priorityAmount ?? 1, 1)
              : 0;
            const institutionInvestment = Math.max(
              0,
              Number(((batch?.subordinateAmount ?? 0) * clientWeight).toFixed(2))
            );
            const settlementCalc = (() => {
              if (isRedacted) {
                return { institutionPnL: 0, clientPnL: 0, institutionReceives: 0, clientReceives: 0 };
              }
              try {
                if (client.status === ClientStatus.SETTLED && (client as any).settlement) {
                  const snap = (client as any).settlement;
                  return {
                    institutionPnL: Number(snap.institutionPnL ?? 0),
                    clientPnL: Number(snap.clientPnL ?? 0),
                    institutionReceives: Number(snap.institutionReceives ?? (institutionInvestment + Number(snap.institutionPnL ?? 0))),
                    clientReceives: Number(snap.clientReceives ?? (client.investmentAmount + Number(snap.clientPnL ?? 0))),
                  };
                }
                if (!batch || !batch.priorityAmount || !(batch.priorityAmount > 0)) {
                  return {
                    institutionPnL: 0,
                    clientPnL: 0,
                    institutionReceives: institutionInvestment,
                    clientReceives: estExit,
                  };
                }
                const priceFinal = (batch as any).currentStockPrice ?? (batch as any).stockPriceAtStart ?? 0;
                const mvFinal = (() => {
                  try { return getAccountMarketValue(batch as any); }
                  catch { return client.estimatedExitAmount ?? client.investmentAmount; }
                })();
                const r = calculateClientSettlement(
                  client as any,
                  batch as any,
                  mvFinal,
                  priceFinal,
                );
                return {
                  institutionPnL: Number(r.institutionPnL ?? 0),
                  clientPnL: Number(r.clientPnL ?? 0),
                  institutionReceives: Number(r.institutionReceives ?? (institutionInvestment + Number(r.institutionPnL ?? 0))),
                  clientReceives: Number(r.clientReceives ?? (client.investmentAmount + Number(r.clientPnL ?? 0))),
                };
              } catch {
                return {
                  institutionPnL: 0,
                  clientPnL: 0,
                  institutionReceives: institutionInvestment,
                  clientReceives: estExit,
                };
              }
            })();
            const clientFinalPnL = settlementCalc.clientPnL;
            const clientFinalPnLPct = client.investmentAmount > 0
              ? (clientFinalPnL / client.investmentAmount) * 100
              : 0;
            const totalInvestmentAttributed = client.investmentAmount + institutionInvestment;
            const totalPnL = settlementCalc.clientPnL + settlementCalc.institutionPnL;
            const totalExitAttributed = settlementCalc.clientReceives + settlementCalc.institutionReceives;
            const totalReturnPct = totalInvestmentAttributed > 0 ? (totalPnL / totalInvestmentAttributed) * 100 : 0;
            const institutionReturnPct = institutionInvestment > 0 ? (settlementCalc.institutionPnL / institutionInvestment) * 100 : 0;

            return (
              <TableRow
                id={`client-row-${client.id}`}
                key={`${client.id}-${isSettled ? `S${settledTs}` : "A"}`}
                className={cn(
                  "border-t border-white/[0.06] bg-card/50 transition-colors hover:bg-[rgba(255,255,255,0.028)]",
                  isRedacted && "opacity-60 pointer-events-none select-none",
                  justSettled && "animate-settle-focus-pulse"
                )}
              >
                <TableCell>
                  {isRedacted ? (
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-secondary/60">
                        <EyeOff className="h-4 w-4 text-muted-foreground/70" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold italic text-muted-foreground">{client.name}</p>
                        <p className="text-[11px] text-muted-foreground/80">其他商务经理客户</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <ClientAvatar name={client.name} size="md" rounded="xl" />
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold leading-none text-foreground">{client.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {(client as any).clientNo ? (
                            <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary/90">
                              {(client as any).clientNo}
                            </span>
                          ) : null}
                          {isVipClient(client) && (
                            <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary/90">VIP</span>
                          )}
                          {client.investmentAmount >= 200000 && (
                            <span className="rounded-md border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">大额</span>
                          )}
                        </div>
                        <p className="mt-1 text-[10px] leading-none text-muted-foreground">占优先池 {clientRatio.toFixed(1)}%</p>
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {isRedacted ? (
                    <span className="text-sm italic text-muted-foreground">—</span>
                  ) : (
                    <div className="min-w-0">
                      <Link
                        href={`/bd/${encodeURIComponent(client.bdManager)}`}
                        className="block truncate text-[13px] font-medium leading-none text-primary hover:underline underline-offset-2"
                        title={`查看 ${client.bdManager} 的所有客户`}
                      >
                        {client.bdManager}
                      </Link>
                      <p className="mt-1 text-[10px] leading-none text-muted-foreground">客户归属经理</p>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {isRedacted ? (
                    <span className="text-sm italic text-muted-foreground">—</span>
                  ) : (
                      <div className="space-y-0.5">
                        <div className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] leading-none text-foreground/90">
                        <User className="h-3 w-3" />
                        客户账户
                      </div>
                        <div className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] leading-none text-primary/90">
                        <Building2 className="h-3 w-3" />
                        机构分成
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="italic text-muted-foreground">—</span>
                  ) : (
                    <div className="min-w-0">
                      <p className="font-mono text-[16px] font-bold leading-none tracking-tight text-foreground">{formatCurrency(client.investmentAmount)}</p>
                      <p className="mt-1 text-[10px] leading-none text-muted-foreground/80">保本线 {formatCurrency(client.investmentAmount)}</p>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="italic text-muted-foreground">—</span>
                  ) : (
                    <div className="min-w-0">
                      <p className="font-mono text-[16px] font-bold leading-none tracking-tight text-foreground">{formatCurrency(totalInvestmentAttributed)}</p>
                      <div className="mt-1.5 space-y-1 text-[10px] leading-none text-muted-foreground/90">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">客</span>
                          <span className="font-mono tabular-nums tracking-tight">{formatCurrency(client.investmentAmount)}</span>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">机</span>
                          <span className="font-mono tabular-nums tracking-tight">{formatCurrency(institutionInvestment)}</span>
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] leading-none text-muted-foreground/75">占比 {clientRatio.toFixed(1)}%</p>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="italic text-muted-foreground">—</span>
                  ) : (
                    <div className="min-w-0">
                      <p className={cn(
                        "font-mono text-[16px] font-bold leading-none tracking-tight",
                        totalPnL > 0 ? "text-success" : totalPnL < 0 ? "text-danger" : "text-muted-foreground"
                      )}>
                        {totalPnL > 0 ? "+" : ""}{formatCurrency(totalPnL)}
                      </p>
                      <div className="mt-1.5 space-y-1 text-[10px] leading-none text-muted-foreground/90">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">客</span>
                          <span className="font-mono tabular-nums tracking-tight">
                            {clientFinalPnL > 0 ? "+" : ""}{formatCurrency(clientFinalPnL)}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">机</span>
                          <span className="font-mono tabular-nums tracking-tight">
                            {settlementCalc.institutionPnL > 0 ? "+" : ""}{formatCurrency(settlementCalc.institutionPnL)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="italic text-muted-foreground">—</span>
                  ) : (
                    <div className="min-w-0">
                      <p className={cn(
                        "font-mono text-[16px] font-bold leading-none tracking-tight",
                        totalReturnPct > 0 ? "text-success" : totalReturnPct < 0 ? "text-danger" : "text-muted-foreground"
                      )}>
                        {formatPercent(totalReturnPct)}
                      </p>
                      <div className="mt-1.5 space-y-1 text-[10px] leading-none text-muted-foreground/90">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">客</span>
                          <span className="font-mono tabular-nums tracking-tight">
                            {formatPercent(clientFinalPnLPct)}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">机</span>
                          <span className="font-mono tabular-nums tracking-tight">
                            {formatPercent(institutionReturnPct)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="italic text-muted-foreground">—</span>
                  ) : (
                    <div className="min-w-0">
                      <p className="font-mono text-[16px] font-bold leading-none tracking-tight text-primary">
                        {unverifiedSettlement ? "待核对" : formatCurrency(totalExitAttributed)}
                      </p>
                      <div className="mt-1.5 space-y-1 text-[10px] leading-none text-muted-foreground/90">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">客</span>
                          <span className="font-mono tabular-nums tracking-tight">{formatCurrency(settlementCalc.clientReceives)}</span>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="w-5 text-right text-muted-foreground/70">机</span>
                          <span className="font-mono tabular-nums tracking-tight">{formatCurrency(settlementCalc.institutionReceives)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {isRedacted ? (
                    <Badge variant="outline" className="gap-1 border-dashed text-muted-foreground italic">
                      <EyeOff className="h-3 w-3" />
                      已脱敏
                    </Badge>
                  ) : (
                      <div className="space-y-0.5">
                      <Badge variant={statusConfig.variant as any} className="gap-1 px-2 py-0.5 text-[10px] shadow-[0_0_14px_rgba(15,23,42,0.18)]">
                        <StatusIcon className="h-3 w-3" />
                        {statusConfig.label}
                      </Badge>
                      {showRescueCol && clientPending > 0.01 ? (
                        <p className="text-[10px] leading-none font-medium text-warning">待补 {formatCurrency(clientPending)}</p>
                      ) : showRescueCol && clientFulfilled > 0 ? (
                        <p className="text-[10px] leading-none font-medium text-success">已补 {formatCurrency(clientFulfilled)}</p>
                      ) : (
                        <p className="text-[10px] leading-none text-muted-foreground">{isSettled ? "已冻结结算" : "客户本金保底"}</p>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {!isRedacted && (
                      <div className="grid justify-items-center gap-1">
                      {!isSettled && showRescueCol && clientRequired > 0 && clientPending > 0.01 && institutionRole && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="warning"
                                size="xs"
                                className="h-7 gap-1 rounded-full px-2 text-[9px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (batch && isTopupBlockedByLegacyLedger(batch)) {
                                  if (onLedgerRecovery) onLedgerRecovery();
                                  else window.location.assign(`/batch/${encodeURIComponent(batch.id)}`);
                                  return;
                                }
                                setMarginCollateralType("stock");
                                setMarginDialogClientId(client.id);
                                setMarginInputValue(clientPending.toFixed(2));
                                setMarginDialogOpen(true);
                              }}
                            >
                              <Zap className="h-3.5 w-3.5" />
                              机构补仓
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-[11px]">本次机构补仓 {formatCurrency(clientPending)}，客户本人不承担补仓义务</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {client.status === ClientStatus.ACTIVE && institutionRole && (
                        <Button
                          variant="outline"
                          size="xs"
                          className="h-7 gap-1 rounded-full px-2 text-[9px] text-warning hover:text-warning hover:border-warning"
                          disabled={!onRequestExit || !!(batch && getExitEligibility(batch, client as any).lockUpEndDate > new Date() && role !== "ADMIN")}
                          onClick={(e) => {
                            e.stopPropagation();
                            const locked = batch && getExitEligibility(batch, client as any).lockUpEndDate > new Date();
                            if (locked && role === "ADMIN") onClientStatusChange?.(client.id, ClientStatus.SETTLED);
                            else onRequestExit?.(client.id);
                          }}
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          {batch && getExitEligibility(batch, client as any).lockUpEndDate > new Date() && role === "ADMIN" ? "锁仓期特批退出" : "申请退出"}
                        </Button>
                      )}
                      {client.status === ClientStatus.EXIT_REQUESTED && institutionRole && (
                        <>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="h-7 gap-1 rounded-full px-2 text-[9px] text-muted-foreground"
                            disabled={!onCancelExit}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCancelExit?.(client.id);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                            取消
                          </Button>
                          {(() => {
                            const elig = batch ? getExitEligibility(batch, client as any) : null;
                            const canSettle = elig?.canExit ?? false;
                            const isAdmin = role === "ADMIN" || role === "RISK_MANAGER";
                            const locked = !!elig && elig.lockUpEndDate > new Date();
                            const effectivelyCanSettle = canSettle || (isAdmin && (!locked || role === "ADMIN"));
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="secondary"
                                    size="xs"
                                    className="h-7 gap-1 rounded-full px-2 text-[9px]"
                                    disabled={!effectivelyCanSettle || !onClientStatusChange}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onClientStatusChange?.(client.id, ClientStatus.SETTLED);
                                    }}
                                  >
                                    <CheckSquare className="h-3.5 w-3.5" />
                                    {!canSettle && isAdmin ? "特批同意" : "同意退出"}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-[11px]">
                                    {canSettle
                                      ? (elig?.isEarlyExit ? "提前退出，收取 1% 手续费归中阳证券" : "到期退出，无手续费")
                                      : (isAdmin ? "特批免等待期，立即同意并结算" : (elig?.reason ?? "等待通知期结束"))}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()}
                        </>
                      )}
                      {client.status === ClientStatus.SETTLED && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-7 gap-1 rounded-full px-2 text-[9px] text-muted-foreground"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          已归档
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
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
          title={`为 ${marginDialogClient.name ?? "该客户"} 记机构补仓`}
          description="WIN100 对该客户归属缺口出资补仓，客户本人不承担任何补仓义务。其他客户的归属缺口不变，批次剩余缺口同步扣减。补仓本金及收益全部归 WIN100，与客户原始本金分开记录。"
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
                { label: "机构归属补仓", value: formatCurrency(req), accent: "danger" as const },
                { label: "机构已补仓", value: formatCurrency(ful) + (mm?.history?.length ? ` · ${mm.history.length} 次` : ""), accent: "success" as const },
                { label: "补仓形式", value: marginCollateralType === "stock" ? "股票（默认）" : "现金", accent: "primary" as const },
                ...[{ label: "等值股票 / 计价", value: `${(applyAmount / (batch?.currentStockPrice || batch?.stockPriceAtStart || 1)).toLocaleString(undefined, { maximumFractionDigits: 6 })} 股 / $${(batch?.currentStockPrice || batch?.stockPriceAtStart || 0).toFixed(4)}`, accent: "muted" as const }],
                { label: "本次机构补仓", value: marginCollateralType === "stock" ? `${(applyAmount / (batch?.currentStockPrice || batch?.stockPriceAtStart || 1)).toLocaleString(undefined, { maximumFractionDigits: 6 })} 股（${formatCurrency(applyAmount)}）` : formatCurrency(applyAmount), accent: "warning" as const },
                { label: "补仓后机构剩余缺口", value: formatCurrency(Math.max(0, pending - applyAmount)), accent: applyAmount >= pending ? "success" : "danger" as const },
                { label: "归属 商务经理", value: marginDialogClient.bdManager ?? "—", accent: "primary" as const },
              ];
            })()
          }
          footerExtra={
            <div className="flex items-center gap-2 w-full">
              <select aria-label="补仓形式" className="h-10 rounded-md border border-border bg-background px-2 text-xs" value={marginCollateralType} onChange={e => setMarginCollateralType(e.target.value as "stock" | "cash")}><option value="stock">补股票</option><option value="cash">补现金</option></select>
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
            return amount > 0 ? (marginCollateralType === "stock" ? `确认补入 ${(amount / (batch?.currentStockPrice || batch?.stockPriceAtStart || 1)).toLocaleString(undefined, { maximumFractionDigits: 6 })} 股` : `确认补入现金 ${formatCurrency(amount)}`) : "确认机构补仓";
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
            let applied: number;
            try {
              applied = commitBatchFinance(batch, (draft) => executeInstitutionTopup(draft, {
                amount, clientId: c.id, expectedRoundId: mm?.roundId, collateralType: marginCollateralType,
                operatorName: viewerUser?.displayName ?? viewerUser?.email,
              }));
            } catch (err) {
              if (err instanceof Error && err.name === "RevisionMismatchError") {
                toast.error(err.message);
              } else {
                toast.error(err instanceof Error ? err.message : "补仓失败");
              }
              return;
            }
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
