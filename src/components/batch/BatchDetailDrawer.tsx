"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BatchLikeForDetail } from "./BatchDetailContent";
import { BatchDetailContent } from "./BatchDetailContent";

interface BatchDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  batch: BatchLikeForDetail | null;
  onStateChange?: () => void;
}

export function BatchDetailDrawer({ open, onClose, batch, onStateChange }: BatchDetailDrawerProps) {
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" aria-hidden={!open}>
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px] animate-drawer-scrim-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute right-0 top-0 bottom-0 w-[min(640px,94vw)] lg:w-[680px] xl:w-[760px]",
          "bg-card border-l border-border/60 shadow-2xl animate-drawer-in flex flex-col overflow-hidden"
        )}
      >
        {/* Header handle bar */}
        <div className="border-b border-border/50 bg-background/60 backdrop-blur-xl px-5 py-3 flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-10 rounded-full bg-muted-foreground/25 -ml-1" />
            <p className="text-[11px] text-muted-foreground font-medium tracking-wider uppercase ml-2">
              批次详情 · 侧栏预览
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {batch && (
              <Link
                href={`/batch/${batch.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex"
              >
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-[11px]">
                  <ExternalLink className="h-3.5 w-3.5" />
                  新页面打开
                </Button>
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 rounded-md"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin overscroll-contain px-5 py-5">
          {batch ? (
            <BatchDetailContent batch={batch} compact onBack={onClose} onChange={onStateChange} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <p className="text-sm">无批次数据</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
