import { calculateBatchPnLSplit, calculateRescueStats, getBatchMetrics, type BatchLike } from '@/lib/riskEngine';
export type DailyTopup = { amount: number; type: 'cash' | 'stock' | 'unknown'; shares: number; price: number | null; at: string };
export type BatchDailySummary = {
  date: string; price: number; shares: number; cash: number; marketValue: number;
  totalPnL: number; yieldPct: number; institutionPnL: number; clientPnL: number;
  institutionYieldPct?: number; clientYieldPct?: number;
  requiredMargin: number; cumulativeTopup: number; topupAmount: number; topups: DailyTopup[];
  activeClients: number; status: string; riskLevel: string;
};
export function marketDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// Daily provider candles may be stamped at UTC midnight or at the session open.
export function candleDate(time: number) {
  const date = new Date(time);
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 ? date.toISOString().slice(0, 10) : marketDate(date);
}
export function dailyCaptureDate(now: Date): string | null {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
  return hour >= 17 && weekday !== 'Sat' && weekday !== 'Sun' ? marketDate(now) : null;
}
export function summarizeDailyBatch(batch: BatchLike, date: string, close: number): BatchDailySummary {
  if (!(close > 0) || !Number.isFinite(close)) throw new Error('收盘价无效');
  batch.currentStockPrice = close;
  const metrics = getBatchMetrics(batch);
  const split = calculateBatchPnLSplit(batch, metrics.currentMarketValue);
  const rescue = calculateRescueStats(batch, close);
  const trades = batch.finance?.trades ?? [];
  const topups: DailyTopup[] = trades.filter(t => marketDate(new Date(t.createdAt)) === date).map(t => ({ amount: t.amount, type: t.collateralType ?? (t.entryPrice ? 'stock' : 'unknown'), shares: t.shares, price: t.entryPrice, at: t.createdAt }));
  return {
    date, price: close, shares: batch.totalShares + rescue.totalRescueShares,
    cash: trades.filter(t => t.collateralType === 'cash').reduce((sum, t) => sum + t.amount * t.remainingFraction, 0),
    marketValue: metrics.currentMarketValue, totalPnL: split.institutionTotalPnL + split.clientTotalPnL, yieldPct: (batch.finance?.originalCapital ?? batch.initialTotalAmount) > 0 ? (split.institutionTotalPnL + split.clientTotalPnL) / (batch.finance?.originalCapital ?? batch.initialTotalAmount) * 100 : 0,
    institutionPnL: split.institutionTotalPnL, clientPnL: split.clientTotalPnL,
    institutionYieldPct: split.institutionTotalPnLPercent, clientYieldPct: split.clientTotalPnLPercent,
    requiredMargin: batch.finance?.rounds.filter(r => r.status === "PENDING" || r.status === "OVERDUE").reduce((sum, r) => sum + Math.max(0, r.requiredAmount - r.fulfilledAmount), 0) ?? metrics.requiredMarginCall, cumulativeTopup: batch.cumulativeMarginCalls,
    topupAmount: topups.reduce((sum, t) => sum + t.amount, 0), topups,
    activeClients: (batch.clients ?? []).filter(c => c.status !== 'SETTLED').length,
    status: String(batch.status ?? ''), riskLevel: String(metrics.riskLevel),
  };
}
