"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMockData } from "@/lib/mockData";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import { triggerMarginCallAlert } from "@/lib/notifier";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Mail,
  MessageCircle,
  Clock,
  Building2,
  Filter,
  Zap,
} from "lucide-react";
import { RiskLevel, MarginCallStatus } from "@prisma/client";
import Link from "next/link";

export default function AlertsPage() {
  const { batches } = getMockData();
  const criticalBatches = batches.filter((b) => b.riskLevel === RiskLevel.CRITICAL);
  const warningBatches = batches.filter((b) => b.riskLevel === RiskLevel.WARNING);

  const notifications = [
    ...criticalBatches.flatMap((b) =>
      b.marginCalls?.map((mc) => ({
        id: `crit-${b.id}-${mc.id}`,
        severity: "critical" as const,
        batchId: b.id,
        batchNumber: b.batchNumber,
        symbol: b.stockSymbol,
        title: `补仓警报触发 #${b.marginCalls?.indexOf(mc)! + 1}`,
        message: `批次 ${b.batchNumber} (${b.stockSymbol}) 跌幅 ${(mc.dropPercent * 100).toFixed(1)}%，需补仓 ${formatCurrency(mc.requiredAmount)}`,
        time: mc.createdAt,
        status: mc.status === "FULLFILLED" ? "resolved" : "pending",
      })) || []
    ),
    ...warningBatches.map((b) => ({
      id: `warn-${b.id}`,
      severity: "warning" as const,
      batchId: b.id,
      batchNumber: b.batchNumber,
      symbol: b.stockSymbol,
      title: "接近补仓预警线",
      message: `批次 ${b.batchNumber} (${b.stockSymbol}) 当前跌幅已接近 20% 补仓线，请密切关注`,
      time: b.updatedAt,
      status: "active" as const,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-danger/10 text-danger font-semibold">
              监控中心
            </span>
            <span>/</span>
            <span>风险警报中心</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            风险警报中心
          </h1>
          <p className="text-sm text-muted-foreground">
            实时监控补仓预警、历史通知记录与执行状态
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            筛选
          </Button>
          <Button size="sm" variant="danger" className="gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            {criticalBatches.length} 个待处理补仓
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">需补仓批次</p>
                <p className="text-3xl font-bold font-mono text-danger">
                  {criticalBatches.length}
                </p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-danger/15 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-danger" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">预警观察</p>
                <p className="text-3xl font-bold font-mono text-warning">
                  {warningBatches.length}
                </p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-warning/15 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">今日通知数</p>
                <p className="text-3xl font-bold font-mono">{notifications.length}</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-secondary flex items-center justify-center">
                <Mail className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">已完成补仓</p>
                <p className="text-3xl font-bold font-mono text-success">
                  {notifications.filter((n) => n.status === "resolved").length}
                </p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-success/15 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            通知时间线
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-0">
            {notifications.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>当前无风险警报</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-5 top-2 bottom-2 w-px bg-border" />
                {notifications.map((n) => (
                  <div key={n.id} className="relative pl-14 pb-5 last:pb-0">
                    <div
                      className={cn(
                        "absolute left-0 h-11 w-11 rounded-xl border-2 border-background flex items-center justify-center shadow-md",
                        n.severity === "critical"
                          ? "bg-danger/20"
                          : "bg-warning/20"
                      )}
                    >
                      {n.severity === "critical" ? (
                        <AlertCircle className="h-5 w-5 text-danger" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-warning" />
                      )}
                    </div>

                    <div
                      className={cn(
                        "rounded-xl border p-4 transition-all hover:shadow-md",
                        n.severity === "critical"
                          ? "bg-danger/5 border-danger/30"
                          : "bg-warning/5 border-warning/30"
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              variant={n.severity === "critical" ? "danger" : "warning"}
                              className="text-[10px] uppercase"
                            >
                              {n.severity === "critical" ? "严重警报" : "风险预警"}
                            </Badge>
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              {n.symbol}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {n.batchNumber}
                            </Badge>
                            {n.status === "resolved" && (
                              <Badge variant="success" className="gap-1 text-[10px]">
                                <CheckCircle className="h-2.5 w-2.5" />
                                已解决
                              </Badge>
                            )}
                            {n.status === "pending" && (
                              <Badge variant="danger" className="gap-1 text-[10px] animate-breath-danger">
                                <Clock className="h-2.5 w-2.5" />
                                待处理
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold text-sm">{n.title}</p>
                        </div>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {formatDateTime(n.time)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">{n.message}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/batch/${n.batchId}`}>
                          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                            <Building2 className="h-3.5 w-3.5" />
                            查看批次
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 text-xs"
                          onClick={async () => {
                            const batch = getMockData().batches.find((b) => b.id === n.batchId);
                            if (batch) {
                              const mc = batch.marginCalls?.[0];
                              if (mc) await triggerMarginCallAlert(batch as any, mc, batch.clients?.map(c => c.bdManager).filter(Boolean) as any);
                            }
                            console.log("[通知] 邮件通知风控及BD:", n);
                          }}
                        >
                          <Mail className="h-3.5 w-3.5" />
                          邮件通知
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 text-xs"
                          onClick={() => console.log("[通知] WhatsApp发送至相关人员:", n)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          WhatsApp
                        </Button>
                        {n.status === "pending" && n.severity === "critical" && (
                          <Button
                            size="sm"
                            variant="danger"
                            className="gap-1.5 h-8 text-xs ml-auto"
                            onClick={() => {
                              const mock = getMockData();
                              const b = mock.batches.find((x) => x.id === n.batchId);
                              const mc = b?.marginCalls?.find((x) => `crit-${b.id}-${x.id}` === n.id);
                              if (mc) {
                                mc.status = MarginCallStatus.FULLFILLED;
                                mc.fulfilledAmount = mc.requiredAmount;
                                mc.fulfilledDate = new Date();
                              }
                              window.location.reload();
                            }}
                          >
                            <Zap className="h-3.5 w-3.5" />
                            确认补仓
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
