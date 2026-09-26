"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlashNumber } from "@/components/ui/FlashNumber";
import { getMockData, refreshMockDataPrices } from "@/lib/mockData";
import { toast } from "sonner";
import { getNYSEInfo } from "@/lib/liveQuote";
import {
  cn,
  formatCurrency,
  formatPercent,
  formatCompactNumber,
} from "@/lib/utils";
import {
  getBatchMetrics,
  calculateBatchPnLSplit,
  calculatePortfolioSummary,
} from "@/lib/riskEngine";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Clock,
  RadioTower,
  RefreshCw,
  Building2,
  Wallet,
  Landmark,
  Users,
  Coins,
  Recycle,
  Crown,
  CalendarClock,
  LayoutGrid,
  Gauge,
  ShieldAlert,
  UserCheck,
  TrendingUp,
  PieChart as PieIcon,
  AlertTriangle,
} from "lucide-react";
import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { RiskLevel } from "@prisma/client";
import { getWebAlertSettings } from "@/lib/webAlertSettings";
import { getLiveQuoteSettings, DEFAULT_LIVE_QUOTE, type BrowserQuote, fetchQuoteBrowser } from "@/lib/liveQuote";
import { BD_MANAGERS } from "@/lib/mockData";
import { MonthlyBatchesTrend } from "@/components/dashboard/MonthlyBatchesTrend";

function generateInstitutionRiskByMonth(seed = 20260917) {
  const months = [
    "25/05",
    "25/07",
    "25/10",
    "25/12",
    "26/02",
    "26/03",
    "26/04",
    "26/05",
    "26/06",
    "26/07",
    "26/08",
    "26/09",
  ];
  function mulberry32(a: number) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(seed >>> 0);
  return months.map((m, i) => ({
    month: m,
    风险敞口: Math.round(500000 + rnd() * 1800000 - i * 30000),
    机构补仓: i < 3 ? 0 : Math.round(rnd() * 500000 * (i / 8)),
  }));
}

const MARKET_OPEN_HOURS = { startHour: 21, endHour: 4 }; // HK/US crossover 模拟

function isMarketOpen(now = new Date()) {
  const h = now.getUTCHours() + 8;
  return (h >= 9 && h < 12) || (h >= 13 && h < 16) || (h >= 21 && h <= 23);
}

const DEFAULT_WEB_ALERT_SETTINGS = {
  webAlertEnabled: true,
  webAlertSound: true,
  webAlertCriticalOnly: false,
  realtimeTickEnabled: true,
  realtimeTickIntervalSec: 8,
};

const VIP_THRESHOLD = 100000;

const INVEST_BUCKETS = [
  { key: "<$50K", min: -Infinity, max: 50000, color: "hsl(217 91% 75%)" },
  { key: "$50K-$100K", min: 50000, max: 100000, color: "hsl(217 91% 60%)" },
  { key: "$100K-$300K", min: 100000, max: 300000, color: "hsl(191 91% 55%)" },
  { key: "$300K-$1M", min: 300000, max: 1000000, color: "hsl(45 93% 55%)" },
  { key: ">$1M", min: 1000000, max: Infinity, color: "hsl(0 72% 51%)" },
];

const CROWN_COLORS = ["hsl(45 93% 47%)", "hsl(215 20% 65%)", "hsl(30 80% 45%)"];
const DEFAULT_RISK_COLORS: Record<RiskLevel, string> = {
  [RiskLevel.NORMAL]: "hsl(142 76% 45%)",
  [RiskLevel.WARNING]: "hsl(38 92% 50%)",
  [RiskLevel.CRITICAL]: "hsl(0 72% 51%)",
};

