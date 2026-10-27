import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {prisma} from '../src/lib/prisma';
import {clientAccountCapital,clientAccountShares,calculateRescueStats,type BatchLike} from '../src/lib/riskEngine';
async function main(){
 const file=process.argv[2];if(!file)throw new Error('Provide an independently approved reference JSON; this tool never imports or rewrites a ledger');
 const reference=JSON.parse(await readFile(file,'utf8'));
 if(typeof reference.sourceDocumentId!=='string'||!reference.sourceDocumentId.trim()||typeof reference.approvedBy!=='string'||!reference.approvedBy.trim()||!Array.isArray(reference.batches)||!Number.isFinite(Date.parse(reference.asOf)))throw new Error('Reference requires sourceDocumentId, approvedBy, asOf and batches');
 const rows=await prisma.ledgerBatch.findMany();const issues:string[]=[];const expected=new Map<string,any>();
 for(const r of reference.batches){if(!r.id||expected.has(r.id)||!Array.isArray(r.clients)||!Array.isArray(r.trades))throw new Error('Each reference batch requires a unique id, clients and trades');expected.set(r.id,r);}
 const near=(a:number,b:unknown,label:string,tolerance=0.03)=>{if(typeof b!=='number'||!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>tolerance)issues.push(label);};
 for(const row of rows){
  const b=row.snapshot as unknown as BatchLike;const r=expected.get(b.id);if(!r){issues.push(`missing reference: ${b.id}`);continue;}expected.delete(b.id);
  const active=(b.clients ?? []).filter(c=>c.status!=='SETTLED');
  near(b.finance?.remainingCapital ?? NaN,active.reduce((n,c)=>n+clientAccountCapital(c),0),`internal capital mismatch ${b.id}`);
  near(b.finance?.remainingShares ?? NaN,active.reduce((n,c)=>n+clientAccountShares(b,c),0),`internal shares mismatch ${b.id}`,1e-8);
  near(b.finance?.remainingCapital ?? NaN,r.remainingCapital,`reference capital mismatch ${b.id}`);
  near(b.finance?.remainingShares ?? NaN,r.remainingShares,`reference shares mismatch ${b.id}`,1e-8);
  const clients=new Map<string,any>();for(const c of r.clients){if(!c.id||clients.has(c.id))throw new Error('Reference clients require unique ids');clients.set(c.id,c);}
  for(const c of b.clients ?? []){const match=clients.get(c.id);clients.delete(c.id);if(!match){issues.push(`missing client ${b.id}/${c.id}`);continue;}
   near(c.investmentAmount,match.investmentAmount,`client principal mismatch ${c.id}`);near(c.entryStockPrice ?? NaN,match.entryStockPrice,`entry price mismatch ${c.id}`,1e-8);
   if(c.bdUserId!==match.bdUserId||c.status!==match.status)issues.push(`client ownership/status mismatch ${c.id}`);
   const settlement=b.finance?.settlements[c.id];if(c.status==='SETTLED'){near(settlement?.clientReceives ?? NaN,match.clientReceives,`client settlement mismatch ${c.id}`);near(settlement?.institutionReceives ?? NaN,match.institutionReceives,`institution settlement mismatch ${c.id}`);}
  }
  if(clients.size)issues.push(`reference clients absent from ledger ${b.id}`);
  const trades=b.finance?.trades ?? [];if(trades.some(t=>!t.clientId||!(b.clients ?? []).some(c=>c.id===t.clientId)))issues.push(`unresolved trade ownership ${b.id}`);
  const receipts=new Map<string,any>();for(const t of r.trades){if(!t.id||receipts.has(t.id))throw new Error('Reference trades require unique ids');receipts.set(t.id,t);}
  for(const t of trades){const match=receipts.get(t.id);receipts.delete(t.id);if(!match){issues.push(`missing receipt ${t.id}`);continue;}
   if(t.clientId!==match.clientId||t.collateralType!==match.collateralType)issues.push(`trade ownership/type mismatch ${t.id}`);
   near(t.amount,match.amount,`trade amount mismatch ${t.id}`);near(t.shares,match.shares,`trade shares mismatch ${t.id}`,1e-8);near(t.remainingFraction,match.remainingFraction,`trade remaining mismatch ${t.id}`,1e-10);
   if(t.entryPrice!==null)near(t.entryPrice,match.entryPrice,`trade entry price mismatch ${t.id}`,1e-8);else if(match.entryPrice!==null)issues.push(`cash entry price mismatch ${t.id}`);
  }
  if(receipts.size)issues.push(`reference receipts absent from ledger ${b.id}`);
  const rescue=calculateRescueStats(b,b.currentStockPrice ?? b.stockPriceAtStart);
  near(rescue.totalRescueShares,r.rescueShares,`reference rescue shares mismatch ${b.id}`,1e-8);
  near(trades.filter(t=>t.collateralType==='cash').reduce((n,t)=>n+t.amount*t.remainingFraction,0),r.rescueCash,`reference rescue cash mismatch ${b.id}`);
  near(Object.keys(b.finance?.settlements ?? {}).length,r.settlementsCount,`reference settlements mismatch ${b.id}`,0);
 }
 for(const id of expected.keys())issues.push(`reference batch absent from ledger: ${id}`);
 const report={checkedAt:new Date().toISOString(),sourceDocumentId:reference.sourceDocumentId,approvedBy:reference.approvedBy,asOf:reference.asOf,ledgerBatchCount:rows.length,matched:!issues.length,issues,note:'Arithmetic match against current ledger only. Reference authenticity, contract approval and real cash/stock ownership require business verification.'};
 if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(report,null,2));if(issues.length)process.exitCode=1;
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
