"use client";
import { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import type { BatchDailySummary } from '@/lib/batchDaily';
import * as Excel from '@/lib/excelExport';
import { toast } from 'sonner';
type Row = BatchDailySummary & { capturedAt: string; source: string };
export function BatchDailyHistory({ batchId, batchNumber }: { batchId: string; batchNumber: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setRows([]); setSelected('');
    fetch(`/api/batches/${encodeURIComponent(batchId)}/history`, { cache: 'no-store', signal: controller.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error || '历史数据读取失败');
      setRows(data.rows); setSelected(data.rows.at(-1)?.date ?? '');
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [batchId]);
  async function download() {
    setExporting(true);
    try {
      const book = Excel.utils.book_new();
      Excel.utils.book_append_sheet(book, Excel.utils.json_to_sheet(rows.map(r => ({
        '交易日（纽约）': r.date, '收盘价': r.price, '持股数（含补仓）': r.shares, '现金余额': r.cash,
        '在管价值': r.marketValue, '整体累计盈亏': r.totalPnL, '整体收益率(%)': r.yieldPct,
        '机构累计盈亏': r.institutionPnL, '客户累计盈亏': r.clientPnL, '待补仓': r.requiredMargin,
        '累计补仓': r.cumulativeTopup, '当日补仓': r.topupAmount, '在持客户数': r.activeClients,
        '状态': r.status, '风险等级': r.riskLevel, '采集时间': r.capturedAt, '行情来源': r.source,
      }))), '每日数据');
      Excel.utils.book_append_sheet(book, Excel.utils.json_to_sheet(rows.flatMap(r => r.topups.map(t => ({
        '交易日（纽约）': r.date, '补仓时间': t.at, '形式': t.type === 'cash' ? '现金' : t.type === 'stock' ? '股票' : '待核对', '等值金额': t.amount, '股数': t.shares, '计价': t.price,
      })))), '补仓明细');
      await Excel.writeFile(book, `${batchNumber}-每日历史.xlsx`);
    } catch { toast.error('导出失败，请稍后重试'); } finally { setExporting(false); }
  }
  const day = rows.find(r => r.date === selected);
  return <Card className="min-w-0">
    <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><CardTitle className="text-sm">批次历史</CardTitle><p className="text-xs text-muted-foreground mt-1">按纽约交易日收盘价留存 · 金额为美元</p></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={view === 'chart' ? 'secondary' : 'ghost'} onClick={() => setView('chart')}>曲线</Button>
        <Button size="sm" variant={view === 'table' ? 'secondary' : 'ghost'} onClick={() => setView('table')}>每日表格</Button>
        <Button size="sm" variant="outline" disabled={!rows.length || exporting} onClick={download}>{exporting ? '导出中…' : '下载表格'}</Button>
      </div>
    </CardHeader>
    <CardContent className="min-w-0 space-y-4">
      {loading ? <p className="text-sm text-muted-foreground">正在读取每日数据…</p> : error ? <p role="alert" className="text-sm text-danger">{error}</p> : !rows.length ? <p className="text-sm text-muted-foreground py-8 text-center">暂无每日记录，启用后将于交易日收盘后自动留存。</p> : <>
        {view === 'chart' ? <div className="h-72 w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 20, right: 18, left: 0, bottom: 8 }} onClick={(e: any) => { const r = e?.activePayload?.[0]?.payload; if (r) setSelected(r.date); }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40}/><YAxis tick={{ fontSize: 10 }} width={65} tickFormatter={n => `${(n / 1000).toFixed(0)}K`}/>
          <Tooltip content={({ active, payload }) => { const r = payload?.[0]?.payload as Row | undefined; return active && r ? <div className="rounded-lg border border-border bg-background p-3 text-xs shadow-lg space-y-1"><p>{r.date}</p><p>在管价值 {formatCurrency(r.marketValue)}</p><p>整体盈亏 {formatCurrency(r.totalPnL)} · {r.yieldPct.toFixed(2)}%</p>{r.topups.map((t, i) => <p key={i} className="text-warning">补{t.type === 'cash' ? '现金' : '股票'} {formatCurrency(t.amount)}{t.type === 'stock' ? ` · ${t.shares.toFixed(4)} 股 @ $${t.price?.toFixed(4)}` : ''}</p>)}</div> : null; }}/>
          <Line type="linear" dataKey="marketValue" stroke="hsl(var(--primary))" strokeWidth={2} dot={rows.length === 1} isAnimationActive={false}/>
          {rows.filter(r => r.topupAmount > 0).map(r => <ReferenceDot key={r.date} x={r.date} y={r.marketValue} r={5} fill="hsl(var(--warning))" stroke="hsl(var(--background))" label={{ value: `补仓 ${(r.topupAmount / 1000).toFixed(1)}K`, position: 'top', fontSize: 10 }} />)}
        </LineChart></ResponsiveContainer></div> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full whitespace-nowrap text-xs"><thead className="bg-secondary/40"><tr>{['交易日', '收盘价', '持股数', '现金', '在管价值', '整体盈亏', '收益率', '机构盈亏', '客户盈亏', '当日补仓', '待补仓'].map(h => <th className="px-3 py-3 text-right first:text-left" key={h}>{h}</th>)}</tr></thead><tbody>{[...rows].reverse().map(r => <tr key={r.date} className="border-t border-border hover:bg-secondary/30 cursor-pointer" onClick={() => setSelected(r.date)}><td className="p-3 text-left">{r.date}</td>{[r.price.toFixed(4), r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 }), formatCurrency(r.cash), formatCurrency(r.marketValue), formatCurrency(r.totalPnL), `${r.yieldPct.toFixed(2)}%`, formatCurrency(r.institutionPnL), formatCurrency(r.clientPnL), r.topupAmount ? formatCurrency(r.topupAmount) : '—', formatCurrency(r.requiredMargin)].map((v, i) => <td key={i} className="p-3 text-right font-mono">{v}</td>)}</tr>)}</tbody></table></div>}
        <div className="flex flex-wrap items-center gap-2 text-xs"><label htmlFor={`daily-${batchId}`}>查看某日明细</label><select id={`daily-${batchId}`} className="rounded-md border border-border bg-background p-2" value={selected} onChange={e => setSelected(e.target.value)}>{[...rows].reverse().map(r => <option key={r.date}>{r.date}</option>)}</select></div>
        {day && <div className="rounded-lg border border-border p-4 text-xs space-y-3"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['收盘价', `$${day.price.toFixed(4)}`], ['在管价值', formatCurrency(day.marketValue)], ['整体盈亏', formatCurrency(day.totalPnL)], ['整体收益率', `${day.yieldPct.toFixed(2)}%`], ['机构盈亏', formatCurrency(day.institutionPnL)], ['客户盈亏', formatCurrency(day.clientPnL)], ['累计补仓', formatCurrency(day.cumulativeTopup)], ['待补仓', formatCurrency(day.requiredMargin)]].map(([k, v]) => <div key={k}><p className="text-muted-foreground mb-1">{k}</p><p className="font-mono">{v}</p></div>)}</div>{day.topups.length ? <div className="space-y-2 border-t border-border pt-3">{day.topups.map((t, i) => <p key={i} className="break-words text-warning">当日补{t.type === 'cash' ? '现金' : t.type === 'stock' ? '股票' : '仓（形式待核对）'} {formatCurrency(t.amount)}{t.type === 'stock' ? ` · ${t.shares.toFixed(6)} 股 · 计价 $${t.price?.toFixed(4)}` : ''}</p>)}</div> : <p className="text-muted-foreground">当日无补仓</p>}<p className="text-muted-foreground">行情来源 {day.source} · 业务数据留存于 {new Date(day.capturedAt).toLocaleString('zh-CN')}</p></div>}
      </>}
    </CardContent>
  </Card>;
}