export default function MarketPage() {
  const mockDataRef = useRef(getMockData());

  const expandMonthTick = (m: string): { tick: string; tooltip: string } => {
    const [y2, mm] = String(m || "").split("/").map((s) => s.padStart(2, "0"));
    if (!y2 || !mm) return { tick: String(m || ""), tooltip: String(m || "") };
    const yyyy = Number(y2) >= 70 ? 1900 + Number(y2) : 2000 + Number(y2);
    return {
      tick: `${yyyy}年${Number(mm)}月`,
      tooltip: `${yyyy}年${Number(mm)}月`,
    };
  };
  const expandQuarterTick = (q: string): { tick: string; tooltip: string } => {
    const s = String(q || "");
    const m = s.match(/^(\d{2})Q([1-4])$/i);
    if (!m) return { tick: s, tooltip: s };
    const yyyy = 2000 + Number(m[1]);
    return { tick: `${yyyy}年 Q${m[2]}`, tooltip: `${yyyy}年 第${m[2]}季度` };
  };

  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [liveSymbol, setLiveSymbol] = useState<string>(DEFAULT_LIVE_QUOTE.symbol);
  const [realtime, setRealtime] = useState<BrowserQuote | null>(null);
  const [animActive, setAnimActive] = useState(true);
  const batches = useMemo(() => [...mockDataRef.current.batches], [tick]);

  const riskMonthly = useMemo(() => {
    const raw = generateInstitutionRiskByMonth(20260917);
    return raw.map((row) => {
      const { tick, tooltip } = expandMonthTick(row.month);
      return { ...row, month: tick, monthLabel: tooltip };
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setAnimActive(false), 1400);
    return () => window.clearTimeout(id);
  }, []);

  const [settings, setSettings] = useState(DEFAULT_WEB_ALERT_SETTINGS);

  useEffect(() => {
    setHydrated(true);
    try {
      const qs = getLiveQuoteSettings();
      setLiveSymbol(qs.symbol);
      setSettings(getWebAlertSettings());
    } catch { /* ignore */ }
    const onLq = () => { try { const q = getLiveQuoteSettings(); setLiveSymbol(q.symbol); } catch { /* ignore */ } };
    const onStorage = () => { try { setSettings(getWebAlertSettings()); } catch { /* ignore */ } onLq(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("risk-control:quote-changed", onLq as any);
    const id = setInterval(onStorage, 4000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("risk-control:quote-changed", onLq as any);
      clearInterval(id);
    };
  }, []);

  const fetchRt = useCallback(async () => {
    if (!hydrated) return;
    try {
      const q = await fetchQuoteBrowser(liveSymbol);
      setRealtime(q);
    } catch { /* ignore */ }
  }, [liveSymbol, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    fetchRt();
    const s = settings ?? { realtimeTickEnabled: true, realtimeTickIntervalSec: 8 };
    if (!s.realtimeTickEnabled) return;
    const sec = Math.max(2, s.realtimeTickIntervalSec);
    const id = window.setInterval(fetchRt, sec * 1000);
    return () => window.clearInterval(id);
  }, [settings, hydrated, fetchRt]);

  useEffect(() => {
    const s = settings ?? { realtimeTickEnabled: true, realtimeTickIntervalSec: 8 };
    if (!s.realtimeTickEnabled) return;
    const sec = Math.max(2, s.realtimeTickIntervalSec);
    const interval = setInterval(() => {
      const nyse = getNYSEInfo();
      if (!nyse.shouldBreathe) return;
      try { refreshMockDataPrices(); } catch (err) {
        toast.error(err instanceof Error ? err.message : "行情更新失败");
        clearInterval(interval);
        return;
      }
      mockDataRef.current = getMockData();
      setTick((t) => t + 1);
    }, sec * 1000);
    return () => clearInterval(interval);
  }, [settings]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      try {
        const nyse = getNYSEInfo();
        if (nyse.shouldBreathe) {
          refreshMockDataPrices();
          mockDataRef.current = getMockData();
          setTick((t) => t + 1);
        }
        fetchRt();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "行情更新失败");
      } finally {
        setRefreshing(false);
      }
    }, 900);
  };

  const summary = useMemo(() => calculatePortfolioSummary(batches), [batches]);
  const totalInitial = summary.totalAUM;

  const institutionMetrics = useMemo(() => {
    let totalInjected = 0;
    let totalRecovered = 0;
    let worstExposure = 0;
    for (const b of batches) {
      const mv = b.currentMarketValue || b.initialTotalAmount;
      const metrics = getBatchMetrics(b);
      const split = calculateBatchPnLSplit(b, mv);
      totalInjected += b.subordinateAmount + (b.cumulativeMarginCalls || 0);
      totalRecovered += Object.values((b as import("@/lib/riskEngine").BatchLike).finance?.settlements ?? {})
        .reduce((sum, snapshot) => sum + snapshot.marginCallReturned, 0);
      worstExposure = Math.max(worstExposure, metrics.requiredMarginCall);
    }
    return {
      totalInjected,
      totalRecovered,
      outstanding: Math.max(0, summary.totalMarginCalls - totalRecovered),
      worstExposure,
      institutionPnL: summary.institutionPnL,
      institutionPnLPercent: summary.institutionPnLPercent,
    };
  }, [batches, summary]);

  const clientStats = useMemo(() => {
    let vipCount = 0;
    let vipAmount = 0;
    let normalCount = 0;
    let normalAmount = 0;
    let exitedCount = 0;
    let totalDaysActive = 0;
    let totalDaysExited = 0;
    let maxDays = 0;
    const now = Date.now();
    for (const b of batches) {
      const bContractDays = Math.max(1, Math.ceil((new Date(b.maturityDate).getTime() - new Date(b.signDate).getTime()) / 86400000));
      maxDays = Math.max(maxDays, bContractDays);
      for (const c of b.clients ?? []) {
        const amount = c.investmentAmount || 0;
        const vipThreshold = (c as any).signedVipThreshold ?? VIP_THRESHOLD;
        const isVip = amount >= vipThreshold;
        if (isVip) {
          vipCount += 1;
          vipAmount += amount;
        } else {
          normalCount += 1;
          normalAmount += amount;
        }
        const signT = new Date(c.signDate).getTime();
        if (c.status === "SETTLED" || c.status === "EXIT_REQUESTED" || (c as any).settledAt) {
          exitedCount += 1;
          const exitT = ((c as any).settledAt ? new Date((c as any).settledAt).getTime() : now);
          totalDaysExited += Math.max(1, Math.ceil((exitT - signT) / 86400000));
        } else {
          totalDaysActive += Math.max(1, Math.ceil((now - signT) / 86400000));
        }
      }
    }
    const totalClients = vipCount + normalCount;
    const totalClientAmount = vipAmount + normalAmount;
    const activeCount = totalClients - exitedCount;
    return {
      vipCount,
      vipAmount,
      normalCount,
      normalAmount,
      totalClients,
      totalClientAmount,
      vipAmountPct: totalClientAmount > 0 ? (vipAmount / totalClientAmount) * 100 : 0,
      vipCountPct: totalClients > 0 ? (vipCount / totalClients) * 100 : 0,
      exitedCount,
      exitedPct: totalClients > 0 ? (exitedCount / totalClients) * 100 : 0,
      activeCount,
      avgActiveDays: activeCount > 0 ? Math.round(totalDaysActive / activeCount) : 0,
      avgExitedDays: exitedCount > 0 ? Math.round(totalDaysExited / exitedCount) : 0,
      avgContractDays: batches.length > 0 ? Math.round(maxDays) : 0,
      avgTicket: totalClients > 0 ? Math.round(totalClientAmount / totalClients) : 0,
    };
  }, [batches]);

  const batchStatusDist = useMemo(() => {
    const counter: Record<string, number> = {};
    for (const b of batches) {
      const key =
        b.status === "LOCKED" ? "锁仓期" :
        b.status === "TRADING_OPEN" ? "交易窗口" :
        b.status === "CLOSED" ? "已到期封闭" :
        b.status === "LIQUIDATED" ? "已清算" : String(b.status);
      counter[key] = (counter[key] || 0) + 1;
    }
    return Object.entries(counter).map(([name, value]) => ({ name, value }));
  }, [batches]);

  // ====== 新增 1：AUM 资金构成 100% 堆叠 ======
  const aumComposition = useMemo(() => {
    const clientCapital = Math.max(0, totalInitial - summary.totalSubordinate);
    const subInitial = summary.totalSubordinate;
    const margin = summary.totalMarginCalls;
    const total = Math.max(1, clientCapital + subInitial + margin);
    return [
      { key: "客户本金", value: clientCapital, pct: (clientCapital / total) * 100, color: "hsl(217 91% 60%)" },
      { key: "劣后本金", value: subInitial, pct: (subInitial / total) * 100, color: "hsl(265 89% 70%)" },
      { key: "累计补仓", value: margin, pct: (margin / total) * 100, color: "hsl(38 92% 50%)" },
    ];
  }, [totalInitial, summary]);

  // ====== 新增 2：补仓漏斗 4 段堆叠 ======
  const funnelComposition = useMemo(() => {
    const subInitial = summary.totalSubordinate;
    const injected = summary.totalMarginCalls;
    const recovered = institutionMetrics.totalRecovered;
    const outstanding = institutionMetrics.outstanding;
    const max = Math.max(1, subInitial + injected);
    return [
      { key: "劣后原始", value: subInitial, pct: (subInitial / max) * 100, color: "hsl(265 89% 70%)" },
      { key: "补仓累计注入", value: injected, pct: (injected / max) * 100, color: "hsl(38 92% 50%)" },
      { key: "已回收", value: recovered, pct: (recovered / max) * 100, color: "hsl(142 76% 45%)" },
      { key: "未回收敞口", value: outstanding, pct: (outstanding / max) * 100, color: "hsl(0 72% 51%)" },
    ];
  }, [summary, institutionMetrics]);

  // ====== 新增 3：批次风险分层堆叠 ======
  const riskLayerDist = useMemo(() => {
    const counter: Record<RiskLevel, number> = { [RiskLevel.NORMAL]: 0, [RiskLevel.WARNING]: 0, [RiskLevel.CRITICAL]: 0 };
    for (const b of batches) counter[b.riskLevel] = (counter[b.riskLevel] || 0) + 1;
    const total = batches.length || 1;
    return [
      { key: "正常 (NORMAL)", value: counter[RiskLevel.NORMAL], pct: (counter[RiskLevel.NORMAL] / total) * 100, color: DEFAULT_RISK_COLORS[RiskLevel.NORMAL] },
      { key: "预警 (WARNING)", value: counter[RiskLevel.WARNING], pct: (counter[RiskLevel.WARNING] / total) * 100, color: DEFAULT_RISK_COLORS[RiskLevel.WARNING] },
      { key: "危险 (CRITICAL)", value: counter[RiskLevel.CRITICAL], pct: (counter[RiskLevel.CRITICAL] / total) * 100, color: DEFAULT_RISK_COLORS[RiskLevel.CRITICAL] },
    ];
  }, [batches]);

  // ====== 新增 4：批次风险甜甜圈 ======
  const riskDonut = useMemo(() => riskLayerDist.map(x => ({ name: x.key, value: Math.max(0, x.value), color: x.color })), [riskLayerDist]);

  // ====== 新增 5：BD 经理在管 AUM 横向 Bar ======
  const bdAUMRanking = useMemo(() => {
    const map: Record<string, { clients: number; amount: number }> = {};
    for (const b of batches) for (const c of b.clients ?? []) {
      if (!map[c.bdManager]) map[c.bdManager] = { clients: 0, amount: 0 };
      map[c.bdManager].clients += 1;
      map[c.bdManager].amount += c.investmentAmount || 0;
    }
    const arr = Object.entries(map).map(([bd, v]) => ({ bd, ...v }));
    for (const bd of BD_MANAGERS) if (!map[bd]) arr.push({ bd, clients: 0, amount: 0 });
    arr.sort((a, b) => b.amount - a.amount);
    return arr.map((r, i) => ({ ...r, rank: i + 1, fill: i < 3 ? CROWN_COLORS[i] : "hsl(217 91% 60%)" }));
  }, [batches]);

  // ====== 新增 6：客户投资金额分桶直方图 ======
  const investBucketHist = useMemo(() => {
    const buckets = INVEST_BUCKETS.map(b => ({ ...b, clientCount: 0, amount: 0 }));
    const seen = new Set<string>();
    for (const b of batches) for (const c of b.clients ?? []) {
      const fp = `${c.name}|${c.bdManager}`;
      if (seen.has(fp)) continue;
      seen.add(fp);
      const amt = c.investmentAmount || 0;
      for (const bucket of buckets) {
        if (amt >= bucket.min && amt < bucket.max) {
          bucket.clientCount += 1;
          bucket.amount += amt;
          break;
        }
      }
    }
    return buckets.map(b => ({
      range: b.key,
      客户数: b.clientCount,
      投资金额: b.amount,
      fill: b.color,
    }));
  }, [batches]);

  // ====== 新增 7：批次到期节奏按月 ======
  const maturityMonthly = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of batches) {
      const d = new Date(b.maturityDate);
      const key = `${d.getUTCFullYear().toString().slice(2)}/${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
      map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, count]) => {
        const { tick, tooltip } = expandMonthTick(monthKey);
        return { month: tick, monthLabel: tooltip, 到期批次: count };
      });
  }, [batches]);

  // ====== 新增 8：客户签约节奏按季度 ======
  const signQuarterly = useMemo(() => {
    const map: Record<string, number> = {};
    const seen = new Set<string>();
    for (const b of batches) for (const c of b.clients ?? []) {
      const fp = `${c.name}|${c.bdManager}`;
      if (seen.has(fp)) continue;
      seen.add(fp);
      const d = new Date(c.signDate);
      const y = d.getUTCFullYear().toString().slice(2);
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const key = `${y}Q${q}`;
      map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([qKey, n]) => {
        const { tick, tooltip } = expandQuarterTick(qKey);
        return { 季度: tick, 季度Label: tooltip, 签约客户数: n };
      });
  }, [batches]);

  // ====== 新增 9：批次剩余寿命 Top10 横向 Bar ======
  const batchLifespan = useMemo(() => {
    const now = Date.now();
    return batches
      .map(b => {
        const remain = Math.max(0, Math.ceil((new Date(b.maturityDate).getTime() - now) / 86400000));
        const total = Math.max(1, Math.ceil((new Date(b.maturityDate).getTime() - new Date(b.signDate).getTime()) / 86400000));
        const progressPct = Math.min(100, Math.max(0, ((total - remain) / total) * 100));
        return {
          batch: b.batchNumber.replace(/^BATCH-/, ""),
          剩余天数: remain,
          progressPct,
          fill: DEFAULT_RISK_COLORS[b.riskLevel] || "hsl(217 91% 60%)",
        };
      })
      .sort((a, b) => a.剩余天数 - b.剩余天数)
      .slice(0, 10);
  }, [batches]);

  // ====== 新增 10：客户签约质量 双环形进度（替换原4数字卡） ======
  const qualityMetrics = useMemo(() => {
    const clientPct = totalInitial > 0 ? (((totalInitial - summary.totalSubordinate) / totalInitial) * 100) : 0;
    const avgMonth = Math.max(0, Math.round((clientStats.avgActiveDays || 0) / 30.44));
    const avgTicketK = clientStats.totalClients > 0 ? Math.round(clientStats.avgTicket / 1000) : 0;
    return {
      vipPct: clientStats.vipAmountPct,
      clientPct,
      avgMonth,
      avgTicketK,
    };
  }, [clientStats, summary, totalInitial]);

  const marketOpenNow = isMarketOpen();

  const StackedBar = ({ data, height = 36 }: { data: { key: string; value: number; pct: number; color: string }[]; height?: number }) => (
    <div className="w-full" style={{ height }}>
      <div className={cn("h-full w-full rounded-lg overflow-hidden flex")}>
        {data.map((seg, i) => (
          <div
            key={seg.key + i}
            title={`${seg.key}: ${formatCompactNumber(seg.value)} (${formatPercent(seg.pct, 1)})`}
            className="h-full transition-all"
            style={{
              width: `${Math.max(seg.pct, seg.value > 0 ? 1.5 : 0)}%`,
              backgroundColor: seg.color,
              borderLeft: i === 0 ? "none" : "1px solid rgba(255,255,255,0.25)",
            }}
          />
        ))}
      </div>
    </div>
  );

  const LegendRow = ({ data, textSize = "text-[10.5px]" }: { data: { key: string; value?: number; color: string }[]; textSize?: string }) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
      {data.map((seg, i) => (
        <div key={seg.key + i} className={cn("inline-flex items-center gap-1.5", textSize)}>
          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
          <span className="text-muted-foreground">{seg.key}</span>
          {typeof seg.value === "number" && (
            <span className="font-mono font-semibold text-foreground tabular-nums">{formatCompactNumber(seg.value)}</span>
          )}
        </div>
      ))}
    </div>
  );

  const DonutMini = ({ pct, color, label }: { pct: number; color: string; label: string }) => (
    <div className="flex items-center gap-3">
      <svg width="58" height="58" viewBox="0 0 58 58" className="shrink-0">
        <circle cx="29" cy="29" r="23" stroke="hsl(var(--border))" strokeWidth="6" fill="none" />
        <circle
          cx="29" cy="29" r="23"
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.min(100, Math.max(0, pct)) * 1.445} 144.5`}
          transform="rotate(-90 29 29)"
        />
        <text x="29" y="32" textAnchor="middle" className="text-[11px] font-mono font-bold" fill="currentColor">
          {formatPercent(pct, 0)}
        </text>
      </svg>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label.split("|")[0]}</p>
        <p className="text-sm font-bold text-foreground truncate">
          {label.includes("|") ? label.split("|")[1] : ""}
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-[1800px] mx-auto">
      <Reveal offsetY={14}>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground font-semibold">
                行情中心
              </span>
              <span>/</span>
              <span className="font-mono uppercase tracking-wider text-primary font-bold">{liveSymbol}</span>
              <span>/</span>
              <span>数据分析看板</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              数据分析 · {liveSymbol} 机构 &amp; 风控多维可视化
            </h1>
            <p className="text-sm text-muted-foreground">
              纯图形驱动：资金构成堆叠 × 风险分层分布 × BD贡献矩阵 × 签约到期节奏 × 客户结构画像
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={marketOpenNow ? "success" : "secondary"}
              className="gap-1.5 px-3 py-1"
            >
              <Clock className="h-3 w-3" />
              {marketOpenNow ? "美股 / 港股 开盘中" : "全球市场休市"}
            </Badge>
            <Badge
              variant={
                realtime?.source === "LIVE"
                  ? "success"
                  : realtime?.source === "CACHE"
                    ? "secondary"
                    : "warning"
              }
              className="gap-1.5 px-3 py-1"
            >
              <RadioTower
                className={cn(
                  "h-3 w-3",
                  realtime?.source === "LIVE" && marketOpenNow && "animate-pulse-green"
                )}
              />
              {realtime?.provider
                ? realtime.provider.replace("_UNOFFICIAL", "").replace("_", " ")
                : "LIVE"}
              <span className="text-[10px] opacity-70 font-mono">
                [{realtime?.source ?? "—"}]
              </span>
            </Badge>
            <Button
              size="sm"
              variant="gradient"
              className="gap-1.5"
              onClick={handleRefresh}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
              />
              刷新行情
            </Button>
          </div>
        </div>
      </Reveal>

      {/* ===== Section 0: 近 6 月月度新增批次趋势（整页第一数据卡） ===== */}
      <Reveal offsetY={16} delayMs={80}>
        <MonthlyBatchesTrend batches={batches} isAnimationActive={animActive} />
      </Reveal>

      {/* ===== Section 1: 资金与风险全景 3 堆叠条 ===== */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Reveal offsetY={16} delayMs={120}>
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Landmark className="h-4 w-4 text-primary" />
                AUM 资金构成（100% 堆叠）
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                总规模 {formatCompactNumber(totalInitial)} · 优先 / 劣后 / 补仓三层拆分
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <StackedBar data={aumComposition} height={42} />
              <LegendRow data={aumComposition} />
            </CardContent>
          </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={200}>
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Recycle className="h-4 w-4 text-warning" />
                补仓回收漏斗（对比劣后规模）
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                回收率 {formatPercent(summary.totalMarginCalls > 0 ? (institutionMetrics.totalRecovered / summary.totalMarginCalls) * 100 : 100, 1)} · 单笔最高敞口 {formatCompactNumber(institutionMetrics.worstExposure)}
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <StackedBar data={funnelComposition} height={42} />
              <LegendRow data={funnelComposition} />
            </CardContent>
          </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={280}>
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-danger" />
                批次风险分层（总览）
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {batches.length} 批次 · NORMAL / WARNING / CRITICAL 占比
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <StackedBar data={riskLayerDist} height={42} />
              <LegendRow data={riskLayerDist.map(x => ({ ...x, key: x.key.split(" ")[0] }))} />
            </CardContent>
          </Card>
        </Reveal>
      </div>

      {/* ===== Section 2: 风险甜甜圈 + BD排行 + 投资分桶 ===== */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Reveal offsetY={16} delayMs={160}>
          <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <PieIcon className="h-4 w-4 text-info" />
              风险分层分布 · 环形饼
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              批次数量占比 · 红=需风控介入
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    data={riskDonut}
                    innerRadius={58}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {riskDonut.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <ReTooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    formatter={(v: any, _n, p: any) => [`${Number(v)} 批 · ${formatPercent((Number(v) / batches.length) * 100, 0)}`, p.payload.name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <LegendRow data={riskDonut.map(x => ({ key: x.name, value: x.value, color: x.color }))} textSize="text-[11px]" />
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={240}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-warning" />
              BD 经理 · 在管资金排行
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              前 3 名 金 / 银 / 铜 色冠
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={bdAUMRanking}
                  layout="vertical"
                  margin={{ top: 6, right: 12, left: 0, bottom: 6 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
                  <YAxis
                    dataKey="bd"
                    type="category"
                    width={130}
                    tick={{ fontSize: 10.5 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => v.split(" ")[0]}
                  />
                  <ReTooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    formatter={(v: any, n) => [n === "amount" ? formatCompactNumber(Number(v)) : `${Number(v)} 位`, n === "amount" ? "在管资金" : "服务客户"]}
                  />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    dataKey="amount"
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                  >
                    {bdAUMRanking.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <LegendRow
              data={[
                { key: "🥇 冠军", color: CROWN_COLORS[0] },
                { key: "🥈 亚军", color: CROWN_COLORS[1] },
                { key: "🥉 季军", color: CROWN_COLORS[2] },
                { key: "其他", color: "hsl(217 91% 60%)" },
              ]}
            />
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={320}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              客户投资金额分桶
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              自然人按单笔投资额分组 · {clientStats.totalClients} 位去重口径
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={investBucketHist}
                  margin={{ top: 6, right: 10, left: 0, bottom: 6 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="range" tick={{ fontSize: 10.5 }} axisLine={false} tickLine={false} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                  />
                  <ReTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    yAxisId="left"
                    dataKey="客户数"
                    fill="hsl(217 91% 60%)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    yAxisId="right"
                    dataKey="投资金额"
                    radius={[4, 4, 0, 0]}
                  >
                    {investBucketHist.map((e, i) => (
                      <Cell key={i} fill={e.fill} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        </Reveal>
      </div>

      {/* ===== Section 3: 月度补仓 & 劣后净值（保留原） + PnL 构成 ===== */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Reveal offsetY={16} delayMs={200} className="lg:col-span-2">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              机构月度补仓注入 &amp; 劣后净值贡献
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              柱体：月度劣后 PnL 净值贡献（蓝渐变）· 月度机构补仓注入额（橙柱）· 过去 12 个月
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riskMonthly} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={65}
                    tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                  />
                  <ReTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelFormatter={(_label, payload) => {
                      const first = (payload as unknown as Array<{ payload?: any }>)?.[0]?.payload;
                      return first?.monthLabel ?? _label;
                    }}
                    formatter={(v: any) => formatCurrency(Number(v))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    dataKey="风险敞口"
                    name="当月劣后 PnL 贡献"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                  >
                    <defs>
                      <linearGradient id="expGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(217 91% 60%)" />
                        <stop offset="100%" stopColor="hsl(239 84% 67%)" />
                      </linearGradient>
                    </defs>
                  </Bar>
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    dataKey="机构补仓"
                    name="机构当月补仓注入"
                    stackId="a"
                    fill="hsl(30 100% 55%)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={280}>
        <Card className="lg:col-span-1 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Coins className="h-4 w-4 text-warning" />
              总 PnL 构成：机构 vs 客户
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              按绝对盈亏拆分 · 合计 {formatCompactNumber(summary.institutionPnL + summary.allClientsPnL)}
            </p>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {(() => {
              const instPnL = summary.institutionPnL;
              const cliPnL = summary.allClientsPnL;
              const total = Math.abs(instPnL) + Math.abs(cliPnL);
              const instPct = total > 0 ? (Math.abs(instPnL) / total) * 100 : 50;
              const cliPct = 100 - instPct;
              const expectedInstPct = 30;
              const EPS = 0.005;
              return (
                <>
                  <div className="space-y-2">
                    <div className="rounded-xl border border-border/50 p-3 bg-card/50 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                          机构 PnL
                        </span>
                        <span className={cn("font-mono font-bold", instPnL >= 0 ? "text-success" : "text-danger")}>
                          {instPnL >= 0 ? "+" : ""}{formatCompactNumber(instPnL)}
                        </span>
                      </div>
                      {(Math.abs(summary.institutionRealizedPnL) >= EPS || Math.abs(summary.institutionUnrealizedPnL) >= EPS) && (
                        <div className="space-y-0.5 text-[10.5px] pt-0.5 border-t border-border/35">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground uppercase tracking-wider font-semibold">已实现</span>
                            <span className={cn("font-mono font-semibold tabular-nums",
                              Math.abs(summary.institutionRealizedPnL) < EPS
                                ? "text-muted-foreground"
                                : summary.institutionRealizedPnL >= 0
                                ? "text-success"
                                : "text-danger")}>
                              {summary.institutionRealizedPnL >= 0 && Math.abs(summary.institutionRealizedPnL) >= EPS ? "+" : ""}
                              {formatCompactNumber(summary.institutionRealizedPnL)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground uppercase tracking-wider font-semibold">未实现</span>
                            <span className={cn("font-mono font-semibold tabular-nums",
                              Math.abs(summary.institutionUnrealizedPnL) < EPS
                                ? "text-muted-foreground"
                                : summary.institutionUnrealizedPnL >= 0
                                ? "text-success"
                                : "text-danger")}>
                              {summary.institutionUnrealizedPnL >= 0 && Math.abs(summary.institutionUnrealizedPnL) >= EPS ? "+" : ""}
                              {formatCompactNumber(summary.institutionUnrealizedPnL)}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="h-3 w-full rounded-full bg-secondary/50 overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${instPct}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[10.5px] font-mono text-muted-foreground">
                        <span>占 {formatPercent(instPct, 1)}</span>
                        <span>理论 ~{expectedInstPct}%</span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/50 p-3 bg-card/50 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          <span className="h-2.5 w-2.5 rounded-full bg-info" />
                          客户 PnL
                        </span>
                        <span className={cn("font-mono font-bold", cliPnL >= 0 ? "text-success" : "text-warning")}>
                          {cliPnL >= 0 ? "+" : ""}{formatCompactNumber(cliPnL)}
                        </span>
                      </div>
                      {(Math.abs(summary.clientsRealizedPnL) >= EPS || Math.abs(summary.clientsUnrealizedPnL) >= EPS) && (
                        <div className="space-y-0.5 text-[10.5px] pt-0.5 border-t border-border/35">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground uppercase tracking-wider font-semibold">已实现</span>
                            <span className={cn("font-mono font-semibold tabular-nums",
                              Math.abs(summary.clientsRealizedPnL) < EPS
                                ? "text-muted-foreground"
                                : summary.clientsRealizedPnL >= 0
                                ? "text-success"
                                : "text-warning")}>
                              {summary.clientsRealizedPnL >= 0 && Math.abs(summary.clientsRealizedPnL) >= EPS ? "+" : ""}
                              {formatCompactNumber(summary.clientsRealizedPnL)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground uppercase tracking-wider font-semibold">未实现</span>
                            <span className={cn("font-mono font-semibold tabular-nums",
                              Math.abs(summary.clientsUnrealizedPnL) < EPS
                                ? "text-muted-foreground"
                                : summary.clientsUnrealizedPnL >= 0
                                ? "text-success"
                                : "text-warning")}>
                              {summary.clientsUnrealizedPnL >= 0 && Math.abs(summary.clientsUnrealizedPnL) >= EPS ? "+" : ""}
                              {formatCompactNumber(summary.clientsUnrealizedPnL)}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="h-3 w-full rounded-full bg-secondary/50 overflow-hidden">
                        <div className="h-full rounded-full bg-info" style={{ width: `${cliPct}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[10.5px] font-mono text-muted-foreground">
                        <span>占 {formatPercent(cliPct, 1)}</span>
                        <span>理论 ~{100 - expectedInstPct}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-1 border-t border-border/40 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        分成偏离度
                      </span>
                      <span className={cn(
                        "font-mono font-bold tabular-nums",
                        Math.abs(instPct - expectedInstPct) <= 3 ? "text-success" :
                        Math.abs(instPct - expectedInstPct) <= 8 ? "text-warning" : "text-danger"
                      )}>
                        {formatPercent(instPct - expectedInstPct, 1)}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
        </Reveal>
      </div>

      {/* ===== Section 4: 到期节奏 + 签约节奏 + 剩余寿命 ===== */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Reveal offsetY={16} delayMs={140}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-info" />
              批次到期节奏（月份）
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              按 maturityDate 聚合 · 风控提前排期
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={maturityMonthly} margin={{ top: 6, right: 10, left: 0, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10.5 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={38} allowDecimals={false} />
                  <ReTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v) => [`${v} 批次`, "到期"]} labelFormatter={(_label, payload) => {
                    const first = (payload as unknown as Array<{ payload?: any }>)?.[0]?.payload;
                    return first?.monthLabel ?? _label;
                  }} />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    dataKey="到期批次"
                    radius={[4, 4, 0, 0]}
                    fill="hsl(265 89% 70%)"
                    barSize={30}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={220}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              客户签约节奏（季度）
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              BD 获客趋势 · {clientStats.totalClients} 位自然人去重
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={signQuarterly} margin={{ top: 6, right: 10, left: 0, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="季度" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={38} allowDecimals={false} />
                  <ReTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v) => [`${v} 位客户`, "签约"]} labelFormatter={(_label, payload) => {
                    const first = (payload as unknown as Array<{ payload?: any }>)?.[0]?.payload;
                    return first?.季度Label ?? _label;
                  }} />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    dataKey="签约客户数"
                    radius={[4, 4, 0, 0]}
                    barSize={36}
                  >
                    <defs>
                      <linearGradient id="signGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(142 76% 55%)" />
                        <stop offset="100%" stopColor="hsl(142 76% 38%)" />
                      </linearGradient>
                    </defs>
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={300}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              批次剩余寿命 · Top 10（快到期置顶）
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              颜色 = 风险等级 · 进度条 = 已执行比例
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={batchLifespan}
                  layout="vertical"
                  margin={{ top: 4, right: 56, left: 60, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => `${v} 天`}
                    axisLine={false}
                  />
                  <YAxis
                    dataKey="batch"
                    type="category"
                    width={60}
                    tick={{ fontSize: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ReTooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    formatter={(v: any, n, p: any) => [
                      n === "剩余天数"
                        ? `${Number(v)} 天 (已执行 ${formatPercent(p.payload.progressPct, 0)})`
                        : formatPercent(Number(v), 0),
                      n === "剩余天数" ? "剩余" : "进度"
                    ]}
                  />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    dataKey="剩余天数"
                    radius={[0, 4, 4, 0]}
                    barSize={16}
                  >
                    {batchLifespan.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        </Reveal>
      </div>

      {/* ===== Section 5: 客户结构 4 图形（VIP饼 + 退出横条 + 批次生命周期饼 + 签约质量双环） ===== */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Reveal offsetY={16} delayMs={160}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Crown className="h-4 w-4 text-warning" />
              客户投资结构 · VIP 分层
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              VIP 阈值：单客 ≥ ${formatCompactNumber(VIP_THRESHOLD)} · 按签约投资金额
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 items-center">
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      isAnimationActive={animActive}
                      animationDuration={1100}
                      data={[
                        { name: "VIP客户", value: Math.max(1, clientStats.vipAmount) },
                        { name: "普通客户", value: Math.max(1, clientStats.normalAmount) },
                      ]}
                      innerRadius={58}
                      outerRadius={88}
                      paddingAngle={2}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      <Cell fill="hsl(45 93% 47%)" />
                      <Cell fill="hsl(217 91% 60%)" />
                    </Pie>
                    <ReTooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                      formatter={(v: any) => [formatCompactNumber(Number(v)), "投资金额"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 text-[12px]">
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-warning">
                      <Crown className="h-3.5 w-3.5" /> VIP
                    </span>
                    <span className="font-mono font-bold tabular-nums">
                      {clientStats.vipCount} 位 · {formatCompactNumber(clientStats.vipAmount)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary/60 overflow-hidden mt-1">
                    <div className="h-full rounded-full" style={{ width: `${clientStats.vipAmountPct}%`, backgroundColor: "hsl(45 93% 47%)" }} />
                  </div>
                </div>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                      <Users className="h-3.5 w-3.5" /> 普通
                    </span>
                    <span className="font-mono font-bold tabular-nums">
                      {clientStats.normalCount} 位 · {formatCompactNumber(clientStats.normalAmount)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary/60 overflow-hidden mt-1">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${100 - clientStats.vipAmountPct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={260}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-info" />
              客户持有周期 &amp; 退出统计
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              基准：批次平均合约周期 {clientStats.avgContractDays} 天
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[160px] mb-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { label: "批次合约基准", days: clientStats.avgContractDays, fill: "hsl(var(--muted-foreground) / 0.6)" },
                    { label: "已退出平均持有", days: clientStats.avgExitedDays, fill: "hsl(142 76% 45%)" },
                    { label: "在投平均已持有", days: clientStats.avgActiveDays, fill: "hsl(217 91% 60%)" },
                  ]}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}d`} />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={110}
                    tick={{ fontSize: 10.5 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ReTooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    formatter={(v: any) => [`${Number(v)} 天`, ""]}
                  />
                  <Bar
                    isAnimationActive={animActive}
                    animationDuration={1100}
                    dataKey="days"
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                  >
                    {[
                      { fill: "hsl(var(--muted-foreground) / 0.6)" },
                      { fill: "hsl(142 76% 45%)" },
                      { fill: "hsl(217 91% 60%)" },
                    ].map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40 text-[11px]">
              <div className="text-center">
                <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-0.5">在投</p>
                <FlashNumber value={clientStats.activeCount} className="font-mono font-bold text-primary text-sm" />
              </div>
              <div className="text-center">
                <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-0.5">已退出</p>
                <FlashNumber value={clientStats.exitedCount} className="font-mono font-bold text-success text-sm" />
              </div>
              <div className="text-center">
                <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-0.5">退出率</p>
                <FlashNumber
                  value={clientStats.exitedPct}
                  formatter="percent"
                  digits={1}
                  className="font-mono font-bold text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={160}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-primary" />
              批次生命周期结构
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {batches.length} 批次 · 锁仓 / 交易窗口 / 到期 / 结算
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 items-center">
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      isAnimationActive={animActive}
                      animationDuration={1100}
                      data={batchStatusDist}
                      innerRadius={58}
                      outerRadius={88}
                      paddingAngle={2}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {batchStatusDist.map((_, i) => (
                        <Cell
                          key={i}
                          fill={
                            ["hsl(265 89% 70%)", "hsl(217 91% 60%)", "hsl(30 100% 55%)", "hsl(142 76% 45%)", "hsl(0 63% 45%)"][
                              i % 5
                            ]
                          }
                        />
                      ))}
                    </Pie>
                    <ReTooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                      formatter={(v: any, _n, p: any) => [`${Number(v)} 批 · ${formatPercent((Number(v) / batches.length) * 100, 0)}`, p.payload.name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 text-[12px]">
                {batchStatusDist.map((item, i) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between rounded-md px-2.5 py-1.5 bg-secondary/40"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            ["hsl(265 89% 70%)", "hsl(217 91% 60%)", "hsl(30 100% 55%)", "hsl(142 76% 45%)", "hsl(0 63% 45%)"][
                              i % 5
                            ],
                        }}
                      />
                      <span className="font-semibold">{item.name}</span>
                    </span>
                    <span className="font-mono font-bold tabular-nums">
                      {item.value} 批 · {formatPercent((item.value / batches.length) * 100, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        </Reveal>

        <Reveal offsetY={16} delayMs={260}>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Gauge className="h-4 w-4 text-warning" />
              客户签约 · 质量仪表盘
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              图形化：VIP 集中度 + 本金占比 双环形
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DonutMini
                pct={qualityMetrics.vipPct}
                color="hsl(45 93% 47%)"
                label={`VIP集中度|${formatCompactNumber(clientStats.vipAmount)}`}
              />
              <DonutMini
                pct={qualityMetrics.clientPct}
                color="hsl(217 91% 60%)"
                label={`本金占AUM|${formatPercent(qualityMetrics.clientPct, 0)}`}
              />
              <div className="card-chrome rounded-lg p-3">
                <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1">
                  平均单笔投资
                </p>
                <FlashNumber
                  value={clientStats.avgTicket}
                  formatter="dollarCompact"
                  className="font-mono font-bold text-[15px] tabular-nums"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  每 {clientStats.totalClients} 位自然人
                </p>
              </div>
              <div className="card-chrome rounded-lg p-3">
                <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1">
                  平均已签约时长
                </p>
                <FlashNumber
                  value={qualityMetrics.avgMonth}
                  formatter="number"
                  digits={0}
                  suffix=" 个月"
                  className="font-mono font-bold text-[15px] tabular-nums text-primary"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  ≈ {clientStats.avgActiveDays} 天（在投）
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        </Reveal>
      </div>
    </div>
  );
}
