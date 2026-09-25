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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QUOTE_PROVIDERS, type HistoryPeriod, HISTORY_PERIOD_CONFIG, type HistoryCandle } from "@/lib/quote/providers";
import { AlertTriangle, Clock, Loader2, TrendingDown, TrendingUp, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNYSEInfo } from "@/lib/liveQuote";

export interface KLineDialogProps {
  open: boolean;
  symbol: string;
  onOpenChange: (next: boolean) => void;
  anchorPrice?: number | null;
}

type CandleRow = {
  time: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  up: boolean;
  volBar: number;
};

function formatTimeLabel(period: HistoryPeriod, time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  const isIntraday = HISTORY_PERIOD_CONFIG[period]?.isIntraday;
  if (isIntraday) {
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (period === "1D" || period === "5D") {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

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

type PriceSeries = ISeriesApi<"Candlestick">;
type VolumeSeries = ISeriesApi<"Histogram">;

export function KLineDialog({ open, symbol, onOpenChange, anchorPrice }: KLineDialogProps) {
  const [period, setPeriod] = useState<HistoryPeriod>("1M");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candles, setCandles] = useState<HistoryCandle[] | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [fallbackNote, setFallbackNote] = useState<string>("");
  const [tick, setTick] = useState(0);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const volumeContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<PriceSeries | null>(null);
  const volumeSeriesRef = useRef<VolumeSeries | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mountedKeyRef = useRef<string>("");
  const candlesRef = useRef<HistoryCandle[] | null>(null);
  candlesRef.current = candles;

  useEffect(() => {
    if (!open) return;
    setCandles(null);
    setError(null);
    setFallbackNote("");
    setLoading(true);
    let cancelled = false;
    (async () => {
      let attempts = 0;
      while (attempts < 2) {
        attempts++;
        try {
          const res = await fetch(`/api/quote/history?symbol=${encodeURIComponent(symbol)}&period=${period}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (cancelled) return;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as
            | { provider: string; candles: HistoryCandle[]; fallbackNote?: string; candleCount?: number; error?: string }
            | { error: string };
          if (cancelled) return;
          if (!json || (json as { error?: string }).error) {
            const errMsg = (json as { error?: string }).error;
            if (attempts === 1 && errMsg) { await new Promise((r) => setTimeout(r, 500)); continue; }
            throw new Error(errMsg || "empty data");
          }
          const data = json as { provider: string; candles: HistoryCandle[]; fallbackNote?: string; candleCount?: number };
          if (!data.candles || data.candles.length === 0) {
            if (attempts === 1) { await new Promise((r) => setTimeout(r, 500)); continue; }
            throw new Error("no candles");
          }
          setProvider(data.provider);
          setFallbackNote(data.fallbackNote || "");
          const sortedCandles = data.candles.sort((a, b) => a.time - b.time);
          const anchorClose = Number(anchorPrice || 0) > 0 ? Number(anchorPrice) : null;
          const normalized = anchorClose
            ? (() => {
                const out = [...sortedCandles];
                const last = out[out.length - 1];
                const fixedClose = Number(anchorClose.toFixed(2));
                out[out.length - 1] = {
                  ...last,
                  open: Number(last.open.toFixed(2)),
                  high: Number(Math.max(last.high, fixedClose).toFixed(2)),
                  low: Number(Math.min(last.low, fixedClose).toFixed(2)),
                  close: fixedClose,
                };
                return out;
              })()
            : sortedCandles;
          setCandles(normalized);
          setError(null);
          break;
        } catch (e: any) {
          if (cancelled) return;
          if (attempts === 1) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          setError(e?.message || String(e || "加载失败"));
          setCandles(null);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, symbol, period, tick, anchorPrice]);

  const rows: CandleRow[] = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    let prevClose = candles[0].open;
    return candles.map((c) => {
      const up = c.close >= c.open;
      const change = prevClose ? ((c.close - prevClose) / prevClose) * 100 : 0;
      const row: CandleRow = {
        time: c.time,
        timeLabel: formatTimeLabel(period, c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        change,
        up,
        volBar: c.volume || 0,
      };
      prevClose = c.close;
      return row;
    });
  }, [candles, period]);

  const summary = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const highs = rows.map((r) => r.high);
    const lows = rows.map((r) => r.low);
    const vols = rows.map((r) => r.volume);
    const netChg = last.close - first.open;
    const netChgPct = first.open ? (netChg / first.open) * 100 : 0;
    return {
      open: first.open,
      high: Math.max(...highs),
      low: Math.min(...lows),
      close: last.close,
      volume: vols.reduce((a, b) => a + b, 0),
      netChg,
      netChgPct,
      up: netChg >= 0,
      points: rows.length,
    };
  }, [rows]);

  const isSynthetic = provider === "SYNTHETIC_INTRADAY";
  const providerLabel =
    isSynthetic
      ? "合成模拟分时（3 免费源均无可用 intraday 数据）"
      : provider && QUOTE_PROVIDERS.find((p) => p.id === provider)
        ? QUOTE_PROVIDERS.find((p) => p.id === provider)!.label
        : provider || "";

  useEffect(() => {
    if (!open) return;

    let destroyed = false;
    let retryTimer: number | null = null;
    let mountedOnce = false;

    const mountKey = `${symbol}__${period}`;
    if (mountedKeyRef.current !== mountKey) {
      mountedOnce = false;
      try {
        if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; candleSeriesRef.current = null; }
        if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; volumeSeriesRef.current = null; }
      } catch (_) { /* ignore */ }
      mountedKeyRef.current = mountKey;
    }

    const destroyChart = () => {
      try {
        if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; candleSeriesRef.current = null; }
        if (volumeChartRef.current) { volumeChartRef.current.remove(); volumeChartRef.current = null; volumeSeriesRef.current = null; }
      } catch (_) { /* ignore */ }
    };

    const applyCurrentData = (cs: PriceSeries, vs: VolumeSeries, c1: IChartApi, c2: IChartApi) => {
      const cur = candlesRef.current;
      if (!cur || cur.length === 0) return;
      const klineData = cur.map((c) => ({
        time: toUTCTime(c.time),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));
      const volData = cur.map((c) => {
        const up = c.close >= c.open;
        return {
          time: toUTCTime(c.time),
          value: Number(c.volume || 0),
          color: up ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.55)",
        };
      });
      try { cs.setData(klineData as any); } catch (_) { /* ignore */ }
      try { vs.setData(volData as any); } catch (_) { /* ignore */ }
      try {
        window.setTimeout(() => {
          try { c1.timeScale().fitContent(); } catch (_) { /* ignore */ }
          try { c2.timeScale().fitContent(); } catch (_) { /* ignore */ }
        }, 30);
      } catch (_) { /* ignore */ }
    };

    const mount = () => {
      if (destroyed) return;
      if (mountedOnce) return;
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
      const chartW = Math.max(320, Math.min(chartContainerRef.current.clientWidth || 900, 1600));
      const chartH = Math.max(240, chartContainerRef.current.clientHeight || 420);
      const volW = Math.max(320, Math.min(volumeContainerRef.current.clientWidth || 900, 1600));
      const volH = Math.max(60, volumeContainerRef.current.clientHeight || 130);

      try {
        const c1 = createChart(chartContainerRef.current, {
          layout: {
            background: { type: ColorType.Solid as const, color: dark ? "#0b1220" : "#ffffff" },
            textColor,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
          },
          width: chartW,
          height: chartH,
          rightPriceScale: {
            borderVisible: false,
            scaleMargins: { top: 0.05, bottom: 0.08 },
          },
          leftPriceScale: { visible: false },
          timeScale: {
            borderVisible: false,
            timeVisible: (HISTORY_PERIOD_CONFIG[period]?.isIntraday || period === "1D" || period === "5D") ?? false,
            secondsVisible: false,
            rightOffset: 4,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: axisColor, labelBackgroundColor: dark ? "#1f2937" : "#f1f5f9" },
            horzLine: { color: axisColor, labelBackgroundColor: dark ? "#1f2937" : "#f1f5f9" },
          },
          grid: {
            vertLines: { color: gridColor, visible: true },
            horzLines: { color: gridColor, visible: true },
          },
          handleScroll: true,
          handleScale: true,
        });

        const cs = c1.addCandlestickSeries({
          upColor,
          downColor,
          borderUpColor: upBorder,
          borderDownColor: downBorder,
          wickUpColor: upBorder,
          wickDownColor: downBorder,
          borderVisible: true,
          wickVisible: true,
        });
        chartRef.current = c1;
        candleSeriesRef.current = cs;

        const c2 = createChart(volumeContainerRef.current, {
          layout: {
            background: { type: ColorType.Solid as const, color: dark ? "#0b1220" : "#ffffff" },
            textColor,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 10,
          },
          width: volW,
          height: volH,
          rightPriceScale: {
            borderVisible: false,
            scaleMargins: { top: 0.1, bottom: 0.05 },
          },
          leftPriceScale: { visible: false },
          timeScale: {
            visible: true,
            borderVisible: false,
            timeVisible: period === "1D" || period === "5D" || HISTORY_PERIOD_CONFIG[period]?.isIntraday,
            secondsVisible: false,
            rightOffset: 4,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: axisColor, labelVisible: false },
            horzLine: { color: axisColor, labelBackgroundColor: dark ? "#1f2937" : "#f1f5f9" },
          },
          grid: {
            vertLines: { visible: false },
            horzLines: { color: gridColor, visible: true },
          },
          handleScroll: true,
          handleScale: true,
        });

        const vs = c2.addHistogramSeries({
          priceFormat: { type: "volume" as any },
          priceScaleId: "",
        });
        c2.priceScale("").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.05 } });
        volumeChartRef.current = c2;
        volumeSeriesRef.current = vs;

        const commonTimeScale = c1.timeScale();
        let syncing = false;
        c1.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncing || !range) return;
          syncing = true;
          try { c2.timeScale().setVisibleLogicalRange(range); } catch (_) { /* ignore */ }
          syncing = false;
        });
        c2.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncing || !range) return;
          syncing = true;
          try { commonTimeScale.setVisibleLogicalRange(range); } catch (_) { /* ignore */ }
          syncing = false;
        });

        const syncCrosshair = (source: "price" | "vol", param: any) => {
          if (syncing) return;
          if (!param || !param.point) return;
          syncing = true;
          try {
            if (source === "price") {
              const logical = commonTimeScale.coordinateToLogical(param.point.x);
              if (logical != null) {
                const pricePoint = cs.priceToCoordinate(param.seriesData && param.seriesData[cs as any] ? (param.seriesData[cs as any] as any).close : param.price || 0);
                if (pricePoint != null) {
                  const x = c2.timeScale().logicalToCoordinate(logical);
                  const y = vs.priceToCoordinate(param.seriesData && param.seriesData[vs as any] ? (param.seriesData[vs as any] as any).value : 0) ?? null;
                  if (x != null && y != null) {
                    c2.clearCrosshairPosition();
                    (c2 as any).setCrosshairPosition?.(y, x, vs);
                  }
                }
              }
            } else {
              const logical = c2.timeScale().coordinateToLogical(param.point.x);
              if (logical != null) {
                const x = commonTimeScale.logicalToCoordinate(logical);
                const y = cs.priceToCoordinate(param.price || 0);
                if (x != null && y != null) {
                  c1.clearCrosshairPosition();
                  (c1 as any).setCrosshairPosition?.(y, x, cs);
                }
              }
            }
          } catch (_) { /* ignore */ }
          syncing = false;
        };
        try {
          c1.subscribeCrosshairMove((p: any) => syncCrosshair("price", p));
          c2.subscribeCrosshairMove((p: any) => syncCrosshair("vol", p));
        } catch (_) { /* ignore */ }

        const onResize = () => {
          if (!chartContainerRef.current || !volumeContainerRef.current) return;
          const nextCW = Math.max(200, Math.min(chartContainerRef.current.clientWidth || 900, 1600));
          const nextVW = Math.max(200, Math.min(volumeContainerRef.current.clientWidth || 900, 1600));
          try { c1.applyOptions({ width: nextCW }); } catch (_) { /* ignore */ }
          try { c2.applyOptions({ width: nextVW }); } catch (_) { /* ignore */ }
        };
        onResize();
        const ro = new ResizeObserver(onResize);
        ro.observe(chartContainerRef.current);
        ro.observe(volumeContainerRef.current);
        resizeObserverRef.current = ro;
        applyCurrentData(cs, vs, c1, c2);
        mountedOnce = true;
        return true;
      } catch (e: any) {
        setError(e?.message || String(e || "createChart failed"));
        destroyChart();
        return false;
      }
    };

    const attempt = () => {
      if (destroyed) return;
      const ok = mount();
      if (ok === false) {
        retryTimer = window.setTimeout(attempt, 120);
      }
    };
    retryTimer = window.setTimeout(attempt, 260);

    return () => {
      destroyed = true;
      if (retryTimer != null) try { window.clearTimeout(retryTimer); } catch (_) { /* ignore */ }
      destroyChart();
    };
  }, [open, symbol, period]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeChartRef.current || !volumeSeriesRef.current) return;
    if (!candles || candles.length === 0) {
      try { candleSeriesRef.current.setData([] as any); } catch (_) { /* ignore */ }
      try { volumeSeriesRef.current.setData([] as any); } catch (_) { /* ignore */ }
      return;
    }
    const klineData = candles.map((c) => ({
      time: toUTCTime(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
    const volData = candles.map((c) => {
      const up = c.close >= c.open;
      return {
        time: toUTCTime(c.time),
        value: Number(c.volume || 0),
        color: up ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.55)",
      };
    });
    try {
      candleSeriesRef.current.setData(klineData as any);
      volumeSeriesRef.current.setData(volData as any);
    } catch (_) { /* ignore */ }
    const c1 = chartRef.current;
    const c2 = volumeChartRef.current;
    try {
      window.setTimeout(() => {
        if (!c1 || !c2) return;
        try { c1.timeScale().fitContent(); } catch (_) { /* ignore */ }
        try { c2.timeScale().fitContent(); } catch (_) { /* ignore */ }
      }, 40);
    } catch (_) { /* ignore */ }
  }, [candles]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-1">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <span className="font-mono uppercase tracking-wider text-primary">{symbol}</span>
                <span className="font-semibold text-foreground">K 线走势</span>
                {summary && (
                  <Badge variant="outline" className="gap-1.5">
                    {summary.up ? (
                      <TrendingUp className="h-3 w-3 text-success" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-danger" />
                    )}
                    <span className="font-mono tabular-nums">
                      {summary.up ? "+" : ""}
                      {Number(summary.netChg).toFixed(2)} ({summary.up ? "+" : ""}
                      {Number(summary.netChgPct).toFixed(2)}%)
                    </span>
                  </Badge>
                )}
                {providerLabel && (
                  <Badge variant={isSynthetic ? "warning" : "secondary"} className="gap-1 text-[11px]">
                    <Clock className="h-3 w-3" />
                    {isSynthetic && <span className="font-bold">模拟 · </span>}
                    {providerLabel}
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12px]">
                数据源按优先级依次尝试 Yahoo Finance → Nasdaq Unofficial → Stooq 多源补齐（串行优先命中即返回，不等待其余源）。
                {isSynthetic
                  ? "当前周期（5分/15分/1时/4时）3 免费源中国大陆网络均抓不到 intraday，已基于最近真实日线 OHLC 合成模拟分时，数据源 Badge 为「模拟」。"
                  : "真实历史 K 线为真实抓取数据。"}
              </DialogDescription>
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTick((t) => t + 1)}
                className="h-8 px-2"
                title="重新加载"
              >
                <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 rounded-xl border border-border/50 bg-secondary/30 px-4 py-3 text-[12px] mb-2">
            <div>
              <p className="text-muted-foreground text-[11px]">开盘</p>
              <p className="font-mono tabular-nums font-semibold">{Number(summary.open).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px]">收盘</p>
              <p className="font-mono tabular-nums font-semibold">{Number(summary.close).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px]">最高</p>
              <p className="font-mono tabular-nums font-semibold text-success">{Number(summary.high).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px]">最低</p>
              <p className="font-mono tabular-nums font-semibold text-danger">{Number(summary.low).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px]">累计成交量</p>
              <p className="font-mono tabular-nums font-semibold">
                {summary.volume >= 1e9
                  ? `${(summary.volume / 1e9).toFixed(2)}B`
                  : summary.volume >= 1e6
                    ? `${(summary.volume / 1e6).toFixed(2)}M`
                    : summary.volume >= 1e3
                      ? `${(summary.volume / 1e3).toFixed(2)}K`
                      : String(summary.volume)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px]">样本点</p>
              <p className="font-mono tabular-nums font-semibold">{summary.points}</p>
            </div>
          </div>
        )}

        {(fallbackNote || error) && !loading && (
          <div className={cn(
            "mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]",
            error ? "border-warning/40 bg-warning/10 text-warning-foreground" : "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
          )}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="leading-relaxed break-all">
              {error ? (
                <>
                  <span className="font-semibold text-warning">加载失败：{error}。</span>
                  <span> 请检查 Symbol 是否正确（美股如 AAPL，港股如 0700.HK），或点击右上角 ↻ 刷新。</span>
                </>
              ) : (
                <span>
                  <span className="font-semibold">数据说明：</span>{fallbackNote}
                  {fallbackNote && !fallbackNote.includes("FINNHUB") && (
                    <span className="ml-1.5 text-primary">
                      （如需更稳定 intraday 真实数据，可在环境变量配置 FINNHUB_API_KEY 免费注册后接入）
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2 relative">
          <div
            ref={chartContainerRef}
            className="h-[380px] w-full rounded-xl border border-border/50 bg-background overflow-hidden"
            data-testid="kline-chart"
          />
          <div
            ref={volumeContainerRef}
            className="h-[110px] w-full rounded-xl border border-border/50 bg-background overflow-hidden"
            data-testid="volume-chart"
          />

          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/85 backdrop-blur-sm z-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-[12px] text-muted-foreground">
                正在从 3 个数据源加载 {symbol} · {HISTORY_PERIOD_CONFIG[period].label} ...
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex items-start justify-center rounded-xl bg-background/85 backdrop-blur-sm z-10 p-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[12px] text-foreground max-w-full">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                <div>
                  <p className="font-semibold">无法从任一数据源获取 {symbol} · {HISTORY_PERIOD_CONFIG[period].label} 的历史数据</p>
                  <p className="text-muted-foreground mt-0.5">
                    错误：{error}。请检查代码是否正确（美股为 Ticker，港股如 0700.HK 需带上交易所后缀），或切换周期后重试。
                  </p>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && rows && rows.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm z-10">
              <p className="text-[12px] text-muted-foreground">
                暂无可用数据，请确认 Symbol 正确后点击右上角刷新重试。
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
