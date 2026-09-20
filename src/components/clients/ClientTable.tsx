"use client";

import { useMemo } from "react";
import { Client, ClientStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { calculateProfitSplitRatio } from "@/lib/riskEngine";

export interface EnrichedClient extends Omit<Client, 'realtimePnL' | 'estimatedExitAmount'> {
  __redacted?: boolean;
  realtimePnL?: number | null;
  estimatedExitAmount?: number | null;
  marketValueShare?: number;
  actualClientPnL?: number;
  actualClientPnLPercent?: number;
  requiredMarginCall?: number;
}

const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600",
  "bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600",
  "bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600",
  "bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-600",
  "bg-gradient-to-br from-amber-500 via-orange-500 to-red-500",
  "bg-gradient-to-br from-fuchsia-500 via-purple-500 to-violet-600",
  "bg-gradient-to-br from-lime-500 via-green-500 to-emerald-600",
  "bg-gradient-to-br from-orange-400 via-rose-500 to-red-600",
];

function pickGradientForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

interface ClientTableProps {
  clients: EnrichedClient[];
  batchInitialAmount: number;
  viewerRole?: AppRole;
  viewerUser?: AppSessionUser | null;
  batchRequiredMarginCall?: number;
  onClientStatusChange?: (clientId: string, newStatus: ClientStatus) => void;
}

export function ClientTable({
  clients,
  batchInitialAmount,
  viewerRole = APP_ROLES.RISK_MANAGER,
  viewerUser,
  batchRequiredMarginCall = 0,
  onClientStatusChange,
}: ClientTableProps) {
  const totalInvestment = clients
    .filter((c) => !(c as any).__redacted)
    .reduce((s, c) => s + c.investmentAmount, 0);

  const isBd = viewerRole === APP_ROLES.BD_MANAGER;
  const bdFullName = viewerUser?.bdManagerFullName;
  const institutionRole = !isBd;
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



  const showMarginCallCol = batchRequiredMarginCall > 0;
  const anyRescueAllocation = clients.some(
    (c) => typeof (c as any).rescueAllocation === "number" && (c as any).rescueAllocation > 0.01
  );
  const showRescueCol = showMarginCallCol || anyRescueAllocation;

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
                BD 经理
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
            const estExit = client.estimatedExitAmount || client.investmentAmount;
            const split = calculateProfitSplitRatio(client.investmentAmount || 0);
            const actualPnL = client.actualClientPnL ?? 0;
            const actualPnLPct = client.actualClientPnLPercent ?? 0;
            const clientRatio = totalInvestment > 0
              ? ((client.investmentAmount || 0) / totalInvestment) * 100
              : 0;
            const canEdit = canEditClient(client);
            const canDelete = canDeleteClient(client);

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
                          其他 BD 客户 · 已脱敏
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
                        pickGradientForName(client.name)
                      )}>
                        <span className="text-xs font-bold text-white">
                          {client.name.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-sm truncate">{client.name}</p>
                          {split.client >= 0.4 && (
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
                      className="text-sm truncate text-primary hover:text-primary/80 hover:underline underline-offset-2 transition-colors"
                      title={`查看 ${client.bdManager} 的所有客户`}
                    >
                      {client.bdManager}
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
                            客户 {Math.round(split.client * 100)}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            / 机构 {Math.round(split.institution * 100)}%
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
                            {client.investmentAmount >= 100000
                              ? "≥ $100,000 档：客户 40% / 机构 60%"
                              : "< $100,000 档：客户 30% / 机构 70%"}
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
                              <ShieldCheck className="h-3 w-3" /> 保本中
                            </span>
                          )}
                        </p>
                        {actualPnL > 0 ? (
                          <p className="text-[10px] font-mono mt-0.5 text-success/80 text-right">
                            +{formatPercent(actualPnLPct)}
                          </p>
                        ) : (
                          (() => {
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
                          <div className="cursor-help w-[120px] ml-auto">
                            <p className={cn(
                              "font-mono font-bold text-sm",
                              ((client as any).rescueAllocation ?? 0) > 0
                                ? "text-warning"
                                : (client.requiredMarginCall ?? 0) > 0
                                ? "text-danger"
                                : "text-muted-foreground"
                            )}>
                              {((client as any).rescueAllocation ?? 0) > 0 ? (
                                <span className="flex items-center gap-0.5 justify-end">
                                  <Archive className="h-3 w-3" />
                                  {formatCurrency((client as any).rescueAllocation ?? 0)}
                                </span>
                              ) : (client.requiredMarginCall ?? 0) > 0 ? (
                                <span className="flex items-center gap-0.5 justify-end">
                                  <AlertCircle className="h-3 w-3" />
                                  {formatCurrency(client.requiredMarginCall ?? 0)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </p>
                            <p className="text-[10px] font-mono mt-0.5 text-right text-warning/80">
                              占 {clientRatio.toFixed(1)}%
                            </p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="end">
                          <div className="text-xs w-[240px] space-y-1">
                            {((client as any).rescueAllocation ?? 0) > 0 ? (
                              <>
                                <p className="font-semibold text-warning">机构补仓救援（名义分摊）</p>
                                <p className="text-muted-foreground">
                                  机构已出资救援补仓，本客户按出资比例名义分摊对应救援金 {formatCurrency((client as any).rescueAllocation ?? 0)}
                                </p>
                                <p className="pt-1 text-[10px] text-primary">
                                  * 救援金本金及盈利全部归机构，客户不参与分成，本金 100% 保底
                                </p>
                              </>
                            ) : (client.requiredMarginCall ?? 0) > 0 ? (
                              <>
                                <p className="font-semibold text-danger">需机构补仓（待处理）</p>
                                <p className="text-muted-foreground">
                                  当前批次需补仓 {formatCurrency(client.requiredMarginCall ?? 0)}，该客户按出资比例占 {clientRatio.toFixed(1)}%
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
                        {formatCurrency((client.investmentAmount || 0) + actualPnL)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        本金 + 真实盈利
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
        </div>
      </div>
    </div>
  );
}
