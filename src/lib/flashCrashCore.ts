/**
 * 闪跌检测核心算法（纯函数，不依赖 window / localStorage）。
 *
 * 浏览器端（src/lib/flashCrash.ts）与服务端监控任务（src/lib/server/flashMonitor.ts）
 * 共用同一套判定逻辑，避免两端口径漂移：服务端负责持续推进采集与告警，
 * 浏览器端仅用于界面即时展示。
 */

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

/** 单档阈值的检测明细 */
export interface FlashCrashDetail {
  windowMinutes: number;
  dropPercent: number;
  /** 实际窗口内跌幅% */
  actualDropPercent: number;
  /** 窗口内最高价 */
  highPrice: number;
  /** 当前价 */
  currentPrice: number;
  triggered: boolean;
}

/** 闪跌检测结果 */
export interface FlashCrashStatus {
  /** 是否触发闪跌预警 */
  triggered: boolean;
  /** 触发的阈值详情 */
  triggeredThresholds: FlashCrashDetail[];
  /** 所有阈值的检测明细 */
  details: FlashCrashDetail[];
}

/** 默认闪跌阈值（D4 建议方案：5 分钟 -10%，15 分钟 -15%） */
export const DEFAULT_FLASH_CRASH_THRESHOLDS: FlashCrashThreshold[] = [
  { windowMinutes: 5, dropPercent: 10, enabled: true },
  { windowMinutes: 15, dropPercent: 15, enabled: true },
];

/** 清洗阈值配置：仅保留合法项，按窗口升序，避免非法配置进入关键计算。 */
export function sanitizeFlashCrashThresholds(input: unknown): FlashCrashThreshold[] {
  if (!Array.isArray(input)) return DEFAULT_FLASH_CRASH_THRESHOLDS;
  const valid = input
    .filter(
      (t): t is FlashCrashThreshold =>
        !!t &&
        typeof t === 'object' &&
        Number.isFinite((t as FlashCrashThreshold).windowMinutes) &&
        (t as FlashCrashThreshold).windowMinutes > 0 &&
        Number.isFinite((t as FlashCrashThreshold).dropPercent) &&
        (t as FlashCrashThreshold).dropPercent > 0 &&
        (t as FlashCrashThreshold).dropPercent <= 100
    )
    .map((t) => ({
      windowMinutes: Math.trunc(t.windowMinutes),
      dropPercent: t.dropPercent,
      enabled: t.enabled !== false,
    }))
    .sort((a, b) => a.windowMinutes - b.windowMinutes);
  return valid.length > 0 ? valid : DEFAULT_FLASH_CRASH_THRESHOLDS;
}

/**
 * 检测闪跌：回溯指定时间窗口，计算从窗口内最高价到当前价的跌幅。
 * @param points 该批次的价格快照（无序亦可，内部按窗口过滤）
 * @param currentPrice 当前价
 * @param thresholds 阈值列表
 * @param nowMs 判定基准时间（毫秒）
 */
export function evaluateFlashCrash(
  points: PriceSnapshot[],
  currentPrice: number,
  thresholds: FlashCrashThreshold[],
  nowMs: number = Date.now()
): FlashCrashStatus {
  const details: FlashCrashDetail[] = [];
  const triggeredThresholds: FlashCrashDetail[] = [];

  for (const t of thresholds) {
    if (!t.enabled) continue;
    const windowStart = nowMs - t.windowMinutes * 60 * 1000;
    const inWindow = points.filter((s) => s.ts >= windowStart);
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
    const highPrice = Math.max(...inWindow.map((s) => s.price), currentPrice);
    const actualDropPercent = highPrice > 0 ? ((highPrice - currentPrice) / highPrice) * 100 : 0;
    const triggered = actualDropPercent + Number.EPSILON >= t.dropPercent - 1e-8;
    const detail: FlashCrashDetail = {
      windowMinutes: t.windowMinutes,
      dropPercent: t.dropPercent,
      actualDropPercent,
      highPrice,
      currentPrice,
      triggered,
    };
    details.push(detail);
    if (triggered) triggeredThresholds.push(detail);
  }

  return { triggered: triggeredThresholds.length > 0, triggeredThresholds, details };
}
