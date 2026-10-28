import type { RealtimeQuote } from "@/lib/quote/providers";
import { readSharedSetting, writeSharedSetting } from "./settingsStore";

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
    const raw = readSharedSetting(LIVE_QUOTE_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const next: LiveQuoteSettings = { ...DEFAULT_LIVE_QUOTE, ...(parsed || {}) };
    next.symbol = String(next.symbol || "").trim().toUpperCase();
    if (!next.symbol) next.symbol = DEFAULT_LIVE_QUOTE.symbol;
    const refreshSecRaw = Number(next.refreshSec) || 0;
    next.refreshSec = Math.max(1, Math.min(3600, refreshSecRaw)) || 8;
    // 仅在归一化结果与存储值不一致时回写，避免每次读取都触发落库。
    const normalized = JSON.stringify(next);
    if (normalized !== raw) {
      try {
        writeSharedSetting(LIVE_QUOTE_SETTINGS_KEY, normalized);
      } catch {}
    }
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
      symbol: String(next.symbol || "").trim().toUpperCase(),
      refreshSec: Math.max(1, Math.min(3600, Number(next.refreshSec) || 0)) || 8,
    };
    writeSharedSetting(LIVE_QUOTE_SETTINGS_KEY, JSON.stringify(clean));
    const ev = new CustomEvent("risk-control:quote-changed", { detail: clean });
    window.dispatchEvent(ev);
  } catch {}
}

export interface BrowserQuote {
  source: "LIVE" | "CACHE" | "STALE" | "OFFLINE";
  price: number;
  changePct: number;
  up: boolean;
  provider?: string;
  updatedAt: number;
  /** 行情失效标记：缓存超期或退回离线价时为 true，禁止进入关键风控计算。 */
  stale: boolean;
  data?: RealtimeQuote;
}

/**
 * 缓存行情有效期。超过该时长视为失效：可以继续展示（并明确标注），
 * 但不得作为批次价格 / 风控判定的输入。
 */
export const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;

/** 行情是否可用于关键计算：必须是实时行情，或仍在有效期内的缓存。 */
export function isQuoteUsableForRiskDecision(q: BrowserQuote | null | undefined): boolean {
  if (!q) return false;
  if (q.stale) return false;
  return q.source === "LIVE" || q.source === "CACHE";
}

/** 行情新鲜度（毫秒）；用于界面展示「多久之前」。 */
export function quoteAgeMs(q: BrowserQuote | null | undefined, nowMs: number = Date.now()): number | null {
  if (!q || !Number.isFinite(q.updatedAt) || q.updatedAt <= 0) return null;
  return Math.max(0, nowMs - q.updatedAt);
}

/** 行情来源中文标签，用于界面明确标注数据可信度。 */
export function quoteSourceLabel(q: BrowserQuote | null | undefined): string {
  if (!q) return "未知";
  switch (q.source) {
    case "LIVE":
      return "实时行情";
    case "CACHE":
      return "最近成功缓存";
    case "STALE":
      return "缓存已过期";
    case "OFFLINE":
      return "离线占位价";
    default:
      return "未知";
  }
}

function loadCached(symbol: string): BrowserQuote | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LAST_SUCCESSFUL_QUOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, BrowserQuote>;
    const entry = parsed?.[symbol.trim().toUpperCase()];
    if (!entry) return null;
    // 旧版本缓存可能没有 stale 字段，读取时按时间戳补齐，避免把超期缓存当实时价使用。
    const fresh = Date.now() - Number(entry.updatedAt || 0) <= QUOTE_CACHE_TTL_MS;
    return { ...entry, stale: !fresh };
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

function offlineQuote(reason: string): BrowserQuote {
  const fallback = { price: 41.88, prevClose: 41.73 };
  const chg = ((fallback.price - fallback.prevClose) / fallback.prevClose) * 100;
  // 离线价仅用于占位展示，一律标记失效；调用方不得据此做风控判定。
  void reason;
  return {
    source: "OFFLINE",
    price: fallback.price,
    changePct: chg,
    up: chg >= 0,
    updatedAt: Date.now(),
    stale: true,
  };
}

export async function fetchQuoteBrowser(symbol: string): Promise<BrowserQuote> {
  const s = (symbol || "").trim().toUpperCase();
  if (!s) return offlineQuote("empty-symbol");
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
    if (!Number.isFinite(Number(live.price)) || Number(live.price) <= 0) {
      throw new Error("invalid-price");
    }
    const q: BrowserQuote = {
      source: "LIVE",
      price: Number(live.price),
      changePct: Number(live.changePct),
      up: Number(live.changePct) >= 0,
      provider: live.provider,
      updatedAt: Date.now(),
      stale: false,
      data: live,
    };
    saveCached(s, q);
    return q;
  } catch {
    const cached = loadCached(s);
    if (cached) {
      // 缓存未超期沿用（标注为 CACHE）；超期则以 STALE 返回，界面提示失效、计算侧拦截。
      return { ...cached, source: cached.stale ? "STALE" : "CACHE", stale: cached.stale };
    }
    return offlineQuote("no-cache");
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
