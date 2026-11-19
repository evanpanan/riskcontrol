import { topupReceipts } from '@/lib/topupReceipts';
import type { InstitutionTrade } from '@/lib/riskEngine';
import { formatCurrency, formatDate } from '@/lib/utils';
export function TopupReceiptsTable({ trades }: { trades: InstitutionTrade[] }) {
  const rows = topupReceipts(trades);
  if (!rows.length) return null;
  return <div className="overflow-auto max-h-72 rounded-lg border border-border/50">
    <table className="w-full min-w-[510px] text-xs tabular-nums">
      <thead className="sticky top-0 bg-card text-muted-foreground"><tr>
        <th className="p-2 text-left">补仓日期</th><th className="p-2 text-left">形式</th><th className="p-2 text-right">股数</th><th className="p-2 text-right">成交价</th><th className="p-2 text-right">本次金额</th><th className="p-2 text-left">记录人</th>
      </tr></thead>
      <tbody>{rows.map(r => <tr key={r.id} className="border-t border-border/40">
        <td className="p-2 whitespace-nowrap">{formatDate(r.at)}</td><td className="p-2">{r.type === 'cash' ? '现金' : '股票'}</td>
        <td className="p-2 text-right">{r.type === 'stock' ? r.shares.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}</td>
        <td className="p-2 text-right">{r.price ? `$${r.price.toFixed(4)}` : '—'}</td><td className="p-2 text-right font-semibold">{formatCurrency(r.amount)}</td><td className="p-2">{r.operatorName || '—'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
