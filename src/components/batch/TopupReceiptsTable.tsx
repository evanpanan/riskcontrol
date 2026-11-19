import { topupReceipts } from '@/lib/topupReceipts';
import type { InstitutionTrade } from '@/lib/riskEngine';
import { formatCurrency, formatDate } from '@/lib/utils';
export function TopupReceiptsTable({ trades }: { trades: InstitutionTrade[] }) {
  const rows = topupReceipts(trades);
  if (!rows.length) return null;
  return <>
    <div className="space-y-2 sm:hidden">{rows.map(r => <div key={r.id} className="rounded-lg border border-border/50 bg-background/20 p-3 text-xs">
      <div className="mb-3 flex justify-between gap-3 text-muted-foreground"><span>{formatDate(r.at)}</span><span>{r.type === 'cash' ? '现金' : '股票'}</span></div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div className="min-w-0"><dt className="text-muted-foreground">股数</dt><dd className="mt-1 font-mono break-words">{r.type === 'stock' ? r.shares.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">成交价</dt><dd className="mt-1 font-mono break-words">{r.price ? `$${r.price.toFixed(4)}` : '—'}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">本次金额</dt><dd className="mt-1 font-mono font-semibold break-words">{formatCurrency(r.amount)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">记录人</dt><dd className="mt-1 break-all">{r.operatorName || '—'}</dd></div>
      </dl>
    </div>)}</div>
    <div className="hidden sm:block overflow-auto max-h-72 rounded-lg border border-border/50">
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
  </div></>;
}
