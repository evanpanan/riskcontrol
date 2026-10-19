"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMockData } from "@/lib/mockData";
import {
  buildWin100Ledger,
  type CollateralLedgerEntry,
  type RevenueLedgerEntry,
  type PerformanceLedgerEntry,
} from "@/lib/win100Ledger";
import { formatCurrency, cn } from "@/lib/utils";
import {
  Landmark,
  TrendingUp,
  ShieldCheck,
  Download,
  Printer,
  CircleDollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  AlertOctagon,
} from "lucide-react";

const fmtDate = (d?: string) => {
  if (!d) return "-";
  const date = new Date(d);
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
};

const fmtDateFull = (d?: string) => {
  if (!d) return "-";
  return new Date(d).toLocaleString("zh-CN", { hour12: false });
};

export default function Win100LedgerPage() {
  const [tick, setTick] = useState(0);
  const { batches } = useMemo(() => getMockData(), [tick]);
  const [tab, setTab] = useState<"collateral" | "revenue" | "performance">("collateral");

  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("risk-control:finance-changed", handler);
    window.addEventListener("risk-control:quote-changed", handler);
    window.addEventListener("storage", handler);
    const id = window.setInterval(handler, 8000);
    return () => {
      window.removeEventListener("risk-control:finance-changed", handler);
      window.removeEventListener("risk-control:quote-changed", handler);
      window.removeEventListener("storage", handler);
      window.clearInterval(id);
    };
  }, []);

  const ledger = useMemo(() => buildWin100Ledger(batches), [batches]);

  const exportReport = () => {
    const lines: string[] = [];
    lines.push("=" .repeat(70));
    lines.push("WIN100 履约台账报告");
    lines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
    lines.push("=" .repeat(70));
    lines.push("");

    lines.push("【担保品台账】");
    lines.push(`累计注入本金: ${formatCurrency(ledger.collateral.totalInjected)}`);
    lines.push(`累计释放本金: ${formatCurrency(ledger.collateral.totalReleased)}`);
    lines.push(`剩余本金: ${formatCurrency(ledger.collateral.totalRemainingPrincipal)}`);
    lines.push(`当前盯市市值: ${formatCurrency(ledger.collateral.totalCurrentValue)}`);
    lines.push(`浮动盈亏: ${formatCurrency(ledger.collateral.totalUnrealizedPnL)}`);
    lines.push(`担保比例: ${(ledger.collateral.collateralRatio * 100).toFixed(2)}%`);
    lines.push("");
    ledger.collateral.entries.forEach((e, i) => {
      lines.push(`  ${i + 1}. ${e.batchNumber} | ${e.type === "initial" ? "初始担保" : "补仓"} | 本金 ${formatCurrency(e.principal)} | 剩余市值 ${formatCurrency(e.currentValue)} | 盈亏 ${formatCurrency(e.pnl)} | ${e.status === "active" ? "持有中" : "已释放"}`);
    });
    lines.push("");

    lines.push("【收益台账】");
    lines.push(`已结算客户数: ${ledger.revenue.totalSettledCount}`);
    lines.push(`客户实收总额: ${formatCurrency(ledger.revenue.totalClientReceives)}`);
    lines.push(`提前退出费总额: ${formatCurrency(ledger.revenue.totalEarlyExitFee)}`);
    lines.push(`WIN100 总收益: ${formatCurrency(ledger.revenue.totalInstitutionPnL)}`);
    lines.push(`单笔平均收益: ${formatCurrency(ledger.revenue.avgWin100PnL)}`);
    lines.push("");
    ledger.revenue.entries.forEach((e, i) => {
      lines.push(`  ${i + 1}. ${fmtDate(e.settledAt)} | ${e.batchNumber} | ${e.clientName} | 本金 ${formatCurrency(e.principal)} | WIN100收益 ${formatCurrency(e.institutionTotalPnL)} | 客户实收 ${formatCurrency(e.clientReceives)}`);
    });
    lines.push("");

    lines.push("【履约台账】");
    lines.push(`补仓应缴总额: ${formatCurrency(ledger.performance.totalRequired)}`);
    lines.push(`补仓已缴总额: ${formatCurrency(ledger.performance.totalFulfilled)}`);
    lines.push(`履约率: ${(ledger.performance.fulfillmentRate * 100).toFixed(2)}%`);
    lines.push(`待处理笔数: ${ledger.performance.pendingCount}`);
    lines.push(`逾期笔数: ${ledger.performance.overdueCount}`);
    lines.push(`罚息总额: ${formatCurrency(ledger.performance.totalPenalty)}`);
    lines.push("");
    ledger.performance.entries.forEach((e, i) => {
      lines.push(`  ${i + 1}. ${e.batchNumber} | 第${e.roundNumber}轮 | 应缴 ${formatCurrency(e.requiredAmount)} | 已缴 ${formatCurrency(e.fulfilledAmount)} | 到期 ${fmtDate(e.dueDate)} | ${e.status}${e.isOverdue ? ` 逾期${e.overdueDays}天 罚息${formatCurrency(e.penaltyAmount)}` : ""}`);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `win100-ledger-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print:space-y-4">
      {/* 页头 */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Landmark className="h-6 w-6 text-amber-500" />
            WIN100 履约台账
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            担保品 · 收益 · 履约三类台账汇总视图
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={exportReport}>
            <Download className="h-4 w-4 mr-1" /> 导出报告
          </Button>
          <Button variant="outline" onClick={printReport}>
            <Printer className="h-4 w-4 mr-1" /> 打印 / PDF
          </Button>
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-blue-500" /> 担保品当前盯市市值
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(ledger.collateral.totalCurrentValue)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              剩余本金 {formatCurrency(ledger.collateral.totalRemainingPrincipal)} · 浮盈 {formatCurrency(ledger.collateral.totalUnrealizedPnL)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-emerald-500" /> WIN100 累计收益
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", ledger.revenue.totalInstitutionPnL >= 0 ? "text-emerald-500" : "text-red-500")}>
              {ledger.revenue.totalInstitutionPnL >= 0 ? "+" : ""}
              {formatCurrency(ledger.revenue.totalInstitutionPnL)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              已结算 {ledger.revenue.totalSettledCount} 笔 · 提前退出费 {formatCurrency(ledger.revenue.totalEarlyExitFee)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 text-amber-500" /> 补仓履约率
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(ledger.performance.fulfillmentRate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              待处理 {ledger.performance.pendingCount} · 逾期 {ledger.performance.overdueCount} · 罚息 {formatCurrency(ledger.performance.totalPenalty)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b print:hidden">
        {([
          { key: "collateral", label: "担保品台账", icon: ShieldCheck },
          { key: "revenue", label: "收益台账", icon: TrendingUp },
          { key: "performance", label: "履约台账", icon: Clock },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5",
              tab === t.key
                ? "border-amber-500 text-amber-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* 担保品台账 */}
      {tab === "collateral" && (
        <Card>
          <CardHeader>
            <CardTitle>担保品台账</CardTitle>
            <CardDescription>
              WIN100 每笔担保品的存入（初始担保 + 补仓）、释放（客户退出）、当前盯市市值
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 px-2">批次</th>
                  <th className="py-2 px-2">类型</th>
                  <th className="py-2 px-2 text-right">本金</th>
                  <th className="py-2 px-2 text-right">入场价</th>
                  <th className="py-2 px-2 text-right">已释放</th>
                  <th className="py-2 px-2 text-right">剩余本金</th>
                  <th className="py-2 px-2 text-right">当前价</th>
                  <th className="py-2 px-2 text-right">当前市值</th>
                  <th className="py-2 px-2 text-right">浮盈/亏</th>
                  <th className="py-2 px-2 text-center">状态</th>
                </tr>
              </thead>
              <tbody>
                {ledger.collateral.entries.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-muted-foreground">暂无担保品记录</td>
                  </tr>
                )}
                {ledger.collateral.entries.map((e: CollateralLedgerEntry) => {
                  const remainingPrincipal = Math.max(0, e.principal - e.releasedAmount);
                  return (
                    <tr key={e.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium">{e.batchNumber}</td>
                      <td className="py-2 px-2">
                        <Badge variant={e.type === "initial" ? "default" : "secondary"}>
                          {e.type === "initial" ? "初始担保" : "补仓担保"}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right">{formatCurrency(e.principal)}</td>
                      <td className="py-2 px-2 text-right">${e.entryPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{formatCurrency(e.releasedAmount)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(remainingPrincipal)}</td>
                      <td className="py-2 px-2 text-right">${e.currentPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-medium">{formatCurrency(e.currentValue)}</td>
                      <td className={cn("py-2 px-2 text-right font-medium", e.pnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                        {e.pnl >= 0 ? "+" : ""}{formatCurrency(e.pnl)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant={e.status === "active" ? "outline" : "secondary"}>
                          {e.status === "active" ? "持有中" : "已释放"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* 收益台账 */}
      {tab === "revenue" && (
        <Card>
          <CardHeader>
            <CardTitle>收益台账</CardTitle>
            <CardDescription>
              WIN100 从每笔客户退出中获得的收益（客户让渡的分成 + 担保品本身盈亏）
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 px-2">结算时间</th>
                  <th className="py-2 px-2">批次</th>
                  <th className="py-2 px-2">客户</th>
                  <th className="py-2 px-2 text-right">本金</th>
                  <th className="py-2 px-2 text-right">结算价</th>
                  <th className="py-2 px-2 text-right">客户实收</th>
                  <th className="py-2 px-2 text-right">让渡收益</th>
                  <th className="py-2 px-2 text-right">初始担保盈亏</th>
                  <th className="py-2 px-2 text-right">补仓担保盈亏</th>
                  <th className="py-2 px-2 text-right">WIN100 总收益</th>
                  <th className="py-2 px-2 text-center">备注</th>
                </tr>
              </thead>
              <tbody>
                {ledger.revenue.entries.length === 0 && (
                  <tr>
                    <td colSpan={11} className="text-center py-8 text-muted-foreground">暂无已结算记录</td>
                  </tr>
                )}
                {ledger.revenue.entries.map((e: RevenueLedgerEntry) => (
                  <tr key={e.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-2 whitespace-nowrap">{fmtDateFull(e.settledAt)}</td>
                    <td className="py-2 px-2 font-medium">{e.batchNumber}</td>
                    <td className="py-2 px-2">{e.clientName}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(e.principal)}</td>
                    <td className="py-2 px-2 text-right">${e.stockPrice.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(e.clientReceives)}</td>
                    <td className={cn("py-2 px-2 text-right", e.institutionClientShare >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {e.institutionClientShare >= 0 ? "+" : ""}{formatCurrency(e.institutionClientShare)}
                    </td>
                    <td className={cn("py-2 px-2 text-right", e.institutionInitialPnL >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {e.institutionInitialPnL >= 0 ? "+" : ""}{formatCurrency(e.institutionInitialPnL)}
                    </td>
                    <td className={cn("py-2 px-2 text-right", e.institutionRescuePnL >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {e.institutionRescuePnL >= 0 ? "+" : ""}{formatCurrency(e.institutionRescuePnL)}
                    </td>
                    <td className={cn("py-2 px-2 text-right font-bold", e.institutionTotalPnL >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {e.institutionTotalPnL >= 0 ? "+" : ""}{formatCurrency(e.institutionTotalPnL)}
                    </td>
                    <td className="py-2 px-2 text-center">
                      {e.isEarlyExit && (
                        <Badge variant="secondary">提前退出 · 手续费 {formatCurrency(e.earlyExitFee)}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* 履约台账 */}
      {tab === "performance" && (
        <Card>
          <CardHeader>
            <CardTitle>履约台账</CardTitle>
            <CardDescription>
              每笔补仓指令的 T+2 到账情况、违约记录、罚息（逾期按日万分之五计罚息）
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 px-2">批次</th>
                  <th className="py-2 px-2 text-center">轮次</th>
                  <th className="py-2 px-2">触发日</th>
                  <th className="py-2 px-2">到期日 (T+2)</th>
                  <th className="py-2 px-2 text-right">应缴</th>
                  <th className="py-2 px-2 text-right">已缴</th>
                  <th className="py-2 px-2 text-right">缺口</th>
                  <th className="py-2 px-2">类型</th>
                  <th className="py-2 px-2 text-center">状态</th>
                  <th className="py-2 px-2 text-right">逾期天数</th>
                  <th className="py-2 px-2 text-right">罚息</th>
                </tr>
              </thead>
              <tbody>
                {ledger.performance.entries.length === 0 && (
                  <tr>
                    <td colSpan={11} className="text-center py-8 text-muted-foreground">暂无补仓记录</td>
                  </tr>
                )}
                {ledger.performance.entries.map((e: PerformanceLedgerEntry) => {
                  const gap = Math.max(0, e.requiredAmount - e.fulfilledAmount);
                  return (
                    <tr key={e.id} className={cn("border-b hover:bg-muted/30", e.isOverdue && "bg-red-500/5")}>
                      <td className="py-2 px-2 font-medium">{e.batchNumber}</td>
                      <td className="py-2 px-2 text-center">第 {e.roundNumber} 轮</td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(e.triggerDate)}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(e.dueDate)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(e.requiredAmount)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(e.fulfilledAmount)}</td>
                      <td className="py-2 px-2 text-right text-red-500">{gap > 0.01 ? formatCurrency(gap) : "-"}</td>
                      <td className="py-2 px-2">{e.collateralType === "cash" ? "现金" : e.collateralType === "stock" ? "股票" : "-"}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant={e.status === "FULLFILLED" ? "default" : e.isOverdue ? "destructive" : "secondary"}>
                          {e.status === "FULLFILLED" ? "已履约" : e.status === "OVERDUE" ? "逾期" : e.status === "PENDING" ? "待缴" : e.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right">
                        {e.isOverdue ? <span className="text-red-500 font-medium">{e.overdueDays} 天</span> : "-"}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {e.penaltyAmount > 0 ? <span className="text-red-500">{formatCurrency(e.penaltyAmount)}</span> : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
