"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FINANCE_STORE_KEY, getMockData, reloadMockData, resetMockTestData } from "@/lib/mockData";
import { BatchDetailContent } from "@/components/batch/BatchDetailContent";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface BatchDetailPageProps {
  params: { id: string };
}

export default function BatchDetailPage({ params }: BatchDetailPageProps) {
  const [batch, setBatch] = useState<ReturnType<typeof getMockData>["batches"][number] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = (fromStorage: boolean) => {
      try {
        const data = fromStorage ? reloadMockData() : getMockData();
        setBatch(data.batches.find((b) => b.id === params.id) ?? null);
        setLoadError("");
        setTick((x) => x + 1);
      } catch (error) {
        const devMode =
          process.env.NODE_ENV === "development" ||
          /localhost|127\.0\.0\.1|:300[0-9]$/.test(window.location.host);
        if (devMode && (window as any).__RISK_RESET_TEST_DATA__) {
          try {
            (window as any).__RISK_RESET_TEST_DATA__(true);
            const data = reloadMockData();
            setBatch(data.batches.find((b) => b.id === params.id) ?? null);
            setLoadError("");
            setTick((x) => x + 1);
            return;
          } catch {
            /* 真实账本不满足 pristine，走下面的报错流程 */
          }
        }
        setBatch(null);
        setLoadError(error instanceof Error ? error.message : "账本读取失败");
      } finally { setLoading(false); }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === FINANCE_STORE_KEY || event.key === null) load(true);
    };
    const onFinance = () => load(false);
    load(true);
    window.addEventListener("storage", onStorage);
    window.addEventListener("risk-control:finance-changed", onFinance);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("risk-control:finance-changed", onFinance);
    };
  }, [params.id]);

  if (loading) return <p role="status" className="p-6 text-muted-foreground">正在读取最新账本...</p>;

  if (!batch) {
    const devMode =
      typeof window !== "undefined" &&
      (process.env.NODE_ENV === "development" ||
        /localhost|127\.0\.0\.1|:300[0-9]$/.test(window.location.host));
    return (
      <div className="max-w-4xl mx-auto text-center py-20 px-4 space-y-6">
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 space-y-4">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h2 className="text-xl font-bold mb-2">{loadError ? "账本暂时无法读取" : "批次未找到"}</h2>
        <p role={loadError ? "alert" : undefined} className="text-muted-foreground whitespace-pre-wrap mb-6">{loadError || `ID: ${params.id}`}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {loadError && devMode && (
          <Button variant="destructive" className="mr-3" onClick={() => {
            try {
              const r = resetMockTestData();
              toast.success(`已重建测试账本（备份 ${r.backupKey}）`);
              setTimeout(() => window.location.reload(), 150);
            } catch (e: any) {
              toast.error(e?.message ?? "重置失败，请手动清理 localStorage。");
            }
          }}>
            仅开发环境：重建测试账本（会先备份）
          </Button>
          )}
          {loadError && <Button onClick={() => window.location.reload()}>重新检查账本</Button>}
          <Link href="/">
            <Button>
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回风控大盘
            </Button>
          </Link>
        </div>
        {loadError && (
          <div className="mt-4 rounded-lg bg-background/60 p-3 text-left text-[11.5px] text-muted-foreground space-y-1">
            <div>· 操作会经过「真实账目校验」：存在真实结算 / 已履约补仓 / 非 legacy 手动交易的账本会被拒绝执行。</div>
            <div>· 执行前会先备份到 localStorage <code className="font-mono">risk_control_test_backup_*</code>，可在「历史账目恢复入口」还原。</div>
            {!devMode && (
            <div>· 当前为生产/预览环境，浏览器端账本重建入口已禁用。请通过部署环境的账本修复流程或联系开发管理员处理。</div>
            )}
          </div>
        )}
      </div>
      </div>
    );
  }

  return (
    <div className="px-0 lg:px-4 py-4 lg:py-6">
      <BatchDetailContent batch={batch as any} onChange={() => setTick((x) => x + 1)} />
    </div>
  );
}
