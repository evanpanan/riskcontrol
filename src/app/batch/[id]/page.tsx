"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FINANCE_STORE_KEY, getMockData, reloadMockData } from "@/lib/mockData";
import { BatchDetailContent } from "@/components/batch/BatchDetailContent";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h2 className="text-xl font-bold mb-2">{loadError ? "账本暂时无法读取" : "批次未找到"}</h2>
        <p role={loadError ? "alert" : undefined} className="text-muted-foreground mb-6">{loadError || `ID: ${params.id}`}</p>
        {loadError && <Button className="mr-3" onClick={() => window.location.reload()}>重新检查账本</Button>}
        <Link href="/">
          <Button>
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回风控大盘
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="px-0 lg:px-4 py-4 lg:py-6">
      <BatchDetailContent batch={batch as any} onChange={() => setTick((x) => x + 1)} />
    </div>
  );
}
