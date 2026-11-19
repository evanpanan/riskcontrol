import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dispatchNotification } from '../src/lib/server/notificationDispatch';
import { notifyBatchChannel } from '../src/lib/notifier';
import { notificationHarness, testEnv } from './helpers/notificationHarness';
import { prisma } from '../src/lib/prisma';
const manual = (requestId?: string) => ({
  batchId:'manual-batch', type:'MARGIN_CALL', severity:'CRITICAL', title:'风控提醒', message:'本次补仓详情',
  details:{ marginCallId:'round1', deliveryContext:{ kind:'manual', channel:'telegram', actorId:'admin', actorName:'管理员', actorEmail:'a@recipient.test', ...(requestId?{requestId}:{}) } },
});
async function main() {
  const h=notificationHarness();
  try {
    const old=await dispatchNotification(manual(),testEnv);
    const oldRepeat=await dispatchNotification(manual(),testEnv);
    assert.equal(old.success,true);assert.equal(oldRepeat.success,true);assert.equal(oldRepeat.deduplicated,true);assert.equal(h.test.calls.length,1,'reproduce legacy old success without a fresh TG message');
    const firstId=randomUUID();
    const first=await dispatchNotification(manual(firstId),testEnv);
    const second=await dispatchNotification(manual(randomUUID()),testEnv);
    assert.equal(first.success,true);assert.equal(second.success,true);assert.notEqual(first.dispatchId,second.dispatchId);assert.equal(h.test.calls.length,3,'each deliberate click issues a new TG request');
    const again=await dispatchNotification(manual(firstId),testEnv);
    assert.equal(again.deduplicated,true);assert.equal(h.test.calls.length,3,'same request retries do not send again');
    h.rows.get(first.dispatchId).updatedAt=new Date(0);
    await dispatchNotification(manual(firstId),testEnv);
    assert.equal(h.test.calls.length,3,'same request stays idempotent past the cooldown');
    h.test.tg='unknown';
    const unknownId=randomUUID();const unknown=await dispatchNotification(manual(unknownId),testEnv);
    assert.equal(unknown.status,'REVIEW');await dispatchNotification(manual(unknownId),testEnv);assert.equal(h.test.calls.length,4,'unknown outcome never automatically resends');
  } finally {h.restore();}
  const originalFetch=globalThis.fetch;const ids:string[]=[];
  const batch={id:'client-manual',batchNumber:'TEST',stockSymbol:'TEST',stockPriceAtStart:100,currentStockPrice:80,initialTotalAmount:1000,priorityAmount:700,subordinateAmount:300,totalShares:10,cumulativeMarginCalls:0,clients:[],marginCalls:[]} as any;
  try {
    let fail=false;
    globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));ids.push(body.requestId);assert.match(body.requestId,/^[a-f0-9-]{36}$/);if(fail)throw new Error('socket lost');return new Response(JSON.stringify({channels:{telegram:{success:true,sentTo:['-100123']}}}));};
    await notifyBatchChannel(batch);await notifyBatchChannel(batch);assert.notEqual(ids[0],ids[1]);
    fail=true;await assert.rejects(notifyBatchChannel(batch));await assert.rejects(notifyBatchChannel(batch));assert.equal(ids[2],ids[3]);
    fail=false;await notifyBatchChannel(batch);assert.equal(ids[3],ids[4]);await notifyBatchChannel(batch);assert.notEqual(ids[4],ids[5]);
  } finally {globalThis.fetch=originalFetch;}
  console.log('PASS reproduced old successful no-send; fresh manual sends, exact-request and unknown-outcome idempotency, expired-cooldown protection and browser request identity lifecycle');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
