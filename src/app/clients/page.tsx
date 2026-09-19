"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMockData } from "@/lib/mockData";
import { formatCurrency, cn, formatDate, formatPercent } from "@/lib/utils";
import { calculateProfitSplitRatio } from "@/lib/riskEngine";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { filterClientsByRole, type ClientLike } from "@/lib/authz/dataScope";
import { APP_ROLES } from "@/types/auth";
import {
  Users,
  Search,
  Download,
  Building2,
  TrendingUp,
  Filter,
  UserPlus,
  DollarSign,
  ShieldCheck,
  EyeOff,
  Pencil,
  Eye,
  ShieldAlert,
  Calendar,
  Landmark,
  Layers,
} from "lucide-react";
import { useState, useMemo } from "react";
import Link from "next/link";
import { ClientStatus } from "@prisma/client";

export default function ClientsPage() {
  const { batches } = getMockData();
  const [search, setSearch] = useState("");
  const [bdFilter, setBdFilter] = useState("ALL");
  const [batchFilter, setBatchFilter] = useState<string>("ALL");
  const { user, role, isBdManager, bdManagerFullName } = useCurrentUser();

  const rawAllClients = useMemo(() => {
    const list: any[] = [];
    batches.forEach((b) => {
      b.clients?.forEach((c) => {
        list.push({
          ...c,
          batchNumber: b.batchNumber,
          batchId: b.id,
          symbol: b.stockSymbol,
          riskLevel: b.riskLevel,
        });
      });
    });
    return list;
  }, [batches]);

  const scopeUser = (user ?? {
    id: 'fallback_risk',
    role: APP_ROLES.RISK_MANAGER,
    email: 'fallback@risk.com',
    displayName: 'Fallback Risk',
    avatarInitials: 'FR',
  }) as any;

  const roleFilteredClients: ClientLike[] = useMemo(
    () => filterClientsByRole(rawAllClients, scopeUser),
    [rawAllClients, scopeUser]
  );

  const bdManagers = useMemo(() => {
    const set = new Set<string>();
    if (isBdManager && bdManagerFullName) {
      set.add(bdManagerFullName);
    } else {
      batches.forEach((b) => b.clients?.forEach((c) => set.add(c.bdManager)));
    }
    return Array.from(set);
  }, [batches, isBdManager, bdManagerFullName]);

  const batchTabs = useMemo(() => {
    return batches
      .slice()
      .sort((a, b) => (a.batchNumber ?? "").localeCompare(b.batchNumber ?? ""))
      .map((b) => ({
        batchId: b.id,
        batchNumber: b.batchNumber,
        symbol: b.stockSymbol,
        stockName: b.stockName,
        clientCount: b.clients?.length ?? 0,
        riskLevel: b.riskLevel,
      }));
  }, [batches]);

  const allClients = useMemo(() => {
    let result = roleFilteredClients as any[];
    if (batchFilter !== "ALL") {
      result = result.filter((c) => c.batchId === batchFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.bdManager?.toLowerCase().includes(q) ||
          c.symbol?.toLowerCase().includes(q) ||
          c.batchNumber?.toLowerCase().includes(q)
      );
    }
    if (bdFilter !== "ALL") {
      result = result.filter((c) => c.bdManager === bdFilter);
    }
    return result;
  }, [roleFilteredClients, batchFilter, search, bdFilter]);

  const stats = useMemo(() => {
    let totalInvestment = 0;
    const bdStats: Record<string, { count: number; amount: number }> = {};
    allClients.forEach((c) => {
      totalInvestment += c.investmentAmount || 0;
      if (!bdStats[c.bdManager]) bdStats[c.bdManager] = { count: 0, amount: 0 };
      bdStats[c.bdManager].count++;
      bdStats[c.bdManager].amount += c.investmentAmount || 0;
    });
    return {
      totalClients: allClients.length,
      totalInvestment,
      bdCount: bdManagers.length,
      bdStats,
    };
  }, [allClients, bdManagers]);

  const canEdit = (c: any): boolean => {
    if (role === APP_ROLES.RISK_MANAGER) return true;
    if (isBdManager && bdManagerFullName && c.bdManager === bdManagerFullName) return true;
    return false;
  };

  return (
    <div className="space-y-6 max-w-[1800px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">
              客户关系
            </span>
            <span>/</span>
            <span>客户管理</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">客户管理中心</h1>
          <p className="text-sm text-muted-foreground">
            统一管理所有批次的客户档案、投资记录与 BD 分配
            {isBdManager && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/60 border border-border/60 text-xs font-mono">
              <EyeOff className="h-3 w-3" />
              仅显示名下 {bdManagerFullName} 的 {roleFilteredClients.length} 位客户
            </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            导出客户表
          </Button>
          <Button size="sm" className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" />
            批量新增客户
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">客户总数</p>
              <Users className="h-4 w-4 text-primary" />
            </div>
            <p className="text-2xl font-bold font-mono">{stats.totalClients}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              覆盖 {batches.length} 个批次
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">累计投资总额</p>
              <DollarSign className="h-4 w-4 text-success" />
            </div>
            <p className="text-2xl font-bold font-mono text-success">
              {formatCurrency(stats.totalInvestment)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              平均单笔 {formatCurrency(stats.totalClients > 0 ? stats.totalInvestment / stats.totalClients : 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">BD 经理数</p>
              <Building2 className="h-4 w-4 text-secondary-foreground" />
            </div>
            <p className="text-2xl font-bold font-mono">{stats.bdCount}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              人均管理 {Math.round(stats.totalClients / Math.max(1, stats.bdCount))} 位客户
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">保本机制保护</p>
              <ShieldCheck className="h-4 w-4 text-success" />
            </div>
            <p className="text-2xl font-bold font-mono text-success">100%</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              所有客户本金全额保障
            </p>
          </CardContent>
        </Card>
      </div>

      {/* BD Ranking */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            BD 经理业绩排行榜
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {Object.entries(stats.bdStats)
              .sort((a, b) => b[1].amount - a[1].amount)
              .map(([bd, s], idx) => (
                <div
                  key={bd}
                  className="rounded-xl border border-border/50 bg-secondary/30 p-4 hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0",
                        idx === 0 && "bg-gradient-to-br from-amber-400 to-yellow-500 text-white shadow-md shadow-amber-500/30",
                        idx === 1 && "bg-gradient-to-br from-slate-300 to-slate-400 text-white",
                        idx === 2 && "bg-gradient-to-br from-orange-400 to-amber-600 text-white",
                        idx > 2 && "bg-primary/15 text-primary border border-primary/20"
                      )}
                    >
                      #{idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{bd}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {s.count} 位客户
                      </p>
                    </div>
                  </div>
                  <p className="font-mono font-bold text-sm text-gradient-primary">
                    {formatCurrency(s.amount)}
                  </p>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Clients List */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Users className="h-4 w-4" />
              客户总表 ({allClients.length})
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜索：姓名 / BD / 股票..."
                  className="pl-8 h-9 w-[240px] text-xs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="h-9 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
                value={bdFilter}
                onChange={(e) => setBdFilter(e.target.value)}
                disabled={isBdManager}
              >
                <option value="ALL">{isBdManager ? "仅我名下（已锁定）" : "全部 BD 经理"}</option>
                {bdManagers.map((bd) => {
                  const disabled = isBdManager && bd !== bdManagerFullName;
                  return (
                    <option key={bd} value={bd} disabled={disabled}>
                      {bd}{disabled ? "（其他 BD · 无权限）" : ""}
                    </option>
                  );
                })}
              </select>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
                <Filter className="h-3.5 w-3.5" />
                更多筛选
              </Button>
            </div>
          </div>

          {/* 批次分组 Tab 行 */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setBatchFilter("ALL")}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[11px] font-semibold transition-all",
                batchFilter === "ALL"
                  ? "bg-primary/15 border-primary/40 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.25)_inset]"
                  : "border-border/60 hover:border-primary/30 hover:bg-card/60 text-foreground/80 bg-card/30"
              )}
            >
              <Layers className="h-3 w-3" />
              全部批次
              <Badge variant="outline" className="h-4 text-[9px] px-1.5 ml-0.5 font-mono">
                {roleFilteredClients.length}
              </Badge>
            </button>
            {batchTabs.map((bt) => {
              const dotClass =
                bt.riskLevel === "CRITICAL"
                  ? "bg-danger animate-breath-danger"
                  : bt.riskLevel === "WARNING"
                  ? "bg-warning animate-breath-warning"
                  : "bg-success";
              return (
                <button
                  key={bt.batchId}
                  type="button"
                  onClick={() => setBatchFilter(bt.batchId)}
                  className={cn(
                    "group inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11px] font-semibold transition-all",
                    batchFilter === bt.batchId
                      ? "bg-primary/15 border-primary/40 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.25)_inset]"
                      : "border-border/60 hover:border-primary/30 hover:bg-card/60 text-foreground/80 bg-card/30"
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} />
                  <span className="font-mono tracking-tight">{bt.symbol}</span>
                  <span className="text-muted-foreground/80 font-normal truncate max-w-[70px] hidden sm:inline">
                    {bt.stockName}
                  </span>
                  <Badge variant="outline" className="h-4 text-[9px] px-1.5 font-mono">
                    {bt.clientCount}
                  </Badge>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border/50">
              <div className="col-span-2">客户</div>
              <div className="col-span-2">所属 BD</div>
              <div className="col-span-2">批次 / 股票</div>
              <div className="col-span-1 text-right">投资金额</div>
              <div className="col-span-1 text-center">分成</div>
              <div className="col-span-2 text-right">状态 / 签约</div>
              <div className="col-span-2 text-right">操作</div>
            </div>
            <div className="divide-y divide-border/40 max-h-[550px] overflow-y-auto scrollbar-thin">
              {allClients.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>没有匹配的客户</p>
                </div>
              ) : (
                allClients.map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-12 items-center px-5 py-3 hover:bg-secondary/30 transition-colors group"
                  >
                    <div className="col-span-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center shrink-0 shadow-sm">
                          <span className="text-[11px] font-bold text-primary-foreground">
                            {c.name.charAt(0)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{c.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {c.id.slice(-6)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs">
                        <Building2 className="h-3 w-3 text-primary shrink-0" />
                        <span className="truncate">{c.bdManager}</span>
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {c.batchNumber}
                      </p>
                      <p className="font-bold text-sm">{c.symbol}</p>
                    </div>
                    <div className="col-span-1 text-right">
                      <p className="font-mono font-bold text-sm">
                        {formatCurrency(c.investmentAmount)}
                      </p>
                      {c.investmentAmount >= 100000 && (
                        <Badge variant="primary" className="mt-0.5 text-[9px] px-1.5">
                          VIP
                        </Badge>
                      )}
                    </div>
                    <div className="col-span-1 text-center text-xs font-mono">
                      {(() => {
                        const split = calculateProfitSplitRatio(c.investmentAmount || 0);
                        return (
                          <>
                            <p className="font-semibold">客户 {Math.round(split.client * 100)}%</p>
                            <p className="text-[10px] text-muted-foreground">
                              / 机构 {Math.round(split.institution * 100)}%
                            </p>
                          </>
                        );
                      })()}
                    </div>
                    <div className="col-span-2 text-right">
                      <Badge
                        variant={
                          c.status === ClientStatus.ACTIVE
                            ? "success"
                            : c.status === ClientStatus.EXIT_REQUESTED
                            ? "warning"
                            : "secondary"
                        }
                        className="text-[10px] mb-1"
                      >
                        {c.status === ClientStatus.ACTIVE
                          ? "持仓中"
                          : c.status === ClientStatus.EXIT_REQUESTED
                          ? "申请退出"
                          : "已结算"}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground font-mono block">
                        {formatDate(c.signDate)}
                      </p>
                    </div>
                    <div className="col-span-2 flex justify-end gap-1">
                      {canEdit(c) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log("[Edit] 编辑客户:", c.id);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        详情
                      </Button>
                      <Link href={`/batch/${c.batchId}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <TrendingUp className="h-3.5 w-3.5" />
                          批次详情
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
