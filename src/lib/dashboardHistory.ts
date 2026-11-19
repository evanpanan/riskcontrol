import type { BatchDailySummary } from '@/lib/batchDaily';
export type DashboardDailyRow = { bucketAt: Date; totalValue: number; institutionValue: number; clientValue: number; totalYieldPct: number; institutionYieldPct: number; clientYieldPct: number };
/** Aggregate actual daily values and weight returns by capital, never average percentages. */
export function aggregateDailyHistory(series: Array<{ start: string; rows: BatchDailySummary[] }>): DashboardDailyRow[] {
  const dates = [...new Set(series.flatMap(s => s.rows.map(r => r.date)))].sort();
  const indexed = series.map(s => ({ start: s.start, rows: new Map(s.rows.map(r => [r.date, r])) }));
  return dates.flatMap(date => {
    const active = indexed.filter(s => s.start <= date);
    const rows = active.map(s => s.rows.get(date));
    // A partially priced portfolio must not masquerade as the whole portfolio.
    if (!rows.length || rows.some(r => !r || r.originalCapital === undefined)) return [];
    const sum = (pick: (r: BatchDailySummary) => number) => (rows as BatchDailySummary[]).reduce((v, r) => v + pick(r), 0);
    const capital = sum(r => r.originalCapital!);
    const clientCapital = sum(r => r.originalPriority!);
    const institutionCapital = capital - clientCapital + sum(r => r.cumulativeTopup);
    const clientPnL = sum(r => r.clientPnL);
    const institutionPnL = sum(r => r.institutionPnL);
    return [{ bucketAt: new Date(`${date}T21:00:00Z`), totalValue: sum(r => r.marketValue),
      institutionValue: sum(r => r.institutionAssetValue ?? r.marketValue - (r.originalPriority! + r.clientPnL)),
      clientValue: sum(r => r.clientAssetValue ?? r.originalPriority! + r.clientPnL),
      totalYieldPct: capital > 0 ? (clientPnL + institutionPnL) / capital * 100 : 0,
      institutionYieldPct: institutionCapital > 0 ? institutionPnL / institutionCapital * 100 : 0,
      clientYieldPct: clientCapital > 0 ? clientPnL / clientCapital * 100 : 0 }];
  });
}
