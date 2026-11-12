/**
 * 服务端闪跌监控。
 *
 * 背景：原实现把价格快照与闪跌检测放在批次详情页面里（localStorage），
 * 页面未打开、浏览器休眠或换设备时监控即中断。风控告警不能依赖某个浏览器窗口常开，
 * 因此这里由服务端任务持续采集行情、落库价格历史、检测闪跌并投递通知。
 *
 * 设计要点：
 * - 行情不可用时绝不使用缓存价或离线价参与判定，直接跳过本轮该标的。
 * - 价格历史落库（QuotePricePoint），支持停机恢复后仍能回溯窗口。
 * - 告警按 (批次, 阈值, 冷却桶) 去重（FlashCrashAlert.dedupeKey 唯一），避免刷屏；
 *   投递失败的告警保留 delivered=false，由后续轮次重试。
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { fetchRealtimeWithFallback, type RealtimeQuote } from '../quote/providers';
import {
  evaluateFlashCrash,
  sanitizeFlashCrashThresholds,
  type FlashCrashThreshold,
} from '../flashCrashCore';
import { dispatchNotification, retryPendingNotifications } from './notificationDispatch';

const CONFIG_KIND = 'config';
const FLASH_THRESHOLD_KEY = 'risk_control_flash_crash_thresholds';
const RECIPIENTS_KEY = 'risk_control_recipients';

/** 同一批次同一阈值的告警冷却时间：冷却期内只告警一次。 */
export const DEFAULT_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
/** 价格历史保留时长，需覆盖最长检测窗口。 */
export const DEFAULT_HISTORY_MS = 2 * 60 * 60 * 1000;
/** 价格点保留时长（清理用）。 */
const POINT_RETENTION_MS = 6 * 60 * 60 * 1000;

export interface MonitorCycleOptions {
  now?: Date;
  env?: Record<string, string | undefined>;
  cooldownMs?: number;
  historyMs?: number;
}

export interface MonitorCycleResult {
  batches: number;
  symbols: number;
  quotesFetched: number;
  quoteFailures: number;
  snapshotsWritten: number;
  notificationRetries?: number;
  alertsQueued?: number;
  alertsCreated: number;
  alertsDelivered: number;
  alertsPendingRetry: number;
  notes: string[];
}

interface MonitoredBatch {
  batchId: string;
  symbol: string;
  batchNumber: string;
  stockName?: string;
}

/** 读取 { kind: 'config', key } 记录的字符串值（共享配置统一存放格式）。 */
async function readConfigValue(key: string): Promise<string | null> {
  const rec = await prisma.workspaceRecord.findUnique({
    where: { kind_key: { kind: CONFIG_KIND, key } },
    select: { payload: true },
  });
  const value = (rec?.payload as { value?: unknown } | null)?.value;
  return typeof value === 'string' ? value : null;
}

/** 载入启用的闪跌阈值（机构级共享配置；缺失或非法时回退默认值）。 */
export async function loadFlashCrashThresholds(): Promise<FlashCrashThreshold[]> {
  const raw = await readConfigValue(FLASH_THRESHOLD_KEY);
  if (!raw) return sanitizeFlashCrashThresholds(null);
  try {
    return sanitizeFlashCrashThresholds(JSON.parse(raw));
  } catch {
    return sanitizeFlashCrashThresholds(null);
  }
}

interface RecipientTargets {
  emails: string[];
  telegrams: string[];
}

/** 载入启用的收件人；示例地址与占位地址一律剔除，避免告警发到无主邮箱。 */
export async function loadRecipientTargets(): Promise<RecipientTargets> {
  const raw = await readConfigValue(RECIPIENTS_KEY);
  const empty: RecipientTargets = { emails: [], telegrams: [] };
  if (!raw) return empty;
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return empty;
    const emails = new Set<string>();
    const telegrams = new Set<string>();
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.enabled === false) continue;
      const email = typeof rec.email === 'string' ? rec.email.trim() : '';
      if (email.includes('@') && !/@(institution\.com|bd-team\.com|example\.com)$/i.test(email)) emails.add(email);
      const wa = typeof rec.telegram === 'string' ? rec.telegram.trim() : '';
      if (/^\+[1-9]\d{7,14}$/.test(wa)) telegrams.add(wa);
    }
    return { emails: [...emails].slice(0, 20), telegrams: [...telegrams].slice(0, 20) };
  } catch {
    return empty;
  }
}

/** 载入需要监控的批次（来自服务端账本，已结束/已清算的批次不再监控）。 */
export async function loadMonitoredBatches(): Promise<MonitoredBatch[]> {
  const rows = await prisma.workspaceRecord.findMany({
    where: { kind: 'ledger' },
    select: { key: true, payload: true },
  });
  const out: MonitoredBatch[] = [];
  for (const row of rows) {
    const batch = (row.payload as { batch?: Record<string, unknown> } | null)?.batch;
    if (!batch) continue;
    const status = typeof batch.status === 'string' ? batch.status.toUpperCase() : '';
    if (status === 'CLOSED' || status === 'LIQUIDATED') continue;
    const symbol = typeof batch.stockSymbol === 'string' ? batch.stockSymbol.trim().toUpperCase() : '';
    if (!symbol) continue;
    out.push({
      batchId: typeof batch.id === 'string' && batch.id ? batch.id : row.key,
      symbol,
      batchNumber: typeof batch.batchNumber === 'string' && batch.batchNumber ? batch.batchNumber : row.key,
      stockName: typeof batch.stockName === 'string' ? batch.stockName : undefined,
    });
  }
  return out;
}

