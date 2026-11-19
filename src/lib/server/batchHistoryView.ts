import type { BatchLike } from '@/lib/riskEngine';
import type { BatchDailySummary } from '@/lib/batchDaily';
import { contractDate, candleDate } from '@/lib/batchDaily';
import { replayBatchDay } from '@/lib/batchHistoryReplay';
import { ensureDailyCloseHistory, tradingDates } from '@/lib/server/batchHistoryBackfill';
import { completedSessionDate } from '@/lib/marketSession';

type SavedDay = { tradingDate: string; summary: unknown; capturedAt?: Date; source?: string };
export function replayHistoryPrices(batch: BatchLike, saved: SavedDay[], candles: Array<{ candleTime: Date; close: number; provider: string }>, calculatedAt = new Date()) {
  const prices = new Map<string, { price: number; source: string }>();
  // Saved closes are useful fallback prices, but saved portfolio totals may predate a historical import.
  for (const row of saved) {
    const price = (row.summary as Partial<BatchDailySummary>)?.price;
    if (price && Number.isFinite(price) && price > 0) prices.set(row.tradingDate, { price, source: row.source ?? 'DAILY_SNAPSHOT' });
  }
  for (const candle of candles) prices.set(candleDate(candle.candleTime.getTime()), { price: candle.close, source: candle.provider });
  return [...prices].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, close]) => {
    const summary = replayBatchDay(batch, date, close.price);
    if (!summary) return [];
    return [{ ...summary, source: close.source, reconstructed: true, capturedAt: calculatedAt.toISOString() }];
  });
}

export async function loadBatchHistoryView(batch: BatchLike, saved: SavedDay[], now = new Date(), archive?: ReturnType<typeof ensureDailyCloseHistory>) {
  const from = contractDate(batch.signDate);
  let candles: Awaited<ReturnType<typeof ensureDailyCloseHistory>>['candles'] = [];
  try {
    if (batch.stockSymbol) candles = (await (archive ?? ensureDailyCloseHistory(batch.stockSymbol.trim().toUpperCase(), from, now))).candles;
  } catch { /* Render saved genuine closes, explicitly reporting gaps below. */ }
  const rows = replayHistoryPrices(batch, saved, candles, now);
  const firstClient = (batch.clients ?? []).map(c => contractDate(c.signDate)).sort()[0];
  const start = firstClient && firstClient > from ? firstClient : from;
  const available = new Set(rows.map(r => r.date));
  const missingDates = tradingDates(start, completedSessionDate(now.getTime())).filter(day => !available.has(day));
  return { rows, start, missingDates,
    warning: missingDates.length ? `历史收盘价尚缺 ${missingDates.length} 个交易日（${missingDates[0]} 起），当前仅显示有真实价格的日期，请稍后刷新` : null };
}
