import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prisma} from '../src/lib/prisma';
import {initializeBatchFinance,addClientPosition,type BatchLike} from '../src/lib/riskEngine';
import {recordValuation,aggregateValuations,readValuationHistory} from '../src/lib/server/valuationHistory';
import {authorizedCron,runRiskMonitor} from '../src/lib/server/riskMonitor';
import {resolveNotification} from '../src/lib/server/notificationResolution';
import {backupDatabase,restoreDatabase} from './operations/backup';
const run=promisify(execFile);
const url=process.env.DATABASE_URL || '';
if(url!=='postgresql://audit@127.0.0.1:55437/riskcontrol_ops_check')throw new Error('Only the isolated riskcontrol_ops_check database is permitted');
const user=(id:string,role:'ADMIN'|'BD_MANAGER'='ADMIN')=>({id,role,email:'fixture@example.invalid',displayName:'Fixture',avatarInitials:'FX'});
const pass=(text:string)=>console.log('PASS '+text);
async function main(){
 assert.equal(await prisma.ledgerBatch.count(),0,'Use an empty ops test database; do not erase existing records');
 const b={id:randomUUID(),batchNumber:'OPS-FIXTURE',stockSymbol:'TEST',stockPriceAtStart:100,currentStockPrice:100,signDate:'2024-01-01',maturityDate:'2028-01-01',initialTotalAmount:0,priorityAmount:0,subordinateAmount:0,totalShares:0,cumulativeMarginCalls:0,clients:[],marginCalls:[],quoteAsOf:new Date().toISOString()} as BatchLike;
 initializeBatchFinance(b);
 for(const [id,price] of [['A',100],['B',200]] as const){b.currentStockPrice=price;addClientPosition(b,{id,batchId:b.id,name:'Synthetic '+id,bdManager:id,bdUserId:id,investmentAmount:70000,entryStockPrice:price,status:'ACTIVE',signDate:'2024-01-01',profitSplitClient:40,profitSplitInstitution:60});}
 await prisma.ledgerBatch.create({data:{id:b.id,batchNumber:b.batchNumber,snapshot:JSON.parse(JSON.stringify(b))}});
 const time=new Date('2026-10-26T10:10:00Z');
 await prisma.$transaction(tx=>recordValuation(tx,b,time));
 let records=await prisma.ledgerValuation.findMany();assert.equal(records.length,1);
 assert.equal(aggregateValuations(records,user('A','BD_MANAGER'))[0].value,200000);assert.equal(aggregateValuations(records,user('B','BD_MANAGER'))[0].value,100000);assert.equal(aggregateValuations(records,user('C','BD_MANAGER')).length,0);
 b.currentStockPrice=100;await prisma.$transaction(tx=>recordValuation(tx,b,new Date('2026-10-26T10:55:00Z')));records=await prisma.ledgerValuation.findMany();assert.equal(records.length,1);assert.equal(aggregateValuations(records,user('admin'))[0].value,150000);
 await prisma.$transaction(tx=>recordValuation(tx,b,new Date('2026-10-26T11:05:00Z')));assert.equal((await readValuationHistory(user('A','BD_MANAGER'),new Date('2020-01-01'))).points.length,2);assert.equal((await readValuationHistory(user('C','BD_MANAGER'),new Date('2020-01-01'))).points.length,0);
 pass('persisted history uses actual valuations, overwrites only same hour, filters owner and never backfills');
 await assert.rejects(prisma.$transaction(async tx=>{await recordValuation(tx,b,new Date('2026-10-26T12:05:00Z'));throw new Error('test rollback');}));assert.equal(await prisma.ledgerValuation.count(),2);pass('history rolls back with failed financial transaction');
 assert(!authorizedCron(null));assert(!authorizedCron('Bearer short',{CRON_SECRET:'short'}));assert(authorizedCron('Bearer '+'a'.repeat(32),{CRON_SECRET:'a'.repeat(32)}));assert(!authorizedCron('Bearer '+'b'.repeat(32),{CRON_SECRET:'a'.repeat(32)}));
 const env={MONITOR_ENABLED:'true',MONITOR_NOTIFICATIONS_ENABLED:'true',MONITOR_NOTIFICATION_EMAILS:'operator@example.invalid',NOTIFICATION_SEND_TOKEN:'a'.repeat(40),EMAIL_WEBHOOK_URL:'https://notify.internal.invalid/send'};
 let attempts=0;const options={env,refresh:async()=>{},notify:async()=>{attempts++;return{success:true,sentTo:['operator@example.invalid'],status:'sent',error:undefined};}};
 // Force missing quote independently of exchange opening hours.
 const snapshot:any=JSON.parse(JSON.stringify(b));snapshot.quoteAsOf=null;await prisma.ledgerBatch.update({where:{id:b.id},data:{snapshot}});
 let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const first=runRiskMonitor({...options,refresh:async()=>{entered();await gate;}});await started;assert.equal((await runRiskMonitor(options)).status,'BUSY');release();assert.equal((await first).status,'DEGRADED');assert.equal(attempts,1);
 await runRiskMonitor(options);assert.equal(attempts,1);pass('monitor runs without browser, excludes overlap and deduplicates unchanged risk');
 snapshot.quoteAsOf=new Date().toISOString();snapshot.currentStockPrice=200;await prisma.ledgerBatch.update({where:{id:b.id},data:{snapshot}});await runRiskMonitor(options);
 snapshot.quoteAsOf=null;await prisma.ledgerBatch.update({where:{id:b.id},data:{snapshot}});await runRiskMonitor({...options,notify:async()=>{attempts++;throw new Error('test ambiguous timeout');}});assert.equal(attempts,2);await runRiskMonitor(options);assert.equal(attempts,2);const unknown=await prisma.riskNotification.findFirstOrThrow({where:{status:'UNKNOWN'}});
 await assert.rejects(resolveNotification(user('B','BD_MANAGER'),{id:unknown.id,resolution:'CONFIRMED_NOT_SENT',evidence:'provider receipt checked'}));
 await resolveNotification(user('admin'),{id:unknown.id,resolution:'CONFIRMED_NOT_SENT',evidence:'Synthetic provider confirms request never accepted'});await runRiskMonitor(options);assert.equal(attempts,3);assert.equal(await prisma.auditLog.count({where:{action:'notification_resolution'}}),1);pass('ambiguous delivery is not retried until admin resolves it with atomic audit');
 // Queue without sending, then recover: obsolete warning must not be sent later.
 snapshot.quoteAsOf=new Date().toISOString();await prisma.ledgerBatch.update({where:{id:b.id},data:{snapshot}});await runRiskMonitor(options);snapshot.quoteAsOf=null;await prisma.ledgerBatch.update({where:{id:b.id},data:{snapshot}});await runRiskMonitor({...options,env:{...env,MONITOR_NOTIFICATIONS_ENABLED:'false'}});assert.equal(await prisma.riskNotification.count({where:{status:'PENDING'}}),1);snapshot.quoteAsOf=new Date().toISOString();await prisma.ledgerBatch.update({where:{id:b.id},data:{snapshot}});await runRiskMonitor(options);assert.equal(attempts,3);assert.equal(await prisma.riskNotification.count({where:{status:'PENDING'}}),0);pass('recovered risks cancel stale queued warnings');
 const dir=await mkdtemp(join(tmpdir(),'rc-ops-test-'));const targetName='riskcontrol_restore_'+randomUUID().slice(0,8);const target=url.replace('riskcontrol_ops_check',targetName);const connection=['-h','127.0.0.1','-p','55437','-U','audit'];const key='local-synthetic-backup-key-'+randomUUID();
 try{
  const file=join(dir,'ledger.rcbackup');await backupDatabase(url,file,key);assert.equal((await stat(file)).mode&0o777,0o600);await assert.rejects(backupDatabase(url,file,key));await run('createdb',[...connection,targetName]);
  await assert.rejects(restoreDatabase(file,url,target,key+'wrong',targetName));const empty=await run('psql',[...connection,'-d',targetName,'-Atc',"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]);assert.equal(empty.stdout.trim(),'0');
  await assert.rejects(restoreDatabase(file,url,url,key,'riskcontrol_ops_check'));await assert.rejects(restoreDatabase(file,url,target,key,'wrong-confirmation'));await restoreDatabase(file,url,target,key,targetName);
  const sql=`SELECT md5(coalesce(string_agg(t::text,',' ORDER BY t::text),'')) FROM (SELECT row_to_json(x) AS t FROM "LedgerBatch" x UNION ALL SELECT row_to_json(x) FROM "LedgerValuation" x UNION ALL SELECT row_to_json(x) FROM "AuditLog" x UNION ALL SELECT row_to_json(x) FROM "RiskNotification" x UNION ALL SELECT row_to_json(x) FROM "MonitorRun" x) q`;
  const a=await run('psql',[...connection,'-d','riskcontrol_ops_check','-Atc',sql]);const restored=await run('psql',[...connection,'-d',targetName,'-Atc',sql]);assert.equal(a.stdout,restored.stdout);await assert.rejects(restoreDatabase(file,url,target,key,targetName));pass('encrypted database backup restores identical ledger/history/audit/notifications; bad key, same DB, bad confirmation and nonempty target rejected');
  const ref={sourceDocumentId:'SYNTHETIC-INDEPENDENT-REFERENCE',approvedBy:'TEST-ONLY',asOf:new Date().toISOString(),batches:[{id:b.id,remainingCapital:200000,remainingShares:1500,rescueShares:0,rescueCash:0,settlementsCount:0,clients:[{id:'A',investmentAmount:70000,entryStockPrice:100,bdUserId:'A',status:'ACTIVE'},{id:'B',investmentAmount:70000,entryStockPrice:200,bdUserId:'B',status:'ACTIVE'}],trades:[]}]};const path=join(dir,'reference.json');await writeFile(path,JSON.stringify(ref));await run(process.execPath,['--import','tsx','scripts/reconcile-ledger.ts',path]);ref.batches[0].remainingShares=1501;await writeFile(path,JSON.stringify(ref));await assert.rejects(run(process.execPath,['--import','tsx','scripts/reconcile-ledger.ts',path]));assert.deepEqual((await prisma.ledgerBatch.findUniqueOrThrow({where:{id:b.id}})).snapshot,snapshot);pass('read-only reconciliation accepts independent synthetic balances and detects mismatch without mutation');
 }finally{await run('dropdb',[...connection,'--if-exists',targetName]).catch(()=>{});await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
