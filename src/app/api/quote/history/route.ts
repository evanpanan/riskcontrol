import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchHistoryWithFallback,
  type HistoryCandle,
  type HistoryPeriod,
  HISTORY_PERIOD_CONFIG,
} from "@/lib/quote/providers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PERIOD_CACHE_TTL_MS: Record<HistoryPeriod, number> = {
  "15M": 2 * 60 * 1000,
  "1H": 3 * 60 * 1000,
  "4H": 5 * 60 * 1000,
  "1D": 15 * 60 * 1000,
  "5D": 30 * 60 * 1000,
  "1M": 2 * 60 * 60 * 1000,
  "3M": 6 * 60 * 60 * 1000,
  "1Y": 12 * 60 * 60 * 1000,
  "MAX": 24 * 60 * 60 * 1000,
};

function getIntervalKey(period: HistoryPeriod): string {
  return HISTORY_PERIOD_CONFIG[period].interval;
}

function getCacheWindowStart(period: HistoryPeriod): Date {
  const days = HISTORY_PERIOD_CONFIG[period].calendarDays;
  return new Date(Date.now() - (days + 7) * 24 * 60 * 60 * 1000);
}

function serializeRows(
  rows: Array<{
    candleTime: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>
): HistoryCandle[] {
  return rows.map((row) => ({
    time: row.candleTime.getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume || 0),
  }));
}

async function readHistoryCache(symbol: string, period: HistoryPeriod) {
  const interval = getIntervalKey(period);
  const rows = await prisma.quoteHistoryCandle.findMany({
    where: {
      symbol,
      interval,
      candleTime: { gte: getCacheWindowStart(period) },
    },
    orderBy: { candleTime: "asc" },
  });
  if (!rows.length) return null;
  const latestFetchedAt = rows.reduce((latest, row) => {
    const t = row.fetchedAt.getTime();
    return t > latest ? t : latest;
  }, 0);
  return {
    provider: rows[rows.length - 1]?.provider || "DB_CACHE",
    candles: serializeRows(rows),
    candleCount: rows.length,
    hasEnoughCandles: rows.length >= Math.max(1, Math.floor(HISTORY_PERIOD_CONFIG[period].minExpected * 0.8)),
    isFresh: Date.now() - latestFetchedAt <= PERIOD_CACHE_TTL_MS[period],
    latestFetchedAt,
  };
}

async function writeHistoryCache(
  symbol: string,
  period: HistoryPeriod,
  provider: string,
  candles: HistoryCandle[],
) {
  const interval = getIntervalKey(period);
  const fetchedAt = new Date();
  await prisma.$transaction(
    candles.map((candle) =>
      prisma.quoteHistoryCandle.upsert({
        where: {
          symbol_interval_candleTime: {
            symbol,
            interval,
            candleTime: new Date(candle.time),
          },
        },
        create: {
          symbol,
          interval,
          candleTime: new Date(candle.time),
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
          volume: Number(candle.volume || 0),
          provider,
          fetchedAt,
        },
        update: {
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
          volume: Number(candle.volume || 0),
          provider,
          fetchedAt,
        },
      })
    )
  );
}

export async function GET(req: Request) {
  const start = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    const period = (searchParams.get("period") || "1M").toUpperCase() as HistoryPeriod;
    if (!symbol) return NextResponse.json({ error: "symbol required", provider: "NASQAD_UNOFFICIAL", candles: [], fallbackNote: "symbol required", elapsedMs: Date.now() - start }, { status: 400 });
    if (!HISTORY_PERIOD_CONFIG[period]) return NextResponse.json({ error: "invalid period", provider: "NASDAQ_UNOFFICIAL", candles: [], fallbackNote: `invalid period: ${period}`, elapsedMs: Date.now() - start }, { status: 400 });

    const cached = await readHistoryCache(symbol, period);
    if (cached?.isFresh && cached.hasEnoughCandles) {
      return NextResponse.json(
        {
          provider: cached.provider,
          symbol,
          period,
          candles: cached.candles,
          candleCount: cached.candleCount,
          cacheHit: true,
          cacheFresh: true,
          elapsedMs: Date.now() - start,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "public, s-maxage=20, stale-while-revalidate=120",
            "X-Quote-History-Cache": "HIT",
          },
        },
      );
    }

    const data = await fetchHistoryWithFallback(symbol, period);
    if (data.candles.length > 0) {
      await writeHistoryCache(symbol, period, data.provider, data.candles);
    }
    return NextResponse.json(
      {
        ...data,
        symbol,
        period,
        candleCount: data.candles.length,
        cacheHit: false,
        cacheFresh: false,
        elapsedMs: Date.now() - start,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=20, stale-while-revalidate=120",
          "X-Quote-History-Cache": "MISS",
        },
      },
    );
  } catch (e: any) {
    const msg = e?.message || String(e || "internal");
    const symbol = new URL(req.url).searchParams.get("symbol") || "UNKNOWN";
    const period = (new URL(req.url).searchParams.get("period") || "1M").toUpperCase();
    if (HISTORY_PERIOD_CONFIG[period as HistoryPeriod]) {
      const cached = await readHistoryCache(symbol.toUpperCase(), period as HistoryPeriod);
      if (cached && cached.candleCount > 0) {
        return NextResponse.json(
          {
            provider: cached.provider,
            symbol,
            period,
            candles: cached.candles,
            candleCount: cached.candleCount,
            fallbackNote: `行情源刷新失败，已回退到数据库缓存。原因：${msg}`,
            cacheHit: true,
            cacheFresh: false,
            elapsedMs: Date.now() - start,
          },
          {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "X-Quote-History-Cache": "STALE",
            },
          },
        );
      }
    }
    return NextResponse.json(
      {
        error: "行情获取失败",
        provider: "NASDAQ_UNOFFICIAL",
        symbol,
        period,
        candles: [],
        candleCount: 0,
        detail: `UPSTREAM_FATAL: ${msg}`,
        elapsedMs: Date.now() - start,
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
