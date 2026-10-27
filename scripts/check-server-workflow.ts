import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
const target=process.env.TEST_BASE_URL || 'http://127.0.0.1:3019';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(target) || !/\/(riskcontrol_fix)(\?|$)/.test(process.env.DATABASE_URL || '')) throw new Error('Use only the isolated riskcontrol_fix database and localhost service.');
async function call(path:string,body?:any,cookie?:string,method?:string){const r=await fetch(target+path,{method:method ?? (body?'POST':'GET'),headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
function pass(s:string){console.log('PASS '+s);}
async function main(){
 assert.equal((await call('/api/auth/login',{identifier:'admin_root',password:'Admin@Risk2026'})).status,401);pass('production demo administrator rejected');
 const login=await call('/api/auth/login',{identifier:'audit-admin@example.invalid',password:'LocalAudit2026!Only'});assert.equal(login.status,200);const admin=login.cookie!;
 const tag=randomUUID().slice(0,8);
 async function user(role:string,name:string){const email=`${tag}-${name.replaceAll(" ","-")}@example.invalid`;const r=await call('/api/auth/manage',{email,displayName:name,role,bdManagerFullName:role==='BD_MANAGER'?`${name}-${tag}`:null,password:'LocalUser2026!Only'},admin);assert.equal(r.status,200,JSON.stringify(r.data));const l=await call('/api/auth/login',{identifier:email,password:'LocalUser2026!Only'});assert.equal(l.status,200);return{...r.data.user,cookie:l.cookie};}
 const bd=await user('BD_MANAGER','BD One');const other=await user('BD_MANAGER','BD Two');const ops=await user('OPERATIONS','Ops');const risk=await user('RISK_MANAGER','Risk');assert.equal((await call('/api/ledger',undefined,risk.cookie)).status,200);pass('new database accounts create and login');
 assert.equal((await call('/api/ledger/history')).status,401);
 assert.equal((await call('/api/internal/risk-monitor')).status,401);
 assert.equal((await call('/api/health',undefined,bd.cookie)).status,403);
 assert.equal((await call('/api/monitor/notifications',undefined,bd.cookie)).status,403);
 assert.equal((await call('/api/health',undefined,admin)).status,503,'Disabled monitor must not look ready');
 assert.equal((await call('/api/ledger/history?since=invalid',undefined,admin)).status,400);
 pass('history/monitor/health require authorization; disabled monitoring reports not ready');
 assert.equal((await call('/api/auth/manage',undefined,bd.cookie)).status,403);
 const created=await call('/api/ledger',{operation:'create',input:{batchNumber:'FIX-'+tag,stockSymbol:'TEST',currentStockPrice:100,signDate:'2024-01-01',maturityDate:'2028-01-01'}},admin);assert.equal(created.status,200,JSON.stringify(created.data));let batch=created.data.batch;
 async function refresh(){const r=await call('/api/ledger',undefined,admin);assert.equal(r.status,200);batch=r.data.batches.find((x:any)=>x.id===batch.id);return batch;}
 async function cmd(type:string,input:any,cookie=admin,revision=batch.finance.revision,id=randomUUID()){return call('/api/ledger',{commandId:id,batchId:batch.id,revision,command:{type,input}},cookie);}
 for(const b of [bd,other]){const r=await cmd('client_add',{name:'Synthetic '+b.displayName,investmentAmount:70000,bdUserId:b.id,signDate:'2024-01-01'});assert.equal(r.status,200,JSON.stringify(r.data));await refresh();}
 assert.equal(batch.priorityAmount,140000);assert.equal(batch.initialTotalAmount,200000);pass('two subscriptions booked on server with institution matching capital');
 const late=await cmd('client_add',{name:'Synthetic Later Subscriber',investmentAmount:70000,bdUserId:bd.id,signDate:'2025-01-01'});assert.equal(late.status,200,JSON.stringify(late.data));await refresh();assert.equal(batch.clients.find((x:any)=>x.name==='Synthetic Later Subscriber').contractTerms.lockUpEndDate.slice(0,10),'2025-07-01');pass('later subscription has its own lock-up and preserves batch maturity');
 const recorded=await call('/api/ledger/history',undefined,bd.cookie);assert.equal(recorded.status,200);assert(recorded.data.points.length>0);assert.equal(recorded.data.source,'RECORDED_LEDGER_VALUATIONS');pass('authenticated history endpoint returns persisted owner valuations');
 const own=batch.clients.find((x:any)=>x.bdUserId===bd.id);const theirs=batch.clients.find((x:any)=>x.bdUserId===other.id);
 const visible=await call('/api/ledger',undefined,bd.cookie);const text=JSON.stringify(visible.data);assert(text.includes(own.id));assert(!text.includes(theirs.id));assert(!text.includes(theirs.name));
 const filtered=await call('/api/data/clients/filter',{clients:[{id:'forged',name:'forged',bdManager:bd.bdManagerFullName}]},bd.cookie);assert(!JSON.stringify(filtered.data).includes('forged'));pass('BD ownership enforced before data leaves server; supplied rows ignored');
 assert.equal((await cmd('topup',{amount:1000},bd.cookie)).status,403);
 assert.equal((await cmd('exit_request',{clientId:theirs.id},bd.cookie)).status,403);
 const price=await cmd('batch_update',{currentStockPrice:78});assert.equal(price.status,200,JSON.stringify(price.data));await refresh();assert(batch.finance.rounds.length>0);
 const revision=batch.finance.revision;const id=randomUUID();const input={amount:1000,expectedRoundId:batch.finance.rounds.at(-1).id};
 const [a,b]=await Promise.all([cmd('topup',input,admin,revision,id),cmd('topup',input,admin,revision,randomUUID())]);assert.deepEqual([a.status,b.status].sort(),[200,409]);await refresh();assert.equal(batch.cumulativeMarginCalls,1000);
 // Replay whichever request used the fixed key only when it was the winning transaction.
 if(a.status===200){const replay=await cmd('topup',input,admin,revision,id);assert.equal(replay.status,200);await refresh();assert.equal(batch.cumulativeMarginCalls,1000);}
 pass('concurrent revision conflict rejected; no duplicate financial booking');
 const stableId=randomUUID();const stableRevision=batch.finance.revision;
 assert.equal((await cmd('topup',{amount:125},admin,stableRevision,stableId)).status,200);
 assert.equal((await cmd('topup',{amount:125},admin,stableRevision,stableId)).status,200);
 assert.equal((await cmd('topup',{amount:126},admin,stableRevision,stableId)).status,409);
 await refresh();assert.equal(batch.cumulativeMarginCalls,1125);pass('same idempotency key never books twice; changed payload rejected');
 assert.equal((await call('/api/audit',{action:'margin_topup',detail:{amount:999999}},bd.cookie)).status,400);pass('client cannot forge financial audit entries');

 const staleRow=await prisma.ledgerBatch.findUniqueOrThrow({where:{id:batch.id}});const stale:any=staleRow.snapshot;
 stale.quoteAsOf=new Date(Date.now()-86400000).toISOString();await prisma.ledgerBatch.update({where:{id:batch.id},data:{snapshot:stale}});
 assert.equal((await cmd('topup',{amount:100})).status,409);
 stale.quoteAsOf=new Date().toISOString();await prisma.ledgerBatch.update({where:{id:batch.id},data:{snapshot:stale}});await refresh();pass('stale reference price blocks financial booking');
 const before=structuredClone(batch);
 await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reject_test_topup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='margin_topup' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER audit_failure_test BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_test_topup()`);
 try{assert.equal((await cmd('topup',{amount:100})).status,503);await refresh();assert.equal(batch.cumulativeMarginCalls,before.cumulativeMarginCalls);assert.equal(batch.finance.revision,before.finance.revision);}finally{await prisma.$executeRawUnsafe('DROP TRIGGER audit_failure_test ON "AuditLog"');await prisma.$executeRawUnsafe('DROP FUNCTION reject_test_topup()');}pass('audit failure rolls back financial write and revision atomically');
 const ex=await cmd('exit_request',{clientId:own.id},bd.cookie);assert.equal(ex.status,200);await refresh();
 // Controlled fixture: emulate a matured contract with elapsed notice in the isolated test database.
 const row=await prisma.ledgerBatch.findUniqueOrThrow({where:{id:batch.id}});const fixture:any=row.snapshot;fixture.finalMaturityDate='2026-01-01T00:00:00.000Z';fixture.maturityDate=fixture.finalMaturityDate;fixture.clients.find((x:any)=>x.id===own.id).contractTerms.finalMaturityDate=fixture.finalMaturityDate;fixture.clients.find((x:any)=>x.id===own.id).exitRequestedAt=new Date(Date.now()-20*86400000).toISOString();await prisma.ledgerBatch.update({where:{id:row.id},data:{snapshot:fixture}});await refresh();
 const assets=batch.currentMarketValue;const settled=await cmd('settle',{clientId:own.id});assert.equal(settled.status,200,JSON.stringify(settled.data));await refresh();const result=settled.data.result;assert(Math.abs(result.clientReceives+result.institutionReceives+batch.currentMarketValue-assets)<0.03);pass('exit request, notice fixture and settlement conserve assets');
 const secondDevice=await call('/api/ledger',undefined,ops.cookie);assert.equal(secondDevice.data.batches.find((x:any)=>x.id===batch.id).clients.find((x:any)=>x.id===own.id).status,'SETTLED');pass('independent operator session reads identical persisted settlement');
 assert.equal((await call('/api/auth/logout',{},ops.cookie)).status,200);assert.equal((await call('/api/auth/me',undefined,ops.cookie)).status,401);pass('logout revokes old cookie');
 assert.equal((await call('/api/auth/manage/'+bd.id,{enabled:false},admin,'PATCH')).status,200);assert.equal((await call('/api/auth/me',undefined,bd.cookie)).status,401);assert.equal((await call('/api/auth/login',{identifier:bd.email,password:'LocalUser2026!Only'})).status,401);pass('disabled account rejects current session and new login');
 const logs=await call('/api/audit',undefined,admin);assert.equal(logs.status,200);assert(logs.data.logs.some((x:any)=>x.action==='client_settle'&&x.resource===batch.id));pass('authoritative audit can be read back');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
