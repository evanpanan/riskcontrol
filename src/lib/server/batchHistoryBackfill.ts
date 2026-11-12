import { prisma } from '@/lib/prisma';
import { yahooFinanceHistory, nasdaqHistory, stooqHistory, finnhubHistory, type HistoryCandle } from '@/lib/quote/providers';
import { candleDate, marketDate } from '@/lib/batchDaily';
import { replayBatchDay } from '@/lib/batchHistoryReplay';
import type { BatchLike } from '@/lib/riskEngine';
const inflight = new Map<string, Promise<{ candles: HistoryCandle[]; provider: string }>>();
export async function fetchDailyCloses(symbol: string) {
  // A recently listed stock may have only a few days: every real daily close is useful.
  const providers = [...(process.env.FINNHUB_API_KEY ? [{ name: 'FINNHUB', load: finnhubHistory }] : []), { name: 'YAHOO_FINANCE', load: yahooFinanceHistory }, { name: 'NASDAQ_UNOFFICIAL', load: nasdaqHistory }, { name: 'STOOQ', load: stooqHistory }];
  for (const provider of providers) {
    try {
      const candles = (await provider.load(symbol, '1Y')).filter(c => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0);
      if (candles.length) return { provider: provider.name, candles };
    } catch { /* Try another source; never synthesize daily closing prices. */ }
  }
  throw new Error('行情源暂无可用的历史收盘价');
}
async function dailyPrices(symbol: string, signDate: Date | string) {
  const cached = await prisma.quoteHistoryCandle.findMany({ where: { symbol, interval: '1d' }, orderBy: { candleTime: 'asc' } }).catch(() => []);
  if (cached.length && cached[0].candleTime.getTime() <= new Date(signDate).getTime() + 7 * 86400000 && Math.max(...cached.map(c => c.fetchedAt.getTime())) > Date.now() - 6 * 3600000) return { provider: cached.at(-1)!.provider, candles: cached.map(c => ({ time: c.candleTime.getTime(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })) };
  if (inflight.has(symbol)) return inflight.get(symbol)!;
  const promise = (async () => {
    try {
      const history = await fetchDailyCloses(symbol);
      await prisma.quoteHistoryCandle.createMany({ data: history.candles.map(c => ({ symbol, interval: '1d', candleTime: new Date(c.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0, provider: history.provider })), skipDuplicates: true }).catch(() => undefined);
      return history;
    } catch (e) {
      if (cached.length) return { provider: cached.at(-1)!.provider, candles: cached.map(c => ({ time: c.candleTime.getTime(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })) };
      throw e;
    }
  })();
  inflight.set(symbol, promise);
  try { return await promise; } finally { inflight.delete(symbol); }
}
export async function backfillBatchHistory(batch: BatchLike, storedDates: Set<string>, now = new Date()) {
  if (!batch.stockSymbol) return [];
  const history = await dailyPrices(batch.stockSymbol.toUpperCase(), batch.signDate);
  const today = marketDate(now);
  const result = new Map<string, object>();
  for (const candle of history.candles) {
    const date = candleDate(candle.time);
    if (storedDates.has(date) || date >= today) continue;
    const summary = replayBatchDay(batch, date, candle.close);
    if (summary) result.set(date, { ...summary, capturedAt: now.toISOString(), source: history.provider, reconstructed: true });
  }
  return [...result.values()];
}
