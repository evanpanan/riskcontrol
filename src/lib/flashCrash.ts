/**
 * Phase 6.1 & 6.2: 盘中闪跌检测
 *
 * 在 8 秒行情刷新基础上，检测「N 分钟内跌幅超 X%」。
 * 即使未到击穿线也触发临时预警（与 riskLevel 并行）。
 *
 * 默认阈值（D4 建议方案）：
 *   - 5 分钟内跌幅 ≥ 10%
 *   - 15 分钟内跌幅 ≥ 15%
 *
 * 实现方式：维护每个批次的价格历史快照（环形缓冲），
 * 每次刷新行情时调用 recordPriceSnapshot 追加，
 * 检测时回溯指定时间窗口内的最低价/最高价计算跌幅。
 */

import { readSharedSetting, writeSharedSetting } from "./settingsStore";

/** 单条价格快照 */
export interface PriceSnapshot {
  /** 毫秒时间戳 */
  ts: number;
  /** 当前股价 */
  price: number;
}

/** 闪跌阈值配置 */
export interface FlashCrashThreshold {
  /** 时间窗口（分钟） */
  windowMinutes: number;
  /** 跌幅阈值（百分比，如 10 表示 10%） */
  dropPercent: number;
  /** 是否启用 */
  enabled: boolean;
}

/** 闪跌检测结果 */
export interface FlashCrashStatus {
  /** 是否触发闪跌预警 */
  triggered: boolean;
  /** 触发的阈值详情 */
  triggeredThresholds: Array<{
    windowMinutes: number;
    dropPercent: number;
    /** 实际窗口内跌幅% */
    actualDropPercent: number;
    /** 窗口内最高价 */
    highPrice: number;
    /** 当前价 */
    currentPrice: number;
  }>;
  /** 所有阈值的检测明细 */
  details: Array<{
    windowMinutes: number;
    dropPercent: number;
    actualDropPercent: number;
    highPrice: number;
    currentPrice: number;
    triggered: boolean;
  }>;
}

const FLASH_CRASH_LS_KEY = "risk_control_flash_crash_thresholds";
const PRICE_HISTORY_LS_KEY = "risk_control_price_history";
/** 历史快照保留时长（毫秒），默认 2 小时 */
const HISTORY_TTL_MS = 2 * 60 * 60 * 1000;
/** 单批次最多保留快照数（防止内存膨胀） */
const MAX_SNAPSHOTS_PER_BATCH = 2000;

/** 默认闪跌阈值 */
export const DEFAULT_FLASH_CRASH_THRESHOLDS: FlashCrashThreshold[] = [
  { windowMinutes: 5, dropPercent: 10, enabled: true },
  { windowMinutes: 15, dropPercent: 15, enabled: true },
];

/**
 * 获取已配置的闪跌阈值（机构级共享配置）
 */
export function getFlashCrashThresholds(): FlashCrashThreshold[] {
  if (typeof window === "undefined") return DEFAULT_FLASH_CRASH_THRESHOLDS;
  try {
    const raw = readSharedSetting(FLASH_CRASH_LS_KEY);
    if (!raw) return DEFAULT_FLASH_CRASH_THRESHOLDS;
    const parsed = JSON.parse(raw) as FlashCrashThreshold[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_FLASH_CRASH_THRESHOLDS;
    return parsed;
  } catch {
    return DEFAULT_FLASH_CRASH_THRESHOLDS;
  }
}

/**
 * 保存闪跌阈值配置（机构级共享配置）
 */
export function saveFlashCrashThresholds(thresholds: FlashCrashThreshold[]): void {
  if (typeof window === "undefined") return;
  // 校验
  const valid = thresholds
    .filter((t) => t.windowMinutes > 0 && t.dropPercent > 0 && t.dropPercent <= 100)
    .sort((a, b) => a.windowMinutes - b.windowMinutes);
  writeSharedSetting(FLASH_CRASH_LS_KEY, JSON.stringify(valid));
}

/**
 * 重置为默认阈值
 */
export function resetFlashCrashThresholds(): FlashCrashThreshold[] {
  if (typeof window !== "undefined") {
    writeSharedSetting(FLASH_CRASH_LS_KEY, null);
  }
  return DEFAULT_FLASH_CRASH_THRESHOLDS;
}

/** 从 localStorage 读取所有批次的价格历史 */
function loadHistory(): Record<string, PriceSnapshot[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PRICE_HISTORY_LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PriceSnapshot[]>;
  } catch {
    return {};
  }
}

