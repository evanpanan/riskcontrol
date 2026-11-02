/**
 * 服务端闪跌监控常驻任务。
 *
 * 独立于浏览器运行：容器/进程启动后按固定间隔采集行情、检测闪跌并投递通知。
 * 用法：
 *   npx tsx scripts/flash-monitor.ts            # 常驻循环
 *   npx tsx scripts/flash-monitor.ts --once     # 只跑一轮（用于部署自检 / 定时任务）
 *
 * 环境变量：
 *   RC_MONITOR_INTERVAL_SEC  轮询间隔秒数，默认 30
 *   RC_MONITOR_ONCE=1        等同于 --once
 */
import { runFlashMonitorCycle } from '../src/lib/server/flashMonitor';
import { runDashboardSnapshotCycle } from '../src/lib/server/dashboardSnapshots';
import { prisma } from '../src/lib/prisma';

const INTERVAL_SEC = Math.max(5, Number(process.env.RC_MONITOR_INTERVAL_SEC ?? 30) || 30);
const ONCE = process.argv.includes('--once') || process.env.RC_MONITOR_ONCE === '1';

let stopping = false;
let timer: NodeJS.Timeout | null = null;
let lastSnapshotBucket = '';

function currentSnapshotBucket(now: Date): string {
  return now.toISOString().slice(0, 13);
}

async function tick(round: number): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runFlashMonitorCycle();
    const now = new Date();
    const snapshotBucket = currentSnapshotBucket(now);
    let snapshotSummary = '';
    if (round === 1 || snapshotBucket !== lastSnapshotBucket) {
      const snapshotResult = await runDashboardSnapshotCycle(now);
      lastSnapshotBucket = snapshotBucket;
      snapshotSummary =
        ` | 大盘快照 scope ${snapshotResult.scopes} | upsert ${snapshotResult.snapshotsUpserted}`;
      for (const note of snapshotResult.notes) console.log(`[monitor]   · ${note}`);
    }
    const elapsed = Date.now() - startedAt;
    console.log(
      `[monitor] 第 ${round} 轮 | 批次 ${result.batches} | 标的 ${result.symbols} | ` +
        `行情成功 ${result.quotesFetched} 失败 ${result.quoteFailures} | 快照 ${result.snapshotsWritten} | ` +
        `新增告警 ${result.alertsCreated} | 已送达 ${result.alertsDelivered} | 待重试 ${result.alertsPendingRetry}` +
        `${snapshotSummary} | ${elapsed}ms`
    );
    for (const note of result.notes) console.log(`[monitor]   · ${note}`);
  } catch (err) {
    // 单轮失败不能让常驻任务退出：记录后等待下一轮。
    console.error('[monitor] 本轮执行异常：', err instanceof Error ? err.message : String(err));
  }
}

async function main(): Promise<void> {
  await tick(1);
  if (ONCE) return;

  console.log(`[monitor] 进入常驻模式，间隔 ${INTERVAL_SEC}s。`);
  let round = 1;
  const schedule = () => {
    if (stopping) return;
    timer = setTimeout(async () => {
      round += 1;
      await tick(round);
      schedule();
    }, INTERVAL_SEC * 1000);
  };
  schedule();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[monitor] 收到 ${signal}，准备退出……`);
    if (timer) clearTimeout(timer);
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (err) => {
  console.error('[monitor] 启动失败：', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
