import assert from 'node:assert/strict';
import { fetchDailyCloses, backfillBatchHistory, getOrArchiveDailyClose, tradingDates } from '../src/lib/server/batchHistoryBackfill';
import { prisma } from '../src/lib/prisma';
import type { BatchLike } from '../src/lib/riskEngine';

async function main() {
  const originalFetch = globalThis.fetch;
  const originalTransaction = prisma.$transaction;
  const originalMarker = prisma.workspaceRecord.findUnique;
  const originalFind = prisma.quoteHistoryCandle.findMany;
  const originalClose = prisma.quoteHistoryCandle.findUnique;
  let marker: object | null = null;
  let requests = 0;
  const archive: any[] = [];
  try {
    globalThis.fetch = async input => {
      requests++;
      const url = new URL(String(input));
      const start = url.searchParams.get('period1');
      const end = url.searchParams.get('period2');
      const dates = Number(end) - Number(start) === 86400
        ? [Number(start)] : tradingDates(new Date(Number(start) * 1000).toISOString().slice(0, 10), new Date(Number(end) * 1000 - 1).toISOString().slice(0, 10)).map(date => Date.parse(date) / 1000);
      const values = dates.map((_, i) => 11 + i);
      return Response.json({ chart: { result: [{
        timestamp: dates,
        indicators: { quote: [{ open: values, high: values, low: values, close: values, volume: values.map(() => 100) }] },
      }] } });
    };
    prisma.workspaceRecord.findUnique = (async () => marker) as any;
    const findMany = async ({ where }: any) => archive.filter(row => row.candleTime >= where.candleTime.gte && row.candleTime <= where.candleTime.lte);
    prisma.quoteHistoryCandle.findMany = findMany as any;
    const findClose = async ({ where }: any) => archive.find(row =>
      row.candleTime.getTime() === where.symbol_interval_candleTime.candleTime.getTime()) ?? null;
    prisma.quoteHistoryCandle.findUnique = findClose as any;
    prisma.$transaction = (async (run: any) => run({
      $executeRaw: async () => 0,
      workspaceRecord: {
        findUnique: async () => marker,
        upsert: async ({ update }: any) => { marker = update; },
      },
      quoteHistoryCandle: {
        findUnique: findClose,
        findMany,
        createMany: async ({ data }: any) => archive.push(...data.map((row: any) => ({ ...row, createdAt: new Date() }))),
      },
    })) as any;
    const batch = {
      id: 'test', stockSymbol: 'NEW', signDate: '2026-01-01', maturityDate: '2028-01-01',
      initialTotalAmount: 1000, priorityAmount: 700, subordinateAmount: 300, stockPriceAtStart: 10,
      currentStockPrice: 12, totalShares: 100, cumulativeMarginCalls: 0, marginCalls: [],
      clients: [{ id: 'c', batchId: 'test', name: 'C', bdManager: 'B', investmentAmount: 700, signDate: '2026-01-01', status: 'ACTIVE' }],
    } as unknown as BatchLike;
    const dates = new Set(['2026-01-05']);
    const days = await backfillBatchHistory(batch, dates, new Date('2026-01-10'));
    assert.equal(days.length, 5);
    assert.ok(days.every(day => day.date !== '2026-01-05'));
    assert.equal(requests, 1);
    await backfillBatchHistory(batch, dates, new Date('2026-01-10'));
    assert.equal(requests, 1, 'archived history does not expire');
    await backfillBatchHistory(batch, dates, new Date('2026-01-13T07:00:00Z'));
    assert.equal(requests, 2, 'only new completed sessions are fetched');
    const newClose = await getOrArchiveDailyClose('NEW', '2026-01-14', fetchDailyCloses);
    assert.equal(newClose?.candleTime.toISOString().slice(0, 10), '2026-01-14');
    assert.equal(requests, 3);
    await getOrArchiveDailyClose('NEW', '2026-01-14', fetchDailyCloses);
    assert.equal(requests, 3, 'same-day archive is reused');
    assert.equal(archive.length, 8);
    assert.equal(batch.finance, undefined);
    console.log('PASS: daily gap catch-up, permanent reuse of completed history, exact-day close query and deduplication');
  } finally {
    globalThis.fetch = originalFetch;
    prisma.$transaction = originalTransaction;
    prisma.workspaceRecord.findUnique = originalMarker;
    prisma.quoteHistoryCandle.findMany = originalFind;
    prisma.quoteHistoryCandle.findUnique = originalClose;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
