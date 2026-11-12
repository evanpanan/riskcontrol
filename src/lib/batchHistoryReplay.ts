import { type BatchLike, PRIORITY_RATIO, syncBatchFinance, calculateContractDates } from '@/lib/riskEngine';
import { marketDate, summarizeDailyBatch, type BatchDailySummary } from '@/lib/batchDaily';
export function replayBatchDay(original: BatchLike, date: string, close: number): BatchDailySummary | null {
  if (date < marketDate(new Date(original.signDate))) return null;
  const batch = structuredClone(original);
  if (!batch.finance) return null;
  const f = batch.finance;
  const before = (value: unknown) => !!value && marketDate(new Date(value as string)) <= date;
  const allSettlements = f.settlements;
  const entered = (batch.clients ?? []).filter(c => before(c.signDate));
  const ended = (id: string) => !!allSettlements[id] && before(allSettlements[id].settledAt);
  const capital = (c: typeof entered[number]) => c.investmentAmount / PRIORITY_RATIO;
  const shares = (c: typeof entered[number]) => capital(c) / (c.entryStockPrice || batch.stockPriceAtStart);
  if (!entered.length) return null;
  const active = entered.filter(c => !ended(c.id));
  f.originalCapital = entered.reduce((sum, c) => sum + capital(c), 0);
  f.originalPriority = f.originalCapital * PRIORITY_RATIO;
  f.originalShares = entered.reduce((sum, c) => sum + shares(c), 0);
  f.remainingCapital = active.reduce((sum, c) => sum + capital(c), 0);
  f.remainingShares = active.reduce((sum, c) => sum + shares(c), 0);
  f.settlements = Object.fromEntries(Object.entries(allSettlements).filter(([, s]) => before(s.settledAt)));
  batch.clients = entered.map(c => {
    if (ended(c.id)) return c;
    delete c.settlement; c.settledAt = null; c.status = before(c.exitRequestedAt) ? 'EXIT_REQUESTED' : 'ACTIVE';
    if (!before(c.exitRequestedAt)) { c.exitRequestedAt = null; c.exitEligibleAt = null; }
    return c;
  });
  f.trades = f.trades.filter(t => before(t.createdAt)).map(t => ({ ...t, remainingFraction: t.clientId ? (ended(t.clientId) ? 0 : 1) : (f.originalCapital > 0 ? f.remainingCapital / f.originalCapital : 0) }));
  // Reconstruct obligations only from rounds already triggered by that day; remove future receipts/exits.
  f.rounds = f.rounds.filter(r => before(r.triggerDate)).map(r => {
    const receipts = f.trades.filter(t => t.roundId === r.id);
    const paid = receipts.reduce((sum, t) => sum + t.amount, 0);
    const required = Math.max(r.requiredAmount, paid);
    return { ...r, fulfilledAmount: paid, requiredAmount: required, status: required - paid < .005 ? 'FULLFILLED' as const : 'PENDING' as const };
  });
  batch.status = active.length ? (date < marketDate(calculateContractDates(batch.signDate).lockUpEndDate) ? "LOCKED" : "TRADING_OPEN") : "CLOSED";
  batch.currentStockPrice = close;
  syncBatchFinance(batch);
  return replaySafeSummary(batch, date, close);
}
function replaySafeSummary(batch: BatchLike, date: string, close: number) {
  const summary = summarizeDailyBatch(batch, date, close);
  return Object.values(summary).some(v => typeof v === 'number' && !Number.isFinite(v)) ? null : summary;
}
