import type { RealtimeQuote } from "@/lib/quote/providers";

export const LIVE_QUOTE_SETTINGS_KEY = "risk_control_live_quote_v2";
const LAST_SUCCESSFUL_QUOTE_KEY = "risk_control_live_quote_last_v2";

const NYSE_OFFSET_MIN = -4 * 60;

function getDynamicDSTOffsetMinNow(nowMs: number = Date.now()): number {
  const marchNthSunday = (year: number, nth: number) => {
    const d = new Date(Date.UTC(year, 2, 1));
    const sun0 = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 2, 1 + sun0 + (nth - 1) * 7, 7));
  };
  const novemberNthSunday = (year: number, nth: number) => {
    const d = new Date(Date.UTC(year, 10, 1));
    const sun0 = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 10, 1 + sun0 + (nth - 1) * 7, 6));
  };
  const year = new Date(nowMs).getUTCFullYear();
  const dstStart = marchNthSunday(year, 2);
  const dstEnd = novemberNthSunday(year, 1);
  const t = nowMs;
  const dstOn = t >= dstStart.getTime() && t < dstEnd.getTime();
  return dstOn ? -4 * 60 : -5 * 60;
}

export function getNYSEInfo(nowMs: number = Date.now()): {
  offsetMin: number;
  weekdayEN: string;
  weekdayCN: string;
  hour24: number;
  minute: number;
  ymd: string;
  isTradingDay: boolean;
  inRegularSession: boolean;
  inPreMarket: boolean;
  inAfterHours: boolean;
  marketState: "PRE" | "REGULAR" | "AFTER" | "CLOSED";
  shouldBreathe: boolean;
  shouldRefreshReal: boolean;
  nextRefreshSec: number;
} {
  const offsetMin = getDynamicDSTOffsetMinNow(nowMs);
  const d = new Date(nowMs + offsetMin * 60_000);
  const wd = d.getUTCDay();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const mins = h * 60 + m;
  const isTradingDay = wd >= 1 && wd <= 5;
  const inRegular = isTradingDay && mins >= 9 * 60 + 30 && mins <= 16 * 60;
  const inPre = isTradingDay && mins >= 4 * 60 && mins < 9 * 60 + 30;
  const inAfter = isTradingDay && mins > 16 * 60 && mins <= 20 * 60;
  let state: "PRE" | "REGULAR" | "AFTER" | "CLOSED" = "CLOSED";
  if (inRegular) state = "REGULAR";
  else if (inPre) state = "PRE";
  else if (inAfter) state = "AFTER";
  const weekdaysCN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekdaysEN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    offsetMin,
    weekdayEN: weekdaysEN[wd],
    weekdayCN: weekdaysCN[wd],
    hour24: h,
    minute: m,
    ymd: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    isTradingDay,
    inRegularSession: inRegular,
    inPreMarket: inPre,
    inAfterHours: inAfter,
    marketState: state,
    shouldBreathe: inRegular || inPre || inAfter,
    shouldRefreshReal: inRegular || inPre || inAfter,
    nextRefreshSec: inRegular ? 8 : inPre || inAfter ? 30 : 600,
  };
}

export interface LiveQuoteSettings {
  symbol: string;
  refreshSec: number;
  showOnTopBar: boolean;
  colorUp: string;
  colorDown: string;
}

export const DEFAULT_LIVE_QUOTE: LiveQuoteSettings = {
  symbol: "XMAX",
  refreshSec: 8,
  showOnTopBar: true,
  colorUp: "text-success",
  colorDown: "text-danger",
};

export function getLiveQuoteSettings(): LiveQuoteSettings {
  try {
    if (typeof window === "undefined") return { ...DEFAULT_LIVE_QUOTE };
    const raw = localStorage.getItem(LIVE_QUOTE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_LIVE_QUOTE };
    const parsed = JSON.parse(raw);
    const next: LiveQuoteSettings = { ...DEFAULT_LIVE_QUOTE, ...(parsed || {}) };
    next.symbol = String(next.symbol || DEFAULT_LIVE_QUOTE.symbol).trim().toUpperCase() || "XMAX";
    const refreshSecRaw = Number(next.refreshSec) || 0;
    next.refreshSec = Math.max(1, Math.min(3600, refreshSecRaw)) || 8;
    return next;
  } catch {
    return { ...DEFAULT_LIVE_QUOTE };
  }
}

export function setLiveQuoteSettings(next: LiveQuoteSettings): void {
  try {
    const clean: LiveQuoteSettings = {
      ...DEFAULT_LIVE_QUOTE,
      ...next,
      symbol: String(next.symbol || DEFAULT_LIVE_QUOTE.symbol).trim().toUpperCase() || "XMAX",
      refreshSec: Math.max(1, Math.min(3600, Number(next.refreshSec) || 0)) || 8,
    };
    localStorage.setItem(LIVE_QUOTE_SETTINGS_KEY, JSON.stringify(clean));
    const ev = new CustomEvent("risk-control:quote-changed", { detail: clean });
    window.dispatchEvent(ev);
  } catch {}
}

export interface BrowserQuote {
  source: "LIVE" | "CACHE" | "OFFLINE";
  price: number;
  changePct: number;
  up: boolean;
  provider?: string;
  updatedAt: number;
  data?: RealtimeQuote;
}

const FALLBACK_PRICES: Record<string, { price: number; prevClose: number }> = {
  XMAX: { price: 41.88, prevClose: 41.73 },
};

function loadCached(symbol: string): BrowserQuote | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LAST_SUCCESSFUL_QUOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, BrowserQuote>;
    const entry = parsed?.[symbol.trim().toUpperCase()];
    if (!entry) return null;
    return entry;
  } catch {
    return null;
  }
}

function saveCached(symbol: string, q: BrowserQuote): void {
  try {
    if (typeof window === "undefined") return;
    const key = LAST_SUCCESSFUL_QUOTE_KEY;
    const raw = localStorage.getItem(key);
    const map: Record<string, BrowserQuote> = raw ? (JSON.parse(raw) as Record<string, BrowserQuote>) : {};
    map[symbol.trim().toUpperCase()] = q;
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

export async function fetchQuoteBrowser(symbol: string): Promise<BrowserQuote> {
  const s = (symbol || "").trim().toUpperCase() || "XMAX";
  try {
    const res = await fetch(`/api/quote/realtime?symbol=${encodeURIComponent(s)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()) as RealtimeQuote | { error: string };
    if (!d || (d as { error?: string }).error) {
      throw new Error((d as { error?: string }).error || "empty");
    }
    const live = d as RealtimeQuote;
    const q: BrowserQuote = {
      source: "LIVE",
      price: Number(live.price),
      changePct: Number(live.changePct),
      up: Number(live.changePct) >= 0,
      provider: live.provider,
      updatedAt: Date.now(),
      data: live,
    };
    saveCached(s, q);
    return q;
  } catch {
    const cached = loadCached(s);
    if (cached) {
      return { ...cached, source: "CACHE" };
    }
    const fallback = FALLBACK_PRICES[s] ?? { price: 41.88, prevClose: 41.73 };
    const chg = ((fallback.price - fallback.prevClose) / fallback.prevClose) * 100;
    return {
      source: "OFFLINE",
      price: fallback.price,
      changePct: chg,
      up: chg >= 0,
      updatedAt: Date.now(),
    };
  }
}

export function previewTickBreathe(
  basePrice: number,
  baseChgPct: number,
): { price: number; chgPct: number; up: boolean } {
  const p = Math.max(0.01, Number(basePrice) || 0.01);
  const c = Number(baseChgPct || 0);
  return { price: p, chgPct: c, up: c >= 0 };
}
