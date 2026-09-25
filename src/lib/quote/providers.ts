export type QuoteProvider = "YAHOO_FINANCE" | "NASDAQ_UNOFFICIAL" | "STOOQ" | "FINNHUB";

export const QUOTE_PROVIDERS: { id: QuoteProvider; label: string; url: string }[] = [
  { id: "YAHOO_FINANCE", label: "Yahoo Finance（免费，全球覆盖）", url: "https://finance.yahoo.com" },
  { id: "NASDAQ_UNOFFICIAL", label: "Nasdaq Unofficial（免费，美股）", url: "https://www.nasdaq.com" },
  { id: "STOOQ", label: "Stooq（免费，CSV 友好）", url: "https://stooq.com" },
  { id: "FINNHUB", label: "Finnhub（专业美股行情，需免费 API Key）", url: "https://finnhub.io" },
];

function getFinnhubKey(): string | null {
  const k =
    (typeof process !== "undefined" && process.env?.FINNHUB_API_KEY) ||
    null;
  if (!k) return null;
  const s = String(k).trim();
  return s.length > 0 ? s : null;
}

export async function finnhubRealtime(symbol: string): Promise<RealtimeQuote> {
  const key = getFinnhubKey();
  if (!key) throw new Error("Finnhub API Key 未配置 (FINNHUB_API_KEY)");
  const s = symbol.trim().toUpperCase();
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${key}`;
  const res = await timeout(
    fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }),
    3000,
  );
  if (!res.ok) throw new Error(`Finnhub quote ${res.status}`);
  const j = (await res.json()) as any;
  if (!j || typeof j.c !== "number" || !j.c) throw new Error("Finnhub quote empty");
  const price = Number(j.c);
  const prevClose = Number(j.pc ?? price);
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  return {
    provider: "FINNHUB",
    symbol: s,
    price,
    open: Number(j.o ?? prevClose),
    high: Number(j.h ?? price),
    low: Number(j.l ?? price),
    prevClose,
    volume: Number(j.v ?? 0),
    changePct,
    updatedAt: Number(j.t ?? 0) * 1000 || Date.now(),
  };
}

function _aggCandlesTo4H(raw: HistoryCandle[]): HistoryCandle[] {
  if (!raw || raw.length === 0) return [];
  const sorted = [...raw].sort((a, b) => a.time - b.time);
  const step = 4 * 60 * 60 * 1000;
  const out: HistoryCandle[] = [];
  let bucketStart = 0;
  let bucket: HistoryCandle | null = null;
  for (const c of sorted) {
    const bStart = Math.floor(c.time / step) * step;
    if (!bucket || bStart !== bucketStart) {
      if (bucket) out.push(bucket);
      bucket = {
        time: bStart,
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
      };
      bucketStart = bStart;
    } else {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.volume += (c.volume || 0);
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

export async function finnhubHistory(symbol: string, period: HistoryPeriod): Promise<HistoryCandle[]> {
  const key = getFinnhubKey();
  if (!key) throw new Error("Finnhub API Key 未配置 (FINNHUB_API_KEY)");
  const s = symbol.trim().toUpperCase();
  const cfg = HISTORY_PERIOD_CONFIG[period];
  const toSec = Math.floor(Date.now() / 1000);
  const fromSec = Math.max(0, toSec - cfg.calendarDays * 24 * 3600);
  let resolution = cfg.finnhubResolution;
  const is4HAgg = period === "4H";
  if (is4HAgg) resolution = "60";
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(s)}&resolution=${encodeURIComponent(resolution)}&from=${fromSec}&to=${toSec}&token=${key}`;
  const res = await timeout(
    fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }),
    3000,
  );
  if (!res.ok) throw new Error(`Finnhub candle ${res.status}`);
  const j = (await res.json()) as any;
  if (!j || j.s !== "ok" || !Array.isArray(j.t) || j.t.length === 0) {
    throw new Error(`Finnhub candle no_data: ${j?.s || "empty"}`);
  }
  const t: number[] = j.t || [];
  const o: number[] = j.o || [];
  const h: number[] = j.h || [];
  const l: number[] = j.l || [];
  const c: number[] = j.c || [];
  const v: number[] = j.v || [];
  const n = Math.min(t.length, o.length, h.length, l.length, c.length, v.length);
  const out: HistoryCandle[] = [];
  for (let i = 0; i < n; i++) {
    const close = Number(c[i]);
    if (!Number.isFinite(close) || !close) continue;
    out.push({
      time: Number(t[i]) * 1000,
      open: Number(o[i] ?? close),
      high: Number(h[i] ?? close),
      low: Number(l[i] ?? close),
      close,
      volume: Number(v[i] ?? 0),
    });
  }
  if (is4HAgg) return _aggCandlesTo4H(out);
  return out.sort((a, b) => a.time - b.time);
}

