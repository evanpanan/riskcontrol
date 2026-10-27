'use client';
import { useEffect,useState } from 'react';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import type { PortfolioSummary } from '@/lib/riskEngine';
import { LineChart,Line,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid,Legend } from 'recharts';
interface Point {time:string;value:number;clientValue:number;institutionValue:number;pnl:number;priceStale:boolean;incomplete?:boolean;}
const axisCurrency=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value);
export function DashboardCharts({summary}:{summary:PortfolioSummary}) {
  const [days,setDays]=useState(30);const [points,setPoints]=useState<Point[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;const load=async()=>{if(active)setLoading(true);try{const res=await fetch(`/api/ledger/history?since=${encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())}`,{cache:'no-store',credentials:'include'});const data=await res.json();if(!res.ok)throw new Error(data.error || '历史读取失败');if(active){setPoints(data.points);setError('');}}catch(e){if(active){setPoints([]);setError((e as Error).message);}}finally{if(active)setLoading(false);}};void load();window.addEventListener('risk-control:finance-changed',load);return()=>{active=false;window.removeEventListener('risk-control:finance-changed',load);};},[days]);
  const empty=error || (loading?'正在读取记录…':'暂无可核验的历史记录；系统从实际记账起积累数据。');
  const stale=points.some(p=>p.priceStale);const incomplete=points.some(p=>p.incomplete);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>实际账本记录 · 每小时末次估值</span>{[1,7,30,90].map(d=><Button key={d} size="sm" variant={days===d?'default':'outline'} onClick={()=>setDays(d)}>{d}天</Button>)}</div>
    <p className="text-xs text-muted-foreground">仅展示已保存记录，不补造上线前历史。{incomplete && <span className="text-warning">部分时点未覆盖全部批次，仅表示已记录批次的合计。</span>}数值含认购、补仓、退出等现金流变化，不是投资收益率。{stale && <span className="text-warning">部分记录的参考价已过期，不能作为当时可成交价格。</span>}</p>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card><CardHeader><CardTitle className="text-sm">已记录资产估值</CardTitle><p className="text-xs text-muted-foreground">当前账本 {formatCurrency(summary.currentMarketValueTotal)}</p></CardHeader><CardContent>{points.length?<div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" tickFormatter={s=>new Date(s).toLocaleDateString()}/><YAxis width={80} tickFormatter={v=>axisCurrency(Number(v))}/><Tooltip labelFormatter={s=>new Date(String(s)).toLocaleString()} formatter={(v:number)=>formatCurrency(v)}/><Legend/><Line type="stepAfter" dataKey="value" name="账户总估值" stroke="#3b82f6" dot={points.length<8}/><Line type="stepAfter" dataKey="clientValue" name="客户账面权益" stroke="#14b8a6" dot={points.length<8}/><Line type="stepAfter" dataKey="institutionValue" name="机构账面权益" stroke="#a855f7" dot={points.length<8}/></LineChart></ResponsiveContainer></div>:<p role="status" className="py-16 text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm">已记录账本损益</CardTitle><p className="text-xs text-muted-foreground">包含已结算及未结算损益；不表示可兑付金额</p></CardHeader><CardContent>{points.length?<div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" tickFormatter={s=>new Date(s).toLocaleDateString()}/><YAxis width={80} tickFormatter={v=>axisCurrency(Number(v))}/><Tooltip labelFormatter={s=>new Date(String(s)).toLocaleString()} formatter={(v:number)=>formatCurrency(v)}/><Line type="stepAfter" dataKey="pnl" name="账本损益" stroke="#f59e0b" dot={points.length<8}/></LineChart></ResponsiveContainer></div>:<p role="status" className="py-16 text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>
    </div>
  </div>;
}
