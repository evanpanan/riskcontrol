import { prisma } from '@/lib/prisma';
import { resolveSessionUser, unauthorized, forbidden, jsonNoStore } from '@/lib/server/apiAuth';
import { BACKUP_POLICY_KEY, parseBackupPolicy } from '@/lib/backupPolicy';
import { loadBackupPolicy } from '@/lib/server/dailyBackup';
import { notificationReadiness } from '@/lib/server/notificationDelivery';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await resolveSessionUser(); if (!user) return unauthorized(); if (user.role !== 'ADMIN') return forbidden();
  try {
    const [policy, archives] = await Promise.all([
      loadBackupPolicy(), prisma.backupArchive.findMany({ orderBy: { backupDate: 'desc' }, take: 14, select: { id: true, backupDate: true, capturedAt: true, byteLength: true, emailStatus: true, lastError: true } }),
    ]);
    const heartbeat = await prisma.workspaceRecord.findUnique({ where: { kind_key: { kind: 'meta', key: 'daily_job_heartbeat' } }, select: { payload: true } });
    return jsonNoStore({ policy, archives, heartbeat: heartbeat?.payload ?? null, readiness: { key: (process.env.BACKUP_KEY?.length ?? 0) >= 32, email: notificationReadiness().email.ready, cron: !!(process.env.CRON_SECRET || process.env.RC_MONITOR_CRON_TOKEN) } });
  } catch { return jsonNoStore({ error: '备份设置暂不可用，请确认数据库迁移已执行' }, 503); }
}
export async function POST(req: Request) {
  const user = await resolveSessionUser(); if (!user) return unauthorized(); if (user.role !== 'ADMIN') return forbidden();
  try {
    const policy = parseBackupPolicy(await req.json());
    if (policy.enabled && (process.env.BACKUP_KEY?.length ?? 0) < 32) throw new Error('请先在服务器配置 BACKUP_KEY');
    if (policy.enabled && !notificationReadiness().email.ready) throw new Error('请先配置可用邮件服务');
    await prisma.$transaction(async tx => {
      await tx.workspaceRecord.upsert({ where: { kind_key: { kind: 'config', key: BACKUP_POLICY_KEY } }, create: { kind: 'config', key: BACKUP_POLICY_KEY, payload: policy, updatedBy: user.id }, update: { payload: policy, updatedBy: user.id, revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorId: user.id, actorEmail: user.email, role: user.role, action: 'backup_policy_update', resource: 'backup:settings', detail: policy } });
    });
    return jsonNoStore({ policy });
  } catch (e) { return jsonNoStore({ error: e instanceof Error ? e.message : '保存失败' }, 400); }
}