export interface RealtimeQuote {
  provider: QuoteProvider;
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  changePct: number;
  updatedAt: number;
}

export interface HistoryCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type HistoryPeriod = "15M" | "1H" | "4H" | "1D" | "5D" | "1M" | "3M" | "1Y" | "MAX";

export const HISTORY_PERIOD_CONFIG: Record<HistoryPeriod, { label: string; range: string; interval: string; calendarDays: number; isIntraday: boolean; minExpected: number; finnhubResolution: string }> = {
  "15M": { label: "15分", range: "5d",  interval: "15m",  calendarDays: 31,  isIntraday: true,  minExpected: 12, finnhubResolution: "15" },
  "1H":  { label: "1小时", range: "20d", interval: "60m",  calendarDays: 62,  isIntraday: true,  minExpected: 14, finnhubResolution: "60" },
  "4H":  { label: "4小时", range: "60d", interval: "240m", calendarDays: 120, isIntraday: true,  minExpected: 18, finnhubResolution: "60" },
  "1D":  { label: "1日",  range: "1mo", interval: "1d",   calendarDays: 30,  isIntraday: false, minExpected: 8,  finnhubResolution: "D"  },
  "5D":  { label: "5日",  range: "2mo", interval: "1d",   calendarDays: 60,  isIntraday: false, minExpected: 20, finnhubResolution: "D"  },
  "1M":  { label: "1月",  range: "3mo", interval: "1d",   calendarDays: 120, isIntraday: false, minExpected: 50, finnhubResolution: "D"  },
  "3M":  { label: "3月",  range: "6mo", interval: "1d",   calendarDays: 210, isIntraday: false, minExpected: 120,finnhubResolution: "D"  },
  "1Y":  { label: "1年",  range: "2y",  interval: "1d",   calendarDays: 600, isIntraday: false, minExpected: 300,finnhubResolution: "D"  },
  "MAX": { label: "全部",  range: "max", interval: "1mo",  calendarDays: 10950,isIntraday:false, minExpected: 180,finnhubResolution: "M"  },
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

async function timeout<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`fetch timeout ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(to);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(to);
        reject(e);
      });
  });
}

function yahooRangeInterval(period: HistoryPeriod): { range: string; interval: string } {
  return HISTORY_PERIOD_CONFIG[period];
}

function yahooPeriodSeconds(period: HistoryPeriod): { p1: number; p2: number; interval: string } {
  const cfg = HISTORY_PERIOD_CONFIG[period];
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = Math.max(0, p2 - cfg.calendarDays * 24 * 3600);
  const interval = cfg.isIntraday
    ? (cfg.interval === "240m" ? "60m" : cfg.interval)
    : (cfg.interval === "1mo" ? "1mo" : cfg.interval === "1wk" ? "1wk" : cfg.interval);
  return { p1, p2, interval };
}

function _yahooV8ToCandles(json: any, period: HistoryPeriod): HistoryCandle[] {
  const result = json?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const open: number[] = quote.open ?? [];
  const high: number[] = quote.high ?? [];
  const low: number[] = quote.low ?? [];
  const close: number[] = quote.close ?? [];
  const volume: number[] = quote.volume ?? [];
  const raw: HistoryCandle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = Number(close[i]);
    if (!Number.isFinite(c)) continue;
    raw.push({
      time: Number(timestamps[i]) * 1000,
      open: Number(open[i] ?? c),
      high: Number(high[i] ?? c),
      low: Number(low[i] ?? c),
      close: c,
      volume: Number(volume[i] ?? 0),
    });
  }
  if (period === "4H") return _aggCandlesTo4H(raw);
  return raw;
}

export function forceNormalizeLastCandle<T extends HistoryCandle>(
  candles: T[],
  anchor: { close?: number | null; high?: number | null; low?: number | null } = {},
): T[] {
  if (!candles || candles.length === 0) return candles;
  const out = [...candles];
  const last = out[out.length - 1];
  let fixed = false;
  let newClose = last.close;
  let newHigh = last.high;
  let newLow = last.low;
  if (anchor && typeof anchor.close === "number" && Number.isFinite(anchor.close) && anchor.close > 0) {
    const diff = Math.abs(anchor.close - last.close) / Math.max(1e-6, last.close);
    if (diff > 0.0001) {
      newClose = anchor.close;
      fixed = true;
    }
  }
  if (anchor && typeof anchor.high === "number" && Number.isFinite(anchor.high) && anchor.high > 0 && anchor.high > newHigh) {
    newHigh = anchor.high;
    fixed = true;
  }
  if (anchor && typeof anchor.low === "number" && Number.isFinite(anchor.low) && anchor.low > 0 && anchor.low < newLow) {
    newLow = anchor.low;
    fixed = true;
  }
  if (fixed) {
    out[out.length - 1] = {
      ...last,
      open: Number(last.open.toFixed(2)),
      high: Number(newHigh.toFixed(2)),
      low: Number(Math.max(0.0001, newLow).toFixed(2)),
      close: Number(newClose.toFixed(2)),
      volume: Number(last.volume || 0),
    } as T;
  }
  return out;
}

export async function yahooFinanceRealtime(symbol: string): Promise<RealtimeQuote> {
  const { p1, p2, interval } = yahooPeriodSeconds("1D");
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=${interval}`;
  let lastErr: any = null;
  for (const host of ["query1", "query2"]) {
    try {
      const url = base.replace("query1.", `${host}.`);
      const res = await timeout(
        fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }),
        3000,
      );
      if (!res.ok) { lastErr = new Error(`Yahoo ${res.status}`); continue; }
      const json = (await res.json()) as any;
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== "number") { lastErr = new Error("Yahoo empty meta"); continue; }
      const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice);
      const price = Number(meta.regularMarketPrice);
      const open = Number(meta.regularMarketOpen ?? prevClose);
      const high = Number(meta.regularMarketDayHigh ?? price);
      const low = Number(meta.regularMarketDayLow ?? price);
      const volume = Number(meta.regularMarketVolume ?? 0);
      const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
      return {
        provider: "YAHOO_FINANCE",
        symbol,
        price, open, high, low, prevClose, volume, changePct,
        updatedAt: Date.now(),
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("Yahoo all hosts failed");
}

