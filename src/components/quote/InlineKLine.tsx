"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  CrosshairMode,
  ColorType,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HISTORY_PERIOD_CONFIG,
  QUOTE_PROVIDERS,
  type HistoryCandle,
  type HistoryPeriod,
} from "@/lib/quote/providers";
import { AlertTriangle, Clock, Loader2, RefreshCcw, TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatCompactNumber, formatPercent } from "@/lib/utils";

export interface InlineKLineProps {
  symbol: string;
  defaultPeriod?: HistoryPeriod;
  chartHeightPx?: number;
  volumeHeightPx?: number;
  className?: string;
  onPeriodChange?: (p: HistoryPeriod) => void;
}

type PriceSeries = ISeriesApi<"Candlestick">;
type VolumeSeries = ISeriesApi<"Histogram">;

function toUTCTime(timeMs: number): UTCTimestamp {
  const d = new Date(timeMs);
  return (Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  ) / 1000) as UTCTimestamp;
}

function isDarkTheme() {
  if (typeof window === "undefined") return true;
  const root = document.documentElement;
  const bg = getComputedStyle(root).getPropertyValue("--background")?.trim();
  if (!bg) return root.classList.contains("dark") ?? true;
  return bg.startsWith("240 10% 3") || bg.includes("hsl") || root.classList.contains("dark");
}

