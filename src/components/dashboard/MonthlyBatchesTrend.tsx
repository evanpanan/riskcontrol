"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Batch } from "@prisma/client";
import { LineChart, BarChart3 } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export function MonthlyBatchesTrend({ batches, isAnimationActive = false }: { batches: Batch[]; isAnimationActive?: boolean }) {
  const monthlySeries = useMemo(() => {
    const byMonthKey = new Map<string, { label: string; count: number; cumAUM: number }>();
    for (const b of batches) {
      const d = new Date(b.signDate ?? b.createdAt ?? 0);
      if (!isFinite(d.valueOf())) continue;
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const existing = byMonthKey.get(key) ?? { label: `${y}年${m}月`, count: 0, cumAUM: 0 };
      existing.count += 1;
      existing.cumAUM += Number(b.initialTotalAmount ?? b.currentMarketValue ?? 0);
      byMonthKey.set(key, existing);
    }
    const keysSorted = Array.from(byMonthKey.keys()).sort();
    const last6 = keysSorted.slice(-6);
    const maxCount = Math.max(1, ...last6.map((k) => byMonthKey.get(k)!.count));
    let runningTotal = 0;
    return last6.map((key, idx) => {
      const item = byMonthKey.get(key)!;
      runningTotal += item.count;
      const [_y, _m] = key.split("-");
      return {
        key,
        label: `${Number(_m)}月`,
        monthFullLabel: item.label,
        count: item.count,
        cumAUM: item.cumAUM,
        heightPct: Math.round((item.count / maxCount) * 100),
        runningTotal,
        isLast: idx === last6.length - 1,
        yearLabel: idx === 0 || _m === "01" ? _y : undefined,
      };
    });
  }, [batches]);

  if (monthlySeries.length === 0) return null;

  const chartData = monthlySeries.map((m) => ({
    label: m.label,
    fullLabel: m.monthFullLabel,
    count: m.count,
    runningTotal: m.runningTotal,
  }));

  const totalIn6m = monthlySeries[monthlySeries.length - 1]?.runningTotal ?? 0;
  const lastMonth = monthlySeries[monthlySeries.length - 1];
  const prevMonth = monthlySeries[monthlySeries.length - 2];

  return (
    <Card className="card-chrome overflow-hidden">
      <CardContent className="p-5 lg:p-6">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl border bg-success/15 text-success border-success/25 flex items-center justify-center shrink-0">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <h3 className="text-[15px] font-semibold tracking-tight">
                近 6 月月度新增批次趋势
              </h3>
              <p className="text-[11.5px] text-muted-foreground">
                {lastMonth?.monthFullLabel} 当月 +{lastMonth?.count ?? 0} 批
                {prevMonth ? ` · 上月 +${prevMonth.count} 批` : ""}
                {" · 累计在管 "}
                <span className="font-mono font-semibold text-foreground">{totalIn6m}</span> 批
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 text-[10.5px] font-mono text-muted-foreground">
            <LineChart className="h-3.5 w-3.5 opacity-80" />
            柱状 = 当月新增 · 折线 = 累计在管
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-secondary/30 p-3.5">
          <ResponsiveContainer width="100%" height={140}>
            <ComposedChart
              data={chartData}
              margin={{ top: 6, right: 16, left: -8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border) / 0.55)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
                tickLine={false}
                width={40}
                tickFormatter={(v) => `+${v}`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={{ stroke: "hsl(var(--border) / 0.7)" }}
                tickLine={false}
                width={38}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border) / 0.8)",
                  borderRadius: 12,
                  fontSize: 11.5,
                  boxShadow: "0 10px 40px -10px hsl(0 0% 0% / 0.6)",
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
                labelKey="fullLabel"
                formatter={(v: number, name: string) => {
                  if (name === "count") return [`+${v} 批`, "当月新增批次"];
                  if (name === "runningTotal") return [`${v} 批`, "累计在管批次"];
                  return [v, name];
                }}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                formatter={(v: string) => {
                  const map: Record<string, { label: string; color: string }> = {
                    count: { label: "当月新增批次", color: "#22c55e" },
                    runningTotal: { label: "累计在管批次", color: "#60a5fa" },
                  };
                  const cfg = map[v];
                  return (
                    <span
                      style={{ color: cfg?.color ?? "inherit", fontWeight: 500 }}
                    >
                      {cfg?.label ?? v}
                    </span>
                  );
                }}
              />
              <Bar
                isAnimationActive={isAnimationActive}
                animationDuration={1100}
                yAxisId="left"
                dataKey="count"
                name="count"
                fill="#22c55e"
                opacity={0.58}
                radius={[5, 5, 0, 0]}
                barSize={28}
              />
              <Line
                isAnimationActive={isAnimationActive}
                animationDuration={1300}
                yAxisId="right"
                type="monotone"
                dataKey="runningTotal"
                name="runningTotal"
                stroke="#60a5fa"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#60a5fa", stroke: "#fff", strokeWidth: 1.5 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default MonthlyBatchesTrend;