export async function yahooFinanceHistory(symbol: string, period: HistoryPeriod): Promise<HistoryCandle[]> {
  const { p1, p2, interval } = yahooPeriodSeconds(period);
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=${interval}`;
  let lastErr: any = null;
  for (const host of ["query1", "query2"]) {
    try {
      const url = base.replace("query1.", `${host}.`);
      const res = await timeout(
        fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }),
        3000,
      );
      if (!res.ok) { lastErr = new Error(`Yahoo ${res.status}`); continue; }
      const json = (await res.json()) as any;
      const out = _yahooV8ToCandles(json, period);
      if (out.length > 0) return out;
      lastErr = new Error("Yahoo 0 candles");
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("Yahoo history all failed");
}

export async function stooqRealtime(symbol: string): Promise<RealtimeQuote> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}&f=sd2t2ohlcvn&h&e=json`;
  const res = await timeout(
    fetch(url, { headers: { "User-Agent": UA } }),
    3000,
  );
  if (!res.ok) throw new Error(`Stooq ${res.status}`);
  const text = await res.text();
  const line = text.split(/\r?\n/).find((r) => /^[^\s,]+,[^,]*,[^,]*,[^,]*,[0-9.\-]*,[0-9.\-]*,[0-9.\-]*,[0-9.\-]*,[0-9]*,.*/i.test(r.trim()));
  if (!line) throw new Error("Stooq empty");
  const parts = line.split(",");
  const close = Number(parts[6]);
  const prevClose = Number(parts[7]);
  if (!Number.isFinite(close) || !close) throw new Error("Stooq invalid");
  const volume = Number(parts[8] ?? 0);
  const changePct = prevClose ? ((close - prevClose) / prevClose) * 100 : 0;
  return {
    provider: "STOOQ",
    symbol,
    price: close,
    open: Number(parts[3] ?? close),
    high: Number(parts[4] ?? close),
    low: Number(parts[5] ?? close),
    prevClose,
    volume,
    changePct,
    updatedAt: Date.now(),
  };
}

