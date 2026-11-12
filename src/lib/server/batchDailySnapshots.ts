import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { candleDate, dailyCaptureDate, summarizeDailyBatch } from '@/lib/batchDaily';
import { fetchHistoryWithFallback } from '@/lib/quote/providers';
import { type BatchLike } from '@/lib/riskEngine';
export async function runBatchDailySnapshotCycle(now = new Date(), loadHistory: typeof fetchHistoryWithFallback = fetchHistoryWithFallback) {
  const date = dailyCaptureDate(now);
  const result = { date, captured: 0, errors: [] as string[] };
  if (!date) return result;
  const rows = await prisma.workspaceRecord.findMany({ where: { kind: 'ledger' } });
  const existing = await prisma.batchDailySnapshot.findMany({ where: { tradingDate: date }, select: { batchId: true } });
  const done = new Set(existing.map(r => r.batchId));
  const quotes = new Map<string, Awaited<ReturnType<typeof fetchHistoryWithFallback>>>();
  for (const row of rows) {
    if (done.has(row.key)) continue;
    try {
      const batch = structuredClone((row.payload as any)?.batch) as BatchLike;
      if (!batch?.stockSymbol || !batch.finance || !batch.id) continue;
      const symbol = batch.stockSymbol.toUpperCase();
      let history = quotes.get(symbol);
      if (!history) { history = await loadHistory(symbol, '1M'); quotes.set(symbol, history); }
      if (history.provider === 'SYNTHETIC_INTRADAY') throw new Error('拒绝使用模拟行情留存');
      const candle = history.candles.find(c => candleDate(c.time) === date);
      // Holidays / delayed feed: do not invent a close or reuse yesterday's quote.
      if (!candle) { result.errors.push(`${row.key}: 尚无 ${date} 收盘价`); continue; }
      const summary = summarizeDailyBatch(batch, date, candle.close);
      await prisma.batchDailySnapshot.upsert({
        where: { batchId_tradingDate: { batchId: row.key, tradingDate: date } },
        create: { batchId: row.key, tradingDate: date, capturedAt: now, source: history.provider, summary: summary as unknown as Prisma.InputJsonValue, ledger: row.payload as Prisma.InputJsonValue },
        update: {}, // immutable: refreshes never rewrite historical holdings/settlements
      });
      result.captured++;
    } catch (e) { result.errors.push(`${row.key}: ${e instanceof Error ? e.message : '采集失败'}`); }
  }
  return result;
}
