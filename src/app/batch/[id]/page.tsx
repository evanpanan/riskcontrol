"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getMockData } from "@/lib/mockData";
import { BatchDetailContent } from "@/components/batch/BatchDetailContent";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BatchDetailPageProps {
  params: { id: string };
}

export default function BatchDetailPage({ params }: BatchDetailPageProps) {
  const { batches } = getMockData();
  const batch = batches.find((b) => b.id === params.id);
  const [, setTick] = useState(0);

  const b = useMemo(() => batch as any, [batch]);

  if (!batch) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h2 className="text-xl font-bold mb-2">批次未找到</h2>
        <p className="text-muted-foreground mb-6">ID: {params.id}</p>
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
      <BatchDetailContent batch={b} onChange={() => setTick((x) => x + 1)} />
    </div>
  );
}
