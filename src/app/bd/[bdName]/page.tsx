"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Users,
  DollarSign,
  Briefcase,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Landmark,
  Building2,
  UserPlus,
  Crown,
  Target,
  Award,
  AlertTriangle,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMockData } from "@/lib/mockData";
import { BD_MANAGERS } from "@/lib/mockData";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { getBatchMetrics, getClientProfitSplit, calculateRealtimeClientMetrics, isVipClient } from "@/lib/riskEngine";
import type { Client } from "@prisma/client";
import {
  mergeClientStatusesOnClientList,
} from "@/lib/clientStatusStore";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { APP_ROLES } from "@/types/auth";
import { ClientAvatar } from "@/components/branding/ClientAvatar";
import { getInitialsCn } from "@/lib/utils";

type ExtendedRiskLevel = "CRITICAL" | "WARNING" | "NORMAL" | "PROFITABLE";

function displayNameIncludes(bdFull: string, target: string): boolean {
  const tokens = new Set<string>();
  const add = (s: string) => { if (s) tokens.add(s.trim()); };
  add(bdFull);
  const m1 = bdFull.match(/([\u4e00-\u9fa5]+)/);
  if (m1) add(m1[1]);
  const m2 = bdFull.match(/\(([^)]+)\)/);
  if (m2) add(m2[1]);
  // 目标名中包含 tokens 中任一（中文名优先）
  for (const t of tokens) {
    if (t && target.includes(t)) return true;
  }
  return false;
}



function bdEmail(bdName: string): string {
  const m = bdName.match(/\(([^)]+)\)/);
  if (m) {
    const [first, last] = m[1].split(/\s+/);
    return `${(first || "").toLowerCase()}.${(last || "bd").toLowerCase()}@institution.com`;
  }
  return "bd@institution.com";
}

