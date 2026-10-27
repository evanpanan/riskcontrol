import { viewBatch } from './ledgerProjection';
import { recordValuation } from './valuationHistory';
import { financialSettings } from "./settings";
import { randomUUID, createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { applyFinanceCommand, type FinanceCommand } from '@/lib/financeCommands';
import { initializeBatchFinance, syncBatchFinance, PRIORITY_RATIO, MIN_INVESTMENT_AMOUNT, type BatchLike, clientAccountCapital, clientAccountShares, assertTradeOwnership, getBatchMetrics } from '@/lib/riskEngine';
import { contractDates, validDate } from '@/lib/contractDates';
import type { AppSessionUser } from '@/types/auth';
import { fetchRealtimeWithFallback } from '@/lib/quote/providers';
export class LedgerError extends Error { constructor(message: string, public status = 400) { super(message); } }
const jsonValue = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
function string(v: unknown, label: string, max = 255): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new LedgerError(`${label}无效`);
  return v.trim();
}
function positive(v: unknown, label: string) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1e12) throw new LedgerError(`${label}无效`);
  return v;
}
export { viewBatch } from './ledgerProjection';
export async function readLedger(user: AppSessionUser) {
  const rows = await prisma.ledgerBatch.findMany({ orderBy: { createdAt: 'desc' } });
  const settings=await financialSettings();
  return rows.map(row => viewBatch({...row.snapshot as unknown as BatchLike,thresholds:{warningDropPercent:settings.warningThreshold,marginDropPercent:settings.marginThreshold}}, user)).filter(Boolean);
}
function requireRole(user: AppSessionUser, roles: string[]) { if (!roles.includes(user.role)) throw new LedgerError('当前角色无权执行此操作',403); }
async function prepareCommand(b: BatchLike, c: FinanceCommand, user: AppSessionUser): Promise<FinanceCommand> {
  if(!c || typeof c !== 'object') throw new LedgerError('操作参数无效');
  const p = c.input;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new LedgerError('操作参数无效');
  if (user.role === 'BD_MANAGER') {
    if (!['exit_request','exit_cancel'].includes(c.type)) throw new LedgerError('商务经理仅可为自有客户申请或取消退出',403);
    if (!b.clients?.some(x => x.id === p.clientId && x.bdUserId === user.id)) throw new LedgerError('无权操作此客户',403);
  }
  if (c.type === 'topup' || c.type === 'settle' || c.type === 'client_add') {
    requireRole(user,['ADMIN','RISK_MANAGER','OPERATIONS']);
    const at = new Date(b.quoteAsOf ?? 0).getTime();
    if (!Number.isFinite(at) || Date.now()-at > 15*60000 || at > Date.now()+60000) throw new LedgerError('参考价格已过期，请先刷新行情或由管理员确认参考价',409);
  }
  switch(c.type) {
    case 'topup': return { type: c.type, input: { amount: positive(p.amount,'补仓金额'), clientId: p.clientId, expectedRoundId: p.expectedRoundId, collateralType: p.collateralType === 'stock' ? 'stock':'cash', operatorName: user.displayName } };
    case 'client_add': {
      requireRole(user,['ADMIN','RISK_MANAGER','OPERATIONS']);
      const amount = positive(p.investmentAmount,'投资额');
      if (amount < MIN_INVESTMENT_AMOUNT) throw new LedgerError('投资门槛为 30000 美元');
      const bd = p.bdUserId ? await prisma.appUser.findUnique({where:{id:p.bdUserId}}) : await prisma.appUser.findFirst({ where:{ bdManagerFullName: string(p.bdManager,'商务经理'), role:'BD_MANAGER', enabled:true } });
      if (!bd || bd.role !== 'BD_MANAGER' || !bd.enabled || !bd.bdManagerFullName) throw new LedgerError('商务经理账号无效');
      const signDate = validDate(p.signDate); if (signDate > new Date() || signDate < validDate(b.signDate)) throw new LedgerError('客户签约日期无效');
      // Each later subscriber has their own lock-up; batch-wide final maturity still applies.
      const ownDates=contractDates(signDate,{noticePeriodDays:b.noticePeriodDays,exitWindowMonths:b.exitWindowMonths,exitWindowDays:b.exitWindowDays,finalMaturityDate:b.finalMaturityDate});
      if(b.lockUpEndDate && validDate(b.lockUpEndDate)>ownDates.lockUpEndDate) ownDates.lockUpEndDate=validDate(b.lockUpEndDate);
      const price = positive(b.currentStockPrice,'入场价格');
      const id = randomUUID();
      const config=await financialSettings(); const clientShare=amount>=config.vipThreshold?config.vipClient:config.normalClient;
      return { type:c.type, input:{ id, batchId:b.id, name:string(p.name,'客户姓名'), investmentAmount:amount, initialInvestment:amount, contractTerms:ownDates, bdManager:bd.bdManagerFullName, bdUserId:bd.id, signDate, entryStockPrice:price, status:'ACTIVE', profitSplitClient:clientShare, profitSplitInstitution:100-clientShare, clientNo:`C-${id}`, subAccountNo:`SA-${id}`, createdAt:new Date(), updatedAt:new Date(), brokerAccount: p.brokerAccount ? string(p.brokerAccount,'券商账号'):null } };
    }
    case 'client_update': {
      requireRole(user,['ADMIN','RISK_MANAGER','OPERATIONS']);
      const old = b.clients?.find(x=>x.id===p.clientId); if(!old) throw new LedgerError('客户不存在',404);
      const patch: any = {};
      if(p.patch?.name !== undefined) patch.name=string(p.patch.name,'客户姓名');
      // Financial terms cannot be silently rewritten after subscription.
      if(p.patch?.investmentAmount !== undefined && p.patch.investmentAmount !== old.investmentAmount) throw new LedgerError('已入账本金不可直接修改，请走退出或新增认购');
      if(p.patch?.signDate && validDate(p.patch.signDate).getTime() !== validDate(old.signDate).getTime()) throw new LedgerError('签约日期不可直接改写');
      if(p.patch?.bdManager && p.patch.bdManager !== old.bdManager) throw new LedgerError('客户归属变更需独立审批');
      return { type:c.type, input:{clientId:old.id,patch} };
    }
    case 'client_remove': requireRole(user,['ADMIN']); throw new LedgerError('已有资金记录不可删除，请使用退出结算保留完整台账');
    case 'batch_update': {
      requireRole(user,['ADMIN']);
      const patch: any = {};
      for(const key of ['batchNumber','stockName']) if(p[key]!==undefined) patch[key]=string(p[key],key);
      // Dates are contract terms, never retroactively editable after clients enter.
      if ((b.clients?.length ?? 0) === 0) { for(const key of ['signDate','maturityDate']) if(p[key]) patch[key]=validDate(p[key]); }
      else if (p.signDate && validDate(p.signDate).getTime() !== validDate(b.signDate).getTime()) throw new LedgerError('已有客户的批次不可改写签约日期');
      if(p.currentStockPrice !== undefined) { patch.currentStockPrice=positive(p.currentStockPrice,'参考价格'); patch.quoteAsOf=new Date().toISOString(); patch.quoteSource='MANUAL_CONFIRMED'; }
      for (const key of ['lockUpEndDate','finalMaturityDate','noticePeriodDays','exitWindowMonths','exitWindowDays']) if (p[key] !== undefined) patch[key] = p[key];
      if((b.clients?.length ?? 0)>0 && ['lockUpEndDate','finalMaturityDate','noticePeriodDays','exitWindowMonths','exitWindowDays'].some(key=>key in patch && String(patch[key])!==String(b[key]))) throw new LedgerError('已有认购的合同期限不可直接改写');
      contractDates(b.signDate,{...b,...patch});
      return {type:c.type,input:patch};
    }
    case 'exit_request': case 'exit_cancel': case 'settle': case 'client_status':
      if(c.type==='client_status') requireRole(user,['ADMIN','RISK_MANAGER','OPERATIONS']);
      return {type:c.type,input:{clientId:string(p.clientId,'客户ID'),operatorName:user.displayName,status:p.status}};
    default: throw new LedgerError('不支持的操作');
  }
  return {type:c.type,input:{clientId:string(p.clientId,'客户ID')}};
}
export async function mutateLedger(user: AppSessionUser, body: any) {
  const commandId=string(body.commandId,'请求ID',100); const batchId=string(body.batchId,'批次ID');
  const requestHash=createHash('sha256').update(JSON.stringify({batchId,revision:body.revision,command:body.command})).digest('hex');
  if (!Number.isInteger(body.revision) || body.revision < 0) throw new LedgerError('版本无效');
  const prior = await prisma.ledgerCommand.findUnique({where:{id:commandId}});
  if(prior) { if(prior.actorId!==user.id || prior.batchId!==batchId || prior.requestHash!==requestHash) throw new LedgerError('请求ID冲突',409); return prior.result; }
  const row=await prisma.ledgerBatch.findUnique({where:{id:batchId}});
  if(!row) throw new LedgerError('批次不存在',404);
  if(row.revision!==body.revision) throw new LedgerError('批次已更新，请刷新后重新确认',409);
  const snapshot=row.snapshot as unknown as BatchLike;
  const config=await financialSettings();snapshot.thresholds={warningDropPercent:config.warningThreshold,marginDropPercent:config.marginThreshold};
  const command=await prepareCommand(snapshot,body.command,user);
  const draft=structuredClone(snapshot);
  const result=applyFinanceCommand(draft,command) ?? null;
  initializeBatchFinance(draft); draft.finance!.revision=row.revision+1;
  const response=jsonValue({batch:viewBatch(draft,user),result});
  try {
    return await prisma.$transaction(async tx=>{
      const updated=await tx.ledgerBatch.updateMany({where:{id:batchId,revision:row.revision},data:{revision:{increment:1},snapshot:jsonValue(draft),batchNumber:draft.batchNumber}});
      if(updated.count!==1) throw new LedgerError('批次已更新，请刷新后重新确认',409);
      await recordValuation(tx,draft);
      await tx.ledgerCommand.create({data:{id:commandId,actorId:user.id,requestHash,batchId,result:response}});
      await tx.auditLog.create({data:{actorId:user.id,actorEmail:user.email,role:user.role,action:({topup:'margin_topup',settle:'client_settle',client_update:'client_edit',exit_request:'client_exit_request',exit_cancel:'client_exit_cancel'} as Record<string,string>)[command.type] ?? command.type,resource:batchId,detail:jsonValue({commandId,revision:row.revision+1,input:command.input})}});
      return response;
    });
  } catch(e: any) {
    if(e.code==='P2002' || e instanceof LedgerError && e.status===409) {
      const prior=await prisma.ledgerCommand.findUnique({where:{id:commandId}});
      if(prior?.actorId===user.id && prior.batchId===batchId && prior.requestHash===requestHash) return prior.result;
    }
    throw e;
  }
}
export async function createLedgerBatch(user: AppSessionUser, input: any) {
  requireRole(user,['ADMIN','RISK_MANAGER','OPERATIONS']);
  const now=new Date(); const sign=validDate(input.signDate ?? now); const maturity=validDate(input.maturityDate ?? contractDates(sign).finalMaturityDate);
  if(sign>now || maturity<=sign) throw new LedgerError('签约和到期日期无效');
  const price=positive(input.currentStockPrice,'参考价');
  const batch: BatchLike={id:randomUUID(),batchNumber:string(input.batchNumber,'批次编号'),stockSymbol:string(input.stockSymbol,'股票代码',20).toUpperCase(),stockName:input.stockName ?? input.stockSymbol,stockPriceAtStart:price,currentStockPrice:price,signDate:sign,maturityDate:maturity,...contractDates(sign,{...input,finalMaturityDate:maturity}),initialTotalAmount:0,priorityAmount:0,subordinateAmount:0,totalShares:0,cumulativeMarginCalls:0,clients:[],marginCalls:[],createdAt:now,updatedAt:now,quoteAsOf:now.toISOString(),quoteSource:'MANUAL_CONFIRMED'};
  initializeBatchFinance(batch);batch.finance!.revision=0;
  await prisma.$transaction(async tx=>{
    await tx.ledgerBatch.create({data:{id:batch.id,batchNumber:batch.batchNumber,snapshot:jsonValue(batch)}});
    await recordValuation(tx,batch);
    await tx.auditLog.create({data:{actorId:user.id,actorEmail:user.email,role:user.role,action:'batch_create',resource:batch.id}});
  });return batch;
}
export async function refreshLedgerQuotes(user: AppSessionUser) {
  requireRole(user,['ADMIN','RISK_MANAGER','OPERATIONS']);
  const rows=await prisma.ledgerBatch.findMany(); const quotes=new Map<string,any>();
  for(const row of rows){
    const b=row.snapshot as unknown as BatchLike;const symbol=b.stockSymbol!;
    if(!quotes.has(symbol)) { try { quotes.set(symbol,await fetchRealtimeWithFallback(symbol)); } catch { quotes.set(symbol,null); } }
    const q=quotes.get(symbol); if(!q || !Number.isFinite(q.price) || q.price<=0) continue;
    b.currentStockPrice=q.price;b.currentDayChange=q.changePct;b.quoteFetchedAt=new Date(q.updatedAt).toISOString();b.quoteAsOf=q.marketTimestamp ? new Date(q.marketTimestamp).toISOString():null;b.quoteSource=q.provider;
    const config=await financialSettings();b.thresholds={warningDropPercent:config.warningThreshold,marginDropPercent:config.marginThreshold};
    syncBatchFinance(b);b.finance!.revision=row.revision+1;
    await prisma.$transaction(async tx=>{const saved=await tx.ledgerBatch.updateMany({where:{id:row.id,revision:row.revision},data:{snapshot:jsonValue(b),revision:{increment:1}}});if(saved.count===1)await recordValuation(tx,b);});
  }
  if(rows.length && [...quotes.values()].every(q=>q===null)) throw new LedgerError('行情源不可用，保留原价；补仓和结算仍受价格时效校验',502);
  return readLedger(user);
}
