"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
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
import { getMockData, commitBatchFinance, createNewBatch, reloadMockData, nextClientNo, FINANCE_STORE_KEY, FINANCE_STORE_KEY_LEGACY } from "@/lib/mockData";
import { triggerClientAddedAlert } from "@/lib/notifier";
import { getLiveQuoteSettings, fetchQuoteBrowser } from "@/lib/liveQuote";
import { formatCurrency, cn, formatDate, formatPercent } from "@/lib/utils";
import { calculateProfitSplitRatio, getClientProfitSplit, addClientPosition, isVipClient, updateClientPosition, removeClientPosition, getBatchMetrics, calculateBatchPnLSplit } from "@/lib/riskEngine";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { filterClientsByRole, type ClientLike, canCreateBatch } from "@/lib/authz/dataScope";
import { APP_ROLES } from "@/types/auth";
import { ClientAvatar } from "@/components/branding/ClientAvatar";
import { RoleGate } from "@/components/auth/RoleGate";
import * as XLSX from "xlsx";
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
  Trash2,
  AlertOctagon,
  SaveAll,
  Contact2,
  Briefcase,
  Handshake,
  ArrowRight,
  Wallet,
  ScrollText,
  BarChart3,
  Activity,
  Trophy,
  Crown,
  Info,
  RefreshCw,
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
  const initialMock = getMockData();
  const [mockTick, setMockTick] = useState(0);
  const batches = useMemo(() => {
    if (mockTick === 0) return initialMock.batches;
    const refreshed = reloadMockData();
    return refreshed.batches;
  }, [mockTick, initialMock.batches]);
  const [search, setSearch] = useState("");
  const [bdFilter, setBdFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "ALL">("ALL");
  const [batchFilter, setBatchFilter] = useState<string>("ALL");
  const [hydrated, setHydrated] = useState(false);
  const [tick, setTick] = useState(0);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [editClientOpen, setEditClientOpen] = useState<null | { id: string; batchId: string; clientNo?: string | null }>(null);
  const [clientDetail, setClientDetail] = useState<string | null>(null);
  const [deleteClientConfirm, setDeleteClientConfirm] = useState<null | { id: string; batchId: string; name: string }>(null);
  const [addForm, setAddForm] = useState({
    name: "",
    investment: "",
    bdManager: "",
    batchId: "",
    signDate: new Date().toISOString().split("T")[0],
  });
  const [createBatchForm, setCreateBatchForm] = useState<{
    signDate: string;
    maturityDate: string;
    batchNumber: string;
    stockSymbol: string;
    currentStockPrice: string;
  }>({
    signDate: new Date().toISOString().split("T")[0],
    maturityDate: (() => {
      const d = new Date();
      const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      base.setUTCFullYear(base.getUTCFullYear() + 2);
      base.setUTCDate(base.getUTCDate() - 1);
      return base.toISOString().split("T")[0];
    })(),
    batchNumber: "",
    stockSymbol: "",
    currentStockPrice: "",
  });
  const [createBatchFetchingQuote, setCreateBatchFetchingQuote] = useState(false);
  const [createBatchErrors, setCreateBatchErrors] = useState<Record<string, string>>({});
  const LAST_BATCH_SYMBOL_KEY = "risk_control_last_batch_symbol_v1";
  const FORBIDDEN_SYMBOL_FOR_MEMORY = /XMAX/i;
  const rememberLastBatchSymbol = (sym: string): void => {
    if (typeof window === "undefined") return;
    try {
      const clean = String(sym || "").trim().toUpperCase();
      if (!clean || FORBIDDEN_SYMBOL_FOR_MEMORY.test(clean)) {
        window.localStorage.removeItem(LAST_BATCH_SYMBOL_KEY);
        return;
      }
      window.localStorage.setItem(LAST_BATCH_SYMBOL_KEY, clean);
    } catch {}
  };
  const readLastBatchSymbol = (): string => {
    if (typeof window === "undefined") return "";
    try {
      const raw = String(window.localStorage.getItem(LAST_BATCH_SYMBOL_KEY) || "").trim().toUpperCase();
      if (!raw || FORBIDDEN_SYMBOL_FOR_MEMORY.test(raw)) {
        window.localStorage.removeItem(LAST_BATCH_SYMBOL_KEY);
        return "";
      }
      return raw;
    } catch {
      return "";
    }
  };
  const [editForm, setEditForm] = useState<{
    name: string;
    investment: string;
    bdManager: string;
    signDate: string;
    status: ClientStatus;
  }>({
    name: "",
    investment: "",
    bdManager: "",
    signDate: new Date().toISOString().split("T")[0],
    status: ClientStatus.ACTIVE,
  });
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [lastAddedSummary, setLastAddedSummary] = useState<{ clientNo?: string; name: string; amount: number; batchNumber: string }[]>([]);
  const [moreFilterOpen, setMoreFilterOpen] = useState(false);
  const [bdRankingOpen, setBdRankingOpen] = useState(false);
  const { user, role, isBdManager, bdManagerFullName } = useCurrentUser();
  const allowCreateBatch = canCreateBatch(role);

  useEffect(() => {
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "risk_control_client_status_v1") setTick((t) => t + 1);
      if (e.key === FINANCE_STORE_KEY || e.key === FINANCE_STORE_KEY_LEGACY)
        setMockTick((t) => t + 1);
    };
    const onFinanceChanged = () => setMockTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    window.addEventListener("risk-control:finance-changed", onFinanceChanged as any);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("risk-control:finance-changed", onFinanceChanged as any);
    };
  }, []);

  useEffect(() => {
    const onCustom = () => setTick((t) => t + 1);
    window.addEventListener("risk-control:client-status-changed", onCustom);
    const id = window.setInterval(onCustom, 3500);
    return () => {
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
          String(c.clientNo ?? "").toLowerCase().includes(q) ||
          c.name?.toLowerCase().includes(q) ||
          c.bdManager?.toLowerCase().includes(q) ||
          c.batchNumber?.toLowerCase().includes(q)
      );
    }
    if (bdFilter !== "ALL") {
      result = result.filter((c) => c.bdManager === bdFilter);
    }
    if (statusFilter !== "ALL") {
      result = result.filter((c) => c.status === statusFilter);
    }
    return result;
  }, [roleFilteredClients, batchFilter, search, bdFilter, statusFilter]);

  // 客户多批次跨表索引：按 `姓名 + 商务经理` 作为同一个自然人的指纹，聚合其参与的所有批次（跨批次导航）
  // 用途：客户总表「批次号」列显示该客户参与的全部批次号（每一批独立可点），而不只当前行所在的批次
  //       「投资金额」列：只显示最新批次的投资金额（非累计）
  //       「名字下方时间」：显示首次录入时间（所有批次中最早的签约日期）
  const personBatchIndex = useMemo(() => {
    const batchMap = new Map<string, Array<{ batchId: string; batchNumber: string; signDate: Date | null; investmentAmount: number }>>();
    const firstSignDateMap = new Map<string, Date | null>();
    const latestBatchMap = new Map<string, { batchId: string; batchNumber: string; signDate: Date | null; investmentAmount: number } | null>();
    const totalInvestMap = new Map<string, number>();
    for (const c of roleFilteredClients as any[]) {
      const key = `${String(c.name ?? "")}\u0001${String(c.bdManager ?? "")}`;
      if (!c.name || !c.bdManager) continue;
      const invAmt = Number(c.investmentAmount ?? 0);
      const signDateRaw = c.signDate ? new Date(c.signDate) : null;
      const next = {
        batchId: String(c.batchId ?? c.batch?.id ?? ""),
        batchNumber: String(c.batchNumber ?? c.batch?.batchNumber ?? ""),
        signDate: signDateRaw,
        investmentAmount: invAmt,
      };
      if (!next.batchId || !next.batchNumber) continue;
      const entry = batchMap.get(key);
      if (!entry) {
        batchMap.set(key, [next]);
      } else if (!entry.some((e) => e.batchId === next.batchId)) {
        entry.push(next);
      }
      const prevAmt = totalInvestMap.get(key) ?? 0;
      totalInvestMap.set(key, prevAmt + invAmt);
      // 维护首次录入时间（最小 signDate）
      const prevFirst = firstSignDateMap.get(key);
      if (!prevFirst || (signDateRaw && (!prevFirst || signDateRaw.getTime() < prevFirst.getTime()))) {
        firstSignDateMap.set(key, signDateRaw);
      }
      // 维护最新批次（最大 signDate；相等则按 batchNumber 降序）
      const prevLatest = latestBatchMap.get(key) ?? null;
      if (!prevLatest) {
        latestBatchMap.set(key, next);
      } else {
        const ta = next.signDate ? next.signDate.getTime() : 0;
        const tb = prevLatest.signDate ? prevLatest.signDate.getTime() : 0;
        if (ta > tb || (ta === tb && (next.batchNumber ?? "").localeCompare(prevLatest.batchNumber ?? "") > 0)) {
          latestBatchMap.set(key, next);
        }
      }
    }
    for (const list of batchMap.values()) {
      list.sort((a, b) => {
        const ta = a.signDate ? a.signDate.getTime() : 0;
        const tb = b.signDate ? b.signDate.getTime() : 0;
        if (ta !== tb) return tb - ta; // 降序：最新批次在上，旧的在下面
        return (b.batchNumber ?? "").localeCompare(a.batchNumber ?? "");
      });
    }
    return { batchMap, firstSignDateMap, latestBatchMap, totalInvestMap };
  }, [roleFilteredClients]);

  const getPersonBatches = (c: any) => {
    if (!c?.name || !c?.bdManager) return [];
    const key = `${String(c.name)}\u0001${String(c.bdManager)}`;
    return (personBatchIndex.batchMap.get(key) ?? []).map(({ batchId, batchNumber }) => ({ batchId, batchNumber }));
  };

  const getPersonFirstSignDate = (c: any): Date | null => {
    if (!c?.name || !c?.bdManager) return c.signDate ? new Date(c.signDate) : null;
    const key = `${String(c.name)}\u0001${String(c.bdManager)}`;
    return personBatchIndex.firstSignDateMap.get(key) ?? (c.signDate ? new Date(c.signDate) : null);
  };

  const getPersonLatestInvestment = (c: any): number => {
    if (!c?.name || !c?.bdManager) return Number(c?.investmentAmount ?? 0);
    const key = `${String(c.name)}\u0001${String(c.bdManager)}`;
    const latest = personBatchIndex.latestBatchMap.get(key);
    return latest ? latest.investmentAmount : Number(c?.investmentAmount ?? 0);
  };

  const getPersonTotalInvestment = (c: any): number => {
    if (!c?.name || !c?.bdManager) return Number(c?.investmentAmount ?? 0);
    const key = `${String(c.name)}\u0001${String(c.bdManager)}`;
    return personBatchIndex.totalInvestMap.get(key) ?? Number(c?.investmentAmount ?? 0);
  };

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
    if (role === APP_ROLES.ADMIN || role === APP_ROLES.RISK_MANAGER || role === APP_ROLES.OPERATIONS) return true;
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
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                try {
                  const all = allClients;
                  const rows: any[] = [];
                  const seenPerson = new Set<string>();
                  // 第一遍：按自然人去重聚合（同一姓名+经理 = 同一人），导出一行 = 一个自然人 + 累计投资 + 所有批次号（,拼接）
                  for (const c of all as any[]) {
                    const key = `${String(c.name ?? "")}\u0001${String(c.bdManager ?? "")}`;
                    if (!c.name || seenPerson.has(key)) continue;
                    seenPerson.add(key);
                    const batches = getPersonBatches(c).map(x => String(x.batchNumber ?? x.batchId ?? "")).join(", ");
                    const allRecordsForPerson = (all as any[]).filter(
                      (x: any) => String(x.name ?? "") === String(c.name ?? "") && String(x.bdManager ?? "") === String(c.bdManager ?? "")
                    );
                    const totalInvest = getPersonTotalInvestment(c);
                    const latestSignDate = allRecordsForPerson.reduce((max: Date | null, r: any) => {
                      const d = r.signDate ? new Date(r.signDate) : null;
                      if (!d) return max;
                      if (!max) return d;
                      return d.getTime() > max.getTime() ? d : max;
                    }, null);
                    const anyActive = allRecordsForPerson.some((r: any) => r.status === ClientStatus.ACTIVE);
                    const anyExitReq = allRecordsForPerson.some((r: any) => r.status === ClientStatus.EXIT_REQUESTED);
                    const statusLabel =
                      allRecordsForPerson.every((r: any) => r.status === ClientStatus.SETTLED)
                        ? "已结算 / 已退出"
                        : anyExitReq
                        ? "申请退出中"
                        : anyActive
                        ? "持仓中 / 签约有效"
                        : "混合状态";
                    rows.push({
                      "客户编号": String(c.clientNo ?? ""),
                      "客户姓名": c.name ?? "",
                      "客户ID尾号": String(c.id ?? "").slice(-6),
                      "商务经理": c.bdManager ?? "",
                      "参与批次（按签约时间升序，多个批次以逗号分隔）": batches,
                      "参与批次数目": getPersonBatches(c).length,
                      "累计投资总额（USD，多批次合计）": Number(Number(totalInvest).toFixed(2)),
                      "当前行所在批次投资金额（USD）": Number(Number(c.investmentAmount ?? 0).toFixed(2)),
                      "签约状态（客户维度聚合）": statusLabel,
                      "最近一次签约日期": latestSignDate ? formatDate(latestSignDate) : "",
                      "VIP客户标记": isVipClient(c) ? "是" : "否",
                    });
                  }
                  const sheet1 = XLSX.utils.json_to_sheet(rows, {
                    header: [
                      "客户编号", "客户姓名", "客户ID尾号", "商务经理", "参与批次（按签约时间升序，多个批次以逗号分隔）",
                      "参与批次数目", "累计投资总额（USD，多批次合计）", "当前行所在批次投资金额（USD）",
                      "签约状态（客户维度聚合）", "最近一次签约日期", "VIP客户标记"
                    ]
                  });
                  sheet1["!cols"] = [
                    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 60 }, { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 10 }
                  ];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, sheet1, "客户档案（按自然人去重）");
                  // Sheet 2：原始明细（不去重，每一条客户批次参与记录一行）
                  const detailRows = (all as any[]).map((c: any) => ({
                    "客户编号": String(c.clientNo ?? ""),
                    "客户姓名": c.name ?? "",
                    "客户ID": c.id ?? "",
                    "商务经理": c.bdManager ?? "",
                    "所属批次号": c.batchNumber ?? c.batchId ?? "",
                    "单批次投资金额（USD）": Number(Number(c.investmentAmount ?? 0).toFixed(2)),
                    "签约日期": c.signDate ? formatDate(c.signDate) : "",
                    "本批次分成-客户%": Number(Number(c.profitSplitClient ?? 0).toFixed(2)),
                    "本批次分成-机构%": Number(Number(c.profitSplitInstitution ?? 0).toFixed(2)),
                    "本批次签约状态":
                      c.status === ClientStatus.ACTIVE ? "持仓中" :
                      c.status === ClientStatus.EXIT_REQUESTED ? "申请退出中" :
                      c.status === ClientStatus.SETTLED ? "已结算" : String(c.status ?? ""),
                    "VIP客户标记": isVipClient(c) ? "是" : "否",
                  }));
                  const sheet2 = XLSX.utils.json_to_sheet(detailRows);
                  sheet2["!cols"] = [
                    { wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 24 }, { wch: 18 }, { wch: 20 }, { wch: 12 },
                    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }
                  ];
                  XLSX.utils.book_append_sheet(wb, sheet2, "客户批次参与明细（每批次一行）");
                  const fileName = `客户档案_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${new Date().toTimeString().slice(0,5).replace(":","")}.xlsx`;
                  XLSX.writeFile(wb, fileName);
                  toast.success(`客户表导出成功：${fileName}（共 ${rows.length} 位自然人 / ${detailRows.length} 条批次参与记录）`);
                } catch (err) {
                  console.error(err);
                  toast.error("导出失败，请重试。若问题持续请联系管理员。");
                }
              }}>
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
              {allowCreateBatch && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    const nextNum = String(batches.length + 1).padStart(3, "0");
                    const defaultYear = new Date().getUTCFullYear();
                    const today = new Date();
                    const signStr = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).toISOString().split("T")[0];
                    const maturityBase = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
                    maturityBase.setUTCFullYear(maturityBase.getUTCFullYear() + 2);
                    maturityBase.setUTCDate(maturityBase.getUTCDate() - 1);
                    const matStr = maturityBase.toISOString().split("T")[0];
                    const initialSymbol = (() => {
                      const remembered = readLastBatchSymbol();
                      if (remembered) return remembered;
                      return (typeof window !== "undefined" && getLiveQuoteSettings()?.symbol?.trim().toUpperCase()) || "";
                    })();
                    setCreateBatchForm({
                      signDate: signStr,
                      maturityDate: matStr,
                      batchNumber: `BATCH-${defaultYear}-${nextNum}`,
                      stockSymbol: initialSymbol,
                      currentStockPrice: "",
                    });
                    setCreateBatchErrors({});
                    setCreateBatchOpen(true);
                    setCreateBatchFetchingQuote(false);
                  }}
                >
                  <Layers className="h-3.5 w-3.5" />
                  创建批次
                </Button>
              )}
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
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Trophy className="h-4 w-4 text-warning" />
              商务经理业绩排行榜
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setBdRankingOpen(true)}>
              <Users className="h-3 w-3" />
              查看全部
            </Button>
          </div>
          <p className="text-[10.5px] text-muted-foreground mt-1">
            前三名头像右上角自动佩戴 🥇金 / 🥈银 / 🥉铜 皇冠徽章，点击「查看全部」浏览完整榜单及占比进度条。
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {(() => {
              const ranking = Object.entries(stats.bdStats).sort((a, b) => b[1].amount - a[1].amount);
              const medalColors = [
                "text-amber-500",
                "text-slate-300",
                "text-orange-600",
              ];
              const medalBg = [
                "bg-amber-500/15 border-amber-500/40 shadow-[inset_0_0_0_1px_hsl(var(--color-amber-500,.969)#f59e0b)/0.15]",
                "bg-slate-300/10 border-slate-300/40",
                "bg-orange-500/12 border-orange-500/40",
              ];
              const cardChroma = [
                "from-amber-500/20 via-transparent to-transparent",
                "from-slate-200/15 via-transparent to-transparent",
                "from-orange-500/20 via-transparent to-transparent",
              ];
              return ranking.map(([bd, s], idx) => {
                const top3 = idx < 3;
                return (
                  <div
                    key={bd}
                    className={cn(
                      "rounded-xl border p-4 hover:bg-secondary/50 transition-colors relative overflow-hidden",
                      top3
                        ? `${medalBg[idx]} hover:brightness-105`
                        : "border-border/50 bg-secondary/30"
                    )}
                  >
                    {top3 && <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-40", cardChroma[idx])} />}
                    <div className="relative flex items-center gap-3 mb-3">
                      <div className="relative shrink-0">
                        <ClientAvatar name={bd} size="md" />
                        {top3 && (
                          <span
                            className="absolute -top-2 -right-2 h-6 w-6 rounded-full border-2 border-background bg-background flex items-center justify-center shadow-md"
                            title={`排名第 ${idx + 1}`}
                          >
                            <Crown className={cn("h-3.5 w-3.5", medalColors[idx])} strokeWidth={2.25} />
                          </span>
                        )}
                        {!top3 && (
                          <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full border border-border/60 bg-background text-[9px] font-mono text-muted-foreground flex items-center justify-center shadow-sm">
                            {idx + 1}
                          </span>
                        )}
                      </div>
                      <div className="relative min-w-0 flex-1">
                        <Link href={`/bd/${encodeURIComponent(bd)}`} className="text-xs font-semibold hover:text-primary hover:underline block truncate">{bd}</Link>
                        <p className="text-[10px] text-muted-foreground">
                          {s.count} 位客户
                        </p>
                      </div>
                    </div>
                    <p className="relative font-mono font-bold text-sm text-gradient-primary">
                      {formatCurrency(s.amount)}
                    </p>
                  </div>
                );
              });
            })()}
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
                  placeholder="搜索：编号 / 姓名 / 商务经理 / 批次号..."
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
              <select
                className="h-9 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ClientStatus | "ALL")}
              >
                <option value="ALL">全部 签约状态</option>
                <option value={ClientStatus.ACTIVE}>持仓中 / 签约有效</option>
                <option value={ClientStatus.SETTLED}>已结算 / 已退出</option>
                <option value={ClientStatus.EXIT_REQUESTED}>申请退出中</option>
              </select>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 text-xs" onClick={() => setMoreFilterOpen(true)}>
                <Filter className="h-3.5 w-3.5" />
                更多筛选
                {batchFilter !== "ALL" && (
                  <Badge variant="primary" className="ml-1 text-[9px] px-1 py-0 h-4">
                    已筛选
                  </Badge>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border/50">
              <div className="col-span-2">客户</div>
              <div className="col-span-2">所属商务经理</div>
              <div className="col-span-2">批次号</div>
              <div className="col-span-2 text-right">投资金额（累计）</div>
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
                          <p className="text-[10px] text-muted-foreground font-mono truncate" title={c.clientNo}>
                            <span className="text-primary/90 font-semibold">{String(c.clientNo ?? "—")}</span>
                            {" · "}
                            {(() => {
                              const d = getPersonFirstSignDate(c);
                              return d ? formatDate(d) : "-";
                            })()}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <Link href={`/bd/${encodeURIComponent(c.bdManager)}`} className="text-xs hover:text-primary hover:underline inline-flex items-center text-left">
                        <span className="truncate">{c.bdManager}</span>
                      </Link>
                    </div>
                    <div className="col-span-2 min-w-0">
                      {(() => {
                        const personBatches = getPersonBatches(c);
                        const currentBatchId = String(c.batchId ?? c.batch?.id ?? "");
                        if (personBatches.length <= 1) {
                          const b = personBatches[0] ?? { batchId: currentBatchId, batchNumber: c.batchNumber };
                          return (
                            <Link
                              href={`/batch/${b.batchId || currentBatchId}`}
                              className="group/batch inline-flex items-baseline gap-1 rounded-md hover:bg-primary/10 px-1.5 py-0.5 -mx-1.5 text-left"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="font-mono text-[11px] font-semibold tabular-nums text-primary/90 group-hover/batch:text-primary group-hover/batch:underline underline-offset-2 decoration-dashed decoration-primary/50">
                                {b.batchNumber || c.batchNumber}
                              </p>
                            </Link>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-1 items-start -my-0.5 py-0.5" onClick={(e) => e.stopPropagation()}>
                            {personBatches.map((b) => {
                              return (
                                <Link
                                  key={b.batchId}
                                  href={`/batch/${b.batchId}`}
                                  className={
                                    "group/batch inline-flex items-baseline rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-primary/10 transition-colors "
                                  }
                                >
                                  <span
                                    className={
                                      "font-mono text-[11px] font-semibold tabular-nums underline-offset-2 decoration-dashed text-primary/90 group-hover/batch:text-primary group-hover/batch:underline decoration-primary/60"
                                    }
                                  >
                                    {b.batchNumber}
                                  </span>
                                </Link>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="col-span-2 text-right">
                      <p className="font-mono font-bold text-sm">
                        {formatCurrency(getPersonLatestInvestment(c))}
                      </p>
                      {isVipClient(c) && (
                        <Badge variant="primary" className="mt-0.5 text-[9px] px-1.5">
                          VIP
                        </Badge>
                      )}
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
                            setEditErrors({});
                            setEditForm({
                              name: String(c.name ?? ""),
                              investment: Number(c.investmentAmount || 0).toFixed(2),
                              bdManager: String(c.bdManager ?? bdManagerFullName ?? BD_OPTIONS_ADD[0]),
                              signDate: (c.signDate ? new Date(c.signDate) : new Date()).toISOString().split("T")[0],
                              status: (c.status as ClientStatus) || ClientStatus.ACTIVE,
                            });
                            setEditClientOpen({ id: c.id, batchId: c.batchId, clientNo: (c as any).clientNo });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                      )}
                      <RoleGate
                        allowed={[APP_ROLES.ADMIN]}
                        auditResource={`client:delete:${c.id}`}
                        auditAction="ui_component_denied"
                      >
                        {c.status !== ClientStatus.SETTLED && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-danger/10 hover:text-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteClientConfirm({ id: c.id, batchId: c.batchId, name: String(c.name ?? "") });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除
                          </Button>
                        )}
                      </RoleGate>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setClientDetail(c.id);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        详情
                      </Button>
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
                        <div className="flex flex-col items-start">
                          <span className="font-semibold leading-tight">{x.name}</span>
                          <span className="text-muted-foreground font-mono text-[10px] leading-tight">
                            {x.clientNo ? <span className="text-primary/90 font-semibold">{x.clientNo}</span> : null}
                            {x.clientNo ? " · " : null}
                            {x.batchNumber}
                          </span>
                        </div>
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
                  const signYear = new Date(addForm.signDate).getUTCFullYear();
                  const newClient: any = {
                    id: `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    clientNo: nextClientNo(mock.batches, signYear),
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
                    { clientNo: newClient.clientNo, name: newClient.name, amount: numAmt, batchNumber: batch.batchNumber },
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

      {/* ===== 编辑客户 Dialog ===== */}
      <Dialog
        open={!!editClientOpen}
        onOpenChange={(o) => {
          if (!o) setEditClientOpen(null);
        }}
      >
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-4 border-b border-border/50">
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl gradient-primary flex items-center justify-center shrink-0 shadow-md shadow-primary/30">
                <Pencil className="h-4.5 w-4.5 text-primary-foreground" />
              </div>
              <div>
                <p className="font-bold flex items-center gap-2">
                  编辑客户信息
                  {editClientOpen?.clientNo ? (
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 h-4 border-primary/30 text-primary/90 bg-primary/5">
                      {String(editClientOpen.clientNo)}
                    </Badge>
                  ) : null}
                </p>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  允许修改姓名 / 本金 / 商务经理 / 签约日期 / 状态；已结算客户不能再修改
                </DialogDescription>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="rounded-lg border border-border/50 bg-card/40 p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px]">客户姓名 *</Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="例：张伟 / Jennifer Zhang"
                    className={cn(editErrors.name && "border-danger ring-danger/20")}
                  />
                  {editErrors.name && <p className="text-[10px] text-danger font-mono">{editErrors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">投资本金（USD）*</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-muted-foreground">$</span>
                    <Input
                      value={editForm.investment}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        const parts = v.split(".");
                        const cleaned = parts[0] + (parts.length > 1 ? "." + parts.slice(1).join("") : "");
                        setEditForm({ ...editForm, investment: cleaned });
                      }}
                      onBlur={() => {
                        const n = Number(editForm.investment.replace(/[^0-9.]/g, ""));
                        if (Number.isFinite(n)) {
                          setEditForm({ ...editForm, investment: n.toFixed(2) });
                        }
                      }}
                      placeholder="500000.00"
                      className="pl-7 font-mono tabular-nums"
                    />
                  </div>
                  {editErrors.investment && <p className="text-[10px] text-danger font-mono">{editErrors.investment}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">商务经理*</Label>
                  <Select
                    value={editForm.bdManager || ""}
                    onValueChange={(v) => setEditForm({ ...editForm, bdManager: v })}
                    disabled={!!bdManagerFullName}
                  >
                    <SelectTrigger className={cn(editErrors.bdManager && "border-danger ring-danger/20")}>
                      <SelectValue placeholder="选择 商务经理" />
                    </SelectTrigger>
                    <SelectContent>
                      {BD_OPTIONS_ADD.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editErrors.bdManager && <p className="text-[10px] text-danger font-mono">{editErrors.bdManager}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">签约状态</Label>
                  <Select
                    value={editForm.status || ClientStatus.ACTIVE}
                    onValueChange={(v) => setEditForm({ ...editForm, status: v as ClientStatus })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择签约状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ClientStatus.ACTIVE}>持仓中 / 签约有效</SelectItem>
                      <SelectItem value={ClientStatus.EXIT_REQUESTED}>申请退出中</SelectItem>
                      <SelectItem value={ClientStatus.SETTLED}>已结算 / 已退出</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-[11px]">签约日期</Label>
                  <Input
                    type="date"
                    value={editForm.signDate}
                    onChange={(e) => setEditForm({ ...editForm, signDate: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="p-3 border-t border-border/50 flex-row justify-between gap-2">
            <div />
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditClientOpen(null)}
                className="text-[11px]"
              >
                取消
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-[11px]"
                onClick={async () => {
                  const errs: Record<string, string> = {};
                  if (!editForm.name.trim() || editForm.name.trim().length < 2) errs.name = "至少 2 个字符";
                  const numAmt = Number(editForm.investment.replace(/[^0-9.]/g, ""));
                  if (!Number.isFinite(numAmt) || numAmt <= 100) errs.investment = "最低 $100";
                  if (!editForm.bdManager) errs.bdManager = "请选择 商务经理";
                  setEditErrors(errs);
                  if (Object.keys(errs).length > 0 || !editClientOpen) return;
                  const mock = getMockData();
                  const batch = mock.batches.find((x) => x.id === editClientOpen.batchId);
                  if (!batch) return;
                  try {
                    commitBatchFinance(batch, (draft) =>
                      updateClientPosition(draft, editClientOpen.id, {
                        name: editForm.name.trim(),
                        investmentAmount: numAmt,
                        bdManager: editForm.bdManager,
                        signDate: new Date(editForm.signDate),
                        status: editForm.status,
                      } as any)
                    );
                  } catch (err) {
                    setEditErrors({ investment: err instanceof Error ? err.message : "修改客户失败" });
                    return;
                  }
                  window.dispatchEvent(
                    new CustomEvent("risk-control:client-status-changed")
                  );
                  setTick((t) => t + 1);
                  setEditClientOpen(null);
                  toast.success(`已修改客户：${editForm.name.trim()}`);
                }}
              >
                <SaveAll className="h-3.5 w-3.5" />
                保存修改
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 删除客户 确认 Dialog ===== */}
      <Dialog
        open={!!deleteClientConfirm}
        onOpenChange={(o) => {
          if (!o) setDeleteClientConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px] p-0">
          <DialogHeader className="p-4 pb-2 border-b border-border/50">
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-danger/15 flex items-center justify-center shrink-0">
                <AlertOctagon className="h-5 w-5 text-danger" />
              </div>
              <div>
                <p className="font-bold text-danger">确认删除客户？</p>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  该操作会把客户从批次中移除，并同步从账户优先池扣减对应本金。已结算客户不可删除。
                </DialogDescription>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-danger/40 bg-danger/5 p-3">
              <ClientAvatar name={deleteClientConfirm?.name ?? "客户"} size="sm" rounded="lg" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">{deleteClientConfirm?.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  客户 ID: {deleteClientConfirm?.id.slice(-8)}
                </p>
              </div>
              <Badge variant="danger" className="text-[9px] h-5">
                数据不可恢复
              </Badge>
            </div>
          </div>
          <DialogFooter className="p-3 border-t border-border/50 flex-row justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteClientConfirm(null)}
              className="text-[11px]"
            >
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="gap-1.5 text-[11px]"
              onClick={async () => {
                if (!deleteClientConfirm) return;
                const mock = getMockData();
                const batch = mock.batches.find((x) => x.id === deleteClientConfirm.batchId);
                if (!batch) return;
                try {
                  commitBatchFinance(batch, (draft) => removeClientPosition(draft, deleteClientConfirm.id));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "删除客户失败");
                  return;
                }
                window.dispatchEvent(
                  new CustomEvent("risk-control:client-status-changed")
                );
                setTick((t) => t + 1);
                toast.success(`已删除客户：${deleteClientConfirm.name}`);
                setDeleteClientConfirm(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 客户详情 Dialog（完整资料卡，按批次分组展示） ===== */}
      <Dialog open={!!clientDetail} onOpenChange={(o) => !o && setClientDetail(null)}>
        <DialogContent className="sm:max-w-[760px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
          {(() => {
            const clickedClient = allClients.find((c) => c.id === clientDetail) ?? null;
            if (!clickedClient) {
              return (
                <DialogHeader className="p-6">
                  <DialogTitle className="text-sm text-muted-foreground">客户不存在或已被删除</DialogTitle>
                </DialogHeader>
              );
            }
            // Step1：把客户所有参与的所有批次（同一个人可能跨 N 个批次，按客户名+商务经理匹配）都找出来
            // 当前数据模型中 client.id + batchId 绑定，所以按 (c.name + c.bdManager) 识别同一个自然人
            const samePersonClients = batches.flatMap((b) =>
              (b.clients || [])
                .filter(
                  (c) =>
                    c.name === clickedClient.name &&
                    c.bdManager === clickedClient.bdManager
                )
                .map((clientObj) => ({ clientObj, batch: b }))
            );
            // 去重：按 batchId 去重（同一批次同一客户不会多次）
            const seenBatches = new Set<string>();
            const participations = samePersonClients.filter(({ batch }) => {
              if (seenBatches.has(batch.id)) return false;
              seenBatches.add(batch.id);
              return true;
            });
            // 没有匹配到也至少保证当前 clicked 行 1 条显示（兜底）
            const finalParticipations = participations.length > 0
              ? participations
              : batches
                  .filter((b) => b.id === (clickedClient as any).batchId)
                  .map((b) => ({ clientObj: clickedClient, batch: b }));

            // Step2：总财务汇总（所有批次该客户投入/盈亏累加）
            let totalInvested = 0;
            let totalPnL = 0;
            const detailed = finalParticipations.map(({ clientObj, batch }) => {
              const clientLikeClient = clientObj as any;
              const metrics = getBatchMetrics(batch as any);
              const mv = metrics.currentMarketValue;
              const pnl = calculateBatchPnLSplit(batch as any, mv);
              const batchClientsTotalPriority = (batch.clients || []).reduce((s, c) => s + Number(c.investmentAmount || 0), 0);
              const clientWeight = batchClientsTotalPriority > 0 ? Number(clientObj.investmentAmount || 0) / batchClientsTotalPriority : 0;
              const batchPnL = pnl.clientTotalPnL * clientWeight;
              const pnlPct = Number(clientObj.investmentAmount || 0) > 0 ? (batchPnL / Number(clientObj.investmentAmount)) * 100 : 0;
              const split = getClientProfitSplit(clientObj as any);
              const settlement = (batch as any).finance?.settlements?.[clientObj.id] ?? null;
              const entryPrice = Number(clientLikeClient.entryStockPrice ?? 0);
              totalInvested += Number(clientObj.investmentAmount || 0);
              totalPnL += batchPnL;
              return {
                client: clientObj as any,
                batch: batch as any,
                metrics,
                split,
                clientWeight,
                batchPnL,
                pnlPct,
                settlement,
                entryPrice,
              };
            });
            const overallUp = totalPnL >= 0;
            const overallPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
            // 展示客户身份信息以点击行显示为准
            const client = clickedClient as any;
            const statusChip =
              client.status === ClientStatus.ACTIVE
                ? { t: "持仓中 / 签约有效", v: "success" as const, cls: "text-success" }
                : client.status === ClientStatus.EXIT_REQUESTED
                ? { t: "申请退出中", v: "warning" as const, cls: "text-warning" }
                : { t: "已结算 / 已退出", v: "secondary" as const, cls: "text-muted-foreground" };

            return (
              <>
                <DialogHeader className="p-5 pb-4 border-b border-border/50 bg-gradient-to-b from-primary/5 to-transparent">
                  <DialogTitle className="text-base flex items-center gap-3">
                    <div className="relative shrink-0 h-14 w-14 rounded-xl overflow-hidden border border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)_inset] bg-card">
                      <ClientAvatar name={client.name} size="lg" rounded="xl" className="!h-full !w-full" />
                      {isVipClient(client) && (
                        <Badge variant="primary" className="absolute -bottom-1 -right-1 text-[9px] h-4 px-1 shadow-md">
                          VIP
                        </Badge>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-lg truncate">{client.name}</p>
                        <Badge variant={statusChip.v} className="text-[10px] h-5">
                          {statusChip.t}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        客户 ID：{client.id.slice(-10)} &nbsp;·&nbsp; 签约时间：{formatDate(client.signDate)} &nbsp;·&nbsp; 共 {detailed.length} 个批次
                      </p>
                    </div>
                  </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* ===== 总览：全局财务摘要（所有批次合并）===== */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border/60 bg-card p-3.5 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                        <Wallet className="h-3.5 w-3.5" /> 累计投资本金（全部批次合计）
                      </div>
                      <p className="text-2xl font-bold font-mono tabular-nums">{formatCurrency(totalInvested)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        已参与批次：{detailed.length} 个 &nbsp;·&nbsp; 覆盖商务经理：1
                      </p>
                    </div>
                    <div className={cn("rounded-xl border p-3.5 space-y-1.5", overallUp ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5")}>
                      <div className={cn("flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold", overallUp ? "text-success" : "text-danger")}>
                        <Activity className="h-3.5 w-3.5" /> 累计浮动盈亏（全部批次合计）
                      </div>
                      <p className={cn("text-2xl font-bold font-mono tabular-nums", overallUp ? "text-success" : "text-danger")}>
                        {overallUp ? "+" : "-"}{formatCurrency(Math.abs(totalPnL))}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        相对本金综合收益率：
                        <span className={cn("font-bold font-mono ml-1", overallUp ? "text-success" : "text-danger")}>
                          {overallUp ? "+" : ""}{overallPct.toFixed(2)}%
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* ===== 全局基础信息（不随批次变化）客户资料 + 客户经理 ===== */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2.5">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                        <Contact2 className="h-3.5 w-3.5" /> 客户资料卡（基础信息，与批次无关）
                      </div>
                      <ul className="space-y-1.5 text-xs">
                        <li className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-none">
                          <span className="text-muted-foreground flex items-center gap-1.5"><UserPlusIcon className="h-3 w-3" /> 客户姓名</span>
                          <span className="font-semibold truncate">{client.name}</span>
                        </li>
                        <li className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-none">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Calendar className="h-3 w-3" /> 签约日期</span>
                          <span className="font-mono tabular-nums">{formatDate(client.signDate)}</span>
                        </li>
                        <li className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-none">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Briefcase className="h-3 w-3" /> 进入价格（首个批次）</span>
                          <span className="font-mono tabular-nums">${Number(detailed[0]?.entryPrice ?? client.entryStockPrice ?? 0).toFixed(4)}</span>
                        </li>
                        <li className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-none">
                          <span className="text-muted-foreground flex items-center gap-1.5"><ScrollText className="h-3 w-3" /> 合同编号</span>
                          <span className="font-mono tabular-nums">{client.contractNo || `HT-${client.id.slice(-8)}`}</span>
                        </li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2.5">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                        <Handshake className="h-3.5 w-3.5" /> 商务经理分配（所有批次同一客户经理）
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground text-xs">负责客户经理</span>
                        <Link
                          href={`/bd/${encodeURIComponent(client.bdManager)}`}
                          className="font-semibold text-xs hover:text-primary hover:underline truncate max-w-[60%]"
                        >
                          {client.bdManager} <ArrowRight className="inline h-3 w-3 ml-1 -translate-y-px opacity-60" />
                        </Link>
                      </div>
                      <div className="pt-2 mt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                        注：分成协议按批次独立约定（因不同批次签约条款可能不同），具体分成请查阅下方批次详情。
                      </div>
                    </div>
                  </div>

                  {/* ===== 按批次展示：每个参与的批次一个独立卡片（N 条，分成协议/浮动盈亏/投入/结算 都在这里）===== */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                        <Layers className="h-3.5 w-3.5" /> 分批次参与明细（共 {detailed.length} 条）
                      </div>
                    </div>
                    {detailed.map((d, idx) => {
                      const batchUp = d.batchPnL >= 0;
                      return (
                        <div key={`${d.batch.id}-${d.client.id}-${idx}`} className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
                          {/* 顶部条：批次号 + 风险状态 + 跌幅 + 跳转Link */}
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                href={`/batch/${d.batch.id}`}
                                className="inline-flex items-center gap-1.5 rounded-lg hover:bg-primary/10 px-2 py-1 -mx-2"
                              >
                                <p className="font-mono text-xs font-bold tabular-nums text-primary/90 hover:text-primary hover:underline decoration-dashed underline-offset-2">
                                  {d.batch.batchNumber}
                                </p>
                                <ArrowRight className="h-3 w-3 text-primary/70" />
                              </Link>
                              <Badge
                                variant={
                                  d.metrics.riskLevel === "CRITICAL"
                                    ? "danger"
                                    : d.metrics.riskLevel === "WARNING"
                                    ? "warning"
                                    : d.metrics.totalPnLPercent > 0.01
                                    ? "success"
                                    : "primary"
                                }
                                className="text-[10px] h-5"
                              >
                                {d.metrics.riskLevel === "CRITICAL"
                                  ? "击穿补仓线"
                                  : d.metrics.riskLevel === "WARNING"
                                  ? "接近预警线"
                                  : d.metrics.totalPnLPercent > 0.01
                                  ? "盈利中"
                                  : "正常持仓"}
                              </Badge>
                              <span className={cn(
                                "font-mono font-bold text-[11px]",
                                d.metrics.dropPercent <= -20
                                  ? "text-danger"
                                  : d.metrics.dropPercent <= -15
                                  ? "text-warning"
                                  : d.metrics.dropPercent >= 0
                                  ? "text-success"
                                  : "text-foreground"
                              )}>
                                批次整体 {d.metrics.dropPercent > 0 ? "+" : ""}{d.metrics.dropPercent.toFixed(2)}%
                              </span>
                            </div>
                          </div>

                          {/* 第一行：投入 + 浮动盈亏（本批次）+ 分成协议 */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div className="rounded-lg border border-border/50 bg-background/50 p-2.5 space-y-1">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">本批次投入本金</p>
                              <p className="font-mono font-bold text-lg tabular-nums">{formatCurrency(d.client.investmentAmount)}</p>
                              <p className="text-[10px] text-muted-foreground">占该批次客户本金 {d.clientWeight > 0 ? (d.clientWeight * 100).toFixed(2) : "0.00"}%</p>
                            </div>
                            <div className={cn("rounded-lg border p-2.5 space-y-1", batchUp ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5")}>
                              <p className={cn("text-[10px] uppercase tracking-widest font-bold", batchUp ? "text-success" : "text-danger")}>本批次浮动盈亏</p>
                              <p className={cn("font-mono font-bold text-lg tabular-nums", batchUp ? "text-success" : "text-danger")}>
                                {batchUp ? "+" : "-"}{formatCurrency(Math.abs(d.batchPnL))}
                              </p>
                              <p className="text-[10px] text-muted-foreground">相对本金收益率：
                                <span className={cn("font-bold font-mono ml-0.5", batchUp ? "text-success" : "text-danger")}>
                                  {batchUp ? "+" : ""}{d.pnlPct.toFixed(2)}%
                                </span>
                              </p>
                            </div>
                            <div className="rounded-lg border border-border/50 bg-background/50 p-2.5 space-y-1">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">本批次分成协议</p>
                              <Badge variant="outline" className="text-[10px] font-mono h-5">
                                客户 {Number((d.split.client * 100).toFixed(2))}% / 机构 {Number((d.split.institution * 100).toFixed(2))}%
                              </Badge>
                              <p className="text-[10px] text-muted-foreground pt-1">
                                当前市值（含盈亏）：<span className="font-mono font-bold text-foreground ml-0.5">{formatCurrency(Number(d.client.investmentAmount || 0) + d.batchPnL)}</span>
                              </p>
                            </div>
                          </div>

                          {/* 结算档案：若该客户该批次已结算 显示 */}
                          {d.settlement && (
                            <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-2">
                              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-success font-bold">
                                <CheckCircle2 className="h-3.5 w-3.5" /> 本批次已完成结算档案
                              </div>
                              <ul className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
                                <li className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">结算时间</span>
                                  <span className="font-mono tabular-nums">{formatDate(new Date(d.settlement.settledAt))}</span>
                                </li>
                                <li className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">结算市值</span>
                                  <span className="font-mono tabular-nums">{formatCurrency(Number(d.settlement.settledMarketValue ?? 0))}</span>
                                </li>
                                <li className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">客户结算收益</span>
                                  <span className={cn("font-mono font-bold", Number(d.settlement.settledClientPnL ?? 0) >= 0 ? "text-success" : "text-danger")}>
                                    {Number(d.settlement.settledClientPnL ?? 0) >= 0 ? "+" : "-"}
                                    {formatCurrency(Math.abs(Number(d.settlement.settledClientPnL ?? 0)))}
                                  </span>
                                </li>
                                <li className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">结算股份数量</span>
                                  <span className="font-mono tabular-nums">{Number(d.settlement.settledShares ?? 0).toFixed(4)} 股</span>
                                </li>
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ===== 更多筛选 Dialog：把「按批次筛选」移到这里，下拉 Select 形式 ===== */}
      <Dialog open={moreFilterOpen} onOpenChange={setMoreFilterOpen}>
        <DialogContent className="sm:max-w-[520px] p-0">
          <DialogHeader className="p-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              更多筛选
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground mt-1">
              批次筛选已移入这里（之前的顶部胶囊批次 Tab 已合并到此）。筛选结果会实时应用到客户总表。
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">按批次筛选（所有客户所在批次）</Label>
              <Select value={batchFilter} onValueChange={(v) => setBatchFilter(v)}>
                <SelectTrigger className="h-10 text-xs">
                  <SelectValue placeholder="选择一个批次，或保留「全部批次」" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">
                    <span className="inline-flex items-center gap-2">
                      <Layers className="h-3 w-3 text-muted-foreground" />
                      全部批次（共 {roleFilteredClients.length} 条记录）
                    </span>
                  </SelectItem>
                  {batchTabs.map((bt) => {
                    const dotClass =
                      bt.riskLevel === "CRITICAL"
                        ? "bg-danger"
                        : bt.riskLevel === "WARNING"
                        ? "bg-warning"
                        : "bg-success";
                    return (
                      <SelectItem key={bt.batchId} value={bt.batchId} className="text-xs">
                        <div className="inline-flex items-center gap-2 w-full">
                          <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} />
                          <span className="font-mono tabular-nums">{bt.batchNumber}</span>
                          <span className="text-muted-foreground ml-auto text-[10px] font-mono">
                            {bt.clientCount} 位客户
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-[11px] text-muted-foreground space-y-1">
              <p>
                <span className="font-semibold text-foreground">当前生效筛选：</span>
                商务经理 = <span className="font-mono">{bdFilter === "ALL" ? "全部" : bdFilter}</span>
                {" · "}签约状态 = <span className="font-mono">{statusFilter === "ALL" ? "全部" : statusFilter}</span>
                {" · "}批次 = <span className="font-mono">{batchFilter === "ALL" ? "全部批次" : (batchTabs.find(b=>b.batchId===batchFilter)?.batchNumber ?? batchFilter)}</span>
              </p>
              <p>
                搜索词：<span className="font-mono">{search.trim() ? search : "无"}</span>
                {" · "}匹配结果 = <span className="font-mono text-primary">{allClients.length}</span> 条
              </p>
            </div>
          </div>
          <DialogFooter className="p-3 pt-2 border-t border-border/50 flex-row justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8"
              onClick={() => {
                setBdFilter("ALL");
                setStatusFilter("ALL");
                setBatchFilter("ALL");
                setSearch("");
                toast.success("已重置所有筛选条件。");
              }}
            >
              重置所有筛选
            </Button>
            <div className="flex items-center gap-2">
              <DialogClose asChild>
                <Button variant="outline" size="sm" className="text-xs h-8">取消</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button size="sm" className="text-xs h-8">应用筛选</Button>
              </DialogClose>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 商务经理业绩排行榜 · 全量 Dialog ===== */}
      <Dialog open={bdRankingOpen} onOpenChange={setBdRankingOpen}>
        <DialogContent className="sm:max-w-[760px] max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 pb-3 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-warning" />
              商务经理业绩排行榜（全量）
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground mt-1">
              按管辖客户的累计投资总额排序，含所有批次合计。前三名分别对应 🥇 🥈 🥉 徽章。
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto scrollbar-thin p-4 space-y-3">
            {(() => {
              const ranking = Object.entries(stats.bdStats).sort((a, b) => b[1].amount - a[1].amount);
              const totalAmt = ranking.reduce((s, [, v]) => s + (v.amount || 0), 0);
              return ranking.map(([bd, v], idx) => {
                const medalColors = [
                  "text-amber-500",    // 金
                  "text-slate-300",    // 银
                  "text-orange-600",   // 铜
                ];
                const medalBg = [
                  "bg-amber-500/10 border-amber-500/30",
                  "bg-slate-300/10 border-slate-300/30",
                  "bg-orange-500/10 border-orange-500/30",
                ];
                const medalLabel = ["🥇 第 1 名", "🥈 第 2 名", "🥉 第 3 名"];
                const pct = totalAmt > 0 ? (v.amount / totalAmt) * 100 : 0;
                return (
                  <div
                    key={bd}
                    className={cn(
                      "rounded-xl border p-3.5 flex items-center gap-3 transition-colors",
                      idx < 3
                        ? `${medalBg[idx]} hover:brightness-105`
                        : "border-border/50 bg-secondary/20 hover:bg-secondary/35"
                    )}
                  >
                    <div className="relative shrink-0">
                      <ClientAvatar name={bd} size="md" />
                      {idx < 3 && (
                        <span
                          className={cn(
                            "absolute -top-2 -right-2 h-6 w-6 rounded-full border flex items-center justify-center shadow-md",
                            medalBg[idx],
                            "bg-background"
                          )}
                          title={medalLabel[idx]}
                        >
                          <Crown className={cn("h-3.5 w-3.5", medalColors[idx])} fill={
                            idx===0 ? "hsl(var(--color-amber-500) or #f59e0b)" : undefined
                          } strokeWidth={2} />
                        </span>
                      )}
                      {idx >= 3 && (
                        <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full border border-border/60 bg-background text-[9px] font-mono text-muted-foreground flex items-center justify-center shadow">
                          {idx + 1}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-2">
                          <Link href={`/bd/${encodeURIComponent(bd)}`} className="text-sm font-semibold hover:text-primary hover:underline truncate">
                            {bd}
                          </Link>
                          {idx < 3 && (
                            <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5 border", medalBg[idx], medalColors[idx])}>
                              {medalLabel[idx]}
                            </Badge>
                          )}
                        </div>
                        <span className="font-mono font-bold text-sm text-gradient-primary shrink-0">
                          {formatCurrency(v.amount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-[10.5px] text-muted-foreground">
                        <span>管理客户 <span className="text-foreground font-mono font-semibold">{v.count}</span> 位</span>
                        <span>占全公司投资总额 <span className="font-mono text-foreground font-semibold">{Number(pct.toFixed(2))}%</span></span>
                      </div>
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            idx === 0 ? "bg-gradient-to-r from-amber-400 to-amber-500"
                            : idx === 1 ? "bg-gradient-to-r from-slate-300 to-slate-400"
                            : idx === 2 ? "bg-gradient-to-r from-orange-400 to-orange-500"
                            : "bg-primary/70"
                          )}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== 创建批次 Dialog ===== */}
      <Dialog open={createBatchOpen} onOpenChange={setCreateBatchOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] flex flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="p-5 pb-4 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              创建批次
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground mt-1">
              填写批次基础信息，保存后将立即写入资金账本并刷新所有批次列表；空批次无客户，可后续在「批量新增客户」中分配。
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto scrollbar-thin p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cb-batchNumber" className="text-xs font-medium">
                  批次号 <span className="text-danger">*</span>
                </Label>
                <Input
                  id="cb-batchNumber"
                  className="font-mono text-sm"
                  value={createBatchForm.batchNumber}
                  onChange={(e) => setCreateBatchForm({ ...createBatchForm, batchNumber: e.target.value })}
                />
                {createBatchErrors.batchNumber && (
                  <p className="text-[10.5px] text-danger">{createBatchErrors.batchNumber}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cb-status" className="text-xs font-medium">
                  初始状态
                </Label>
                <div className="h-9 px-3 text-xs text-muted-foreground inline-flex items-center rounded-md border border-border/60 bg-secondary/20 font-mono w-full">
                  根据签约日期自动判定（军管期 / 开放交易 / 已到期）
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cb-signDate" className="text-xs font-medium">
                  签约日期 <span className="text-danger">*</span>
                </Label>
                <Input
                  id="cb-signDate"
                  type="date"
                  className="text-sm"
                  value={createBatchForm.signDate}
                  onChange={(e) => {
                    const sign = e.target.value;
                    let mat = createBatchForm.maturityDate;
                    if (sign) {
                      const parts = sign.split("-").map((x) => Number(x));
                      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
                        const base = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                        base.setUTCFullYear(base.getUTCFullYear() + 2);
                        base.setUTCDate(base.getUTCDate() - 1);
                        mat = base.toISOString().split("T")[0];
                      }
                    }
                    setCreateBatchForm({ ...createBatchForm, signDate: sign, maturityDate: mat });
                  }}
                />
                {createBatchErrors.signDate && (
                  <p className="text-[10.5px] text-danger">{createBatchErrors.signDate}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cb-maturityDate" className="text-xs font-medium">
                  到期日期 <span className="text-danger">*</span>
                </Label>
                <Input
                  id="cb-maturityDate"
                  type="date"
                  className="text-sm"
                  value={createBatchForm.maturityDate}
                  onChange={(e) => setCreateBatchForm({ ...createBatchForm, maturityDate: e.target.value })}
                />
                {createBatchErrors.maturityDate && (
                  <p className="text-[10.5px] text-danger">{createBatchErrors.maturityDate}</p>
                )}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cb-symbol" className="text-xs font-medium">
                  股票代码
                </Label>
                <div className="flex items-stretch gap-2">
                  <Input
                    id="cb-symbol"
                    className="font-mono text-sm flex-1"
                    value={createBatchForm.stockSymbol}
                    onChange={(e) => {
                      const sym = String(e.target.value || "").trim().toUpperCase();
                      setCreateBatchForm({ ...createBatchForm, stockSymbol: sym });
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-10 w-11"
                    disabled={createBatchFetchingQuote || !String(createBatchForm.stockSymbol || "").trim()}
                    onClick={async () => {
                      const sym = String(createBatchForm.stockSymbol || "").trim().toUpperCase();
                      if (!sym) {
                        toast.error("请先填写股票代码再抓取报价。");
                        return;
                      }
                      setCreateBatchFetchingQuote(true);
                      try {
                        const q = await fetchQuoteBrowser(sym);
                        const p = Number(q?.price);
                        if (Number.isFinite(p) && p > 0) {
                          setCreateBatchForm((prev) => prev.stockSymbol === sym ? { ...prev, currentStockPrice: Number(p).toFixed(2) } : prev);
                          const label =
                            q?.source === "CACHE" ? "缓存报价" :
                            q?.source === "LIVE" ? "实时报价" : "离线兜底报价";
                          toast.success(`${label}：${sym} = $${Number(p).toFixed(2)}${q?.provider ? ` (${q.provider})` : ""}`);
                        } else {
                          toast.error(`抓取失败：${sym} 未返回有效价格，请手动输入。`);
                        }
                      } catch (err) {
                        toast.error(`抓取 ${sym} 报价失败，请重试或手动输入。`);
                      } finally {
                        setCreateBatchFetchingQuote(false);
                      }
                    }}
                    title="抓取最新股价"
                  >
                    <RefreshCw className={`h-4 w-4 ${createBatchFetchingQuote ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cb-mv" className="text-xs font-medium">
                  建仓价格 (USD)
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    点击右侧「抓取」按钮获取当日股价，也可直接手动修改
                  </span>
                  {createBatchFetchingQuote && (
                    <span className="ml-2 text-[10px] text-primary/80">正在获取真实报价…</span>
                  )}
                </Label>
                <Input
                  id="cb-mv"
                  type="number"
                  step="0.0001"
                  placeholder="例如：8.87，点击右侧按钮抓取，或直接手动输入"
                  className="font-mono text-sm"
                  value={createBatchForm.currentStockPrice}
                  onChange={(e) => setCreateBatchForm({ ...createBatchForm, currentStockPrice: e.target.value })}
                />
                {createBatchErrors.currentStockPrice && (
                  <p className="text-[10.5px] text-danger">{createBatchErrors.currentStockPrice}</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border/50 bg-secondary/15 p-3 space-y-1.5">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <Info className="h-3.5 w-3.5 inline mr-1 -mt-0.5 text-primary" />
                <b>计算预览：</b>
                {(() => {
                  const basePrice = Number(createBatchForm.currentStockPrice);
                  const valid = Number.isFinite(basePrice) && basePrice > 0;
                  return (
                    <span className="block mt-1 font-mono text-[11.5px] text-foreground/80">
                      建仓价格 ≈ <b>{valid ? formatCurrency(basePrice) : "—"}</b>，
                      客户归属批次后自动汇总本金
                    </span>
                  );
                })()}
              </p>
            </div>
          </div>
          <DialogFooter className="p-4 pt-3 border-t border-border/50 shrink-0 flex items-center justify-between gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                取消
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const errors: Record<string, string> = {};
                const bn = String(createBatchForm.batchNumber || "").trim();
                if (!bn) errors.batchNumber = "请填写批次号";
                else if (batches.some((b) => String(b.batchNumber || "") === bn)) errors.batchNumber = "批次号已存在，请换一个";
                if (!createBatchForm.signDate) errors.signDate = "必填";
                if (!createBatchForm.maturityDate) errors.maturityDate = "必填";
                const sd = createBatchForm.signDate ? new Date(createBatchForm.signDate) : null;
                const md = createBatchForm.maturityDate ? new Date(createBatchForm.maturityDate) : null;
                if (sd && md && sd.getTime() >= md.getTime()) errors.maturityDate = "到期日期必须晚于签约日期";
                const basePrice = Number(createBatchForm.currentStockPrice);
                if (!Number.isFinite(basePrice) || basePrice <= 0) errors.currentStockPrice = "请填/等待系统抓取建仓价格";
                setCreateBatchErrors(errors);
                if (Object.keys(errors).length > 0) {
                  toast.error("请检查表单字段后重试");
                  return;
                }
                try {
                  const effectiveSymbol = (
                    createBatchForm.stockSymbol ||
                    (typeof window !== "undefined" ? getLiveQuoteSettings()?.symbol ?? "" : "")
                  )
                    .trim()
                    .toUpperCase();
                  const created = createNewBatch({
                    batchNumber: bn,
                    signDate: sd!,
                    maturityDate: md!,
                    stockSymbol: effectiveSymbol,
                    currentStockPrice: basePrice,
                  });
                  rememberLastBatchSymbol(effectiveSymbol);
                  setMockTick((t) => t + 1);
                  setCreateBatchOpen(false);
                  toast.success(`批次 ${created.batchNumber} 创建成功，当前 0 位客户，可在「批量新增客户」中分配归属批次`);
                } catch (e) {
                  console.error(e);
                  toast.error("创建失败：" + (e instanceof Error ? e.message : "未知错误"));
                }
              }}
            >
              <Layers className="h-3.5 w-3.5" />
              保存并创建批次
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
