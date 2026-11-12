import assert from 'node:assert/strict';
import { fetchDailyCloses, backfillBatchHistory } from '../src/lib/server/batchHistoryBackfill';
import { prisma } from '../src/lib/prisma';
import type { BatchLike } from '../src/lib/riskEngine';
async function main() {
  const original = globalThis.fetch;
  const read = prisma.quoteHistoryCandle.findMany;
  const write = prisma.quoteHistoryCandle.createMany;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ chart: { result: [{ timestamp: [Date.parse('2026-01-05T00:00:00Z')/1000, Date.parse('2026-01-06T00:00:00Z')/1000], indicators: { quote: [{ open:[10,11], high:[12,13], low:[9,10], close:[11,12], volume:[100,200] }] } }], error:null } }), { status:200 });
    const result = await fetchDailyCloses('NEW');
    assert.equal(result.provider, 'YAHOO_FINANCE'); assert.equal(result.candles.length,2); assert.equal(result.candles[0].close,11);
    prisma.quoteHistoryCandle.findMany = (async () => { throw new Error('cache unavailable'); }) as any;
    prisma.quoteHistoryCandle.createMany = (async () => { throw new Error('cache write unavailable'); }) as any;
    const batch = { id:'test', stockSymbol:'NEW', signDate:'2026-01-01', maturityDate:'2028-01-01', initialTotalAmount:1000, priorityAmount:700, subordinateAmount:300, stockPriceAtStart:10, currentStockPrice:12, totalShares:100, cumulativeMarginCalls:0, clients:[{ id:'c', batchId:'test', name:'C', bdManager:'B', investmentAmount:700, signDate:'2026-01-01', status:'ACTIVE' }], marginCalls:[] } as unknown as BatchLike;
    const days = await backfillBatchHistory(batch, new Set(['2026-01-05']), new Date('2026-01-10T12:00:00Z'));
    assert.equal(days.length,1); assert.equal((days[0] as any).date,'2026-01-06');
    assert.ok(Math.abs((days[0] as any).marketValue-1200)<.01);
    assert.equal(batch.finance,undefined);
    console.log('PASS: short real daily history, cache failures tolerated, existing snapshots retained, legacy ledger reconstructed without mutation');
  } finally { globalThis.fetch=original; prisma.quoteHistoryCandle.findMany=read; prisma.quoteHistoryCandle.createMany=write; }
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
