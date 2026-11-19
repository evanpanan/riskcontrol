import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { initializeBatchFinance, correctInstitutionPosition, addClientPosition, executeInstitutionTopup, type BatchLike } from '../src/lib/riskEngine';
import { ensureDailyCloseHistory, tradingDates } from '../src/lib/server/batchHistoryBackfill';
import { loadBatchHistoryView } from '../src/lib/server/batchHistoryView';
import { aggregateDailyHistory } from '../src/lib/dashboardHistory';
import { replayBatchDay } from '../src/lib/batchHistoryReplay';
const near = (a: number, b: number) => assert.ok(Math.abs(a-b)<0.001, `${a} != ${b}`);
function batch(id: string, date: string, amount = 700, entry = 10): BatchLike {
 const b = { id, stockSymbol:'TEST', signDate:date, maturityDate:'2028-01-01', stockPriceAtStart:entry, currentStockPrice:entry,
 initialTotalAmount:amount/.7, priorityAmount:amount, subordinateAmount:amount/.7*.3, totalShares:amount/.7/entry, cumulativeMarginCalls:0, marginCalls:[],
 clients:[{id:id+'-client',batchId:id,name:id,bdManager:'',investmentAmount:amount,entryStockPrice:entry,signDate:date,status:'ACTIVE'}] } as unknown as BatchLike;
 initializeBatchFinance(b); return b;
}
async function main() {
 const a=batch('a','2026-11-01'); correctInstitutionPosition(a,450,80);
 const staleSnapshot=[{tradingDate:'2026-11-12',summary:{price:9,marketValue:900,shares:100,clientPnL:0,institutionPnL:-100},source:'YAHOO_FINANCE'}];
 a.currentStockPrice=4;
 addClientPosition(a,{...structuredClone(a.clients![0]),id:'imported',investmentAmount:350}, {allowHistoricalImport:true});
 executeInstitutionTopup(a,{amount:100,stockShares:20,executionPrice:5,topupDate:'2026-11-17'});
 executeInstitutionTopup(a,{amount:100,collateralType:'cash',topupDate:'2026-11-18'});
 const b=batch('b','2026-11-16',350,5);
 const original=JSON.stringify([a,b,staleSnapshot]);
 const through='2026-11-18'; const now=new Date('2026-11-19T07:00:00Z');
 const days=tradingDates('2026-11-01',through);
 const close=(date:string)=> date<'2026-11-16'?9:date==='2026-11-16'?7:date==='2026-11-17'?6:8;
 const archive:any[]=[{symbol:'TEST',interval:'1d-final',candleTime:new Date('2026-11-12'),open:9,high:9,low:9,close:9,volume:1,provider:'YAHOO_FINANCE',createdAt:now}];
 let marker:any={payload:{initialized:true}};const requests:Array<{from:string;through:string}>=[];
 const saved={fetch:globalThis.fetch,find:prisma.quoteHistoryCandle.findMany,tx:prisma.$transaction};
 const find=async({where}:any)=>archive.filter(c=>c.candleTime>=where.candleTime.gte&&c.candleTime<=where.candleTime.lte);
 try {
  globalThis.fetch=async(input)=>{
   const url=new URL(String(input));assert.ok(url.hostname.includes('yahoo'),'first provider has all requested real daily candles');
   const from=new Date(Number(url.searchParams.get('period1'))*1000).toISOString().slice(0,10);
   const end=Number(url.searchParams.get('period2'))*1000;
   const thru=new Date(end-1).toISOString().slice(0,10);requests.push({from,through:thru});
   const dates=days.filter(d=>d>=from&&d<=thru);const values=dates.map(close);
   return Response.json({chart:{result:[{timestamp:dates.map(d=>Date.parse(d)/1000),indicators:{quote:[{open:values,high:values,low:values,close:values,volume:values.map(()=>1)}]}}]}});
  };
  prisma.quoteHistoryCandle.findMany=find as any;
  prisma.$transaction=(async(run:any)=>run({$executeRaw:async()=>0,quoteHistoryCandle:{findMany:find,createMany:async({data}:any)=>{for(const c of data)if(!archive.some(e=>e.candleTime.getTime()===c.candleTime.getTime()))archive.push({...c,createdAt:now});}},workspaceRecord:{findUnique:async()=>marker,upsert:async({update}:any)=>{marker=update;}}})) as any;
  const repaired=await ensureDailyCloseHistory('TEST','2026-11-01',now);
  assert.equal(repaired.missingDates.length,0);assert.equal(repaired.candles.length,days.length);
  assert.equal(requests.length,1,'old initialized flag must not suppress gap repair');
  await ensureDailyCloseHistory('TEST','2026-11-01',now);assert.equal(requests.length,1,'complete archives never refetch');
  const ah=await loadBatchHistoryView(a,staleSnapshot,now);
  const bh=await loadBatchHistoryView(b,[],now);
  assert.equal(ah.warning,null);assert.equal(bh.warning,null);
  assert.equal(requests.length,1,'both batches reuse same archived closes');
  const series=aggregateDailyHistory([{start:ah.start,rows:ah.rows},{start:bh.start,rows:bh.rows}]);
  const value=(date:string)=>series.find(r=>r.bucketAt.toISOString().startsWith(date))!;
  near(value('2026-11-12').totalValue,185*9);
  near(value('2026-11-16').totalValue,(185+100)*7);
  near(value('2026-11-17').totalValue,(185+20+100)*6);
  near(value('2026-11-18').totalValue,(185+20+100)*8+100);
  assert.equal(series.filter(r=>r.bucketAt>=new Date('2026-11-12')).length,5,'weekly chart has every completed trading day, not one dot');
  for(const row of series)near(row.clientValue+row.institutionValue,row.totalValue);
  assert.equal(JSON.stringify([a,b,staleSnapshot]),original,'reads must not rewrite business ledgers or saved snapshots');
  // Source lacks one trading day: keep genuine prices and surface the missing date.
  archive.splice(archive.findIndex(c=>c.candleTime.toISOString().startsWith('2026-11-17')),1);
  const incomplete=await loadBatchHistoryView(a,staleSnapshot,now);
  assert.deepEqual(incomplete.missingDates,['2026-11-17']);assert.ok(incomplete.warning);
  assert.equal(incomplete.rows.some(r=>r.date==='2026-11-17'),false);
  assert.equal(replayBatchDay(a,'2026-10-31',9),null,'date-only signing date must not shift backward in NY');
  console.log('PASS old one-point archive repaired, all daily prices reused, historical imports supersede stale totals, manual institution shares, two batches, dated stock/cash topups, exact asset conservation, gap warnings and unchanged ledgers');
 } finally {globalThis.fetch=saved.fetch;prisma.quoteHistoryCandle.findMany=saved.find;prisma.$transaction=saved.tx;}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
