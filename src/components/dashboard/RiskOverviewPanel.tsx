"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn, formatPercent } from "@/lib/utils";
import { calculatePortfolioSummary, WARNING_DROP_THRESHOLD, CRITICAL_DROP_THRESHOLD } from "@/lib/riskEngine";
import { Batch, Client, MarginCall, RiskLevel } from "@prisma/client";
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lock,
  Unlock,
  Clock,
} from "lucide-react";

interface RiskOverviewPanelProps {
  batches: (Batch & { clients?: Client[]; marginCalls?: MarginCall[] })[];
}

export function RiskOverviewPanel({ batches }: RiskOverviewPanelProps) {
  const summary = calculatePortfolioSummary(batches);
  const lockedCount = batches.filter((b) => b.status === "LOCKED").length;
  const tradingCount = batches.filter((b) => b.status === "TRADING_OPEN").length;
  const closedCount = batches.filter((b) => b.status === "CLOSED").length;

  const distributionBars = [
    { label: "正常", count: summary.normalCount, variant: "success" as const, color: "bg-success", Icon: CheckCircle2 },
    { label: "预警(15-20%)", count: summary.warningCount, variant: "warning" as const, color: "bg-warning", Icon: AlertTriangle },
    { label: "严重(>20%)", count: summary.criticalCount, variant: "danger" as const, color: "bg-danger", Icon: AlertCircle },
  ];

  const maxCount = Math.max(1, summary.normalCount + summary.warningCount + summary.criticalCount);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">风险分布看板</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                共 {summary.totalBatches} 个批次 · 实时监控
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="gap-1.5">
            <div className="relative">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            </div>
            系统运行中
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">批次风险等级分布</span>
            <span className="font-mono font-semibold">
              {summary.normalCount}/{summary.warningCount}/{summary.criticalCount}
            </span>
          </div>

          {distributionBars.map((bar) => {
            const pct = (bar.count / maxCount) * 100;
            const Icon = bar.Icon;
            return (
              <div key={bar.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icon className={cn("h-3.5 w-3.5",
                      bar.variant === "success" && "text-success",
                      bar.variant === "warning" && "text-warning",
                      bar.variant === "danger" && "text-danger"
                    )} />
                    {bar.label}
                  </span>
                  <span className="font-mono font-bold">
                    {bar.count}
                    <span className="text-muted-foreground font-normal ml-0.5">
                      ({formatPercent((bar.count / maxCount) * 100, 0)})
                    </span>
                  </span>
                </div>
                <div className="h-6 rounded-md bg-secondary overflow-hidden flex">
                  <div
                    className={cn("h-full transition-all duration-700 flex items-center justify-end pr-2", bar.color)}
                    style={{ width: `${Math.max(pct, bar.count > 0 ? 8 : 0)}%`, opacity: 0.85 }}
                  >
                    {bar.count > 0 && pct > 15 && (
                      <span className="text-[10px] font-bold text-white drop-shadow">
                        {bar.count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              生命周期状态
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-secondary/50 border border-border/40 p-3 text-center">
              <Lock className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground" />
              <p className="text-lg font-bold font-mono">{lockedCount}</p>
              <p className="text-[10px] text-muted-foreground">锁仓期</p>
            </div>
            <div className="rounded-lg bg-success/10 border border-success/20 p-3 text-center">
              <Unlock className="h-4 w-4 mx-auto mb-1.5 text-success" />
              <p className="text-lg font-bold font-mono text-success">{tradingCount}</p>
              <p className="text-[10px] text-muted-foreground">开放交易</p>
            </div>
            <div className="rounded-lg bg-secondary/50 border border-border/40 p-3 text-center">
              <Shield className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground" />
              <p className="text-lg font-bold font-mono">{closedCount}</p>
              <p className="text-[10px] text-muted-foreground">已到期</p>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border/50 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground uppercase tracking-wider">
              预警线指示
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-12 rounded bg-warning/60" />
              <span className="text-[11px] text-muted-foreground">
                预警线 15% 跌幅
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-12 rounded bg-danger" />
              <span className="text-[11px] text-muted-foreground">
                补仓线 20% 跌幅 · 触发机构补仓
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