/** 写入所有批次的价格历史到 localStorage */
function saveHistory(history: Record<string, PriceSnapshot[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRICE_HISTORY_LS_KEY, JSON.stringify(history));
  } catch {
    // 容量超限：截断到最近 1 小时
    const now = Date.now();
    const trimmed: Record<string, PriceSnapshot[]> = {};
    for (const [k, v] of Object.entries(history)) {
      trimmed[k] = v.filter((s) => now - s.ts < 60 * 60 * 1000);
    }
    try {
      window.localStorage.setItem(PRICE_HISTORY_LS_KEY, JSON.stringify(trimmed));
    } catch {
      // 最终兜底：清空
      window.localStorage.removeItem(PRICE_HISTORY_LS_KEY);
    }
  }
}

/**
 * 记录一次价格快照（每次行情刷新时调用）
 * @param batchId 批次 ID
 * @param price 当前股价
 * @param ts 时间戳（毫秒），默认 Date.now()
 */
export function recordPriceSnapshot(batchId: string, price: number, ts: number = Date.now()): void {
  if (!batchId || price <= 0) return;
  const history = loadHistory();
  const list = history[batchId] ?? [];
  // 避免重复记录（同一秒内相同价格）
  const last = list[list.length - 1];
  if (last && ts - last.ts < 1000 && Math.abs(last.price - price) < 1e-6) return;
  list.push({ ts, price });
  // 裁剪：超出 TTL 或超过最大数量
  const cutoff = ts - HISTORY_TTL_MS;
  const trimmed = list.filter((s) => s.ts >= cutoff).slice(-MAX_SNAPSHOTS_PER_BATCH);
  history[batchId] = trimmed;
  saveHistory(history);
}

/**
 * 获取某批次的价格历史快照
 */
export function getPriceHistory(batchId: string): PriceSnapshot[] {
  const history = loadHistory();
  return history[batchId] ?? [];
}

/**
 * 清空所有价格历史（测试用）
 */
export function clearPriceHistory(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PRICE_HISTORY_LS_KEY);
  }
}

/**
 * 检测闪跌：回溯指定时间窗口，计算从窗口内最高价到当前价的跌幅
 * @param batchId 批次 ID
 * @param currentPrice 当前股价
 * @param thresholds 阈值列表，默认读取 localStorage
 */
export function detectFlashCrash(
  batchId: string,
  currentPrice: number,
  thresholds: FlashCrashThreshold[] = getFlashCrashThresholds()
): FlashCrashStatus {
  const history = getPriceHistory(batchId);
  const now = Date.now();
  const details: FlashCrashStatus["details"] = [];
  const triggeredThresholds: FlashCrashStatus["triggeredThresholds"] = [];

  for (const t of thresholds) {
    if (!t.enabled) continue;
    const windowMs = t.windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;
    // 窗口内的快照（含当前价参与比较）
    const inWindow = history.filter((s) => s.ts >= windowStart);
    if (inWindow.length === 0) {
      details.push({
        windowMinutes: t.windowMinutes,
        dropPercent: t.dropPercent,
        actualDropPercent: 0,
        highPrice: currentPrice,
        currentPrice,
        triggered: false,
      });
      continue;
    }
    // 窗口内最高价
    const highPrice = Math.max(...inWindow.map((s) => s.price), currentPrice);
    const actualDropPercent =
      highPrice > 0 ? ((highPrice - currentPrice) / highPrice) * 100 : 0;
    const triggered = actualDropPercent + Number.EPSILON >= t.dropPercent - 1e-8;
    details.push({
      windowMinutes: t.windowMinutes,
      dropPercent: t.dropPercent,
      actualDropPercent,
      highPrice,
      currentPrice,
      triggered,
    });
    if (triggered) {
      triggeredThresholds.push({
        windowMinutes: t.windowMinutes,
        dropPercent: t.dropPercent,
        actualDropPercent,
        highPrice,
        currentPrice,
      });
    }
  }

  return {
    triggered: triggeredThresholds.length > 0,
    triggeredThresholds,
    details,
  };
}
