import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dailyCaptureDate, summarizeDailyBatch } from '@/lib/batchDaily';
import { getOrArchiveDailyClose, fetchDailyCloses } from './batchHistoryBackfill';
import { type BatchLike } from '@/lib/riskEngine';
export async function runBatchDailySnapshotCycle(now = new Date(), loadHistory: typeof fetchDailyCloses = fetchDailyCloses) {
  const date = dailyCaptureDate(now);
  const result = { date, captured: 0, errors: [] as string[] };
  if (!date) return result;
  const rows = await prisma.workspaceRecord.findMany({ where: { kind: 'ledger' } });
  const existing = await prisma.batchDailySnapshot.findMany({ where: { tradingDate: date }, select: { batchId: true } });
  const done = new Set(existing.map(r => r.batchId));
  const quotes = new Map<string, ReturnType<typeof getOrArchiveDailyClose>>();
  for (const row of rows) {
    if (done.has(row.key)) continue;
    try {
      const batch = structuredClone((row.payload as any)?.batch) as BatchLike;
      if (!batch?.stockSymbol || !batch.finance || !batch.id) continue;
      const symbol = batch.stockSymbol.trim().toUpperCase();
      let quote = quotes.get(symbol);
      if (!quote) {
        quote = getOrArchiveDailyClose(symbol, date, loadHistory);
        quotes.set(symbol, quote);
      }
      const candle = await quote;
      if (!candle) { result.errors.push(`${row.key}: 尚无 ${date} 收盘价`); continue; }
      const summary = summarizeDailyBatch(batch, date, candle.close);
      await prisma.batchDailySnapshot.upsert({
        where: { batchId_tradingDate: { batchId: row.key, tradingDate: date } },
        create: { batchId: row.key, tradingDate: date, capturedAt: now, source: candle.provider, summary: summary as unknown as Prisma.InputJsonValue, ledger: row.payload as Prisma.InputJsonValue },
        update: {}, // immutable: refreshes never rewrite historical holdings/settlements
      });
      result.captured++;
    } catch (e) { result.errors.push(`${row.key}: ${e instanceof Error ? e.message : '采集失败'}`); }
  }
  return result;
}
