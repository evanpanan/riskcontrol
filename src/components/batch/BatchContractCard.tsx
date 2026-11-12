"use client";
import { Lock, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { calculateContractDates } from '@/lib/riskEngine';
import { calculateTradingWindows, formatDate, cn } from '@/lib/utils';
export function BatchContractCard({ signDate, maturityDate }: { signDate: Date | string; maturityDate: Date | string }) {
  const info = calculateTradingWindows(signDate);
  const dates = calculateContractDates(signDate);
  const now = Date.now();
  const start = new Date(signDate).getTime();
  const end = (info.isLocked ? dates.lockUpEndDate : dates.finalMaturityDate).getTime();
  const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, end - start) * 100));
  const monthsProgress = Math.max(0, Math.min(100, (now - start) / Math.max(1, dates.finalMaturityDate.getTime() - start) * 100));
  return <Card className="min-w-0 h-full border-border/50">
    <CardContent className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-muted-foreground" />合约进度</h3><span className={cn('text-[10px] rounded-full px-2 py-0.5 bg-secondary', info.isTradingWindow ? 'text-success' : 'text-muted-foreground')}>{info.isLocked ? '锁仓期' : now >= dates.finalMaturityDate.getTime() ? '已到期' : info.isTradingWindow ? '窗口已开放' : '观望期'}</span></div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />{info.isLocked ? '锁仓进度' : '合约进度'}</span><span className="font-mono font-semibold">{progress.toFixed(0)}%</span></div>
        <div role="progressbar" aria-label={info.isLocked ? '锁仓进度' : '合约进度'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>
        <p className="text-xs font-medium leading-relaxed">{info.countdownText}</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground">交易节点 · 月</p>
        <div className="relative h-9 mx-2" aria-label="签约后第6、9、12、15、18、21、24个月的交易节点">
          <div className="absolute left-0 right-0 top-1 h-0.5 bg-secondary"><div className="h-full bg-primary/60" style={{ width: `${monthsProgress}%` }} /></div>
          {[{month:0,date:new Date(signDate),passed:start<=now}, ...info.tradingWindows].map(w => <span key={w.month} title={`${w.month === 0 ? '签约' : `第 ${w.month} 月`} · ${formatDate(w.date)}`} className="absolute top-0 -translate-x-1/2 flex flex-col items-center gap-1.5" style={{ left: `${w.month / 24 * 100}%` }}>
            <span className={cn('h-2.5 w-2.5 rounded-full border-2', w.passed ? 'bg-primary border-primary' : info.nextTradingMonth === w.month ? 'bg-background border-primary ring-2 ring-primary/15' : 'bg-card border-border')} />
            <span className={cn('text-[9px] font-mono', info.nextTradingMonth === w.month ? 'text-primary font-semibold' : 'text-muted-foreground')}>{w.month}</span>
          </span>)}
        </div>
      </div>
      <div className="border-t border-border/40 pt-2 space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
        <p>签约 {formatDate(signDate)} · 到期 {formatDate(maturityDate)}</p>
        <p>解锁 {formatDate(dates.lockUpEndDate)}</p>
        {info.nextTradingDate && <p>下次窗口 {formatDate(info.nextTradingDate)}</p>}
        <p>{info.isLocked ? '锁仓期内常规退出受限；仅超级管理员可二次确认后特批退出。' : '开放窗口持续 14 天，每 3 个月一个交易周期。'}</p>
      </div>
    </CardContent>
  </Card>;
}
