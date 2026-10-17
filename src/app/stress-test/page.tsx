"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMockData } from "@/lib/mockData";
import {
  runStressTest,
  generateStressTestReport,
  DEFAULT_STRESS_SCENARIO,
  type StressScenario,
  type StressTestResult,
} from "@/lib/stressTest";
import { formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FlaskConical,
  Download,
  Play,
  AlertTriangle,
  ShieldAlert,
  TrendingDown,
  Wallet,
  Building2,
  Users,
  Clock,
} from "lucide-react";
import Link from "next/link";

const PRESET_SCENARIOS: { label: string; scenario: StressScenario }[] = [
  { label: "温和下跌 20%", scenario: { dropPercent: 20, settlementDelayDays: 2, allBatches: true } },
  { label: "中度下跌 30%", scenario: { dropPercent: 30, settlementDelayDays: 2, allBatches: true } },
  { label: "极端下跌 50%", scenario: { dropPercent: 50, settlementDelayDays: 5, allBatches: true } },
  { label: "全仓跌 20% + T+5 延期", scenario: { dropPercent: 20, settlementDelayDays: 5, allBatches: true } },
];

export default function StressTestPage() {
  const [tick, setTick] = useState(0);
  const { batches } = useMemo(() => getMockData(), [tick]);

  const [dropPercent, setDropPercent] = useState<number>(DEFAULT_STRESS_SCENARIO.dropPercent);
  const [settlementDelayDays, setSettlementDelayDays] = useState<number>(DEFAULT_STRESS_SCENARIO.settlementDelayDays);
  const [allBatches, setAllBatches] = useState<boolean>(DEFAULT_STRESS_SCENARIO.allBatches);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [result, setResult] = useState<StressTestResult | null>(null);

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

  const activeBatches = useMemo(
    () => batches.filter((b) => b.status !== "CLOSED" && b.status !== "LIQUIDATED"),
    [batches]
  );

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const runTest = () => {
    const scenario: StressScenario = {
      dropPercent: Math.max(0, Math.min(100, Number(dropPercent) || 0)),
      settlementDelayDays: Math.max(0, Number(settlementDelayDays) || 0),
      allBatches,
      batchIds: allBatches ? undefined : selectedBatchIds,
    };
    if (!allBatches && selectedBatchIds.length === 0) {
      toast.error("请至少选择一个批次");
      return;
    }
    const res = runStressTest(activeBatches, scenario);
    setResult(res);
    toast.success(`压力测试完成：${res.batchCount} 个批次，需补仓 ${formatCurrency(res.totalRequiredMarginCall)}`);
  };

  const applyPreset = (s: StressScenario) => {
    setDropPercent(s.dropPercent);
    setSettlementDelayDays(s.settlementDelayDays);
    setAllBatches(s.allBatches);
    setResult(null);
  };

  const exportReport = () => {
    if (!result) {
      toast.error("请先运行压力测试");
      return;
    }
    const report = generateStressTestReport(result);
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stress-test-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("报告已导出");
  };

  const printReport = () => {
    if (!result) {
      toast.error("请先运行压力测试");
      return;
    }
    // 打开新窗口打印，浏览器可另存为 PDF
    const report = generateStressTestReport(result);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>压力测试报告</title>
<style>body{font-family:monospace;white-space:pre;padding:24px;line-height:1.6;}</style>
</head><body>${report}</body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("无法打开打印窗口，请允许弹窗");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            压力测试模拟器
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            输入情景参数，实时计算补仓总金额、各方分摊、保本线突破及 WIN100 最大亏损
          </p>
        </div>
        {result && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportReport}>
              <Download className="h-4 w-4 mr-1" /> 导出报告
            </Button>
            <Button variant="outline" size="sm" onClick={printReport}>
              <Download className="h-4 w-4 mr-1" /> 打印 / PDF
            </Button>
          </div>
        )}
      </div>

      {/* 情景配置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">测试情景配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESET_SCENARIOS.map((p) => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(p.scenario)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-sm font-medium mb-1 block">XMAX 跌幅 (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={dropPercent}
                onChange={(e) => setDropPercent(Number(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">模拟标的股票从当前价下跌的幅度</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">补仓到账延期 (T+N 天)</label>
              <Input
                type="number"
                min={0}
                step={1}
                value={settlementDelayDays}
                onChange={(e) => setSettlementDelayDays(Number(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">WIN100 补仓履约到账天数（协议 T+2）</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">测试范围</label>
              <Select
                value={allBatches ? "all" : "selected"}
                onValueChange={(v) => setAllBatches(v === "all")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部在管批次</SelectItem>
                  <SelectItem value="selected">指定批次</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                在管批次共 {activeBatches.length} 个
              </p>
            </div>
          </div>

          {!allBatches && (
            <div>
              <label className="text-sm font-medium mb-2 block">选择批次</label>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 max-h-48 overflow-auto border rounded-lg p-2">
                {activeBatches.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-secondary/50 p-1 rounded"
                  >
                    <Checkbox
                      checked={selectedBatchIds.includes(b.id)}
                      onCheckedChange={() => toggleBatch(b.id)}
                    />
                    <span className="font-mono">{b.batchNumber}</span>
                    <span className="text-muted-foreground text-xs">{b.stockSymbol}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={runTest}>
              <Play className="h-4 w-4 mr-1" /> 运行压力测试
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDropPercent(DEFAULT_STRESS_SCENARIO.dropPercent);
                setSettlementDelayDays(DEFAULT_STRESS_SCENARIO.settlementDelayDays);
                setAllBatches(true);
                setSelectedBatchIds([]);
                setResult(null);
              }}
            >
              重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 测试结果 */}
      {result && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">汇总结果</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">参与批次</p>
                  <p className="text-lg font-bold font-mono">{result.batchCount}</p>
                </div>
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">补仓总金额</p>
                  <p className="text-lg font-bold font-mono text-warning">
                    {formatCurrency(result.totalRequiredMarginCall)}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">击穿补仓线</p>
                  <p className="text-lg font-bold font-mono text-danger">{result.criticalBatchCount}</p>
                </div>
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">击穿保本线</p>
                  <p className={cn(
                    "text-lg font-bold font-mono",
                    result.principalBreachedCount > 0 ? "text-danger" : "text-success"
                  )}>
                    {result.principalBreachedCount}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">担保不足批次</p>
                  <p className={cn(
                    "text-lg font-bold font-mono",
                    result.collateralBreachedCount > 0 ? "text-danger" : "text-success"
                  )}>
                    {result.collateralBreachedCount}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">WIN100 最大亏损</p>
                  <p className="text-lg font-bold font-mono text-danger">
                    {formatCurrency(result.win100MaxLoss)}
                  </p>
                </div>
              </div>

              {/* 各方分摊 */}
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-3 flex items-center gap-2">
                  <Users className="h-5 w-5 text-warning" />
                  <div>
                    <p className="text-[11px] text-muted-foreground">客户承担损失</p>
                    <p className="text-sm font-mono font-bold">{formatCurrency(result.splitEstimate.clientLoss)}</p>
                  </div>
                </div>
                <div className="rounded-lg border p-3 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-[11px] text-muted-foreground">WIN100 承担损失</p>
                    <p className="text-sm font-mono font-bold">{formatCurrency(result.splitEstimate.win100Loss)}</p>
                  </div>
                </div>
                <div className="rounded-lg border p-3 flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-danger" />
                  <div>
                    <p className="text-[11px] text-muted-foreground">需外部补仓</p>
                    <p className="text-sm font-mono font-bold">{formatCurrency(result.splitEstimate.externalTopup)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 批次明细 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">批次明细</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="p-2 font-medium">批次</th>
                      <th className="p-2 font-medium">价格变动</th>
                      <th className="p-2 font-medium">跌幅</th>
                      <th className="p-2 font-medium">需补仓</th>
                      <th className="p-2 font-medium">风险</th>
                      <th className="p-2 font-medium">保本线</th>
                      <th className="p-2 font-medium">担保比例</th>
                      <th className="p-2 font-medium">客户 PnL</th>
                      <th className="p-2 font-medium">WIN100 PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.batches.map((b) => (
                      <tr key={b.batchId} className="border-b hover:bg-secondary/30">
                        <td className="p-2">
                          <Link href={`/batch/${b.batchId}`} className="font-mono hover:underline">
                            {b.batchNumber}
                          </Link>
                          <div className="text-[10px] text-muted-foreground">{b.stockSymbol}</div>
                        </td>
                        <td className="p-2 font-mono text-xs">
                          ${b.originalPrice.toFixed(2)} → ${b.stressedPrice.toFixed(2)}
                        </td>
                        <td className="p-2 font-mono text-danger">-{b.actualDropPercent.toFixed(1)}%</td>
                        <td className="p-2 font-mono font-semibold text-warning">
                          {formatCurrency(b.requiredMarginCall)}
                        </td>
                        <td className="p-2">
                          <Badge variant={b.riskLevel === "CRITICAL" ? "danger" : b.riskLevel === "WARNING" ? "warning" : "success"}>
                            {b.riskLevel === "CRITICAL" ? "击穿" : b.riskLevel === "WARNING" ? "预警" : "正常"}
                          </Badge>
                        </td>
                        <td className="p-2">
                          {b.principalBreached ? (
                            <span className="text-danger text-xs">⚠ 击穿</span>
                          ) : (
                            <span className="text-success text-xs">安全</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className={cn(
                            "font-mono text-xs",
                            b.collateralBreached ? "text-danger" : "text-success"
                          )}>
                            {(b.collateralRatio * 100).toFixed(1)}%
                            {b.collateralBreached && " ⚠"}
                          </span>
                        </td>
                        <td className={cn(
                          "p-2 font-mono text-xs",
                          b.clientTotalPnL < 0 ? "text-danger" : "text-success"
                        )}>
                          {b.clientTotalPnL >= 0 ? "+" : ""}{formatCurrency(b.clientTotalPnL)}
                        </td>
                        <td className={cn(
                          "p-2 font-mono text-xs",
                          b.win100TotalPnL < 0 ? "text-danger" : "text-success"
                        )}>
                          {b.win100TotalPnL >= 0 ? "+" : ""}{formatCurrency(b.win100TotalPnL)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!result && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>配置测试情景后点击「运行压力测试」查看结果</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