interface AlertCandidate {
  batch: MonitoredBatch;
  windowMinutes: number;
  dropPercent: number;
  actualDropPercent: number;
  highPrice: number;
  currentPrice: number;
  dedupeKey: string;
}

/**
 * 执行一轮监控：采集行情 → 落库快照 → 检测闪跌 → 落库告警 → 投递通知。
 * 幂等：同一冷却桶内重复触发只会落一条告警；投递失败保留待重试。
 */
export async function runFlashMonitorCycle(opts: MonitorCycleOptions = {}): Promise<MonitorCycleResult> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const cooldownMs = opts.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS;
  const historyMs = opts.historyMs ?? DEFAULT_HISTORY_MS;

  const result: MonitorCycleResult = {
    batches: 0,
    symbols: 0,
    quotesFetched: 0,
    quoteFailures: 0,
    snapshotsWritten: 0,
    alertsCreated: 0,
    alertsDelivered: 0,
    alertsPendingRetry: 0,
    notes: [],
  };

  result.notificationRetries = await retryPendingNotifications(env);
  const [batches, thresholds, recipients] = await Promise.all([
    loadMonitoredBatches(),
    loadFlashCrashThresholds(),
    loadRecipientTargets(),
  ]);
  result.batches = batches.length;
  if (batches.length === 0) {
    result.notes.push('没有需要监控的在运行批次。');

  }

  const activeThresholds = thresholds.filter((t) => t.enabled);
  if (activeThresholds.length === 0) {
    result.notes.push('闪跌阈值已全部停用，跳过检测。');

  }

  const symbols = [...new Set(batches.map((b) => b.symbol))];
  result.symbols = symbols.length;

  // 1) 采集行情：失败即跳过该标的，绝不使用缓存价/离线价参与风控判定。
  const quoteBySymbol = new Map<string, RealtimeQuote>();
  for (const symbol of activeThresholds.length ? symbols : []) {
    try {
      const q = await fetchRealtimeWithFallback(symbol, (quote) => {
        const age = Date.now() - quote.updatedAt;
        if (!Number.isFinite(age) || quote.updatedAt <= 0 || age > 120_000 || age < -30_000) {
          throw new Error('行情时间缺失、过期或超前，暂停该标的风控检测');
        }
      });
      if (!q || !Number.isFinite(q.price) || q.price <= 0) throw new Error('行情价格无效');
      quoteBySymbol.set(symbol, q);
      result.quotesFetched += 1;
    } catch (err) {
      result.quoteFailures += 1;
      result.notes.push(`行情不可用，本轮跳过（不使用缓存/离线价）：${symbol} —— ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2) 落库价格快照。
  const pointRows: Prisma.QuotePricePointCreateManyInput[] = [];
  const monitoring: Array<{ batch: MonitoredBatch; price: number }> = [];
  for (const batch of batches) {
    const q = quoteBySymbol.get(batch.symbol);
    if (!q) continue;
    const asOfMs = q.updatedAt > 0 ? Math.min(q.updatedAt, now.getTime()) : now.getTime();
    pointRows.push({
      batchId: batch.batchId,
      symbol: batch.symbol,
      price: q.price,
      source: q.provider,
      asOf: new Date(asOfMs),
    });
    monitoring.push({ batch, price: q.price });
  }
  if (pointRows.length > 0) {
    await prisma.quotePricePoint.createMany({ data: pointRows });
    result.snapshotsWritten = pointRows.length;
  }

  // 3) 载入窗口内历史并检测闪跌。
  const historyRows = await prisma.quotePricePoint.findMany({
    where: {
      batchId: { in: batches.map((b) => b.batchId) },
      asOf: { gte: new Date(now.getTime() - historyMs) },
    },
    select: { batchId: true, price: true, asOf: true },
    orderBy: { asOf: 'asc' },
  });
  const historyByBatch = new Map<string, Array<{ ts: number; price: number }>>();
  for (const row of historyRows) {
    const list = historyByBatch.get(row.batchId) ?? [];
    list.push({ ts: row.asOf.getTime(), price: row.price });
    historyByBatch.set(row.batchId, list);
  }

  const bucket = Math.floor(now.getTime() / cooldownMs);
  const candidates: AlertCandidate[] = [];
  for (const { batch, price } of monitoring) {
    const status = evaluateFlashCrash(historyByBatch.get(batch.batchId) ?? [], price, activeThresholds, now.getTime());
    for (const detail of status.triggeredThresholds) {
      candidates.push({
        batch,
        windowMinutes: detail.windowMinutes,
        dropPercent: detail.dropPercent,
        actualDropPercent: detail.actualDropPercent,
        highPrice: detail.highPrice,
        currentPrice: detail.currentPrice,
        dedupeKey: `${batch.batchId}|${detail.windowMinutes}|${bucket}`,
      });
    }
  }

  if (candidates.length > 0) {
    const created = await prisma.flashCrashAlert.createMany({
      data: candidates.map((c) => ({
        batchId: c.batch.batchId,
        symbol: c.batch.symbol,
        windowMinutes: c.windowMinutes,
        dropPercent: c.dropPercent,
        actualDropPercent: c.actualDropPercent,
        highPrice: c.highPrice,
        currentPrice: c.currentPrice,
        dedupeKey: c.dedupeKey,
      })),
      skipDuplicates: true,
    });
    result.alertsCreated = created.count;
  }

  // 4) 投递通知：包含本轮新告警与历史投递失败的重试。
  const batchById = new Map(batches.map((b) => [b.batchId, b]));
  const pending = await prisma.flashCrashAlert.findMany({
    where: {
      delivered: false,
      nextAttemptAt: { lte: now },
      OR: [{ deliveryLeaseUntil: null }, { deliveryLeaseUntil: { lte: now } }],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: 50,
  });

  for (const alert of pending) {
    const token = randomUUID();
    const leaseNow = new Date();
    const claimed = await prisma.flashCrashAlert.updateMany({
      where: { id: alert.id, delivered: false, OR: [
        { deliveryLeaseUntil: null }, { deliveryLeaseUntil: { lte: leaseNow } },
      ] },
      data: { deliveryLeaseToken: token, deliveryLeaseUntil: new Date(leaseNow.getTime() + 10 * 60_000) },
    });
    if (!claimed.count) continue;
    const batch = batchById.get(alert.batchId) ?? {
      batchId: alert.batchId,
      symbol: alert.symbol,
      batchNumber: alert.batchId,
    };
    const outcome = await deliverFlashCrashAlert(alert, batch, recipients, env, token);
    if (outcome.delivered) {
      await prisma.flashCrashAlert.updateMany({
        where: { id: alert.id, deliveryLeaseToken: token },
        data: { delivered: true, deliveryNote: outcome.note, deliveryLeaseUntil: null, deliveryLeaseToken: null, nextAttemptAt: new Date(Date.now() + 60_000) },
      });
      result.alertsQueued = (result.alertsQueued ?? 0) + 1;
      if (outcome.accepted) result.alertsDelivered += 1;
    } else {
      await prisma.flashCrashAlert.updateMany({
        where: { id: alert.id, deliveryLeaseToken: token },
        data: { deliveryNote: outcome.note, deliveryLeaseUntil: null, deliveryLeaseToken: null, nextAttemptAt: new Date(Date.now() + 60_000) },
      });
      result.alertsPendingRetry += 1;
    }
    // Per-channel results are persisted by the shared dispatch worker.
  }

  // 5) 清理过期价格点，避免表无限增长。
  try {
    await prisma.quotePricePoint.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - POINT_RETENTION_MS) } },
    });
  } catch {
    /* 清理失败不影响监控主流程 */
  }

  return result;
}

interface DeliveryOutcome {
  delivered: boolean;
  note: string;
  accepted?: boolean;
}

/** 按渠道投递一条闪跌告警；任一渠道未就绪/失败即视为未完成，等待重试。 */
export async function deliverFlashCrashAlert(
  alert: { id: string; sentChannels: string[]; batchId: string; symbol: string; windowMinutes: number; dropPercent: number; actualDropPercent: number; highPrice: number; currentPrice: number },
  batch: MonitoredBatch,
  recipients: RecipientTargets,
  env: Record<string, string | undefined>,
  leaseToken: string
): Promise<DeliveryOutcome> {
  const title = `【闪跌预警】${batch.batchNumber}（${alert.symbol}）${alert.windowMinutes} 分钟内跌幅 ${alert.actualDropPercent.toFixed(2)}%`;
  const message = [
    `批次 ${batch.batchNumber}（${alert.symbol}）触发闪跌预警。`,
    `检测窗口：${alert.windowMinutes} 分钟，阈值 ${alert.dropPercent.toFixed(2)}%，实际跌幅 ${alert.actualDropPercent.toFixed(2)}%。`,
    `窗口最高价 $${alert.highPrice.toFixed(2)}，当前价 $${alert.currentPrice.toFixed(2)}。`,
    `请立即核查行情与仓位。`,
  ].join('\n');

  const payload = { type: 'WARNING', severity: 'CRITICAL', title, message,
    batchId: alert.batchId, batchNumber: batch.batchNumber, stockSymbol: alert.symbol,
    details: { windowMinutes: alert.windowMinutes, actualDropPercent: alert.actualDropPercent },
  };
  const dispatched = await dispatchNotification(payload, env, alert.sentChannels);
  return { delivered: true, accepted: dispatched.success, note: `已交由统一通知队列处理：${dispatched.summary}` };
}
