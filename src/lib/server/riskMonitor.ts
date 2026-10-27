import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {prisma} from '@/lib/prisma';
import {refreshLedgerQuotes} from './ledger';
import {deliverNotification,notificationReadiness} from './notificationDelivery';
import {getBatchMetrics,type BatchLike} from '@/lib/riskEngine';
import {getNYSEInfo} from '@/lib/liveQuote';
type Env=Record<string,string|undefined>;
const serviceUser={id:'service:risk-monitor',email:'monitor@internal.invalid',displayName:'后台风险监控',avatarInitials:'RM',role:'ADMIN' as const};
export function authorizedCron(value:string|null,env:Env=process.env) {
  const secret=env.CRON_SECRET;const expected=Buffer.from(`Bearer ${secret ?? ''}`);const actual=Buffer.from(value ?? '');
  return !!secret && secret.length>=32 && actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function monitorRecipients(env:Env=process.env){
  const emails=[...new Set((env.MONITOR_NOTIFICATION_EMAILS ?? '').split(',').map(x=>x.trim()).filter(Boolean))];
  return {emails,valid:emails.length>0&&emails.length<=20&&emails.every(x=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x))};
}
export async function runRiskMonitor(options:{env?:Env;refresh?:()=>Promise<unknown>;notify?:typeof deliverNotification;now?:Date}={}) {
  const env=options.env ?? process.env;const now=options.now ?? new Date();
  if(env.MONITOR_ENABLED!=='true')throw new Error('后台监控未启用');
  const token=randomUUID();const until=new Date(now.getTime()+600000);
  let claimed=await prisma.operationalLease.updateMany({where:{id:'risk-monitor',expiresAt:{lt:now}},data:{token,expiresAt:until}});
  if(!claimed.count){try{await prisma.operationalLease.create({data:{id:'risk-monitor',token,expiresAt:until}});claimed={count:1};}catch(e:any){if(e.code==='P2002')return{status:'BUSY'};throw e;}}
  const id=randomUUID();await prisma.monitorRun.create({data:{id,status:'RUNNING',startedAt:now}});
  const errors:string[]=[];let queued=0,sent=0;
  async function renew(){const lease=await prisma.operationalLease.updateMany({where:{id:'risk-monitor',token,expiresAt:{gt:new Date()}},data:{expiresAt:new Date(Date.now()+600000)}});if(!lease.count)throw new Error('Monitor lease expired');}
  try {
    // Do not retry ambiguous deliveries after a crash; require operator reconciliation.
    await prisma.riskNotification.updateMany({where:{status:'SENDING',updatedAt:{lt:new Date(now.getTime()-600000)}},data:{status:'UNKNOWN',error:'上次发送未确认结果，请到服务商核对，禁止盲目重发'}});
    try{await (options.refresh ?? (()=>refreshLedgerQuotes(serviceUser)))();}catch{errors.push('行情刷新失败');}
    await renew();
    const rows=await prisma.ledgerBatch.findMany();
    const recipients=monitorRecipients(env);const emails=recipients.valid?recipients.emails:[];
    if(!recipients.valid)errors.push('请配置1至20位有效后台风险收件人');
    const market=getNYSEInfo(now.getTime());
    for(const row of rows) {
      await renew();
      const b=row.snapshot as unknown as BatchLike;
      if(!(b.clients ?? []).some(c=>c.status!=='SETTLED'))continue;
      const priceTime=new Date(b.quoteAsOf ?? 0).getTime();
      const stale=!b.quoteAsOf || !Number.isFinite(priceTime) || priceTime>now.getTime()+60000 || (market.shouldRefreshReal && now.getTime()-priceTime>15*60000);
      const level=stale?'DATA_STALE':getBatchMetrics(b).riskLevel;
      if(stale)errors.push(`批次 ${b.id} 报价时间未核验或已过期`);
      const stateKey=`monitor-risk:${b.id}`;const previous=await prisma.appConfig.findUnique({where:{id:stateKey}});const last=previous?.value as any;
      const round=b.finance?.rounds.filter(r=>r.status==='PENDING'||r.status==='OVERDUE').at(-1)?.id ?? '';
      const changed=last?.level!==level || last?.round!==round;
      const episode=changed?randomUUID():last.episode;
      if(level!=='NORMAL' && emails.length){
        const key=createHash('sha256').update(`${b.id}:${level}:${episode}:email:${emails.join(',')}`).digest('hex');
        const payload={channel:'email',payload:{title:`RiskControl ${level==='DATA_STALE'?'报价异常待核对':level==='CRITICAL'?'击穿预警':'风险预警'} · ${b.batchNumber ?? b.id}`,message:`批次 ${b.batchNumber ?? b.id}\n状态 ${level}\n参考价格 ${b.currentStockPrice}\n报价时间 ${b.quoteAsOf ?? '未提供'}\n请核对账本与原始成交凭证；本通知不执行资金操作。`,severity:level==='WARNING'?'warning':'critical',type:'risk-monitor',batchId:b.id,recipients:{emails}}};
        await prisma.$transaction(async tx=>{
          const existed=await tx.riskNotification.findUnique({where:{id:key}});
          await tx.riskNotification.updateMany({where:{batchId:b.id,status:'PENDING',id:{not:key}},data:{status:'SUPERSEDED',error:'风险状态变化，待发送旧通知已撤销'}});
          if(!existed){await tx.riskNotification.create({data:{id:key,batchId:b.id,payload}});queued++;}
          await tx.appConfig.upsert({where:{id:stateKey},create:{id:stateKey,value:{level,episode,round}},update:{value:{level,episode,round}}});
        });
      }else await prisma.$transaction(async tx=>{await tx.riskNotification.updateMany({where:{batchId:b.id,status:'PENDING'},data:{status:'SUPERSEDED',error:'风险已恢复或没有有效收件人，旧通知已撤销'}});await tx.appConfig.upsert({where:{id:stateKey},create:{id:stateKey,value:{level,episode,round}},update:{value:{level,episode,round}}});});
    }
    const ready=notificationReadiness(env).email.ready;
    if(env.MONITOR_NOTIFICATIONS_ENABLED!=='true' || !ready){if(await prisma.riskNotification.count({where:{status:'PENDING'}}))errors.push('风险通知尚未启用或服务未就绪，已持久入队但未发送');}
    else {
      const work=await prisma.riskNotification.findMany({where:{status:'PENDING'},orderBy:{createdAt:'asc'},take:20});
      for(const job of work){
        await renew();
        // One transport attempt per event; timeout outcomes are deliberately not auto-retried.
        const claim=await prisma.riskNotification.updateMany({where:{id:job.id,status:'PENDING'},data:{status:'SENDING',attempts:{increment:1}}});if(!claim.count)continue;
        try{const result=await (options.notify ?? deliverNotification)(job.payload,env);if(!result.success)throw new Error('服务未确认全部收件人发送成功');await prisma.riskNotification.update({where:{id:job.id},data:{status:'SENT',error:null}});sent++;}
        catch{await prisma.riskNotification.update({where:{id:job.id},data:{status:'UNKNOWN',error:'发送结果未确认，请人工核对服务商记录后处置'}});errors.push('存在发送结果未确认的通知');}
      }
    }
    if(await prisma.riskNotification.count({where:{status:'UNKNOWN'}}))errors.push('存在待人工核对的通知');
    const status=errors.length?'DEGRADED':'OK';const detail={queued,sent,errors};
    await prisma.monitorRun.update({where:{id},data:{status,completedAt:new Date(),detail}});
    return {id,status,...detail};
  } catch(e) {await prisma.monitorRun.update({where:{id},data:{status:'FAILED',completedAt:new Date(),detail:{error:'后台任务失败，请检查数据库与服务日志'}}});throw e;}
  finally {await prisma.operationalLease.deleteMany({where:{id:'risk-monitor',token}});}
}
