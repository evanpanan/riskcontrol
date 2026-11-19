import type { InstitutionTrade } from '@/lib/riskEngine';
export type TopupReceipt = { id: string; roundId: string; at: string; amount: number; shares: number; price: number | null; type: 'cash' | 'stock'; operatorName?: string; inferred: boolean };
/** Group customer allocations belonging to one execution; never change stored trades. */
export function topupReceipts(trades: InstitutionTrade[]): TopupReceipt[] {
  const groups = new Map<string, TopupReceipt>();
  const occurrences = new Map<string, number>();
  for (const t of trades) {
    const type = t.collateralType ?? (t.entryPrice ? 'stock' : 'cash');
    const base = [t.roundId, t.createdAt, t.entryPrice, type, t.source, t.operatorName].join('|');
    const clientKey = `${base}|${t.clientId ?? t.id}`;
    const occurrence = occurrences.get(clientKey) ?? 0;
    occurrences.set(clientKey, occurrence + 1);
    const id = t.receiptId ?? `${base}|${occurrence}`;
    let row = groups.get(id);
    if (!row) {
      row = { id, roundId: t.roundId, at: t.createdAt, amount: 0, shares: 0, price: t.entryPrice, type, operatorName: t.operatorName, inferred: !t.receiptId };
      groups.set(id, row);
    }
    row.amount += t.amount;
    row.shares += t.shares;
  }
  return [...groups.values()].map(r => ({ ...r, amount: Math.round((r.amount + Number.EPSILON) * 100) / 100 }))
    .sort((a, b) => a.at.localeCompare(b.at));
}
