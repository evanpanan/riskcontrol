"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getMockData } from "@/lib/mockData";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import { notifyBatchChannel, getNotificationLogs, type NotificationLogEntry } from "@/lib/notifier";
import { toast } from "sonner";
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
  XCircle,
  Send,
} from "lucide-react";
import { RiskLevel, MarginCallStatus } from "@prisma/client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AlertsPage() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("risk-control:finance-changed", handler);
    window.addEventListener("risk-control:quote-changed", handler);
    window.addEventListener("risk-control:client-status-changed", handler);
    window.addEventListener("risk-control:notifications-changed", handler);
    const onStorage = () => setTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(handler, 5000);
    return () => {
      window.removeEventListener("risk-control:finance-changed", handler);
      window.removeEventListener("risk-control:quote-changed", handler);
      window.removeEventListener("risk-control:client-status-changed", handler);
      window.removeEventListener("risk-control:notifications-changed", handler);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, []);
  void tick;
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

  // 邮件 / WhatsApp 实际发送记录：仅展示发起过外部通道的条目
  const sendLogs = getNotificationLogs().filter((entry) =>
    (entry.result?.recipientCount?.emails ?? 0) > 0 ||
    (entry.result?.recipientCount?.whatsapps ?? 0) > 0
  );

  const emailSentCount = sendLogs.filter((e) => (e.result?.channels?.email?.sentTo?.length ?? 0) > 0).length;
  const waSentCount = sendLogs.filter((e) => (e.result?.channels?.whatsapp?.sentTo?.length ?? 0) > 0).length;
  const failedCount = sendLogs.filter((e) => e.status === "failed" || e.status === "partial").length;

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
                <p className="text-xs text-muted-foreground mb-1">邮件已发送</p>
                <p className="text-3xl font-bold font-mono">{emailSentCount}</p>
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
                <p className="text-xs text-muted-foreground mb-1">WhatsApp 已发送</p>
                <p className="text-3xl font-bold font-mono text-success">{waSentCount}</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-success/15 flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="alerts" className="w-full">
        <TabsList className="h-9">
          <TabsTrigger value="alerts" className="text-xs gap-1.5 data-[state=active]:text-danger">
            <AlertCircle className="h-3.5 w-3.5" />
            风险警报
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{notifications.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="records" className="text-xs gap-1.5">
            <Send className="h-3.5 w-3.5" />
            发送记录
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{sendLogs.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
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
                                try { if (batch) toast.success(await notifyBatchChannel(batch as any, "email")); }
                                catch (err) { toast.error(err instanceof Error ? err.message : "通知失败"); }
                              }}
                            >
                              <Mail className="h-3.5 w-3.5" />
                              邮件通知
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 h-8 text-xs"
                              onClick={async () => {
                                const batch = getMockData().batches.find((b) => b.id === n.batchId);
                                try { if (batch) toast.success(await notifyBatchChannel(batch as any, "whatsapp")); }
                                catch (err) { toast.error(err instanceof Error ? err.message : "通知失败"); }
                              }}
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              推送给订阅者
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
        </TabsContent>

        <TabsContent value="records">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Send className="h-4 w-4" />
                邮件 / WhatsApp 发送记录
                {failedCount > 0 && (
                  <Badge variant="danger" className="ml-2 gap-1 text-[10px]">
                    <XCircle className="h-2.5 w-2.5" />
                    {failedCount} 条未成功
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {sendLogs.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Send className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>暂无外部通知发送记录</p>
                  <p className="text-xs mt-1">在风险警报或批次详情点击「邮件通知 / WhatsApp」后，记录会显示在这里</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {sendLogs.map((entry) => (
                    <SendRecordRow key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SendRecordRow({ entry }: { entry: NotificationLogEntry }) {
  const emailCh = entry.result?.channels?.email;
  const waCh = entry.result?.channels?.whatsapp;
  const emailSent = emailCh?.sentTo?.length ?? 0;
  const waSent = waCh?.sentTo?.length ?? 0;
  const emailError = emailCh?.error;
  const waError = waCh?.error;
  const allOk = entry.status === "success";
  const partial = entry.status === "partial";

  const recipients = [
    ...(emailCh?.sentTo ?? []).map((v) => ({ ch: "email" as const, v })),
    ...(waCh?.sentTo ?? []).map((v) => ({ ch: "whatsapp" as const, v })),
  ];

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {allOk ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <CheckCircle className="h-2.5 w-2.5" /> 发送成功
              </Badge>
            ) : partial ? (
              <Badge variant="warning" className="gap-1 text-[10px]">
                <AlertTriangle className="h-2.5 w-2.5" /> 部分成功
              </Badge>
            ) : (
              <Badge variant="danger" className="gap-1 text-[10px]">
                <XCircle className="h-2.5 w-2.5" /> 发送失败
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-normal">
              {entry.payload.type ?? "INFO"}
            </Badge>
            {entry.payload.batchNumber && (
              <Badge variant="secondary" className="text-[10px] font-mono">
                {entry.payload.batchNumber}
              </Badge>
            )}
            {entry.payload.stockSymbol && (
              <Badge variant="secondary" className="text-[10px] font-mono">
                {entry.payload.stockSymbol}
              </Badge>
            )}
          </div>
          <p className="text-sm font-semibold truncate">{entry.payload.title}</p>
          {recipients.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {recipients.slice(0, 6).map((r, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono",
                    r.ch === "email"
                      ? "bg-secondary/60 text-foreground"
                      : "bg-success/10 text-success"
                  )}
                >
                  {r.ch === "email" ? <Mail className="h-2.5 w-2.5" /> : <MessageCircle className="h-2.5 w-2.5" />}
                  {r.v}
                </span>
              ))}
              {recipients.length > 6 && (
                <span className="text-[11px] text-muted-foreground">+{recipients.length - 6}</span>
              )}
            </div>
          )}
          {(emailError || waError) && (
            <p className="text-[11px] text-danger mt-1.5 line-clamp-2">
              {[emailError, waError].filter(Boolean).join("；")}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 justify-end text-[11px] text-muted-foreground font-mono mb-1">
            {emailSent > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Mail className="h-2.5 w-2.5" /> {emailSent}
              </span>
            )}
            {waSent > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageCircle className="h-2.5 w-2.5" /> {waSent}
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            {formatDateTime(entry.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
