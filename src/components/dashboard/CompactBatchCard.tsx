'use client';
import Link from 'next/link';
import { getBatchMetrics, summarizeBatchMarginFromClients, calculateBatchPnLSplit } from '@/lib/riskEngine';
import { getStoredThresholds } from '@/lib/thresholds';
import { formatCurrency, formatCompactNumber, cn } from '@/lib/utils';
import type { ComponentProps } from 'react';
import type { BatchCardV2 } from './BatchCardV2';

export function CompactBatchCard({ batch }: { batch: ComponentProps<typeof BatchCardV2>['batch'] }) {
  const metrics = getBatchMetrics(batch);
  const pending = summarizeBatchMarginFromClients(batch).totalPending;
  const critical = pending > 0 || metrics.riskLevel === 'CRITICAL';
  const warning = !critical && metrics.riskLevel === 'WARNING';
  const mv = batch.currentMarketValue ?? batch.initialTotalAmount ?? 0;
  const pnl = calculateBatchPnLSplit(batch, mv);
  const distance = getStoredThresholds().marginDropPercent - metrics.dropPercent;
  return <Link href={`/batch/${batch.id}`} prefetch={false} className={cn('block min-w-0 rounded-xl border bg-card p-3.5 hover:bg-secondary/40 transition-colors', critical ? 'card-chrome-crit' : warning ? 'card-chrome-warn' : metrics.totalPnLPercent > 0 ? 'card-chrome-success' : 'card-chrome-normal')}>
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <span className="text-xs font-semibold">{batch.batchNumber}</span>
      <span className={cn('text-[11px] font-medium', critical ? 'text-danger' : warning ? 'text-warning' : 'text-muted-foreground')}>{critical ? '击穿 / 待处理' : warning ? '预警' : '正常'}</span>
    </div>
    <div className="flex justify-between gap-2 text-[11px] text-muted-foreground mt-1.5"><span>{batch.stockSymbol} · {batch.clients?.length ?? 0} 位客户</span><span>{batch.status === 'LOCKED' ? '锁仓期' : '交易期'}</span></div>
    <dl className="rounded-lg border border-border/50 bg-background/35 p-2.5 grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-[11px]">
      <div><dt className="text-muted-foreground">当前股价</dt><dd className="font-mono font-semibold mt-0.5">{formatCurrency(batch.currentStockPrice ?? batch.stockPriceAtStart ?? 0)}</dd></div>
      <div><dt className="text-muted-foreground">距击穿线</dt><dd className={cn('font-mono font-semibold mt-0.5', distance <= 0 && 'text-danger')}>{distance <= 0 ? '已击穿' : `${distance.toFixed(2)} 个百分点`}</dd></div>
      <div><dt className="text-muted-foreground">仓位价值</dt><dd className="font-mono font-semibold mt-0.5" title={formatCurrency(mv)}>${formatCompactNumber(mv)}</dd></div>
      <div><dt className="text-muted-foreground">补仓缺口</dt><dd className={cn('font-mono font-semibold mt-0.5', pending > 0 && 'text-danger')} title={formatCurrency(pending)}>${formatCompactNumber(pending)}</dd></div>
    </dl>
    <div className="mt-3">
      <div className="flex justify-between gap-2 text-[10px] mb-2"><span className="text-muted-foreground">风险阶梯</span><span className={critical ? 'text-danger' : warning ? 'text-warning' : 'text-foreground'}>{metrics.dropPercent > 0 ? `回撤 ${metrics.dropPercent.toFixed(2)}%` : '盈利区间'}</span></div>
      <div className="relative mx-1 h-1.5 rounded-full bg-gradient-to-r from-success via-warning to-danger"><span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full border-2 border-white bg-card" style={{left: `${Math.max(1,Math.min(99,metrics.dropPercent / getStoredThresholds().marginDropPercent * 100))}%`}} /></div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1.5"><span>安全</span><span>预警</span><span>击穿</span></div>
    </div>
    <div className="grid grid-cols-2 gap-2 mt-2">
      {[{label:'WIN100 盈亏',value:pnl.institutionTotalPnL,rate:pnl.institutionTotalPnLPercent},{label:'客户盈亏',value:pnl.clientTotalPnL,rate:pnl.clientTotalPnLPercent}].map(item => <div key={item.label} className="rounded-lg border border-border/50 bg-background/40 p-2 min-w-0">
        <p className="text-[10px] text-muted-foreground">{item.label}</p>
        <p title={formatCurrency(item.value)} className={cn('text-xs font-semibold font-mono mt-1',item.value<0?'text-danger':item.value>0?'text-success':'text-foreground')}>{item.value<0?'-':item.value>0?'+':''}${formatCompactNumber(Math.abs(item.value))}</p>
        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{item.rate.toFixed(2)}%</p>
      </div>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] mt-3 pt-2 border-t border-border text-muted-foreground"><span>{pending > 0 ? '待补仓' : (batch.cumulativeMarginCalls ?? 0)>0 ? '已补仓 · 持续监控' : '监控中'}</span><span className={cn('rounded-md px-2 py-1 font-medium',pending>0?'bg-danger/15 text-danger':'bg-primary/10 text-primary')}>{pending > 0 ? '处理补仓' : '查看批次'} →</span></div>
  </Link>;
}
