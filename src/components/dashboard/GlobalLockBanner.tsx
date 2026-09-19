"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Lock, X } from "lucide-react";
import { useState } from "react";

interface GlobalLockBannerProps {
  lockedBatchCount?: number;
}

export function GlobalLockBanner({ lockedBatchCount = 3 }: GlobalLockBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border mb-6",
      "bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-orange-500/15",
      "border-amber-500/30",
      "shadow-lg shadow-amber-500/5"
    )}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.1),transparent_50%)]" />
      <div className="relative p-4 flex items-start gap-4">
        <div className="shrink-0 h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
          <Lock className="h-5 w-5 text-amber-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <Badge variant="warning" className="gap-1.5 text-[11px] px-3 py-1">
              <AlertTriangle className="h-3 w-3" />
              全局锁仓期提醒
            </Badge>
            <span className="text-xs font-semibold text-amber-300">
              共 {lockedBatchCount} 个批次处于锁仓期内
            </span>
          </div>
          <p className="text-sm text-amber-100/90 leading-relaxed">
            所有批次<strong className="text-amber-300">签约前 6 个月为锁仓期</strong>，
            期间<strong className="text-amber-300 font-bold">禁止任何交易操作</strong>。
            锁仓期结束后，每 3 个月（第 6/9/12/15/18/21/24 月）开放一次为期 14 天的交易窗口。
          </p>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 h-8 w-8 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-amber-200/60 hover:text-amber-100 transition-colors"
          aria-label="关闭提醒"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
