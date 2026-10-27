import { clientAccountCapital,clientAccountShares,assertTradeOwnership,getBatchMetrics,PRIORITY_RATIO,type BatchLike } from '@/lib/riskEngine';
import type { AppSessionUser } from '@/types/auth';
export function viewBatch(snapshot: BatchLike, user: AppSessionUser): BatchLike | null {
  const b = structuredClone(snapshot);
  if (user.role !== 'BD_MANAGER') return b;
  const all = b.clients ?? [];
  // Stable user IDs are required; display names cannot grant ownership.
  const own = all.filter(c => c.bdUserId === user.id);
  if (!own.length) return null;
  const ids = new Set(own.map(c => c.id));
  assertTradeOwnership(b);
  const active = own.filter(c => c.status !== 'SETTLED');
  b.clients = own;
  if (b.finance) {
    const f = b.finance;
    f.originalCapital = own.reduce((n,c) => n + clientAccountCapital(c), 0);
    f.originalPriority = own.reduce((n,c) => n + c.investmentAmount, 0);
    f.originalShares = own.reduce((n,c) => n + clientAccountShares(b,c), 0);
    f.remainingCapital = active.reduce((n,c) => n + clientAccountCapital(c), 0);
    f.remainingShares = active.reduce((n,c) => n + clientAccountShares(b,c), 0);
    f.trades = f.trades.filter(t => !!t.clientId && ids.has(t.clientId));
    f.rounds = f.rounds.map(r => {
      const allocations = Object.fromEntries(Object.entries(r.allocations).filter(([id]) => ids.has(id)));
      return { ...r, allocations, requiredAmount: Object.values(allocations).reduce((n,a)=>n+a.required,0), fulfilledAmount: Object.values(allocations).reduce((n,a)=>n+a.fulfilled,0), triggerMarketValue: null as any };
    });
    f.settlements = Object.fromEntries(Object.entries(f.settlements).filter(([id]) => ids.has(id)));
    b.initialTotalAmount = f.remainingCapital;
    b.priorityAmount = active.reduce((n,c)=>n+c.investmentAmount,0);
    b.subordinateAmount = f.remainingCapital-b.priorityAmount;
    b.totalShares = f.remainingShares;
    b.cumulativeMarginCalls = f.trades.reduce((n,t)=>n+t.amount,0);
  }
  const metrics = getBatchMetrics(b);
  b.currentMarketValue=metrics.currentMarketValue;b.totalPnL=metrics.totalPnL;b.totalPnLPercent=metrics.totalPnLPercent;b.riskLevel=metrics.riskLevel;
  b.activeSubsetInitialPrincipal=metrics.activeSubsetInitialPrincipal;
  b.win100CollateralShares=b.totalShares*(1-PRIORITY_RATIO);
  b.win100CollateralValue=b.win100CollateralShares*(b.currentStockPrice ?? b.stockPriceAtStart);
  b.marginCalls=(b.finance?.rounds ?? []).map(r=>({id:r.id,batchId:b.id,triggerDate:r.triggerDate,dueDate:r.dueDate,requiredAmount:r.requiredAmount,fulfilledAmount:r.fulfilledAmount,status:r.status,dropPercent:r.dropPercent,triggerMarketValue:null}));
  return b;
}
