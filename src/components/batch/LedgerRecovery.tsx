"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { resetMockTestData } from "@/lib/mockData";
import type { BatchLike } from "@/lib/riskEngine";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RotateCcw, Download, History } from "lucide-react";
import { toast } from "sonner";

export function LedgerRecovery({ batch, open, onOpenChange }: {
  batch: BatchLike; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { role } = useCurrentUser();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRestoreTs, setConfirmRestoreTs] = useState<string | null>(null);
  const [backups, setBackups] = useState<string[]>([]);
  const finance = batch.finance;
  const warnings = finance?.legacyWarnings ?? [];
  const institution = ["ADMIN", "RISK_MANAGER", "OPERATIONS"].includes(role);
  const canReset = process.env.NODE_ENV === "development" && role === "ADMIN";
  const missing = (batch.clients ?? []).filter(c =>
    c.status === "SETTLED" && !c.settlement && !finance?.settlements[c.id]);
  const unpriced = finance?.trades.filter(t => !t.entryPrice || t.needsReconciliation) ?? [];

  useEffect(() => {
    if (!open || !canReset) { setBackups([]); return; }
    try {
      const list = (typeof window !== "undefined" && typeof (window as any).__RISK_LIST_TEST_BACKUPS__ === "function")
        ? (window as any).__RISK_LIST_TEST_BACKUPS__() as string[]
        : [];
      setBackups(Array.isArray(list) ? list : []);
    } catch { setBackups([]); }
  }, [open, canReset]);

  const refreshBackups = () => {
    try {
      const list = (typeof window !== "undefined" && typeof (window as any).__RISK_LIST_TEST_BACKUPS__ === "function")
        ? (window as any).__RISK_LIST_TEST_BACKUPS__() as string[]
        : [];
      setBackups(Array.isArray(list) ? list : []);
    } catch { setBackups([]); }
  };

  const download = () => {
    if (!institution) return;
    try {
      const report = {
        purpose: "历史账目待核对清单，不作为付款凭证",
        batchId: batch.id, batchNumber: batch.batchNumber,
        generatedAt: new Date().toISOString(), warnings,
        missingSettlements: missing.map(c => ({
          clientId: c.id, name: c.name, settledAt: c.settledAt,
          required: ["结算日期", "客户与机构各自实收", "退出份额", "结算计价及分成依据"],
        })),
        institutionTradesToReview: finance?.trades ?? [],
        nextStep: "请机构管理员核对原始记账凭证；当前版本暂不支持在线补录历史结算，不可直接放行或重建真实账目。",
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ledger-review-${batch.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("核对清单已导出，请交机构管理员处理。");
    } catch { toast.error("导出失败，请重试；账目未修改。"); }
  };

  const formatBackupTs = (ts: string): string => {
    try {
      const n = Number(ts);
      if (!Number.isFinite(n) || n < 1e12) return ts;
      const d = new Date(n);
      const pad = (x: number) => x.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch { return ts; }
  };

  if (!warnings.length) return null;
  return (
    <>
      <section role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-4 space-y-3">
        <h2 className="font-semibold text-warning">历史账目资料不完整，需要先核对</h2>
        <p className="text-sm">系统无法确认剩余仓位，部分资金操作已暂停。这不是补仓失败，也没有发生资金划转。</p>
        <p className="text-xs text-muted-foreground">先重新检查，排除旧页面缓存；如仍提示，请查看处理方法。当前估值仅供核对。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>重新检查账本</Button>
          <Button onClick={() => onOpenChange(true)}>查看处理方法</Button>
        </div>
      </section>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>如何恢复补仓与结算</DialogTitle>
            <DialogDescription>批次 {batch.batchNumber || batch.id}。本窗口不会修改资金记录。</DialogDescription>
          </DialogHeader>
          {institution ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border p-3 space-y-2">
                <h3 className="font-semibold">需要核对的记录</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {warnings.map(warning => <li key={warning}>{warning.replace("无成交快照", "缺少完整结算记录")}</li>)}
                </ul>
                {missing.length > 0 && <p>缺少结算记录的客户（{missing.length} 位）：{missing.map(c => c.name || c.id).join("、")}</p>}
                {unpriced.length > 0 && <p>缺少计价依据的机构补仓：{unpriced.length} 笔。</p>}
                {!missing.length && !unpriced.length && <p>当前警告可能涉及历史分配或旧版本记录，请先重新检查；不能据此认定账目已核实。</p>}
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">如果是真实账目</h3>
                <p>导出核对清单，交机构管理员核实结算日期、客户与机构实收、退出份额，以及补仓金额和分配依据。无需接入券商。</p>
                <p className="text-muted-foreground">当前版本尚无在线历史补录功能。核实资料后仍需安排账本修复，导出本身不会解除限制。请勿用重建测试数据代替真实账目核对。</p>
                <Button variant="outline" onClick={download}><Download className="h-3.5 w-3.5 mr-1.5" />导出待核对清单</Button>
              </div>
              {canReset && <div className="rounded-lg border border-danger/30 p-3 space-y-2">
                <h3 className="font-semibold">如果全部是旧测试数据</h3>
                <p>仅本地开发环境管理员可用。备份后替换当前浏览器、当前站点的全部测试账目，不只是此批次；其他浏览器及端口不会同步清理。</p>
                <Button variant="danger" onClick={() => { onOpenChange(false); setConfirmReset(true); }}><RotateCcw className="h-3.5 w-3.5 mr-1.5" />重建本地测试数据</Button>
              </div>}
              {canReset && <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold flex items-center gap-1.5"><History className="h-4 w-4" />从最近备份恢复</h3>
                  <Button size="sm" variant="ghost" onClick={refreshBackups}><RotateCcw className="h-3 w-3 mr-1" />刷新列表</Button>
                </div>
                {backups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无可用备份。执行过重建/清空前系统会自动写入一个备份。</p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {backups.map((ts) => (
                      <li key={ts} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5">
                        <span className="text-xs font-mono tabular-nums">{formatBackupTs(ts)} <span className="text-muted-foreground ml-1">({ts})</span></span>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setConfirmRestoreTs(ts)}>恢复</Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground">恢复会覆盖当前站点全部账本，操作不可撤销；成功后页面会自动重新加载。</p>
              </div>}
            </div>
          ) : <p className="text-sm">请联系机构管理员或风控负责人，由其导出并核对历史结算记录。你无需重复申请补仓。</p>}
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirmReset} onOpenChange={setConfirmReset} tone="danger"
        title="确认全部是测试账目，再重建"
        description="将备份并替换当前站点全部客户、补仓、结算、通知测试记录，保留登录账号、Logo 和系统配置。如包含任何真实记账记录，请取消。重建成功后页面会重新加载。"
        confirmText="确认是测试数据，备份并重建"
        cancelText="取消，保留现有账目"
        onConfirm={() => {
          if (!canReset) throw new Error("仅本地开发环境管理员可重建测试数据。");
          resetMockTestData();
          window.location.reload();
        }} />
      <ConfirmDialog open={!!confirmRestoreTs} onOpenChange={(next) => { if (!next) setConfirmRestoreTs(null); }} tone="warning"
        title="从备份恢复账本"
        description={`将还原到 ${confirmRestoreTs ? formatBackupTs(confirmRestoreTs) : ""} 的备份。当前站点的所有客户、补仓、结算、通知记录都会被覆盖。此操作不可撤销。`}
        confirmText="确认还原到此备份"
        cancelText="取消"
        onConfirm={() => {
          if (!confirmRestoreTs) return;
          try {
            const fn = (window as any).__RISK_RESTORE_TEST_BACKUP__;
            if (typeof fn !== "function") { toast.error("恢复函数不可用（仅开发环境）"); return; }
            const ok = fn(confirmRestoreTs) as boolean;
            if (!ok) toast.error("恢复失败：找不到该备份或解析失败。");
          } catch (e: any) {
            toast.error(e?.message ?? "恢复失败。");
          } finally {
            setConfirmRestoreTs(null);
          }
        }} />
    </>
  );
}
