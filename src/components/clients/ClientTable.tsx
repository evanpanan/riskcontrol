"use client";

import { Client, ClientStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Building2,
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
  const showMarginCallCol = batchRequiredMarginCall > 0;
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

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <Table>
        <TableHeader className="bg-secondary/30">
          <TableRow className="hover:bg-secondary/30 border-border/50">
            <TableHead className="w-[180px]">客户信息</TableHead>
            <TableHead>
              <div className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                BD 经理
              </div>
            </TableHead>
            <TableHead className="text-right">投资金额</TableHead>
            <TableHead className="text-center">分成比例</TableHead>
            {shouldMergeProfitCols ? (
              <TableHead className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  <Landmark className="h-3.5 w-3.5 text-primary" />
                  盈利 / 分成
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
                      <p className="text-xs w-[240px]">
                        按「补仓先归还→本金保底→VIP档40%/普通档30%」分成规则计算的 <span className="font-semibold">客户最终实际可分配盈利</span>
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TableHead>
              </>
            )}
            {showMarginCallCol && (
              <TableHead className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  <Archive className="h-3.5 w-3.5 text-danger" />
                  <span className="whitespace-nowrap text-danger font-semibold">客户级补仓</span>
                </div>
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
          {clients.map((client) => {
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
                      <div className="h-9 w-9 rounded-xl gradient-primary flex items-center justify-center shrink-0 shadow-sm shadow-primary/20">
                        <span className="text-xs font-bold text-primary-foreground">
                          {client.name.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{client.name}</p>
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
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-sm truncate">{client.bdManager}</span>
                    </div>
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
                      <div className="flex justify-end gap-0.5 mt-0.5">
                        <div className="flex gap-0.5">
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
                      </div>
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
                      <div>
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
                            <span className="flex items-center gap-0.5 justify-end text-muted-foreground">
                              <ShieldCheck className="h-3 w-3" /> 保本
                            </span>
                          )}
                        </p>
                        {actualPnL > 0 && (
                          <p className="text-[10px] font-mono mt-0.5 text-success/80">
                            +{formatPercent(actualPnLPct)}
                          </p>
                        )}
                        {actualPnL === 0 && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            实时/分成一致
                          </p>
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
                        <div>
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
                              <span className="flex items-center gap-0.5 justify-end text-muted-foreground">
                                <ShieldCheck className="h-3 w-3" /> 保本
                              </span>
                            )}
                          </p>
                          {realtimePnL !== 0 && (
                            <p className={cn(
                              "text-[10px] font-mono mt-0.5",
                              realtimePnL > 0 ? "text-success/80" : "text-danger/80"
                            )}>
                              {realtimePnL > 0 ? "+" : ""}
                            {formatPercent(
                              (realtimePnL / (client.investmentAmount || 0)) * 100
                            )}
                            </p>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isRedacted ? (
                        <span className="text-muted-foreground italic">—</span>
                      ) : (
                        <div>
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
                              <span className="flex items-center gap-0.5 justify-end text-muted-foreground">
                                <ShieldCheck className="h-3 w-3" /> 保本中
                              </span>
                            )}
                          </p>
                          {actualPnL > 0 && (
                            <p className="text-[10px] font-mono mt-0.5 text-success/80">
                              +{formatPercent(actualPnLPct)}
                            </p>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </>
                )}
                {showMarginCallCol && (
                  <TableCell className="text-right">
                    {isRedacted ? (
                      <span className="text-muted-foreground italic">—</span>
                    ) : (
                      <div>
                        <p className="font-mono font-bold text-sm text-danger">
                          {formatCurrency(client.requiredMarginCall ?? 0)}
                        </p>
                        <p className="text-[10px] font-mono text-danger/80 mt-0.5">
                          占 {clientRatio.toFixed(1)}%
                        </p>
                      </div>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {isRedacted ? (
                    <span className="text-muted-foreground italic">—</span>
                  ) : (
                    <div>
                      <p className="font-mono font-bold text-sm text-gradient-primary">
                        {formatCurrency(estExit + actualPnL - realtimePnL * 0)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        本金 + 分成 {formatCurrency((client.investmentAmount || 0) + actualPnL)}
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
                      {client.status === ClientStatus.ACTIVE && (
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
                      {client.status === ClientStatus.EXIT_REQUESTED && (
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
