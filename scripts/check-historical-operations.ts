import assert from 'node:assert/strict';
import { initializeBatchFinance, executeInstitutionTopup, addClientPosition, type BatchLike, type ClientLike } from '../src/lib/riskEngine';
import { replayBatchDay } from '../src/lib/batchHistoryReplay';
import { aggregateDailyHistory } from '../src/lib/dashboardHistory';
import { topupReceipts } from '../src/lib/topupReceipts';
import { completedSessionDate } from '../src/lib/marketSession';
import { fetchSessionQuote } from '../src/lib/server/sessionQuote';
import { prisma } from '../src/lib/prisma';
const near = (a: number, b: number) => assert.ok(Math.abs(a-b) < .000001, `${a} != ${b}`);
function batch(): BatchLike {
  const b = { id: 'test', stockSymbol: 'TEST', signDate: '2026-01-01', stockPriceAtStart: 10, currentStockPrice: 7,
    initialTotalAmount: 10000, priorityAmount: 7000, subordinateAmount: 3000, totalShares: 1000, cumulativeMarginCalls: 0, marginCalls: [],
    clients: ['a','b'].map(id => ({ id, batchId:'test', name:id, investmentAmount:3500, entryStockPrice:10, signDate:'2026-01-01', status:'ACTIVE', profitSplitClient:40, profitSplitInstitution:60 })) } as unknown as BatchLike;
  initializeBatchFinance(b); return b;
}
async function main() {
  const b = batch();
  const first = executeInstitutionTopup(b, { amount: 100, executionPrice: 5, stockShares: 20, topupDate:'2026-02-02' });
  const oldTrades = structuredClone(b.finance!.trades);
  const oldAllocation = structuredClone(b.finance!.rounds[0].allocations.a);
  const c = { ...structuredClone(b.clients![0]), id:'c', investmentAmount:1750 } as ClientLike;
  assert.throws(() => addClientPosition(structuredClone(b), c));
  const future = { ...c, signDate: new Date('2099-01-01') };
  assert.throws(() => addClientPosition(structuredClone(b), future, { allowHistoricalImport:true }));
  addClientPosition(b, c, { allowHistoricalImport:true });
  assert.equal(b.clients!.length,3);
  assert.deepEqual(b.finance!.trades,oldTrades);
  assert.deepEqual(b.finance!.rounds[0].allocations.a,oldAllocation);
  assert.ok(b.finance!.rounds[0].allocations.c.required > 0);
  console.log('PASS historical admin import preserves existing receipts and allocations; ordinary/future additions remain blocked');
  const second = executeInstitutionTopup(b, { amount: 200, executionPrice: 4, stockShares: 50, topupDate:'2026-02-02' });
  const rows = topupReceipts(b.finance!.trades);
  assert.equal(rows.length,2);
  near(rows[0].amount + rows[1].amount, first + second);
  near(rows.find(r => r.price === 5)!.shares,20);
  near(rows.find(r => r.price === 4)!.shares,50);
  assert.ok(rows.every(r => r.at.slice(0,10) === '2026-02-02'));
  assert.notEqual(b.finance!.trades[0].receiptId,b.finance!.trades.at(-1)!.receiptId);
  const equal = batch();
  executeInstitutionTopup(equal, { amount: 100, executionPrice:5, topupDate:'2026-02-02' });
  executeInstitutionTopup(equal, { amount: 100, executionPrice:5, topupDate:'2026-02-02' });
  assert.equal(topupReceipts(equal.finance!.trades).length,2,'same-day same-price receipts stay separate');
  const legacy = equal.finance!.trades.map(({receiptId, recordedAt, ...t}) => t);
  assert.equal(topupReceipts(legacy).length,2,'legacy repeated allocations can be presented without rewriting');
  assert.deepEqual(b.finance!.trades.slice(0,oldTrades.length),oldTrades);
  console.log('PASS separate receipts, selected-date prices, exact shares and unchanged earlier transactions');
  const before = replayBatchDay(b,'2026-01-05',10)!;
  const after = replayBatchDay(b,'2026-02-02',4)!;
  const original = JSON.stringify(b);
  const total = aggregateDailyHistory([{ start:'2026-01-01',rows:[before,after] }]);
  near(total[0].totalValue,before.marketValue); near(total[1].totalValue,after.marketValue);
  near(total[1].totalYieldPct,after.yieldPct);
  assert.ok(total[1].totalValue < total[0].totalValue,'real historical price drop is retained');
  const incomplete = aggregateDailyHistory([{start:'2026-01-01',rows:[before,after]},{start:'2026-02-01',rows:[]}]);
  assert.equal(incomplete.length,1,'do not draw a partially priced portfolio');
  assert.equal(JSON.stringify(b),original);
  console.log('PASS dashboard aggregates batch history using actual closes with no invented or partial values');
  for (const [at,expected] of [
    ['2026-11-19T07:00:00Z','2026-11-18'], // pre-4am
    ['2026-11-19T02:00:00Z','2026-11-18'], // after 8pm
    ['2026-11-22T15:00:00Z','2026-11-20'], // Sunday
    ['2026-11-26T16:00:00Z','2026-11-25'], // Thanksgiving
    ['2026-11-27T23:00:00Z','2026-11-27'], // early-close session
    ['2026-07-06T06:00:00Z','2026-07-02'], // holiday weekend + DST
  ]) assert.equal(completedSessionDate(Date.parse(at)),expected,at);
  const find = prisma.quoteHistoryCandle.findUnique;
  const now = Date.now;
  const fetch = globalThis.fetch;
  try {
    Date.now = () => Date.parse('2026-11-22T15:00:00Z');
    globalThis.fetch = async () => { throw new Error('closed-session archive must not fetch live ticks'); };
    prisma.quoteHistoryCandle.findUnique = (async ({where}:any) => ({ candleTime:where.symbol_interval_candleTime.candleTime, close:5.83, open:5.9, high:6, low:5.5, volume:100, provider:'YAHOO_FINANCE' })) as any;
    near((await fetchSessionQuote('TEST')).price,5.83);
    near((await fetchSessionQuote('TEST')).price,5.83);
  } finally { Date.now=now; globalThis.fetch=fetch; prisma.quoteHistoryCandle.findUnique=find; }
  console.log('PASS closed sessions use immutable daily close across weekends, holidays, early close and DST');
}
main().catch(e => { console.error(e); process.exitCode=1; });