export async function stooqHistory(symbol: string, period: HistoryPeriod): Promise<HistoryCandle[]> {
  const cfg = HISTORY_PERIOD_CONFIG[period];
  const days = cfg.calendarDays;
  const d2 = new Date();
  const d1 = new Date(Date.now() - days * 24 * 3600 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  let interval = "d";
  if (cfg.isIntraday) {
    switch (cfg.interval) {
      case "5m": interval = "5"; break;
      case "15m": interval = "15"; break;
      case "60m": interval = "60"; break;
      case "240m": interval = "240"; break;
      default: interval = "d";
    }
  } else if (cfg.interval === "1wk") interval = "w";
  else if (cfg.interval === "1mo") interval = "m";
  const sym = symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`;
  const url =
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&d1=${fmt(d1)}&d2=${fmt(d2)}&i=${interval}`;
  const res = await timeout(fetch(url, { headers: { "User-Agent": UA } }), 3000);
  if (!res.ok) throw new Error(`Stooq history ${res.status}`);
  const text = await res.text();
  if (text.slice(0, 40).trim().startsWith("<!")) throw new Error("Stooq JS challenge intercepted (HTML)");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const out: HistoryCandle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 5) continue;
    const dateOrTs = parts[0];
    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    const volume = Number(parts[5] ?? 0);
    const c = Number(close);
    if (!Number.isFinite(c) || !c) continue;
    let t: number;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOrTs)) {
      t = new Date(dateOrTs as any).getTime();
    } else if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(dateOrTs)) {
      t = new Date((dateOrTs as any).replace(" ", "T")).getTime();
    } else {
      t = Number(dateOrTs);
      if (!Number.isFinite(t) || t < 1e10) continue;
    }
    if (!Number.isFinite(t)) continue;
    out.push({
      time: t,
      open: Number.isFinite(open) ? open : c,
      high: Number.isFinite(high) ? high : c,
      low: Number.isFinite(low) ? low : c,
      close: c,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return out;
}

export async function nasdaqRealtime(symbol: string): Promise<RealtimeQuote> {
  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`;
  const res = await timeout(
    fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.nasdaq.com/",
      },
    }),
    3000,
  );
  if (!res.ok) throw new Error(`Nasdaq ${res.status}`);
  const json = (await res.json()) as any;
  const data = json?.data;
  const pds = data?.primaryData || {};
  const price = Number(String(pds.lastSalePrice || pds.LastSalePrice || "0").replace(/[^0-9.\-]/g, ""));
  if (!price) throw new Error("Nasdaq empty");
  const netChange = Number(String(pds.netChange || pds.NetChange || "0").replace(/[^0-9.\-]/g, ""));
  const pctRaw = String(pds.percentageChange || pds.PercentageChange || "0").replace(/[^0-9.\-+]/g, "");
  const changePctRaw = Number(pctRaw);
  const prevClose = Number.isFinite(changePctRaw) && Math.abs(changePctRaw) > 0
    ? price - netChange
    : price * (1 - netChange / (Math.abs(changePctRaw) > 0 ? price * changePctRaw / 100 : price || 1));
  const changePct = (prevClose && price) ? ((price - prevClose) / prevClose) * 100 : 0;
  return {
    provider: "NASDAQ_UNOFFICIAL",
    symbol,
    price,
    open: Number(pds.openPrice || price),
    high: Number(pds.high || price),
    low: Number(pds.low || price),
    prevClose: prevClose || price,
    volume: Number(String(pds.volume || pds.Volume || "0").replace(/,/g, "")),
    changePct,
    updatedAt: Date.now(),
  };
}

export async function nasdaqHistory(symbol: string, period: HistoryPeriod): Promise<HistoryCandle[]> {
  const cfg = HISTORY_PERIOD_CONFIG[period];
  const days = cfg.calendarDays;
  const limit = Math.max(30, Math.min(10000, Math.floor(days * 1.4) + 10));
  const fromdateMs = Date.now() - days * 24 * 3600 * 1000;
  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${new Date(fromdateMs).toISOString().slice(0, 10)}&limit=${limit}`;
  const res = await timeout(
    fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.nasdaq.com/",
      },
    }),
    3000,
  );
  if (!res.ok) throw new Error(`Nasdaq history ${res.status}`);
  const json = (await res.json()) as any;
  const rows: any[] = json?.data?.tradesTable?.rows ?? json?.data?.table?.rows ?? [];
  const out: HistoryCandle[] = [];
  for (const r of rows) {
    const date = r.date ?? r.tradeDate;
    const close = Number(String(r.close || r.Close || "0").replace(/[^0-9.\-]/g, ""));
    if (!date || !Number.isFinite(close) || !close) continue;
    const t = new Date(date as any).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < fromdateMs) continue;
    out.push({
      time: t,
      open: Number(String(r.open || r.Open || close).replace(/[^0-9.\-]/g, "")),
      high: Number(String(r.high || r.High || close).replace(/[^0-9.\-]/g, "")),
      low: Number(String(r.low || r.Low || close).replace(/[^0-9.\-]/g, "")),
      close,
      volume: Number(String(r.volume || r.Volume || "0").replace(/[^0-9]/g, "")),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function fetchRealtimeWithFallback(symbol: string): Promise<RealtimeQuote> {
  if (!symbol || !symbol.trim()) throw new Error("empty symbol");
  const s = symbol.trim().toUpperCase();
  const fns: Array<(s: string) => Promise<RealtimeQuote>> = [];
  if (getFinnhubKey()) fns.push(finnhubRealtime);
  fns.push(yahooFinanceRealtime, nasdaqRealtime, stooqRealtime);
  let lastError: any = null;
  for (const fn of fns) {
    try {
      return await fn(s);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("all providers failed");
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function mergeCandlesByTime(groups: HistoryCandle[][]): HistoryCandle[] {
  const map = new Map<number, HistoryCandle & { _srcCnt: number; _volSum: number; }>();
  for (const g of groups) {
    if (!g || g.length === 0) continue;
    for (const c of g) {
      if (!c || !Number.isFinite(c.time) || !Number.isFinite(c.close) || !c.close) continue;
      const key = Math.round(c.time / 60000) * 60000;
      const ex = map.get(key);
      if (!ex) {
        map.set(key, { ...c, _srcCnt: 1, _volSum: c.volume || 0 });
        continue;
      }
      const next: any = { ...ex };
      next.open = Number.isFinite(ex.open) ? ex.open : c.open;
      next.close = Number.isFinite(c.close) ? c.close : ex.close;
      next.high = Number.isFinite(ex.high) && Number.isFinite(c.high) ? Math.max(ex.high, c.high) : (ex.high ?? c.high);
      next.low = Number.isFinite(ex.low) && Number.isFinite(c.low) ? Math.min(ex.low, c.low) : (ex.low ?? c.low);
      if (!Number.isFinite(next.open)) next.open = next.close;
      if (!Number.isFinite(next.high)) next.high = next.close;
      if (!Number.isFinite(next.low)) next.low = next.close;
      next.high = Math.max(next.high, next.open, next.close);
      next.low = Math.min(next.low, next.open, next.close);
      next.open = clamp(next.open, next.low, next.high);
      next.close = clamp(next.close, next.low, next.high);
      next.volume = (ex.volume || 0) + (c.volume || 0);
      next._srcCnt = ex._srcCnt + 1;
      next._volSum = (ex._volSum || 0) + (c.volume || 0);
      map.set(key, next);
    }
  }
  const arr = Array.from(map.values())
    .sort((a: any, b: any) => a.time - b.time)
    .map((c: any) => {
      const { _srcCnt: _a, _volSum: _b, ...rest } = c;
      void _a; void _b;
      return rest as HistoryCandle;
    });
  return arr;
}

export function synthesizeIntradayCandles(
  period: HistoryPeriod,
  dailyFallback: HistoryCandle[],
  referencePrice?: number,
): HistoryCandle[] {
  const cfg = HISTORY_PERIOD_CONFIG[period];
  if (!cfg.isIntraday) return [];
  let stepMs = 5 * 60 * 1000;
  if (period === "15M") stepMs = 15 * 60 * 1000;
  else if (period === "1H") stepMs = 60 * 60 * 1000;
  else if (period === "4H") stepMs = 4 * 60 * 60 * 1000;
  const days = cfg.calendarDays;
  const todayEnd = new Date();
  todayEnd.setSeconds(0, 0);
  const endMs = todayEnd.getTime();
  const startMs = endMs - days * 86400_000;
  const useDaily = dailyFallback && dailyFallback.length > 0 ? [...dailyFallback].sort((a, b) => a.time - b.time) : [];
  const lastDaily = useDaily[useDaily.length - 1];
  const baseClose = lastDaily?.close ?? referencePrice ?? 41.88;
  const baseOpen = lastDaily?.open ?? baseClose * 0.998;
  const baseHigh = lastDaily?.high ?? baseClose * 1.005;
  const baseLow = lastDaily?.low ?? baseClose * 0.995;
  const totalVol = useDaily.reduce((s, d) => s + (d.volume || 0), 0) || 2_000_000;
  const nyTz = -4 * 60;
  function isTradingHour(ms: number): boolean {
    const d = new Date(ms + nyTz * 60_000);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) return false;
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const mins = h * 60 + m;
    return mins >= 9 * 60 + 30 && mins <= 16 * 60;
  }
  function tradingStart(dayStartMs: number): number {
    const d = new Date(dayStartMs + nyTz * 60_000);
    d.setUTCHours(9, 30, 0, 0);
    return d.getTime() - nyTz * 60_000;
  }
  const slots: number[] = [];
  const day0 = new Date(startMs);
  day0.setHours(0, 0, 0, 0);
  const startDay = day0.getTime();
  for (let t = startDay; t <= endMs; t += 86400_000) {
    const s = tradingStart(t);
    for (let slot = s; isTradingHour(slot); slot += stepMs) {
      slots.push(slot);
    }
  }
  if (slots.length === 0) return [];
  const cfgMin = cfg.minExpected;
  if (slots.length < cfgMin) {
    const base = slots.length > 0 ? slots[slots.length - 1] : endMs;
    for (let i = slots.length; i < cfgMin; i++) {
      slots.push(base + stepMs * (i - slots.length + 1));
    }
  }
  const out: HistoryCandle[] = [];
  let price = baseOpen;
  const vol = 0.002 + (baseHigh - baseLow) / Math.max(1e-6, baseClose);
  const amp = 0.8 + vol * 0.9;
  const perVol = Math.max(5000, Math.round(totalVol / Math.max(1, slots.length)));
  let seed = 1337 + stepMs;
  function rnd(): number {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }
  for (let i = 0; i < slots.length; i++) {
    const t = slots[i];
    const driftBase = useDaily.length > 0
      ? Math.sin(i / Math.max(3, slots.length / useDaily.length)) * 0.3
      : (rnd() - 0.5);
    const o = price;
    const nextClose = o * (1 + (rnd() - 0.5) * amp * 0.008 + driftBase * 0.0015);
    const h = Math.max(o, nextClose) * (1 + rnd() * amp * 0.004);
    const l = Math.min(o, nextClose) * (1 - rnd() * amp * 0.004);
    const c = nextClose;
    price = c;
    out.push({
      time: t,
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.max(100, Math.round(perVol * (0.4 + rnd() * 1.2))),
    });
  }
  if (out.length > 0) {
    const lc = out[out.length - 1];
    const f = baseClose / lc.close;
    if (Number.isFinite(f) && f > 0.5 && f < 1.5) {
      out[out.length - 1] = {
        ...lc,
        open: Number((lc.open * f).toFixed(2)),
        high: Number((lc.high * f).toFixed(2)),
        low: Number((lc.low * f).toFixed(2)),
        close: Number(baseClose.toFixed(2)),
        volume: lc.volume,
      };
    }
  }
  return out;
}

const SYNTHETIC_PROVIDER = "SYNTHETIC_INTRADAY" as const;
export type HistoryResultProvider = QuoteProvider | typeof SYNTHETIC_PROVIDER;

export async function fetchHistoryWithFallback(
  symbol: string,
  period: HistoryPeriod,
): Promise<{ provider: HistoryResultProvider; candles: HistoryCandle[]; fallbackNote?: string }> {
  if (!symbol || !symbol.trim()) throw new Error("empty symbol");
  const s = symbol.trim().toUpperCase();
  const cfg = HISTORY_PERIOD_CONFIG[period];
  const minThreshold = Math.max(1, Math.floor(cfg.minExpected * 0.8));
  const chain: Array<[QuoteProvider, (s: string, p: HistoryPeriod) => Promise<HistoryCandle[]>]> = [];
  if (getFinnhubKey()) chain.push(["FINNHUB", finnhubHistory]);
  chain.push(["YAHOO_FINANCE", yahooFinanceHistory], ["NASDAQ_UNOFFICIAL", nasdaqHistory], ["STOOQ", stooqHistory]);

  const anchorPeriod: HistoryPeriod = cfg.calendarDays <= 5 ? "5D" : cfg.calendarDays <= 90 ? "1M" : "3M";
  let dailyAnchor: HistoryCandle | null = null;
  try {
    const tryNasdaqAnchor = await timeout(
      nasdaqHistory(s, anchorPeriod).catch(() => [] as HistoryCandle[]),
      3000,
    );
    if (tryNasdaqAnchor && tryNasdaqAnchor.length > 0) {
      dailyAnchor = tryNasdaqAnchor[tryNasdaqAnchor.length - 1];
    }
  } catch { /* ignore */ }
  const anchorClose = dailyAnchor?.close ?? null;
  const anchorHigh = dailyAnchor?.high ?? null;
  const anchorLow = dailyAnchor?.low ?? null;

  const collected: Array<{ name: QuoteProvider; candles: HistoryCandle[] }> = [];
  const errors: string[] = [];

  for (const [name, fn] of chain) {
    try {
      const t0 = Date.now();
      const raw = await fn(s, period);
      const sorted = raw && raw.length > 0 ? [...raw].sort((a, b) => a.time - b.time) : [];
      const dt = Date.now() - t0;
      if (sorted.length >= minThreshold) {
        const normalized = forceNormalizeLastCandle(sorted, { close: anchorClose, high: anchorHigh, low: anchorLow });
        const fbErrors = errors.length > 0 ? `快速源成功: ${name} (${dt}ms, n=${sorted.length}); 前置失败: ${errors.join("; ")}` : undefined;
        return { provider: name, candles: normalized, fallbackNote: fbErrors };
      }
      if (sorted.length > 0) collected.push({ name, candles: sorted });
    } catch (e: any) {
      errors.push(`${name}: ${e?.message || String(e || "failed")}`);
    }
  }

  const mergedAll = forceNormalizeLastCandle(
    mergeCandlesByTime(collected.map((x) => x.candles)),
    { close: anchorClose, high: anchorHigh, low: anchorLow },
  );
  const firstProvider = collected[0]?.name;
  if (!cfg.isIntraday && mergedAll.length >= Math.max(1, Math.floor(cfg.minExpected * 0.6)) && firstProvider) {
    return { provider: firstProvider, candles: mergedAll, fallbackNote: errors.length > 0 ? `合并补齐源: ${errors.join("; ")}` : undefined };
  }
  if (cfg.isIntraday && mergedAll.length >= cfg.minExpected && firstProvider) {
    return { provider: firstProvider, candles: mergedAll, fallbackNote: errors.length > 0 ? `合并补齐源: ${errors.join("; ")}` : undefined };
  }

  let dailySupport: HistoryCandle[] = [];
  try {
    const supportPeriod: HistoryPeriod = cfg.calendarDays <= 5 ? "5D" : cfg.calendarDays <= 30 ? "1M" : cfg.calendarDays <= 120 ? "3M" : "1Y";
    const supportChain: Array<[string, (s: string, p: HistoryPeriod) => Promise<HistoryCandle[]>]> = [];
    if (getFinnhubKey()) supportChain.push(["FINNHUB", finnhubHistory]);
    supportChain.push(["YAHOO_FINANCE", yahooFinanceHistory], ["NASDAQ_UNOFFICIAL", nasdaqHistory], ["STOOQ", stooqHistory]);
    const collectedSupport: HistoryCandle[][] = [];
    for (const [_nm, fn] of supportChain) {
      try {
        const r = await timeout(
          fn(s, supportPeriod).catch(() => [] as HistoryCandle[]),
          3000,
        );
        if (r?.length) {
          collectedSupport.push(r);
          if (r.length >= Math.max(10, Math.floor(cfg.minExpected * 0.5))) break;
        }
      } catch { /* ignore */ }
    }
    dailySupport = forceNormalizeLastCandle(mergeCandlesByTime(collectedSupport), { close: anchorClose, high: anchorHigh, low: anchorLow });
    if (dailySupport.length > 0 && !anchorClose) {
      dailyAnchor = dailySupport[dailySupport.length - 1];
    }
  } catch { /* ignore */ }

  if (cfg.isIntraday) {
    const dailyBase = dailySupport.length > 0 ? dailySupport : mergedAll;
    const syn0 = synthesizeIntradayCandles(period, dailyBase);
    const syn = forceNormalizeLastCandle(syn0, { close: anchorClose ?? dailyAnchor?.close ?? null, high: anchorHigh ?? dailyAnchor?.high ?? null, low: anchorLow ?? dailyAnchor?.low ?? null });
    if (syn.length >= Math.max(1, Math.ceil(cfg.minExpected * 0.5))) {
      return {
        provider: "SYNTHETIC_INTRADAY",
        candles: syn,
        fallbackNote: errors.length ? `合成基准: ${dailyBase.length} 根日线; 源错误: ${errors.join("; ")}` : undefined,
      };
    }
  }

  if (mergedAll.length > 0 && firstProvider) {
    return { provider: firstProvider, candles: forceNormalizeLastCandle(mergedAll, { close: anchorClose, high: anchorHigh, low: anchorLow }), fallbackNote: errors.join("; ") || undefined };
  }
  if (dailySupport.length > 0) {
    return { provider: firstProvider ?? "YAHOO_FINANCE", candles: forceNormalizeLastCandle(dailySupport, { close: anchorClose, high: anchorHigh, low: anchorLow }), fallbackNote: `宽周期回退 (${errors.join("; ")})` };
  }

  let refQuote: RealtimeQuote | null = null;
  try { refQuote = await timeout(fetchRealtimeWithFallback(s).catch(() => null), 3500) ?? null; } catch { /* ignore */ }
  if (refQuote) {
    const t = refQuote.updatedAt || Date.now();
    return {
      provider: refQuote.provider,
      candles: forceNormalizeLastCandle([{
        time: t,
        open: refQuote.open || refQuote.price,
        high: refQuote.high || refQuote.price,
        low: refQuote.low || refQuote.price,
        close: refQuote.price,
        volume: refQuote.volume || 0,
      }], { close: anchorClose ?? refQuote.price, high: anchorHigh ?? refQuote.high ?? refQuote.price, low: anchorLow ?? refQuote.low ?? refQuote.price }),
      fallbackNote: `K线全部源失败，退回实时行情单根参考: ${errors.join("; ")}`,
    };
  }

  const t = Date.now();
  const fallback = forceNormalizeLastCandle(
    [{ time: t, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
    { close: anchorClose ?? 1, high: anchorHigh ?? 1, low: anchorLow ?? 1 },
  );
  return {
    provider: firstProvider ?? "YAHOO_FINANCE",
    candles: fallback,
    fallbackNote: `ALL_PROVIDERS_FAILED: ${errors.join("; ")}`,
  };
}

