"use client";
import { useEffect, useRef, useState } from 'react';
import { defaultTopupDate } from '@/lib/topupDate';

/** Backdated transactions never silently fall back to today's quote. */
export function useExecutionPrice(symbol: string, date: string, open: boolean, livePrice: number) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const manual = useRef(false);
  const live = useRef(livePrice);
  live.current = livePrice;
  useEffect(() => {
    if (!open) return;
    manual.current = false;
    setValue('');
    if (date === defaultTopupDate()) {
      setValue(live.current > 0 ? String(live.current) : '');
      setNote('默认当前股价，可修改为实际成交价');
      return;
    }
    const controller = new AbortController();
    setNote('正在读取当日收盘价，也可直接手动输入');
    void fetch(`/api/quote/close?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async res => { const data = await res.json(); if (!res.ok || !(data.price > 0)) throw new Error(data.error); return data; })
      .then(data => { if (!controller.signal.aborted && !manual.current) { setValue(String(data.price)); setNote('默认所选日期收盘价，可修改为实际成交价'); } })
      .catch(() => { if (!controller.signal.aborted && !manual.current) setNote('该日期暂无收盘价，请手动填写实际成交价'); });
    return () => controller.abort();
  }, [symbol, date, open]);
  return { price: Number(value), value, note, setValue: (next: string) => { manual.current = true; setValue(next); setNote('使用手动成交价'); } };
}
