import { getNYSEInfo } from '@/lib/liveQuote';
import { completedSessionDate } from '@/lib/marketSession';
import { getOrArchiveDailyClose } from '@/lib/server/batchHistoryBackfill';
import { fetchRealtimeWithFallback, type QuoteProvider, type RealtimeQuote } from '@/lib/quote/providers';

/** Closed markets use one immutable archived daily close, never an extended-session tick. */
export async function fetchSessionQuote(symbol: string): Promise<RealtimeQuote> {
  if (getNYSEInfo().marketState !== 'CLOSED') return fetchRealtimeWithFallback(symbol);
  const date = completedSessionDate();
  const candle = await getOrArchiveDailyClose(symbol, date);
  if (!candle) throw new Error('最近交易日收盘价暂不可用');
  const previousDate = completedSessionDate(Date.parse(`${date}T08:00:00Z`));
  const previous = await getOrArchiveDailyClose(symbol, previousDate).catch(() => null);
  const prevClose = previous?.close ?? candle.close;
  const session = getNYSEInfo(Date.parse(`${date}T16:00:00Z`));
  const closeAt = Date.parse(`${date}T00:00:00Z`) + session.regularCloseHour * 3600000 - session.offsetMin * 60000;
  return { symbol, provider: candle.provider as QuoteProvider, price: candle.close,
    prevClose, open: candle.open, high: candle.high, low: candle.low, volume: candle.volume,
    changePct: prevClose > 0 ? (candle.close / prevClose - 1) * 100 : 0,
    updatedAt: closeAt, fetchedAt: Date.now() };
}