export default function BDManagerProfilePage() {
  const params = useParams<{ bdName: string }>();
  const router = useRouter();
  const bdName = decodeURIComponent(params?.bdName || "");
  const { user, role, isBdManager, bdManagerFullName, isLoading } = useCurrentUser();
  const mockData = useMemo(() => getMockData(), []);
  const batches0 = mockData.batches as any[];
  const [hydrated, setHydrated] = useState(false);
  const [tick, setTick] = useState(0);
  const batches = useMemo(() => {
    if (!hydrated) {
      return batches0.map((b: any) => ({ ...b, clients: (b.clients || []) as any[] }));
    }
    return batches0.map((b: any) => ({
      ...b,
      clients: mergeClientStatusesOnClientList((b.clients || []) as any[]),
    }));
  }, [batches0, tick, hydrated]);

  // BD 角色：只能访问自己名下的页面，否则重定向
  useEffect(() => {
    if (!hydrated || isLoading) return;
    if (isBdManager && bdManagerFullName) {
      const normalizedCurrent = bdName.trim();
      const normalizedMine = bdManagerFullName.trim();
      // 匹配多种写法（displayName 中含中文名）
      const matches =
        normalizedCurrent === normalizedMine ||
        normalizedCurrent.startsWith(normalizedMine.split(" ")[0] || "__NONE__") ||
        displayNameIncludes(normalizedMine, normalizedCurrent);
      if (!matches) {
        router.replace(`/bd/${encodeURIComponent(normalizedMine)}`);
      }
    }
  }, [hydrated, isLoading, isBdManager, bdManagerFullName, bdName, router]);

  const validBD = BD_MANAGERS.includes(bdName)
    ? bdName
    : isBdManager && bdManagerFullName && BD_MANAGERS.includes(bdManagerFullName)
      ? bdManagerFullName
      : BD_MANAGERS[0];
  const isValid = BD_MANAGERS.includes(bdName);

  useEffect(() => {
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "risk_control_client_status_v1") setTick((t) => t + 1);
    };
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(() => setTick((t) => t + 1), 3500);
    const onCustom = () => setTick((t) => t + 1);
    window.addEventListener("risk-control:client-status-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
      window.removeEventListener("risk-control:client-status-changed", onCustom);
    };
  }, []);

  const relatedBatches = useMemo(() => {
    return batches
      .map((b: any) => {
        const ownClients = (b.clients || []).filter((c: any) => c.bdManager === validBD);
        return { batch: b, ownClients } as { batch: any; ownClients: any[] };
      })
      .filter((r) => r.ownClients.length > 0)
      .sort((a, b) => (b.batch.signDate?.getTime?.() || 0) - (a.batch.signDate?.getTime?.() || 0));
  }, [batches, validBD]);

  const totalStats = useMemo(() => {
    let totalClients = 0;
    let totalInvest = 0;
    let totalRealtime = 0;
    let vipCount = 0;
    let activeClients = 0;
    let settledClients = 0;
    let totalPnL = 0;
    let unverifiedClients = 0;

    for (const { ownClients, batch } of relatedBatches) {
      for (const c of ownClients) {
        totalClients++;
        totalInvest += c.investmentAmount || 0;
        const unverified = c.status === "SETTLED" && !c.settlement && !batch.finance?.settlements[c.id];
        const realtime = calculateRealtimeClientMetrics(c, batch, batch.currentMarketValue);
        if (c.status !== "SETTLED") totalRealtime += realtime.marketValueShare;
        if (unverified) unverifiedClients++;
        else totalPnL += realtime.realtimePnL;
        if (isVipClient(c)) vipCount++;
        if (c.status === "ACTIVE") activeClients++;
        if (c.status === "SETTLED") settledClients++;
      }
    }
    const pnlPct = totalInvest > 0 ? (totalPnL / totalInvest) * 100 : 0;
    return {
      totalClients,
      totalInvest,
      totalRealtime,
      vipCount,
      activeClients,
      settledClients,
      totalPnL,
      unverifiedClients,
      pnlPct,
      batchCount: relatedBatches.length,
    };
  }, [relatedBatches]);

  const initials = getInitialsCn(validBD);

  if (!isValid) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-lg font-semibold text-danger">未找到客户经理：{bdName}</p>
        <Link href="/">
          <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-2"/>返回风控大盘</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Breadcrumb & back */}
      <div className="flex items-center gap-2">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5 h-8 px-2.5">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回风控大盘
          </Button>
        </Link>
      </div>

      {/* Profile Card */}
      <Card className="border-border/50 bg-gradient-to-br from-card via-card to-secondary/30">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-5">
            <ClientAvatar
              name={validBD}
              className="!h-20 !w-20 !rounded-2xl !text-xl !shadow-lg"
              mode="initials"
              rounded="xl"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{validBD}</h1>
                <Badge variant="primary" className="gap-1">
                  <Award className="h-3 w-3" /> 商务经理
                </Badge>
                <Badge variant="success" className="gap-1">
                  <Crown className="h-3 w-3" /> VIP 客户 {totalStats.vipCount}
                </Badge>
                <Badge variant="warning" className="gap-1">
                  <Target className="h-3 w-3" /> 覆盖 {totalStats.batchCount} 个批次
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> 机构客户关系部 · 高级客户经理
                </p>
                <p className="flex items-center gap-1.5 font-mono">
                  📧 {bdEmail(validBD)}
                </p>
              </div>
            </div>
          </div>

          {/* 6 KPI */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-6">
            <div className="rounded-xl bg-secondary/40 p-3 border border-border/40">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> 总客户数
              </p>
              <p className="text-xl font-bold mt-1">{totalStats.totalClients}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                持仓 {totalStats.activeClients} · 已结 {totalStats.settledClients}
              </p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3 border border-border/40">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Briefcase className="h-3 w-3" /> 参与批次
              </p>
              <p className="text-xl font-bold mt-1">{totalStats.batchCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">支股票产品</p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3 border border-border/40">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> 累计募资
              </p>
              <p className="text-xl font-bold mt-1 font-mono">{formatCurrency(totalStats.totalInvest)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                VIP {((totalStats.vipCount / Math.max(1, totalStats.totalClients)) * 100).toFixed(0)}%
              </p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3 border border-border/40">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Landmark className="h-3 w-3" /> 客户在仓市值
              </p>
              <p className="text-xl font-bold mt-1 font-mono">{formatCurrency(totalStats.totalRealtime)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">不含机构资金及已结算仓位</p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3 border border-border/40">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                {totalStats.totalPnL >= 0 ? <TrendingUp className="h-3 w-3 text-success" /> : <TrendingDown className="h-3 w-3 text-danger" />}
                客户累计 PnL
              </p>
              <p className={cn("text-xl font-bold mt-1 font-mono", totalStats.totalPnL >= 0 ? "text-success" : "text-danger")}>
                {totalStats.totalPnL >= 0 ? "+" : ""}{formatCurrency(totalStats.totalPnL)}
              </p>
              <p className={cn("text-[10px] mt-0.5 font-mono", totalStats.totalPnL >= 0 ? "text-success/80" : "text-danger/80")}>
                {formatPercent(totalStats.pnlPct)}
              </p>
              {totalStats.unverifiedClients > 0 && <p className="text-[10px] text-warning">不含 {totalStats.unverifiedClients} 位历史待核对客户</p>}
            </div>
            <div className="rounded-xl bg-secondary/40 p-3 border border-border/40">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> 客户本金安全
              </p>
              <p className="text-xl font-bold mt-1 text-success">100%</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">机构劣后 100% 保本</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Batches with clients */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold flex items-center gap-2 pl-1">
          <UserPlus className="h-4 w-4 text-primary" /> 名下所有批次客户
          <span className="text-muted-foreground text-xs font-normal">（按批次最新签约 → 最早排序）</span>
        </h2>

        {relatedBatches.length === 0 ? (
          <Card className="border-dashed border-border/50">
            <CardContent className="py-14 text-center text-muted-foreground">
              该客户经理暂未分配客户
            </CardContent>
          </Card>
        ) : (
          relatedBatches.map(({ batch, ownClients }) => (
            <ClientBatchCard key={batch.id} batch={batch as any} clients={ownClients} />
          ))
        )}
      </div>
    </div>
  );
}

function ClientBatchCard({ batch, clients }: { batch: any; clients: any[] }) {
  const mv = batch.currentMarketValue || batch.initialTotalAmount || 0;
  const metrics = getBatchMetrics(batch);
  const dropPct = metrics.dropPercent || 0;

  const riskLevel: ExtendedRiskLevel = metrics.riskLevel as ExtendedRiskLevel;

  const riskBadgeMap: Record<ExtendedRiskLevel, { variant: any; label: string; Icon: any; cls: string }> = {
    CRITICAL: { variant: "danger", label: "击穿 · 需补仓", Icon: Flame, cls: "animate-breath-danger" },
    WARNING: { variant: "warning", label: "预警", Icon: AlertTriangle, cls: "animate-breath-warning" },
    NORMAL: { variant: "outline", label: "正常", Icon: ShieldCheck, cls: "" },
    PROFITABLE: { variant: "success", label: "盈利", Icon: TrendingUp, cls: "" },
  };
  const riskBadge = riskBadgeMap[riskLevel];
  const RIcon = riskBadge.Icon;

  const sorted = useMemo(() => {
    const statusRank = (c: any): number => {
      switch (c.status) {
        case "EXIT_REQUESTED": return 0;
        case "ACTIVE": return 1;
        case "SETTLED": return 99;
        default: return 50;
      }
    };
    return [...clients].sort((a, b) => {
      const sa = statusRank(a);
      const sb = statusRank(b);
      if (sa !== sb) return sa - sb;
      const isAVip = isVipClient(a);
      const isBVip = isVipClient(b);
      if (isAVip !== isBVip) return isAVip ? -1 : 1;
      return (b.investmentAmount || 0) - (a.investmentAmount || 0);
    });
  }, [clients]);
  const bdInitial = sorted.reduce((s, c) => s + (c.investmentAmount || 0), 0);
  const unverified = (c: any) => c.status === "SETTLED" && !c.settlement && !batch.finance?.settlements[c.id];
  const unverifiedCount = sorted.filter(unverified).length;
  const bdCurrent = sorted.reduce((s, c) => s + (c.status === "SETTLED" ? 0 : calculateRealtimeClientMetrics(c, batch, mv).marketValueShare), 0);
  const pnl = sorted.reduce((s, c) => s + (unverified(c) ? 0 : calculateRealtimeClientMetrics(c, batch, mv).realtimePnL), 0);
  const pnlPct = bdInitial > 0 ? (pnl / bdInitial) * 100 : 0;

  return (
    <Card className={cn(
      "border-border/50 transition-shadow",
      riskLevel === "CRITICAL" && "animate-card-crit",
      riskLevel === "WARNING" && "animate-card-warn",
    )}>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Badge variant={riskBadge.variant as any} className={cn("gap-1 h-5 text-[10px]", riskBadge.cls)}>
              <RIcon className="h-2.5 w-2.5" /> {riskBadge.label}
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground bg-secondary/60 rounded px-2 py-0.5">
              {batch.batchNumber}
            </span>
            <span className="font-bold">{batch.stockSymbol}</span>
            <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">{batch.stockName}</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
            <div>
              <span className="text-muted-foreground">跌幅：</span>
              <span className={cn("font-mono font-bold", dropPct >= 20 ? "text-danger" : dropPct >= 15 ? "text-warning" : "")}>
                {dropPct.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">我名下投入：</span>
              <span className="font-mono font-semibold">{formatCurrency(bdInitial)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">客户在仓市值：</span>
              <span className="font-mono font-semibold">{formatCurrency(bdCurrent)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">客户分成收益：</span>
              <span className={cn("font-mono font-bold", pnl >= 0 ? "text-success" : "text-danger")}>
                {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)} <span className="text-[10px] opacity-80">({formatPercent(pnlPct)})</span>
              </span>
            </div>
            {unverifiedCount > 0 && <span className="text-warning">{unverifiedCount} 位历史结算待核对，未计入收益</span>}
            <Link href={`/batch/${batch.id}`}>
              <Button size="sm" variant="outline" className="gap-1 h-7 text-[11px] px-2.5">
                批次详情
              </Button>
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="border border-border/50 rounded-xl overflow-hidden">
          <Table>
            <TableHeader className="bg-secondary/30">
              <TableRow className="hover:bg-secondary/30 border-border/50">
                <TableHead className="w-[160px]">客户</TableHead>
                <TableHead className="text-right">投资金额</TableHead>
                <TableHead className="text-center">分成比例</TableHead>
                <TableHead className="text-right">在仓市值 / 结算实收</TableHead>
                <TableHead className="text-right">客户分成收益</TableHead>
                <TableHead className="text-center w-[90px]">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c: Client & any) => {
                const realtime = calculateRealtimeClientMetrics(c, batch, mv);
                const clientMV = realtime.marketValueShare;
                const clientPnL = realtime.realtimePnL;
                const clientPnLPct = (c.investmentAmount || 0) > 0 ? (clientPnL / c.investmentAmount) * 100 : 0;
                const split = getClientProfitSplit(c);
                return (
                  <TableRow key={c.id} className="h-[56px]">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ClientAvatar name={c.name} size="sm" rounded="lg" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-sm font-semibold truncate">{c.name}</span>
                            {isVipClient(c) && <Badge variant="primary" className="text-[9px] px-1.5 py-0 h-4 font-mono">VIP</Badge>}
                            {c.investmentAmount >= 200000 && <Badge variant="warning" className="text-[9px] px-1.5 py-0 h-4 font-mono">大额</Badge>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatCurrency(c.investmentAmount)}</TableCell>
                    <TableCell className="text-center text-xs">
                      <p className="font-mono font-semibold">客户 {Number((split.client * 100).toFixed(2))}%</p>
                      <p className="text-[10px] text-muted-foreground">/ 机构 {Number((split.institution * 100).toFixed(2))}%</p>
                    </TableCell>
                    <TableCell className="text-right font-mono">{unverified(c) ? <span className="text-warning">待核对</span> : formatCurrency(clientMV)}</TableCell>
                    <TableCell className="text-right">
                      {unverified(c) ? <span className="text-xs text-warning">待核对</span> : <>
                      <p className={cn("font-mono font-bold", clientPnL > 0 ? "text-success" : clientPnL < 0 ? "text-danger" : "text-muted-foreground")}>
                        {clientPnL > 0 ? "+" : ""}{formatCurrency(clientPnL)}
                      </p>
                      <p className={cn("text-[10px] font-mono", clientPnL > 0 ? "text-success/80" : clientPnL < 0 ? "text-danger/80" : "text-muted-foreground")}>
                        {formatPercent(clientPnLPct)}
                      </p>
                      </>}
                    </TableCell>
                    <TableCell className="text-center">
                      {c.status === "ACTIVE" ? (
                        <Badge variant="success" className="gap-1 px-2 py-1 text-[10px]"><ShieldCheck className="h-2.5 w-2.5"/>持仓中</Badge>
                      ) : c.status === "EXIT_REQUESTED" ? (
                        <Badge variant="warning" className="gap-1 px-2 py-1 text-[10px]"><AlertTriangle className="h-2.5 w-2.5"/>申请退出</Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 px-2 py-1 text-[10px]"><Landmark className="h-2.5 w-2.5"/>已结算</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
