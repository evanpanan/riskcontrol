"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMockData, commitBatchFinance } from "@/lib/mockData";
import { triggerClientAddedAlert } from "@/lib/notifier";
import { formatCurrency, cn, formatDate, formatPercent } from "@/lib/utils";
import { calculateProfitSplitRatio, getClientProfitSplit, addClientPosition, isVipClient } from "@/lib/riskEngine";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { filterClientsByRole, type ClientLike } from "@/lib/authz/dataScope";
import { APP_ROLES } from "@/types/auth";
import { ClientAvatar } from "@/components/branding/ClientAvatar";
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
  UserPlus as UserPlusIcon,
  CheckCircle2,
  Plus,
  X as XIcon,
} from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ClientStatus } from "@prisma/client";
import { mergeClientStatusesOnClientList } from "@/lib/clientStatusStore";

const BD_OPTIONS_ADD = [
  "李晓明 (Evan Li)",
  "王思远 (Sylvia Wang)",
  "张志强 (Jack Zhang)",
  "刘佳 (Jennifer Liu)",
  "陈志远 (Daniel Chen)",
  "林晓雯 (Sharon Lin)",
];

export default function ClientsPage() {
  const { batches } = getMockData();
  const [search, setSearch] = useState("");
  const [bdFilter, setBdFilter] = useState("ALL");
  const [batchFilter, setBatchFilter] = useState<string>("ALL");
  const [hydrated, setHydrated] = useState(false);
  const [tick, setTick] = useState(0);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    investment: "",
    bdManager: "",
    batchId: "",
    signDate: new Date().toISOString().split("T")[0],
  });
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [lastAddedSummary, setLastAddedSummary] = useState<{ name: string; amount: number; batchNumber: string }[]>([]);
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

  const rawAllClients = useMemo(() => {
    const list: any[] = [];
    batches.forEach((b) => {
      const mergedClients = hydrated ? mergeClientStatusesOnClientList((b.clients || []) as any[]) : (b.clients || []) as any[];
      mergedClients.forEach((c) => {
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
  }, [batches, hydrated, tick]);

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
      .filter((b) => {
        if (!isBdManager || !bdManagerFullName) return true;
        return (b.clients || []).some((c) => (c as any).bdManager === bdManagerFullName);
      })
      .sort((a, b) => (a.batchNumber ?? "").localeCompare(b.batchNumber ?? ""))
      .map((b) => ({
        batchId: b.id,
        batchNumber: b.batchNumber,
        symbol: b.stockSymbol,
        stockName: b.stockName,
        clientCount: (b.clients || []).filter((c) =>
          isBdManager && bdManagerFullName
            ? (c as any).bdManager === bdManagerFullName
            : true
        ).length,
        riskLevel: b.riskLevel,
      }));
  }, [batches, isBdManager, bdManagerFullName]);

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
            统一管理所有批次的客户档案、投资记录与 商务经理分配
            {isBdManager && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/60 border border-border/60 text-xs font-mono">
              <EyeOff className="h-3 w-3" />
              仅显示名下 {bdManagerFullName} 的 {roleFilteredClients.length} 位客户
            </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isBdManager && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                导出客户表
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setAddForm({
                    name: "",
                    investment: "",
                    bdManager: bdManagerFullName ?? BD_OPTIONS_ADD[0],
                    batchId: batches[0]?.id ?? "",
                    signDate: new Date().toISOString().split("T")[0],
                  });
                  setAddErrors({});
                  setLastAddedSummary([]);
                  setAddClientOpen(true);
                }}
              >
                <UserPlus className="h-3.5 w-3.5" />
                批量新增客户
              </Button>
            </>
          )}
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
              <p className="text-xs text-muted-foreground">商务经理数</p>
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
            商务经理业绩排行榜
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
                    <ClientAvatar name={bd} size="md" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/bd/${encodeURIComponent(bd)}`} className="text-xs font-semibold hover:text-primary hover:underline">{bd}</Link>
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
                  placeholder="搜索：姓名 / 商务经理 / 股票..."
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
                <option value="ALL">{isBdManager ? "仅我名下（已锁定）" : "全部 商务经理"}</option>
                {bdManagers.map((bd) => {
                  const disabled = isBdManager && bd !== bdManagerFullName;
                  return (
                    <option key={bd} value={bd} disabled={disabled}>
                      {bd}{disabled ? "（其他商务经理 · 无权限）" : ""}
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
              <div className="col-span-2">所属商务经理</div>
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
                        <ClientAvatar name={c.name} size="sm" rounded="lg" />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{c.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {c.id.slice(-6)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <Link href={`/bd/${encodeURIComponent(c.bdManager)}`} className="flex items-center gap-1.5 text-xs hover:text-primary hover:underline">
                        <ClientAvatar name={c.bdManager} size="xs" />
                        <span className="truncate">{c.bdManager}</span>
                      </Link>
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
                      {isVipClient(c) && (
                        <Badge variant="primary" className="mt-0.5 text-[9px] px-1.5">
                          VIP
                        </Badge>
                      )}
                    </div>
                    <div className="col-span-1 text-center text-xs font-mono">
                      {(() => {
                        const split = getClientProfitSplit(c);
                        return (
                          <>
                            <p className="font-semibold">客户 {Number((split.client * 100).toFixed(2))}%</p>
                            <p className="text-[10px] text-muted-foreground">
                              / 机构 {Number((split.institution * 100).toFixed(2))}%
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

      <Dialog
        open={addClientOpen}
        onOpenChange={(o) => {
          if (!o) {
            setAddClientOpen(false);
            setTick((t) => t + 1);
          } else {
            setAddClientOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-4 border-b border-border/50">
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl gradient-primary flex items-center justify-center shrink-0 shadow-md shadow-primary/30">
                <UserPlusIcon className="h-4.5 w-4.5 text-primary-foreground" />
              </div>
              <div>
                <p className="font-bold">批量新增客户</p>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  连续录入：保存后自动重置姓名和金额，继续添加下一位客户
                </DialogDescription>
              </div>
              {lastAddedSummary.length > 0 && (
                <Badge variant="success" className="ml-auto text-[10px] h-5 font-mono">
                  本次已新增 {lastAddedSummary.length} 位
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="rounded-lg border border-border/50 bg-card/40 p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px]">客户姓名 *</Label>
                  <Input
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                    placeholder="例：张伟 / Jennifer Zhang"
                    className={cn(addErrors.name && "border-danger ring-danger/20")}
                  />
                  {addErrors.name && <p className="text-[10px] text-danger font-mono">{addErrors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">投资本金（USD）*</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-muted-foreground">$</span>
                    <Input
                      value={addForm.investment}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        const parts = v.split(".");
                        const cleaned = parts[0] + (parts.length > 1 ? "." + parts.slice(1).join("") : "");
                        setAddForm({ ...addForm, investment: cleaned });
                      }}
                      onBlur={() => {
                        const n = Number(addForm.investment.replace(/[^0-9.]/g, ""));
                        if (Number.isFinite(n)) {
                          setAddForm({ ...addForm, investment: n.toFixed(2) });
                        }
                      }}
                      placeholder="500000.00"
                      className="pl-7 font-mono tabular-nums"
                    />
                  </div>
                  {addErrors.investment && <p className="text-[10px] text-danger font-mono">{addErrors.investment}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">所属批次 *</Label>
                  <Select
                    value={addForm.batchId || ""}
                    onValueChange={(v) => setAddForm({ ...addForm, batchId: v })}
                  >
                    <SelectTrigger className={cn(addErrors.batchId && "border-danger ring-danger/20")}>
                      <SelectValue placeholder="选择要加入的批次" />
                    </SelectTrigger>
                    <SelectContent>
                      {batches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground">{b.batchNumber}</span>
                            <span className="font-semibold">{b.stockSymbol}</span>
                            <span className="text-muted-foreground text-xs">{b.stockName}</span>
                            <Badge variant="outline" className="ml-auto font-mono text-[9px]">
                              {b.clients?.length ?? 0} 位
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {addErrors.batchId && <p className="text-[10px] text-danger font-mono">{addErrors.batchId}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">商务经理*</Label>
                  <Select
                    value={addForm.bdManager || ""}
                    onValueChange={(v) => setAddForm({ ...addForm, bdManager: v })}
                    disabled={!!bdManagerFullName}
                  >
                    <SelectTrigger className={cn(addErrors.bdManager && "border-danger ring-danger/20")}>
                      <SelectValue placeholder="选择 商务经理" />
                    </SelectTrigger>
                    <SelectContent>
                      {BD_OPTIONS_ADD.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {addErrors.bdManager && <p className="text-[10px] text-danger font-mono">{addErrors.bdManager}</p>}
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-[11px]">签约日期</Label>
                  <Input
                    type="date"
                    value={addForm.signDate}
                    onChange={(e) => setAddForm({ ...addForm, signDate: e.target.value })}
                  />
                </div>
              </div>

              {(() => {
                const b = batches.find((x) => x.id === addForm.batchId);
                const numAmt = Number(addForm.investment.replace(/[^0-9.]/g, "")) || 0;
                const split = numAmt > 0 ? calculateProfitSplitRatio(numAmt) : null;
                return (
                  <div className="rounded-md border border-dashed border-border/70 bg-secondary/30 p-3 grid gap-2 md:grid-cols-3 text-[11px]">
                    <div>
                      <p className="text-muted-foreground mb-0.5">批次优先池上限</p>
                      <p className="font-mono font-semibold">{b ? formatCurrency(b.priorityAmount ?? 0) : "-"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-0.5">分成比例（客户/机构）</p>
                      <p className="font-mono font-semibold">
                        {split ? `客户${Number((split.client * 100).toFixed(2))}% / 机构${Number((split.institution * 100).toFixed(2))}%` : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-0.5">签约日期</p>
                      <p className="font-mono font-semibold">{addForm.signDate || "-"}</p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {lastAddedSummary.length > 0 && (
              <div className="rounded-lg border border-success/40 bg-success/5 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-success flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  本次已新增 {lastAddedSummary.length} 位客户
                </p>
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {lastAddedSummary.map((x, i) => (
                    <li key={i} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-background/50">
                      <div className="flex items-center gap-2">
                        <ClientAvatar name={x.name} size="xs" rounded="full" />
                        <span className="font-semibold">{x.name}</span>
                        <span className="text-muted-foreground font-mono text-[10px]">{x.batchNumber}</span>
                      </div>
                      <span className="font-mono font-semibold text-success">{formatCurrency(x.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter className="p-3 border-t border-border/50 flex-row justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLastAddedSummary([])}
              disabled={lastAddedSummary.length === 0}
              className="text-[11px]"
            >
              <XIcon className="h-3.5 w-3.5" />
              清空本次记录
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAddClientOpen(false);
                  setTick((t) => t + 1);
                }}
                className="text-[11px]"
              >
                完成并关闭
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-[11px]"
                onClick={async () => {
                  const errs: Record<string, string> = {};
                  if (!addForm.name.trim() || addForm.name.trim().length < 2) errs.name = "至少 2 个字符";
                  const numAmt = Number(addForm.investment.replace(/[^0-9.]/g, ""));
                  if (!Number.isFinite(numAmt) || numAmt <= 100) errs.investment = "最低 $100";
                  if (!addForm.batchId) errs.batchId = "请选择所属批次";
                  if (!addForm.bdManager) errs.bdManager = "请选择 商务经理";
                  setAddErrors(errs);
                  if (Object.keys(errs).length > 0) return;
                  const mock = getMockData();
                  const batch = mock.batches.find((x) => x.id === addForm.batchId);
                  if (!batch) return;
                  const split = calculateProfitSplitRatio(numAmt);
                  const newClient: any = {
                    id: `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name: addForm.name.trim(),
                    investmentAmount: numAmt,
                    initialInvestment: numAmt,
                    bdManager: addForm.bdManager,
                    signDate: new Date(addForm.signDate),
                    status: ClientStatus.ACTIVE,
                    profitSplitClient: split.client * 100,
                    profitSplitInstitution: split.institution * 100,
                    signedVipThreshold: split.vipThreshold,
                    realtimePnL: 0,
                    estimatedExitAmount: numAmt,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    batchId: batch.id,
                    settledAt: null,
                  };
                  try {
                    commitBatchFinance(batch, (draft) => addClientPosition(draft, newClient));
                  } catch (err) {
                    setAddErrors({ investment: err instanceof Error ? err.message : "新增客户失败" });
                    return;
                  }
                  try {
                    await triggerClientAddedAlert(batch as any, {
                      name: newClient.name,
                      investmentAmount: numAmt,
                      bdManager: addForm.bdManager,
                    });
                  } catch {}
                  setLastAddedSummary((xs) => [
                    ...xs,
                    { name: newClient.name, amount: numAmt, batchNumber: batch.batchNumber },
                  ]);
                  window.dispatchEvent(
                    new CustomEvent("risk-control:client-added", {
                      detail: { batchId: batch.id, client: newClient },
                    })
                  );
                  setTick((t) => t + 1);
                  setAddForm({
                    name: "",
                    investment: "",
                    bdManager: addForm.bdManager,
                    batchId: addForm.batchId,
                    signDate: addForm.signDate,
                  });
                  setAddErrors({});
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                保存并继续新增
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
