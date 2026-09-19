"use client";

import { Batch, Client, MarginCall, RiskLevel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { useState, useMemo } from "react";
import {
  Search,
  Filter,
  Grid3X3,
  List,
  Plus,
  AlertTriangle,
  Download,
  LayoutGrid,
} from "lucide-react";
import { BatchGridCard } from "./BatchGridCard";

interface BatchControlPanelProps {
  batches: (Batch & { clients?: Client[]; marginCalls?: MarginCall[] })[];
}

type ViewMode = "grid" | "list";
type RiskFilter = "ALL" | RiskLevel;
type StatusFilter = "ALL" | "LOCKED" | "TRADING_OPEN" | "CLOSED";

export function BatchControlPanel({ batches }: BatchControlPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortBy, setSortBy] = useState("riskDesc");

  const filteredBatches = useMemo(() => {
    let list = [...batches];

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (b) =>
          b.batchNumber.toLowerCase().includes(q) ||
          b.stockSymbol.toLowerCase().includes(q) ||
          (b.stockName || "").toLowerCase().includes(q)
      );
    }

    if (riskFilter !== "ALL") {
      list = list.filter((b) => b.riskLevel === riskFilter);
    }

    if (statusFilter !== "ALL") {
      list = list.filter((b) => b.status === statusFilter);
    }

    switch (sortBy) {
      case "riskDesc":
        const riskWeight: Record<RiskLevel, number> = { CRITICAL: 3, WARNING: 2, NORMAL: 1 };
        list.sort((a, b) => riskWeight[b.riskLevel] - riskWeight[a.riskLevel]);
        break;
      case "pnlAsc":
        list.sort((a, b) => (a.totalPnL || 0) - (b.totalPnL || 0));
        break;
      case "pnlDesc":
        list.sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0));
        break;
      case "dateDesc":
        list.sort((a, b) => b.signDate.getTime() - a.signDate.getTime());
        break;
      case "amountDesc":
        list.sort((a, b) => b.initialTotalAmount - a.initialTotalAmount);
        break;
    }

    return list;
  }, [batches, search, riskFilter, statusFilter, sortBy]);

  const criticalCount = batches.filter((b) => b.riskLevel === RiskLevel.CRITICAL).length;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="批次号 / 股票代码..."
            className="pl-9 h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as RiskFilter)}>
            <SelectTrigger className="h-10 w-[140px]">
              <SelectValue placeholder="风险等级" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部风险</SelectItem>
              <SelectItem value="NORMAL">🟢 正常</SelectItem>
              <SelectItem value="WARNING">🟡 预警</SelectItem>
              <SelectItem value="CRITICAL">🔴 需补仓</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-10 w-[140px]">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部状态</SelectItem>
              <SelectItem value="LOCKED">🔒 锁仓期</SelectItem>
              <SelectItem value="TRADING_OPEN">🟢 开放交易</SelectItem>
              <SelectItem value="CLOSED">已到期</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-10 w-[150px]">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="riskDesc">风险等级 高→低</SelectItem>
              <SelectItem value="pnlAsc">盈亏 低→高</SelectItem>
              <SelectItem value="pnlDesc">盈亏 高→低</SelectItem>
              <SelectItem value="amountDesc">初始金额 大→小</SelectItem>
              <SelectItem value="dateDesc">签约时间 新→旧</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="icon"
              className={cn(
                "h-10 w-10 rounded-none border-0",
                viewMode !== "grid" && "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="icon"
              className={cn(
                "h-10 w-10 rounded-none border-0",
                viewMode !== "list" && "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>

          <div className="w-px h-8 bg-border mx-1 hidden sm:block" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0">
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>导出批次报表 (CSV)</p>
            </TooltipContent>
          </Tooltip>

          <Button size="sm" className="gap-1.5 h-10 shrink-0">
            <Plus className="h-4 w-4" />
            新建批次
          </Button>

          {criticalCount > 0 && (
            <Badge variant="danger" className="gap-1 h-10 px-3 animate-breath-danger">
              <AlertTriangle className="h-3.5 w-3.5" />
              {criticalCount} 个批次需补仓
            </Badge>
          )}
        </div>
      </div>

      {/* Filter Count */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          <span>
            显示 <span className="font-bold text-foreground">{filteredBatches.length}</span> / {batches.length} 个批次
          </span>
        </div>
      </div>

      {/* Content */}
      {viewMode === "grid" ? (
        <div className="grid gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredBatches.map((batch) => (
            <BatchGridCard key={batch.id} batch={batch} />
          ))}
        </div>
      ) : (
        <div className="border border-border/50 rounded-xl overflow-hidden bg-card">
          <div className="grid grid-cols-12 px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50 bg-secondary/30">
            <div className="col-span-2">批次 / 股票</div>
            <div className="col-span-1 text-right">股价 / 日涨跌</div>
            <div className="col-span-1 text-center">状态</div>
            <div className="col-span-1 text-right">初始金额</div>
            <div className="col-span-1 text-right">当前市值</div>
            <div className="col-span-2 text-center">安全缓冲</div>
            <div className="col-span-1 text-right">补仓</div>
            <div className="col-span-1 text-right">盈亏</div>
            <div className="col-span-1 text-center">客户</div>
          </div>
          <div className="divide-y divide-border/40">
            {filteredBatches.map((batch) => {
              const mv = batch.currentMarketValue || batch.initialTotalAmount;
              return (
                <div
                  key={batch.id}
                  className={cn(
                    "grid grid-cols-12 items-center px-5 py-4 hover:bg-secondary/30 transition-colors cursor-pointer",
                    batch.riskLevel === RiskLevel.CRITICAL && "bg-danger/5 hover:bg-danger/10"
                  )}
                >
                  <div className="col-span-2 min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">{batch.batchNumber}</p>
                    <p className="font-bold tracking-tight truncate">{batch.stockSymbol}</p>
                  </div>
                  <div className="col-span-1 text-right font-mono text-sm">
                    <p className="font-semibold">${batch.currentStockPrice?.toFixed(2)}</p>
                    <p className={cn(
                      "text-[11px]",
                      (batch.currentDayChange || 0) >= 0 ? "text-success" : "text-danger"
                    )}>
                      {(batch.currentDayChange || 0) >= 0 ? "+" : ""}
                      {(batch.currentDayChange || 0).toFixed(2)}%
                    </p>
                  </div>
                  <div className="col-span-1 text-center">
                    <Badge
                      variant={
                        batch.riskLevel === RiskLevel.CRITICAL ? "danger" :
                        batch.riskLevel === RiskLevel.WARNING ? "warning" : "success"
                      }
                      className="text-[10px] px-2"
                    >
                      {batch.riskLevel === RiskLevel.CRITICAL ? "需补仓" :
                       batch.riskLevel === RiskLevel.WARNING ? "预警" : "正常"}
                    </Badge>
                  </div>
                  <div className="col-span-1 text-right font-mono text-sm">
                    {formatCurrency(batch.initialTotalAmount)}
                  </div>
                  <div className="col-span-1 text-right font-mono text-sm font-semibold">
                    {formatCurrency(mv)}
                  </div>
                  <div className="col-span-2 px-2">
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all",
                          batch.riskLevel === RiskLevel.CRITICAL ? "bg-danger" :
                          batch.riskLevel === RiskLevel.WARNING ? "bg-warning" : "bg-success"
                        )}
                        style={{
                          width: `${Math.max(5, Math.min(100, 100 - ((mv - batch.initialTotalAmount * 0.8) / batch.initialTotalAmount * 500)))}%`
                        }}
                      />
                    </div>
                  </div>
                  <div className="col-span-1 text-right font-mono text-sm text-warning">
                    {formatCurrency(batch.cumulativeMarginCalls || 0)}
                  </div>
                  <div className={cn(
                    "col-span-1 text-right font-mono text-sm font-bold",
                    (batch.totalPnL || 0) < 0 ? "text-danger" : "text-success"
                  )}>
                    {((batch.totalPnLPercent || 0) >= 0 ? "+" : "")}
                    {(batch.totalPnLPercent || 0).toFixed(2)}%
                  </div>
                  <div className="col-span-1 text-center text-sm">
                    {batch.clients?.length || 0}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filteredBatches.length === 0 && (
        <div className="text-center py-20 border border-dashed border-border/50 rounded-2xl">
          <Filter className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground mb-1">没有匹配的批次</p>
          <p className="text-xs text-muted-foreground/70">请调整搜索条件或筛选器</p>
        </div>
      )}
    </div>
  );
}
