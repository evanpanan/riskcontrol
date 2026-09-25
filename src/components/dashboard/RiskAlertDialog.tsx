"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Batch, RiskLevel } from "@prisma/client";
import {
  Flame,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface RiskAlertItem {
  alertKey: string;
  batchId: string;
  batchNumber: string;
  stockSymbol: string;
  stockName: string;
  riskLevel: RiskLevel;
  dropPercent: number;
  requiredMarginCall: number;
  signDate: Date;
  clientCount: number;
  initialTotalAmount: number;
  currentMarketValue: number;
  firstSeenAt: number;
}

interface RiskAlertDialogProps {
  alerts: RiskAlertItem[];
  onDismissAll: () => void;
  onDismissOne: (batchId: string) => void;
  settingsEnabled: boolean;
}

function beep(enabled: boolean) {
  if (!enabled) return;
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.setValueAtTime(420, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
    setTimeout(() => {
      try { ctx.close(); } catch {}
    }, 600);
  } catch {}
}

export function RiskAlertDialog({
  alerts,
  onDismissAll,
  onDismissOne,
  settingsEnabled,
}: RiskAlertDialogProps) {
  const [muted, setMuted] = useState(false);
  const beepedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!settingsEnabled || alerts.length === 0) return;
    for (const a of alerts) {
      if (!beepedIdsRef.current.has(a.alertKey)) {
        beepedIdsRef.current.add(a.alertKey);
        if (a.riskLevel === RiskLevel.CRITICAL) {
          beep(!muted);
        }
      }
    }
  }, [alerts, muted, settingsEnabled]);

  const open = settingsEnabled && alerts.length > 0;
  const criticalAlerts = alerts.filter((a) => a.riskLevel === RiskLevel.CRITICAL);
  const warningAlerts = alerts.filter((a) => a.riskLevel === RiskLevel.WARNING);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDismissAll()}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-hidden flex flex-col animate-drawer-in">
        <DialogHeader className="pb-0">
          <DialogTitle className="flex items-start justify-start gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-danger/15 border border-danger/30 flex items-center justify-center shrink-0 animate-breath-danger">
                <Flame className="h-5 w-5 text-danger" />
              </div>
              <div className="flex items-center gap-3">
                <p className="font-bold tracking-tight">
                  风险警报 · 实时监控
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setMuted(!muted)}
                  title={muted ? "开启提示音" : "静音提示音"}
                >
                  {muted ? (
                    <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5 text-success" />
                  )}
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground font-normal w-full pl-12">
              检测到 {alerts.length} 个新风险批次 · 击穿 {criticalAlerts.length} · 预警 {warningAlerts.length}
            </p>
          </DialogTitle>
        </DialogHeader>
        {process.env.NODE_ENV === "development" && <p className="text-[11px] text-muted-foreground">
          开发模式下使用快照/模拟报价进行场景演示，不代表实时行情。
        </p>}

        <div className="flex-1 overflow-y-auto mt-4 space-y-2 pr-1">
          {alerts.map((a) => (
            <div
              key={a.batchId}
              className={cn(
                "rounded-xl border p-4 transition-all",
                a.riskLevel === RiskLevel.CRITICAL
                  ? "bg-danger/[0.05] border-danger/40 animate-card-crit"
                  : "bg-warning/[0.05] border-warning/40 animate-card-warn"
              )}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={a.riskLevel === RiskLevel.CRITICAL ? "danger" : "warning"}
                      className="text-[10px] h-5"
                    >
                      {a.riskLevel === RiskLevel.CRITICAL ? (
                        <span className="inline-flex items-center gap-1">
                          <Flame className="h-2.5 w-2.5" /> 击穿 · 需补仓
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <AlertTriangle className="h-2.5 w-2.5" /> 预警
                        </span>
                      )}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground bg-secondary/50 rounded px-2 py-0.5">
                      {a.batchNumber}
                    </span>
                    <span className="font-bold text-sm">{a.stockSymbol}</span>
                    <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                      {a.stockName}
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">账户跌幅</p>
                      <p className={cn(
                        "font-mono font-bold",
                          a.dropPercent >= 20 ? "text-danger" : "text-warning"
                      )}>
                        {formatPercent(-Math.abs(a.dropPercent))}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">账户资金基准</p>
                      <p className="font-mono font-semibold">
                        {formatCurrency(a.initialTotalAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">当前账户总资产</p>
                      <p className="font-mono font-semibold">
                        {formatCurrency(a.currentMarketValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {a.riskLevel === RiskLevel.CRITICAL ? "机构需补仓" : "客户数"}
                      </p>
                      <p className={cn(
                        "font-mono font-bold",
                        a.riskLevel === RiskLevel.CRITICAL && "text-danger"
                      )}>
                        {a.riskLevel === RiskLevel.CRITICAL
                          ? formatCurrency(a.requiredMarginCall)
                          : `${a.clientCount} 位`}
                      </p>
                      {a.requiredMarginCall > 0 && <p className="text-[10px] text-muted-foreground">本轮触发时锁定的剩余缺口</p>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Link href={`/batch/${a.batchId}`} className="w-full" onClick={() => onDismissOne(a.batchId)}>
                    <Button size="sm" className="gap-1 w-full">
                      <ExternalLink className="h-3.5 w-3.5" />
                      查看批次
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground hover:text-foreground w-full"
                    onClick={() => onDismissOne(a.batchId)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    已知晓
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-4 mt-1 border-t border-border/50">
          <p className="text-[10.5px] text-muted-foreground font-mono">
            总资产含机构补仓仓位；跌至资金基准的 80% 及以下触发补仓。部分退出后基准同比缩减。
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onDismissAll}>
              全部知晓
            </Button>
            <Link href="/margin-calls" onClick={onDismissAll}>
              <Button size="sm" className="gap-1" variant="danger">
                <Flame className="h-3.5 w-3.5" />
                处理击穿批次
              </Button>
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
