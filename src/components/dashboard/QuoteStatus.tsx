'use client';
import { useEffect, useState } from 'react';
import { getCachedQuote } from '@/lib/liveQuote';
import { quoteProviderLabel } from '@/lib/quote/providers';

export function QuoteStatus({ symbol }: { symbol: string }) {
  const [label, setLabel] = useState('行情状态待确认');
  useEffect(() => {
    const update = () => {
      const quote = getCachedQuote(symbol);
      const time = quote?.data?.updatedAt ?? 0;
      const age = Date.now() - time;
      const valid = time > 0 && age >= -30_000 && age <= 120_000;
      setLabel(quote
        ? `${valid ? '行情有效' : time > 0 ? '行情已过期' : '行情时间未知'} · ${quoteProviderLabel(quote.provider)} · ${time > 0 ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '待核验'}`
        : '暂无可核验行情 · 请勿将展示价格视为实时价');
    };
    update();
    const timer = setInterval(update, 30_000);
    window.addEventListener('risk-control:quote-changed', update);
    return () => { clearInterval(timer); window.removeEventListener('risk-control:quote-changed', update); };
  }, [symbol]);
  return <p className="text-xs text-muted-foreground leading-relaxed" role="status">{symbol} · {label}</p>;
}
