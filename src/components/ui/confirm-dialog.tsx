"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";

export type ConfirmDialogTone = "danger" | "warning" | "info" | "success";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  title?: React.ReactNode;
  description?: React.ReactNode;
  tone?: ConfirmDialogTone;
  confirmText?: React.ReactNode;
  cancelText?: React.ReactNode;
  confirmLoading?: boolean;
  confirmDisabled?: boolean;
  footerExtra?: React.ReactNode;
  summary?: Array<{ label: string; value: React.ReactNode; accent?: "danger" | "warning" | "success" | "primary" | "muted" }>;
  contentClassName?: string;
}

const toneConfig: Record<
  ConfirmDialogTone,
  {
    badgeVariant: any;
    badgeClass?: string;
    accentText: string;
    accentBg: string;
    buttonVariant: any;
    Icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
  }
> = {
  danger: {
    badgeVariant: "danger",
    accentText: "text-danger",
    accentBg: "bg-danger/10 text-danger ring-1 ring-danger/20",
    buttonVariant: "danger",
    Icon: ShieldAlert,
    iconClass: "text-danger",
  },
  warning: {
    badgeVariant: "warning",
    accentText: "text-warning",
    accentBg: "bg-warning/10 text-warning ring-1 ring-warning/20",
    buttonVariant: "warning",
    Icon: AlertTriangle,
    iconClass: "text-warning",
  },
  info: {
    badgeVariant: "primary",
    accentText: "text-primary",
    accentBg: "bg-primary/10 text-primary ring-1 ring-primary/20",
    buttonVariant: "default",
    Icon: Info,
    iconClass: "text-primary",
  },
  success: {
    badgeVariant: "success",
    accentText: "text-success",
    accentBg: "bg-success/10 text-success ring-1 ring-success/20",
    buttonVariant: "success",
    Icon: CheckCircle2,
    iconClass: "text-success",
  },
};

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "确认执行此操作",
  description,
  tone = "warning",
  confirmText = "确认",
  cancelText = "取消",
  confirmLoading,
  confirmDisabled,
  footerExtra,
  summary,
  contentClassName,
}: ConfirmDialogProps) {
  const cfg = toneConfig[tone];
  const Icon = cfg.Icon;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  React.useEffect(() => { if (open) setError(null); }, [open]);

  const loading = confirmLoading || busy;

  const handleConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setError(null);
      setBusy(true);
      const ret = onConfirm();
      if (ret && typeof (ret as any).then === "function") await ret;
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (loading ? void 0 : onOpenChange(v))}>
      <DialogContent
        className={cn(
          "w-[95%] max-w-xl rounded-2xl p-0 overflow-hidden",
          "gradient-card border-border/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]",
          contentClassName
        )}
      >
        <div className="border-b border-border/50 px-6 py-5 bg-background/40">
          <div className="flex items-start gap-4">
            <div className={cn("h-11 w-11 shrink-0 rounded-xl flex items-center justify-center", cfg.accentBg)}>
              <Icon className={cn("h-5.5 w-5.5", cfg.iconClass)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <Badge variant={cfg.badgeVariant as any} className="h-5 text-[10.5px] px-2">
                  {tone === "danger"
                    ? "高风险操作"
                    : tone === "warning"
                      ? "需要确认"
                      : tone === "success"
                        ? "操作确认"
                        : "操作提示"}
                </Badge>
              </div>
              <DialogHeader className="!text-left !space-y-1">
                <DialogTitle className="text-[15px] font-bold leading-snug tracking-tight pr-4">
                  {title}
                </DialogTitle>
                {description && (
                  <DialogDescription className="text-[12.5px] leading-relaxed !mt-1">
                    {description}
                  </DialogDescription>
                )}
              </DialogHeader>
            </div>
          </div>
        </div>

        {summary && summary.length > 0 && (
          <div className="px-6 py-4 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 rounded-xl border border-border/50 bg-background/30 px-4 py-3.5">
              {summary.map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between gap-4",
                    i % 2 === 1 ? "sm:justify-self-end sm:min-w-0 sm:w-full" : ""
                  )}
                >
                  <span className="text-[11px] font-medium text-muted-foreground shrink-0">
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      "text-[12.5px] font-semibold tabular-nums",
                      s.accent === "danger" && "text-danger",
                      s.accent === "warning" && "text-warning",
                      s.accent === "success" && "text-success",
                      s.accent === "primary" && "text-primary",
                      (!s.accent || s.accent === "muted") && "text-foreground"
                    )}
                  >
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p role="alert" className="px-6 pb-3 text-sm text-danger">{error}</p>}
        <DialogFooter className="px-6 py-4 border-t border-border/50 bg-background/30 !gap-2 !flex-row-reverse sm:!flex-row-reverse !justify-end !space-x-0">
          {footerExtra}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4 text-[12.5px] font-medium flex-1 sm:flex-none"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {cancelText}
            </Button>
            <Button
              type="button"
              variant={cfg.buttonVariant as any}
              className="h-10 px-5 text-[12.5px] font-semibold flex-1 sm:flex-none gap-1.5 shadow-lg shadow-black/10"
              onClick={handleConfirm}
              disabled={loading || confirmDisabled}
            >
              {loading ? (
                <>
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-border border-t-current animate-spin" />
                  处理中...
                </>
              ) : (
                confirmText
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
