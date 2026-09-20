"use client";

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
  Filter,
  Zap,
} from "lucide-react";
import { useState, useMemo } from "react";
import { MarginCallStatus } from "@prisma/client";
import Link from "next/link";
import { RoleGate } from "@/components/auth/RoleGate";
import { APP_ROLES } from "@/types/auth";

export default function MarginCallsPage() {
  const { batches } = getMockData();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | MarginCallStatus>("ALL");

  const allCalls = useMemo(() => {
    const list: any[] = [];
    batches.forEach((b) => {
      b.marginCalls?.forEach((mc) => {
        list.push({
          ...mc,
          batchNumber: b.batchNumber,
          batchId: b.id,
          symbol: b.stockSymbol,
          stockName: b.stockName,
        });
      });
    });

    let result = list;
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
    return result.sort(
      (a, b) => new Date(b.triggerDate).getTime() - new Date(a.triggerDate).getTime()
    );
  }, [batches, search, statusFilter]);

  const stats = useMemo(() => {
    let pending = 0,
      fulfilled = 0,
      expired = 0,
      totalRequired = 0,
      totalFulfilled = 0;
    batches.forEach((b) => {
      b.marginCalls?.forEach((mc) => {
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
    }
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
        <h1 className="text-2xl font-bold tracking-tight">机构补仓历史记录</h1>
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
                  placeholder="批次号 / 股票代码"
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
              <Button variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
                <Filter className="h-3.5 w-3.5" />
                高级筛选
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
                <Download className="h-3.5 w-3.5" />
                导出
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border/50">
              <div className="col-span-2">批次 / 股票</div>
              <div className="col-span-1 text-center">触发时间</div>
              <div className="col-span-1 text-right">触发时市值</div>
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
                  const fulfillmentPct =
                    mc.requiredAmount > 0
                      ? ((mc.fulfilledAmount || 0) / mc.requiredAmount) * 100
                      : 0;
                  return (
                    <div
                      key={mc.id}
                      className={cn(
                        "grid grid-cols-12 items-center px-5 py-4 hover:bg-secondary/30 transition-colors",
                        mc.status === "PENDING" && "bg-danger/5 hover:bg-danger/10"
                      )}
                    >
                      <div className="col-span-2 min-w-0">
                        <p className="font-mono text-xs text-muted-foreground">
                          {mc.batchNumber}
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
                          onClick={() => console.log("[补仓单据] 导出/查看PDF:", mc.id)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        {mc.status === "PENDING" && (
                          <RoleGate
                            allowed={[APP_ROLES.RISK_MANAGER, APP_ROLES.ADMIN]}
                            auditResource={`margin_call:fulfill:${mc.id}`}
                            auditAction="button_hidden"
                          >
                            <Button
                              size="sm"
                              variant="danger"
                              className="gap-1 h-8 text-xs"
                              onClick={() => {
                                mc.status = MarginCallStatus.FULLFILLED;
                                mc.fulfilledAmount = mc.requiredAmount;
                                mc.fulfilledDate = new Date();
                                const mock = getMockData();
                                const b = mock.batches.find((x) => x.id === mc.batchId);
                                if (b) b.cumulativeMarginCalls = (b.cumulativeMarginCalls || 0) + mc.requiredAmount;
                                window.location.reload();
                              }}
                            >
                              <Zap className="h-3 w-3" />
                              处理补仓
                            </Button>
                          </RoleGate>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
