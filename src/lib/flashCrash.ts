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
import {
  DEFAULT_FLASH_CRASH_THRESHOLDS,
  evaluateFlashCrash,
  sanitizeFlashCrashThresholds,
  type FlashCrashDetail,
  type FlashCrashStatus,
  type FlashCrashThreshold,
  type PriceSnapshot,
} from "./flashCrashCore";

export type {
  FlashCrashDetail,
  FlashCrashStatus,
  FlashCrashThreshold,
  PriceSnapshot,
};
export { DEFAULT_FLASH_CRASH_THRESHOLDS };

const FLASH_CRASH_LS_KEY = "risk_control_flash_crash_thresholds";
const PRICE_HISTORY_LS_KEY = "risk_control_price_history";
/** 历史快照保留时长（毫秒），默认 2 小时 */
const HISTORY_TTL_MS = 2 * 60 * 60 * 1000;
/** 单批次最多保留快照数（防止内存膨胀） */
const MAX_SNAPSHOTS_PER_BATCH = 2000;

/**
 * 获取已配置的闪跌阈值（机构级共享配置）
 */
export function getFlashCrashThresholds(): FlashCrashThreshold[] {
  if (typeof window === "undefined") return DEFAULT_FLASH_CRASH_THRESHOLDS;
  try {
    const raw = readSharedSetting(FLASH_CRASH_LS_KEY);
    if (!raw) return DEFAULT_FLASH_CRASH_THRESHOLDS;
    return sanitizeFlashCrashThresholds(JSON.parse(raw));
  } catch {
    return DEFAULT_FLASH_CRASH_THRESHOLDS;
  }
}

/**
 * 保存闪跌阈值配置（机构级共享配置）
 */
export function saveFlashCrashThresholds(thresholds: FlashCrashThreshold[]): void {
  if (typeof window === "undefined") return;
  writeSharedSetting(FLASH_CRASH_LS_KEY, JSON.stringify(sanitizeFlashCrashThresholds(thresholds)));
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
 * 检测闪跌：回溯指定时间窗口，计算从窗口内最高价到当前价的跌幅。
 * 判定逻辑与服务端监控任务共用 evaluateFlashCrash，保证两端口径一致。
 * @param batchId 批次 ID
 * @param currentPrice 当前股价
 * @param thresholds 阈值列表，默认读取共享配置
 */
export function detectFlashCrash(
  batchId: string,
  currentPrice: number,
  thresholds: FlashCrashThreshold[] = getFlashCrashThresholds()
): FlashCrashStatus {
  return evaluateFlashCrash(getPriceHistory(batchId), currentPrice, thresholds, Date.now());
}
