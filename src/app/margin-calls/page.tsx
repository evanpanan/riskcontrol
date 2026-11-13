"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { getMockData } from "@/lib/mockData";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import {
  History,
  Search,
  Download,
  CheckCircle,
  Clock,
  XCircle,
  FileText,
  Building2,
  AlertCircle,
  AlertTriangle,
  Filter,
} from "lucide-react";
import { Suspense, useState, useMemo, useEffect } from "react";
import { MarginCallStatus } from "@prisma/client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { calcPenalty } from "@/lib/win100Ledger";
import * as XLSX from "@/lib/excelExport";
import {
  type BatchLike,
} from "@/lib/riskEngine";

export default function MarginCallsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">正在加载补仓历史…</p>}>
      <MarginCallsContent />
    </Suspense>
  );
}

function MarginCallsContent() {
  const requestedStatus = useSearchParams().get("status");
  return <MarginCallsList key={requestedStatus} initialStatus={requestedStatus === "PENDING" ? "PENDING" : "ALL"} />;
}

function MarginCallsList({ initialStatus }: { initialStatus: "ALL" | MarginCallStatus }) {
  const mockData = getMockData();
  const [tick, setTick] = useState(0);
  const batches = useMemo(() => [...mockData.batches], [mockData, tick]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | MarginCallStatus>(initialStatus);
  const [docTarget, setDocTarget] = useState<any | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advFrom, setAdvFrom] = useState("");
  const [advTo, setAdvTo] = useState("");
  const [advBatch, setAdvBatch] = useState("");

  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("risk-control:client-single-margin", handler);
    window.addEventListener("risk-control:margin-fulfilled", handler);
    window.addEventListener("risk-control:finance-changed", handler);
    window.addEventListener("risk-control:quote-changed", handler);
    window.addEventListener("risk-control:client-status-changed", handler);
    const onStorage = () => setTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(handler, 5000);
    return () => {
      window.removeEventListener("risk-control:client-single-margin", handler);
      window.removeEventListener("risk-control:margin-fulfilled", handler);
      window.removeEventListener("risk-control:finance-changed", handler);
      window.removeEventListener("risk-control:quote-changed", handler);
      window.removeEventListener("risk-control:client-status-changed", handler);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, []);

  const allCalls = useMemo(() => {
    const list: any[] = [];
    batches.forEach((b: any) => {
      const rounds = new Map<string, NonNullable<BatchLike["finance"]>["rounds"][number]>(
        ((b as BatchLike).finance?.rounds ?? []).map((round) => [round.id, round]),
      );
      b.marginCalls?.forEach((mc: any, index: number) => {
        const round = rounds.get(mc.id);
        list.push({
          ...mc,
          roundNumber: round?.number ?? index + 1,
          ...calcPenalty(round ?? mc),
          batchNumber: b.batchNumber,
          batchId: b.id,
          symbol: b.stockSymbol,
          stockName: b.stockName,
        });
      });
    });

    const enriched = list.map((call) => ({
      ...call,
      fulfillmentPct: call.requiredAmount > 0
        ? Math.min(100, (call.fulfilledAmount ?? 0) / call.requiredAmount * 100)
        : 0,
    }));

    let result = enriched;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.batchNumber.toLowerCase().includes(q) ||
          c.symbol.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "ALL") {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (advBatch.trim()) {
      const q = advBatch.toLowerCase().trim();
      result = result.filter((c) => c.batchNumber.toLowerCase().includes(q));
    }
    if (advFrom) {
      const from = new Date(`${advFrom}T00:00:00`).getTime();
      result = result.filter((c) => new Date(c.triggerDate).getTime() >= from);
    }
    if (advTo) {
      const to = new Date(`${advTo}T23:59:59`).getTime();
      result = result.filter((c) => new Date(c.triggerDate).getTime() <= to);
    }
    return result.sort(
      (a, b) => new Date(b.triggerDate).getTime() - new Date(a.triggerDate).getTime()
    );
  }, [batches, search, statusFilter, advBatch, advFrom, advTo]);

  useEffect(() => {
    const focusCall = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#margin-call-")) return;
      try {
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "center" });
      } catch {
        // Ignore malformed hashes.
      }
    };
    focusCall();
    window.addEventListener("hashchange", focusCall);
    return () => window.removeEventListener("hashchange", focusCall);
  }, [allCalls.length]);

  const stats = useMemo(() => {
    let pending = 0,
      fulfilled = 0,
      expired = 0,
      totalRequired = 0,
      totalFulfilled = 0;
    batches.forEach((b: any) => {
      b.marginCalls?.forEach((mc: any) => {
        totalRequired += mc.requiredAmount;
        totalFulfilled += mc.fulfilledAmount || 0;
        if (mc.status === "PENDING") pending++;
        else if (mc.status === "FULLFILLED") fulfilled++;
        else expired++;
      });
    });
    return { pending, fulfilled, expired, totalRequired, totalFulfilled };
  }, [batches]);

  const getStatusConfig = (s: MarginCallStatus) => {
    switch (s) {
      case "PENDING":
        return {
          variant: "danger" as const,
          label: "待处理",
          Icon: Clock,
          color: "text-danger",
        };
      case "FULLFILLED":
        return {
          variant: "success" as const,
          label: "已完成",
          Icon: CheckCircle,
          color: "text-success",
        };
      case "EXPIRED":
        return {
          variant: "secondary" as const,
          label: "已过期",
          Icon: XCircle,
          color: "text-muted-foreground",
        };
      case "OVERDUE":
        return {
          variant: "danger" as const,
          label: "T+2 逾期",
          Icon: AlertTriangle,
          color: "text-danger",
        };
      default:
        return {
          variant: "secondary" as const,
          label: "未知",
          Icon: AlertCircle,
          color: "text-muted-foreground",
        };
    }
  };

  const buildDocRows = (mc: any): [string, string][] => [
    ["单据编号", String(mc.id ?? "").slice(-8).toUpperCase()],
    ["批次号", mc.batchNumber ?? ""],
    ["轮次", String(mc.roundNumber)],
    ["股票", `${mc.symbol ?? ""}${mc.stockName ? ` · ${mc.stockName}` : ""}`],
    ["触发时间", mc.triggerDate ? formatDate(mc.triggerDate) : ""],
    ["到期时间（T+2）", mc.dueDate ? formatDate(mc.dueDate) : "—"],
    ["触发时仓位价值", formatCurrency(mc.triggerMarketValue ?? 0)],
    ["触发跌幅", `-${(Number(mc.dropPercent ?? 0) * 100).toFixed(2)}%`],
    ["应补金额", formatCurrency(mc.requiredAmount ?? 0)],
    ["已到账金额", formatCurrency(mc.fulfilledAmount ?? 0)],
    ["完成进度", `${Number(mc.fulfillmentPct ?? 0).toFixed(1)}%`],
    ["补仓形式", mc.collateralType ? (mc.collateralType === "cash" ? "现金" : "股票") : "—"],
    ["当前状态", getStatusConfig(mc.status).label],
    ["逾期天数", String(mc.overdueDays)],
    ["罚息", formatCurrency(mc.penalty)],
    ["到账日期", mc.fulfilledDate ? formatDate(mc.fulfilledDate) : "—"],
    ["备注", mc.note || "—"],
  ];

  const handleExport = async () => {
    try {
      if (allCalls.length === 0) {
        toast.error("当前筛选条件下没有可导出的补仓记录。");
        return;
      }
      const rows = allCalls.map((mc: any) => ({
        "批次号": mc.batchNumber ?? "",
        "股票代码": mc.symbol ?? "",
        "股票名称": mc.stockName ?? "",
        "触发时间": mc.triggerDate ? formatDate(mc.triggerDate) : "",
        "到期时间（T+2）": mc.dueDate ? formatDate(mc.dueDate) : "",
        "触发时仓位价值（USD）": Number(Number(mc.triggerMarketValue ?? 0).toFixed(2)),
        "跌幅（%）": Number((Number(mc.dropPercent ?? 0) * 100).toFixed(2)),
        "应补金额（USD）": Number(Number(mc.requiredAmount ?? 0).toFixed(2)),
        "已到账（USD）": Number(Number(mc.fulfilledAmount ?? 0).toFixed(2)),
        "完成进度（%）": Number(Number(mc.fulfillmentPct ?? 0).toFixed(1)),
        "状态": getStatusConfig(mc.status).label,
        "补仓形式": mc.collateralType ? (mc.collateralType === "cash" ? "现金" : "股票") : "",
        "到账日期": mc.fulfilledDate ? formatDate(mc.fulfilledDate) : "",
        "轮次": mc.roundNumber,
        "逾期天数": mc.overdueDays,
        "罚息（USD）": Number(mc.penalty.toFixed(2)),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [
        { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 18 },
        { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "补仓记录明细");
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const fileName = `补仓记录明细_${stamp}.xlsx`;
      await XLSX.writeFile(wb, fileName);
      toast.success(`导出成功：${fileName}（共 ${allCalls.length} 条记录）`);
    } catch {
      toast.error("导出失败，请重试。若问题持续请联系管理员。");
    }
  };

  const handlePrintDoc = (mc: any) => {
    const rows = buildDocRows(mc);
    const esc = (v: string) => v.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
    const win = window.open("", "_blank", "width=820,height=920");
    if (!win) {
      toast.error("浏览器阻止了打印窗口，请允许弹出窗口后重试。");
      return;
    }
    win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
      <title>补仓单据 ${esc(String(mc.batchNumber ?? ""))}</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#111;padding:40px;}
        h1{font-size:20px;margin:0 0 4px;}
        p.sub{color:#666;font-size:12px;margin:0 0 24px;}
        table{border-collapse:collapse;width:100%;font-size:13px;}
        th,td{border:1px solid #ddd;padding:10px 12px;text-align:left;}
        th{background:#f5f5f5;width:180px;font-weight:600;}
        .foot{margin-top:28px;font-size:11px;color:#888;}
      </style></head><body>
      <h1>WIN100 补仓单据</h1>
      <p class="sub">批次 ${esc(String(mc.batchNumber ?? ""))} · 生成时间 ${esc(new Date().toLocaleString("zh-CN"))}</p>
      <table><tbody>
        ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join("")}
      </tbody></table>
      <p class="foot">本单据由 WIN100 风控平台自动生成，仅作内部对账与归档使用。</p>
      </body></html>`);
    win.document.close();
    win.focus();
    window.setTimeout(() => win.print(), 300);
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded bg-warning/10 text-warning font-semibold">
            资金安全
          </span>
          <span>/</span>
          <span>补仓历史</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">WIN100 补仓历史记录</h1>
        <p className="text-sm text-muted-foreground">
          跟踪所有批次的补仓触发、执行与到账情况
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">累计应补仓</p>
              <History className="h-4 w-4 text-warning" />
            </div>
            <p className="text-2xl font-bold font-mono text-warning">
              {formatCurrency(stats.totalRequired)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">实际到账</p>
              <CheckCircle className="h-4 w-4 text-success" />
            </div>
            <p className="text-2xl font-bold font-mono text-success">
              {formatCurrency(stats.totalFulfilled)}
            </p>
            <Progress
              value={stats.totalRequired > 0 ? (stats.totalFulfilled / stats.totalRequired) * 100 : 0}
              variant="success"
              className="mt-2 h-1.5"
            />
          </CardContent>
        </Card>
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">待处理补仓</p>
              <Clock className="h-4 w-4 text-danger animate-breath-danger" />
            </div>
            <p className="text-2xl font-bold font-mono text-danger">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">已完成 / 已过期</p>
              <FileText className="h-4 w-4 text-success" />
            </div>
            <p className="text-2xl font-bold font-mono">
              <span className="text-success">{stats.fulfilled}</span>
              <span className="text-muted-foreground mx-1 text-lg">/</span>
              <span className="text-muted-foreground">{stats.expired}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              补仓记录明细 ({allCalls.length})
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="批次号 / 客户 / 签约年份"
                  className="pl-8 h-9 w-[200px] text-xs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="h-9 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="ALL">全部状态</option>
                <option value="PENDING">待处理</option>
                <option value="FULLFILLED">已完成</option>
                <option value="EXPIRED">已过期</option>
              </select>
              <Button
                variant={advancedOpen ? "secondary" : "outline"}
                size="sm"
                className="gap-1.5 h-9 text-xs"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                <Filter className="h-3.5 w-3.5" />
                高级筛选
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 text-xs" onClick={handleExport}>
                <Download className="h-3.5 w-3.5" />
                导出
              </Button>
            </div>
          </div>
          {advancedOpen && (
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-border/50 bg-secondary/20 p-3">
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">起始日期</p>
                <Input type="date" className="h-9 w-[150px] text-xs" value={advFrom} onChange={(e) => setAdvFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">结束日期</p>
                <Input type="date" className="h-9 w-[150px] text-xs" value={advTo} onChange={(e) => setAdvTo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">批次号关键词</p>
                <Input className="h-9 w-[180px] text-xs" placeholder="如 008" value={advBatch} onChange={(e) => setAdvBatch(e.target.value)} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => { setAdvFrom(""); setAdvTo(""); setAdvBatch(""); }}
              >
                重置
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border/50">
              <div className="col-span-2">批次号</div>
              <div className="col-span-1 text-center">触发时间</div>
              <div className="col-span-1 text-right">触发时仓位价值</div>
              <div className="col-span-1 text-right">跌幅</div>
              <div className="col-span-1 text-right">应补金额</div>
              <div className="col-span-1 text-right">已到账</div>
              <div className="col-span-2 text-center">完成进度</div>
              <div className="col-span-1 text-center">状态</div>
              <div className="col-span-2 text-right">操作</div>
            </div>
            <div className="divide-y divide-border/40 max-h-[600px] overflow-y-auto scrollbar-thin">
              {allCalls.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <History className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>暂无补仓记录</p>
                </div>
              ) : (
                allCalls.map((mc) => {
                  const sc = getStatusConfig(mc.status);
                  const SIcon = sc.Icon;
                  const fulfillmentPct = mc.fulfillmentPct ?? (
                    mc.requiredAmount > 0
                      ? ((mc.fulfilledAmount || 0) / mc.requiredAmount) * 100
                      : 0
                  );
                  return (
                    <div
                      key={mc.id}
                      id={`margin-call-${mc.id}`}
                      className={cn(
                        "grid grid-cols-12 items-center px-5 py-4 hover:bg-secondary/30 transition-colors target:ring-2 target:ring-inset target:ring-primary",
                        mc.status === "PENDING" && "bg-danger/5 hover:bg-danger/10"
                      )}
                    >
                      <div className="col-span-2 min-w-0">
                        <p className="font-mono text-xs text-muted-foreground">
                          {mc.batchNumber} · 第 {mc.roundNumber} 轮
                        </p>
                        <p className="font-bold text-sm truncate">
                          {mc.symbol}
                          {mc.stockName && (
                            <span className="text-muted-foreground font-normal ml-1 text-xs">
                              {mc.stockName}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="col-span-1 text-center font-mono text-xs">
                        {formatDate(mc.triggerDate)}
                        {mc.dueDate && (
                          <p className={cn(
                            "text-[9px] mt-0.5",
                            mc.status === "OVERDUE" ? "text-danger" : "text-muted-foreground"
                          )}>
                            T+2 {formatDate(mc.dueDate)}
                          </p>
                        )}
                        {mc.collateralType && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            {mc.collateralType === "cash" ? "现金" : "股票"}
                          </p>
                        )}
                      </div>
                      <div className="col-span-1 text-right font-mono text-sm">
                        {formatCurrency(mc.triggerMarketValue)}
                      </div>
                      <div className="col-span-1 text-right font-mono text-sm font-bold text-danger">
                        -{(mc.dropPercent * 100).toFixed(1)}%
                      </div>
                      <div className="col-span-1 text-right font-mono text-sm font-bold text-warning">
                        {formatCurrency(mc.requiredAmount)}
                      </div>
                      <div className="col-span-1 text-right font-mono text-sm font-semibold">
                        {formatCurrency(mc.fulfilledAmount || 0)}
                      </div>
                      <div className="col-span-2 px-2">
                        <Progress
                          value={fulfillmentPct}
                          variant={
                            fulfillmentPct >= 100
                              ? "success"
                              : fulfillmentPct > 0
                              ? "warning"
                              : "danger"
                          }
                          className="h-2"
                        />
                        <p className="text-[10px] text-muted-foreground font-mono mt-1 text-center">
                          {fulfillmentPct.toFixed(0)}%
                        </p>
                      </div>
                      <div className="col-span-1 text-center">
                        <Badge variant={sc.variant as any} className="gap-1 text-[10px]">
                          <SIcon className="h-2.5 w-2.5" />
                          {sc.label}
                        </Badge>
                        {mc.isOverdue && (
                          <p className="mt-1 text-[10px] text-danger">
                            逾期 {mc.overdueDays} 天{mc.penalty > 0 && ` · 罚息 ${formatCurrency(mc.penalty)}`}
                          </p>
                        )}
                        {mc.fulfilledDate && (
                          <p className="text-[9px] text-muted-foreground font-mono mt-1">
                            {formatDate(mc.fulfilledDate)}
                          </p>
                        )}
                      </div>
                      <div className="col-span-2 flex justify-end gap-1.5">
                        <Link href={`/batch/${mc.batchId}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="查看批次">
                            <Building2 className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="查看单据"
                          onClick={() => setDocTarget(mc)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog open={!!docTarget} onOpenChange={(v) => { if (!v) setDocTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              WIN100 补仓单据
            </DialogTitle>
          </DialogHeader>
          {docTarget && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/50 overflow-hidden">
                {buildDocRows(docTarget).map(([label, value], i) => (
                  <div
                    key={label}
                    className={cn(
                      "grid grid-cols-[130px_1fr] text-xs",
                      i > 0 && "border-t border-border/40"
                    )}
                  >
                    <div className="px-3 py-2.5 bg-secondary/30 text-muted-foreground font-medium">
                      {label}
                    </div>
                    <div className="px-3 py-2.5 font-mono break-all">{value}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDocTarget(null)}>
                  关闭
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => handlePrintDoc(docTarget)}>
                  <FileText className="h-3.5 w-3.5" />
                  打印 / 另存为 PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
