"use client";
import type { BatchDailySummary } from '@/lib/batchDaily';
import { cn, formatCurrency } from '@/lib/utils';
export type BatchHistoryPoint = BatchDailySummary & { reconstructed?: boolean };
export function BatchHistoryTooltip({ row }: { row: BatchHistoryPoint }) {
  const percent = (n?: number) => typeof n === 'number' && Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
  const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const color = (n: number) => n > 0 ? 'text-success' : n < 0 ? 'text-danger' : 'text-foreground';
  return <div role="tooltip" className="w-[328px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-background/95 p-3 text-xs shadow-xl backdrop-blur-md">
    <div className="flex justify-between items-center gap-2 mb-3"><strong>{row.date}</strong><span className="text-[10px] text-muted-foreground">{row.reconstructed ? '历史回算' : '每日留存'}</span></div>
    <div className="flex justify-between gap-3 mb-3"><span className="text-muted-foreground">在管总价值</span><strong className="font-mono">{formatCurrency(row.marketValue)}</strong></div>
    <table className="w-full text-[11px]"><thead><tr className="text-muted-foreground"><th className="pb-2 text-left font-normal">归属</th><th className="pb-2 text-right font-normal">累计盈亏</th><th className="pb-2 text-right font-normal">收益率</th></tr></thead><tbody>
      {[
        { name: '整体', pnl: row.totalPnL, yield: row.yieldPct },
        { name: 'Win100', pnl: row.institutionPnL, yield: row.institutionYieldPct },
        { name: '客户', pnl: row.clientPnL, yield: row.clientYieldPct },
      ].map(item => <tr key={item.name} className="border-t border-border/50"><td className="py-2">{item.name}</td><td className={cn('py-2 text-right font-mono', color(item.pnl))}>{formatCurrency(item.pnl)}</td><td className={cn('py-2 text-right font-mono', color(item.yield ?? 0))}>{percent(item.yield)}</td></tr>)}
    </tbody></table>
    <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-border/50 pt-3 mt-1 text-[11px]">
      {[
        ['收盘价', `$${row.price.toFixed(4)}`], ['持股数', number(row.shares)],
        ['现金余额', formatCurrency(row.cash)], ['在持客户', `${row.activeClients} 位`],
        ['当日补仓', formatCurrency(row.topupAmount)], ['累计补仓', formatCurrency(row.cumulativeTopup)],
        ['待补仓', formatCurrency(row.requiredMargin)],
      ].map(([key, value]) => <div key={key} className="space-y-1"><p className="text-muted-foreground">{key}</p><p className="font-mono">{value}</p></div>)}
    </div>
    {row.topups.length > 0 && <div className="mt-3 border-t border-border/50 pt-2 space-y-1 text-[10px] text-warning">{row.topups.slice(0,2).map((t,i) => <p key={i}>补{t.type === 'cash' ? '现金' : t.type === 'stock' ? '股票' : '仓'} {formatCurrency(t.amount)}{t.type === 'stock' ? ` · ${number(t.shares)} 股 @ $${t.price?.toFixed(4)}` : ''}</p>)}{row.topups.length > 2 && <p>共 {row.topups.length} 笔，完整记录见当日明细</p>}</div>}
  </div>;
}