export function InlineKLine({
  symbol,
  defaultPeriod = "1M",
  chartHeightPx = 420,
  volumeHeightPx = 120,
  className,
  onPeriodChange,
}: InlineKLineProps) {
  const [period, setPeriod] = useState<HistoryPeriod>(defaultPeriod);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candles, setCandles] = useState<HistoryCandle[] | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [tick, setTick] = useState(0);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const volumeContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<PriceSeries | null>(null);
  const volumeSeriesRef = useRef<VolumeSeries | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const candlesRef = useRef<HistoryCandle[] | null>(null);
  candlesRef.current = candles;

  useEffect(() => {
    onPeriodChange?.(period);
  }, [period, onPeriodChange]);

  useEffect(() => {
    setCandles(null);
    setError(null);
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/quote/history?symbol=${encodeURIComponent(symbol)}&period=${period}`, {
          headers: { Accept: "application/json" },
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as
          | { provider: string; candles: HistoryCandle[] }
          | { error: string };
        if (cancelled) return;
        if (!json || (json as { error?: string }).error) {
          throw new Error((json as { error?: string }).error || "empty data");
        }
        const data = json as { provider: string; candles: HistoryCandle[] };
        if (!data.candles || data.candles.length === 0) throw new Error("no candles");
        setProvider(data.provider);
        setCandles(data.candles.sort((a, b) => a.time - b.time));
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || String(e || "加载失败"));
        setCandles(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, period, tick]);

  const isSynthetic = provider === "SYNTHETIC_INTRADAY";
  const providerLabel = isSynthetic
    ? "模拟 · 合成分时（3 源均无 intraday）"
    : provider && QUOTE_PROVIDERS.find((p) => p.id === provider)
      ? QUOTE_PROVIDERS.find((p) => p.id === provider)!.label
      : provider || "";

  const summary = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let vol = 0;
    for (const c of candles) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      vol += Number(c.volume || 0);
    }
    const first = candles[0];
    const last = candles[candles.length - 1];
    const netChg = last.close - first.open;
    const netChgPct = first.open ? (netChg / first.open) * 100 : 0;
    return {
      open: first.open,
      high: Number.isFinite(high) ? high : last.close,
      low: Number.isFinite(low) ? low : last.close,
      close: last.close,
      volume: vol,
      netChg,
      netChgPct,
      up: netChg >= 0,
      points: candles.length,
    };
  }, [candles]);

  useEffect(() => {
    return () => {
      try {
        if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; candleSeriesRef.current = null; }
        if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; volumeSeriesRef.current = null; }
      } catch (_) { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    let destroyed = false;
    let retryTimer: number | null = null;
    let mountedOnce = false;
    let retriesLeft = 15;

    const mount = () => {
      if (destroyed || mountedOnce) return true;
      if (!chartContainerRef.current || !volumeContainerRef.current) return false;
      if ((chartContainerRef.current.clientWidth || 0) < 32 || (volumeContainerRef.current.clientWidth || 0) < 32) return false;
      const dark = isDarkTheme();
      const gridColor = dark ? "rgba(148, 163, 184, 0.12)" : "rgba(15, 23, 42, 0.08)";
      const axisColor = dark ? "rgba(148, 163, 184, 0.2)" : "rgba(15, 23, 42, 0.1)";
      const upColor = "#10b981";
      const downColor = "#ef4444";
      const upBorder = "#059669";
      const downBorder = "#dc2626";
      const textColor = dark ? "rgba(156, 163, 175, 0.9)" : "rgba(71, 85, 105, 0.9)";
      const chartW = Math.max(320, Math.min(chartContainerRef.current.clientWidth || 900, 1200));
      const chartH = Math.max(220, chartContainerRef.current.clientHeight || chartHeightPx);
      const volW = Math.max(320, Math.min(volumeContainerRef.current.clientWidth || 900, 1200));
      const volH = Math.max(60, volumeContainerRef.current.clientHeight || volumeHeightPx);
      const timeVisible = (HISTORY_PERIOD_CONFIG[period]?.isIntraday || period === "1D" || period === "5D") ?? false;
      try {
        const c1 = createChart(chartContainerRef.current, {
          layout: {
            background: { type: ColorType.Solid as const, color: "rgba(15, 23, 42, 0.01)" },
            textColor, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11,
          },
          width: chartW, height: chartH,
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.06, bottom: 0.06 } },
          leftPriceScale: { visible: false },
          timeScale: { borderVisible: false, timeVisible, secondsVisible: false, rightOffset: 6 },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: axisColor, labelBackgroundColor: dark ? "#1f2937" : "#f1f5f9" },
            horzLine: { color: axisColor, labelBackgroundColor: dark ? "#1f2937" : "#f1f5f9" },
          },
          grid: { vertLines: { color: gridColor, visible: true }, horzLines: { color: gridColor, visible: true } },
        });
        const cs = c1.addCandlestickSeries({
          upColor, downColor, borderUpColor: upBorder, borderDownColor: downBorder,
          wickUpColor: upBorder, wickDownColor: downBorder, borderVisible: true, wickVisible: true,
        });
        chartRef.current = c1;
        candleSeriesRef.current = cs;

        const c2 = createChart(volumeContainerRef.current, {
          layout: {
            background: { type: ColorType.Solid as const, color: "rgba(15, 23, 42, 0.01)" },
            textColor, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10,
          },
          width: volW, height: volH,
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0 } },
          leftPriceScale: { visible: false },
          timeScale: { visible: true, borderVisible: false, timeVisible, secondsVisible: false, rightOffset: 6 },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: axisColor, labelVisible: false },
            horzLine: { color: axisColor, labelBackgroundColor: dark ? "#1f2937" : "#f1f5f9" },
          },
          grid: { vertLines: { visible: false }, horzLines: { color: gridColor, visible: true } },
        });
        const vs = c2.addHistogramSeries({ priceFormat: { type: "volume" as any }, priceScaleId: "" });
        c2.priceScale("").applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
        volumeChartRef.current = c2;
        volumeSeriesRef.current = vs;

        const commonTS = c1.timeScale();
        let syncing = false;
        c1.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncing || !range) return; syncing = true;
          try { c2.timeScale().setVisibleLogicalRange(range); } catch (_) { /* ignore */ }
          syncing = false;
        });
        c2.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncing || !range) return; syncing = true;
          try { commonTS.setVisibleLogicalRange(range); } catch (_) { /* ignore */ }
          syncing = false;
        });
        const syncCrosshair = (source: "price" | "vol", param: any) => {
          if (syncing) return; if (!param || !param.point) return; syncing = true;
          try {
            if (source === "price") {
              const logical = commonTS.coordinateToLogical(param.point.x);
              if (logical != null) {
                const x = c2.timeScale().logicalToCoordinate(logical);
                const y = vs.priceToCoordinate((param.seriesData && param.seriesData[vs as any]) ? (param.seriesData[vs as any] as any).value : 0) ?? null;
                if (x != null && y != null) { c2.clearCrosshairPosition(); (c2 as any).setCrosshairPosition?.(y, x, vs); }
              }
            } else {
              const logical = c2.timeScale().coordinateToLogical(param.point.x);
              if (logical != null) {
                const x = commonTS.logicalToCoordinate(logical);
                const y = cs.priceToCoordinate(param.price || 0);
                if (x != null && y != null) { c1.clearCrosshairPosition(); (c1 as any).setCrosshairPosition?.(y, x, cs); }
              }
            }
          } catch (_) { /* ignore */ }
          syncing = false;
        };
        try { c1.subscribeCrosshairMove((p: any) => syncCrosshair("price", p)); c2.subscribeCrosshairMove((p: any) => syncCrosshair("vol", p)); } catch (_) { /* ignore */ }
        const onResize = () => {
          if (!chartContainerRef.current || !volumeContainerRef.current) return;
          const ncw = Math.max(200, Math.min(chartContainerRef.current.clientWidth || 900, 1200));
          const nvw = Math.max(200, Math.min(volumeContainerRef.current.clientWidth || 900, 1200));
          try { c1.applyOptions({ width: ncw }); } catch (_) { /* ignore */ }
          try { c2.applyOptions({ width: nvw }); } catch (_) { /* ignore */ }
        };
        onResize();
        const ro = new ResizeObserver(onResize);
        ro.observe(chartContainerRef.current); ro.observe(volumeContainerRef.current);
        resizeObserverRef.current = ro;
        if (candlesRef.current && candlesRef.current.length > 0) {
          const klineData = candlesRef.current.map((c) => ({ time: toUTCTime(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }));
          const volData = candlesRef.current.map((c) => {
            const up = c.close >= c.open;
            return { time: toUTCTime(c.time), value: Number(c.volume || 0), color: up ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.55)" };
          });
          try { cs.setData(klineData as any); vs.setData(volData as any); } catch (_) { /* ignore */ }
          try { window.setTimeout(() => { try { c1.timeScale().fitContent(); } catch (_) { /* ignore */ } try { c2.timeScale().fitContent(); } catch (_) { /* ignore */ } }, 50); } catch (_) { /* ignore */ }
        }
        mountedOnce = true;
        return true;
      } catch (e: any) {
        setError(e?.message || String(e || "createChart failed"));
        try {
          if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
          if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; candleSeriesRef.current = null; }
          if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; volumeSeriesRef.current = null; }
        } catch (_) { /* ignore */ }
        return true;
      }
    };
    const attempt = () => {
      if (destroyed) return;
      const ok = mount();
      if (ok === false) {
        retriesLeft -= 1;
        if (retriesLeft > 0) { retryTimer = window.setTimeout(attempt, 80); }
        else { setError("图表容器初始化失败，请刷新页面重试"); }
      }
    };
    retryTimer = window.setTimeout(attempt, 40);
    return () => {
      destroyed = true;
      if (retryTimer != null) try { window.clearTimeout(retryTimer); } catch (_) { /* ignore */ }
      try {
        if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; candleSeriesRef.current = null; }
        if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; volumeSeriesRef.current = null; }
      } catch (_) { /* ignore */ }
    };
  }, [period, symbol, chartHeightPx, volumeHeightPx]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeChartRef.current || !volumeSeriesRef.current) return;
    if (!candles || candles.length === 0) {
      try { candleSeriesRef.current.setData([] as any); } catch (_) { /* ignore */ }
      try { volumeSeriesRef.current.setData([] as any); } catch (_) { /* ignore */ }
      return;
    }
    const klineData = candles.map((c) => ({ time: toUTCTime(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }));
    const volData = candles.map((c) => {
      const up = c.close >= c.open;
      return { time: toUTCTime(c.time), value: Number(c.volume || 0), color: up ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.55)" };
    });
    try { candleSeriesRef.current.setData(klineData as any); volumeSeriesRef.current.setData(volData as any); } catch (_) { /* ignore */ }
    try {
      window.setTimeout(() => {
        if (!chartRef.current || !volumeChartRef.current) return;
        try { chartRef.current.timeScale().fitContent(); } catch (_) { /* ignore */ }
        try { volumeChartRef.current.timeScale().fitContent(); } catch (_) { /* ignore */ }
      }, 40);
    } catch (_) { /* ignore */ }
  }, [candles]);

  return (
    <div className={cn("space-y-3 rounded-xl border border-border/50 bg-card/40 p-4", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-base tracking-tight flex items-center gap-2">
              <span className="font-mono uppercase tracking-wider text-primary">{symbol}</span>
              <span className="text-muted-foreground text-sm font-semibold">单一标的深度 K 线</span>
              {summary && (
                <Badge variant="outline" className="gap-1.5 text-[11px]">
                  {summary.up ? <TrendingUp className="h-3 w-3 text-success" /> : <TrendingDown className="h-3 w-3 text-danger" />}
                  <span className="font-mono tabular-nums">
                    {summary.up ? "+" : ""}{Number(summary.netChg).toFixed(2)} ({summary.up ? "+" : ""}
                    {formatPercent(summary.netChgPct, 2)})
                  </span>
                </Badge>
              )}
              {providerLabel && (
                <Badge variant={isSynthetic ? "warning" : "secondary"} className="gap-1 text-[11px]">
                  <Clock className="h-3 w-3" />
                  {providerLabel}
                </Badge>
              )}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(HISTORY_PERIOD_CONFIG) as HistoryPeriod[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "outline"}
              onClick={() => setPeriod(p)}
              className="h-8 px-3 text-[12px]"
            >
              {HISTORY_PERIOD_CONFIG[p].label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setTick((t) => t + 1)} className="h-8 px-2" title="重新加载">
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 rounded-xl border border-border/50 bg-secondary/30 px-4 py-2.5 text-[12px]">
          <div>
            <p className="text-muted-foreground text-[11px]">开盘</p>
            <p className="font-mono tabular-nums font-semibold">${Number(summary.open).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">收盘</p>
            <p className="font-mono tabular-nums font-semibold">${Number(summary.close).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">最高</p>
            <p className="font-mono tabular-nums font-semibold text-success">${Number(summary.high).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">最低</p>
            <p className="font-mono tabular-nums font-semibold text-danger">${Number(summary.low).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">累计成交量</p>
            <p className="font-mono tabular-nums font-semibold">{formatCompactNumber(summary.volume)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">样本点</p>
            <p className="font-mono tabular-nums font-semibold">{summary.points}</p>
          </div>
        </div>
      )}

      <div className="space-y-2 relative">
        <div
          ref={chartContainerRef}
          className="w-full rounded-xl border border-border/50 bg-background overflow-hidden"
          data-testid="inline-kline-chart"
          style={{ height: `${chartHeightPx}px` }}
        />
        <div
          ref={volumeContainerRef}
          className="w-full rounded-xl border border-border/50 bg-background overflow-hidden"
          data-testid="inline-volume-chart"
          style={{ height: `${volumeHeightPx}px` }}
        />

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/80 backdrop-blur-sm z-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-[12px] text-muted-foreground">加载 {symbol} · {HISTORY_PERIOD_CONFIG[period].label} ...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-start justify-center rounded-xl bg-background/80 backdrop-blur-sm z-10 p-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[12px] text-foreground max-w-full">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
              <div className="min-w-0">
                <p className="font-semibold">无法获取 {symbol} · {HISTORY_PERIOD_CONFIG[period].label} 的历史数据</p>
                <p className="text-muted-foreground mt-0.5">错误：{error}。请检查 ticker 后缀或切换周期重试。</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
