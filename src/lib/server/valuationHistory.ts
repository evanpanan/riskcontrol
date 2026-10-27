import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { viewBatch } from './ledgerProjection';
import { getAccountMarketValue,calculateBatchPnLSplit,getClientProfitSplit,type BatchLike } from '@/lib/riskEngine';
import type { AppSessionUser } from '@/types/auth';
export interface ValuationMetrics { value:number;clientValue:number;institutionValue:number;pnl:number;priceStale:boolean; }
interface StoredValuation { all:ValuationMetrics; owners:Record<string,ValuationMetrics>; }
function metrics(batch:BatchLike,now:Date):ValuationMetrics {
  const value=getAccountMarketValue(batch);const price=batch.currentStockPrice ?? batch.stockPriceAtStart;
  const clientValue=(batch.clients ?? []).filter(c=>c.status!=='SETTLED').reduce((sum,c)=>sum+c.investmentAmount+Math.max(0,c.investmentAmount*(price/(c.entryStockPrice ?? batch.stockPriceAtStart)-1))*getClientProfitSplit(c).client,0);
  const split=calculateBatchPnLSplit(batch,value);const priceTime=new Date(batch.quoteAsOf ?? 0).getTime();
  return {value,clientValue,institutionValue:value-clientValue,pnl:split.clientTotalPnL+split.institutionTotalPnL,priceStale:!Number.isFinite(priceTime)||now.getTime()-priceTime>15*60000||priceTime>now.getTime()+60000};
}
export async function recordValuation(tx:Prisma.TransactionClient,batch:BatchLike,now=new Date()) {
  const owners:StoredValuation['owners']={};
  for(const id of new Set((batch.clients ?? []).map(c=>c.bdUserId).filter((id):id is string=>!!id))) {
    const view=viewBatch(batch,{id,role:'BD_MANAGER',email:'service@internal.invalid',displayName:'Service',avatarInitials:'SV'});
    if(view)owners[id]=metrics(view,now);
  }
  const payload:StoredValuation={all:metrics(batch,now),owners};const bucketAt=new Date(Math.floor(now.getTime()/3600000)*3600000);
  await tx.ledgerValuation.upsert({where:{id:`${batch.id}:${bucketAt.toISOString()}`},create:{id:`${batch.id}:${bucketAt.toISOString()}`,batchId:batch.id,bucketAt,recordedAt:now,metrics:JSON.parse(JSON.stringify(payload))},update:{recordedAt:now,metrics:JSON.parse(JSON.stringify(payload))}});
}
export interface HistoryRecord {batchId:string;recordedAt:Date;bucketAt:Date;metrics:unknown;}
export function aggregateValuations(records:HistoryRecord[],user:AppSessionUser) {
  const latest=new Map<string,ValuationMetrics & {recordedAt:number}>();const points:Array<ValuationMetrics & {time:string;recordedBatchCount:number}> = [];
  const buckets=new Map<string,HistoryRecord[]>();
  for(const record of records){const key=record.bucketAt.toISOString();const group=buckets.get(key) ?? [];group.push(record);buckets.set(key,group);}
  for(const group of buckets.values()){
    let time=0;
    for(const record of group){const stored=record.metrics as StoredValuation;const value=user.role==='BD_MANAGER'?stored.owners[user.id]:stored.all;if(value){latest.set(record.batchId,{...value,recordedAt:record.recordedAt.getTime()});time=Math.max(time,record.recordedAt.getTime());}}
    if(!time)continue;
    const total=[...latest.values()].reduce((a,b)=>({value:a.value+b.value,clientValue:a.clientValue+b.clientValue,institutionValue:a.institutionValue+b.institutionValue,pnl:a.pnl+b.pnl,priceStale:a.priceStale||b.priceStale||time-b.recordedAt>15*60000}),{value:0,clientValue:0,institutionValue:0,pnl:0,priceStale:false});
    points.push({...total,time:new Date(time).toISOString(),recordedBatchCount:latest.size});
  }
  return points;
}
export async function readValuationHistory(user:AppSessionUser,since:Date) {
  const current=await prisma.ledgerBatch.findMany({select:{id:true,snapshot:true}});
  const allowedIds=current.filter(row=>user.role!=='BD_MANAGER'||(row.snapshot as unknown as BatchLike).clients?.some(c=>c.bdUserId===user.id)).map(r=>r.id);
  const records=await prisma.ledgerValuation.findMany({where:{batchId:{in:allowedIds}},orderBy:[{bucketAt:'asc'},{recordedAt:'asc'}],take:20001});
  if(records.length>20000)throw new Error('历史记录超出本次查询容量，请联系管理员归档或扩容');
  const points=aggregateValuations(records,user).filter(p=>new Date(p.time)>=since).map(p=>({...p,totalBatchCount:allowedIds.length,incomplete:p.recordedBatchCount<allowedIds.length}));
  return {points,source:'RECORDED_LEDGER_VALUATIONS',sampling:'每小时末次账本估值',note:'仅展示上线后实际保存的记录，不补造历史；含认购、补仓和退出现金流变化，不代表投资收益率。'};
}
