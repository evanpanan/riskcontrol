import { NextResponse } from "next/server";
import { fetchHistoryWithFallback, type HistoryPeriod, HISTORY_PERIOD_CONFIG } from "@/lib/quote/providers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const start = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    const period = (searchParams.get("period") || "1M").toUpperCase() as HistoryPeriod;
    if (!symbol) return NextResponse.json({ error: "symbol required", provider: "NASQAD_UNOFFICIAL", candles: [], fallbackNote: "symbol required", elapsedMs: Date.now() - start }, { status: 400 });
    if (!HISTORY_PERIOD_CONFIG[period]) return NextResponse.json({ error: "invalid period", provider: "NASDAQ_UNOFFICIAL", candles: [], fallbackNote: `invalid period: ${period}`, elapsedMs: Date.now() - start }, { status: 400 });
    const data = await fetchHistoryWithFallback(symbol, period);
    return NextResponse.json(
      {
        ...data,
        symbol,
        period,
        candleCount: data.candles.length,
        elapsedMs: Date.now() - start,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=20, stale-while-revalidate=120",
        },
      },
    );
  } catch (e: any) {
    const msg = e?.message || String(e || "internal");
    return NextResponse.json(
      {
        provider: "NASDAQ_UNOFFICIAL",
        candles: [
          {
            time: Date.now(),
            open: 1,
            high: 1,
            low: 1,
            close: 1,
            volume: 0,
          },
        ],
        symbol: new URL(req.url).searchParams.get("symbol") || "UNKNOWN",
        period: (new URL(req.url).searchParams.get("period") || "1M").toUpperCase(),
        candleCount: 1,
        fallbackNote: `API_ROUTE_FATAL: ${msg}`,
        elapsedMs: Date.now() - start,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
