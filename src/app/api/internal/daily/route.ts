import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { jsonNoStore } from '@/lib/server/apiAuth';
import { runBatchDailySnapshotCycle } from '@/lib/server/batchDailySnapshots';
import { runDailyBackupCycle } from '@/lib/server/dailyBackup';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() || process.env.RC_MONITOR_CRON_TOKEN?.trim() || '';
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) return jsonNoStore({ error: 'unauthorized' }, 401);
  const now = new Date();
  // Historical snapshot must be committed before collecting the complete backup.
  let snapshots: unknown, backup: unknown;
  const errors: string[] = [];
  try { snapshots = await runBatchDailySnapshotCycle(now); } catch { errors.push('每日历史采集失败'); }
  try { backup = await runDailyBackupCycle(now); } catch (e) { errors.push(e instanceof Error ? e.message : '每日备份失败'); }
  const result = { ok: !errors.length, at: now.toISOString(), snapshots: snapshots ?? null, backup: backup ?? null, errors };
  await prisma.workspaceRecord.upsert({ where: { kind_key: { kind: 'meta', key: 'daily_job_heartbeat' } }, create: { kind: 'meta', key: 'daily_job_heartbeat', payload: JSON.parse(JSON.stringify(result)) }, update: { payload: JSON.parse(JSON.stringify(result)), revision: { increment: 1 } } });
  return jsonNoStore(result, errors.length ? 500 : 200);
}
