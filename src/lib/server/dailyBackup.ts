import { Prisma } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { assertBackupKey, encryptBackup, backupSha256 } from './backupCrypto';
import { BACKUP_POLICY_KEY, DEFAULT_BACKUP_POLICY, parseBackupPolicy, backupEmailDue, shanghaiDate } from '@/lib/backupPolicy';
import { deliverNotification } from './notificationDelivery';
import { unknownNotificationOutcome } from './notificationErrors';
// Excludes archive bytes themselves to avoid exponential recursive backups. All application tables,
// including auth records, audit logs and complete historical snapshots, are encrypted in this archive.
export const backupModels = Prisma.dmmf.datamodel.models.filter(m => m.name !== 'BackupArchive');
export async function loadBackupPolicy() {
  const row = await prisma.workspaceRecord.findUnique({ where: { kind_key: { kind: 'config', key: BACKUP_POLICY_KEY } } });
  return row ? parseBackupPolicy(row.payload) : DEFAULT_BACKUP_POLICY;
}
export function databaseFingerprint(value: string) {
  const url = new URL(value);
  return createHash('sha256').update(`${url.hostname}:${url.port || '5432'}${url.pathname}`).digest('hex');
}
export async function collectBackup(now: Date) {
  return prisma.$transaction(async tx => {
    const tables: Record<string, unknown[]> = {};
    for (const model of backupModels) {
      const delegate = model.name[0].toLowerCase() + model.name.slice(1);
      tables[model.name] = await (tx as any)[delegate].findMany();
    }
    return { format: 'riskcontrol-json-v1', capturedAt: now.toISOString(), source: databaseFingerprint(process.env.DATABASE_URL!), tables };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
}
type RecipientState = { status: 'accepted' | 'failed' | 'unknown'; attempts: number };
export async function runDailyBackupCycle(now = new Date()) {
  if (Number(new Date(now.getTime() + 8 * 3600000).getUTCHours()) < 8) return { status: '等待收盘后每日备份时段' };
  assertBackupKey();
  const date = shanghaiDate(now);
  let archive = await prisma.backupArchive.findUnique({ where: { backupDate: date } });
  if (!archive) {
    const data = encryptBackup(await collectBackup(now));
    archive = await prisma.backupArchive.upsert({ where: { backupDate: date }, create: { backupDate: date, capturedAt: now, data, sha256: backupSha256(data), byteLength: data.length, emailState: {}, emailStatus: 'NOT_SCHEDULED' }, update: {} });
  }
  let policy = await loadBackupPolicy();
  const lastSent = await prisma.backupArchive.findFirst({ where: { emailStatus: 'SENT' }, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } });
  if (!backupEmailDue(policy, lastSent?.capturedAt ?? null, now)) return { backupDate: date, status: archive.emailStatus, created: true };
  // A crashed worker might have sent externally before persisting its result. Never blind-retry it.
  await prisma.backupArchive.updateMany({ where: { id: archive.id, emailStatus: 'SENDING', leaseUntil: { lt: now } }, data: { emailStatus: 'REVIEW', lastError: '发送进程中断，受理结果未知，请核查邮箱', leaseToken: null, leaseUntil: null } });
  const token = randomUUID();
  const claim = await prisma.backupArchive.updateMany({ where: { id: archive.id, emailStatus: { in: ['NOT_SCHEDULED', 'FAILED'] } }, data: { emailStatus: 'SENDING', leaseToken: token, leaseUntil: new Date(now.getTime() + 10 * 60000) } });
  if (!claim.count) return { backupDate: date, status: '已处理或等待人工核查' };
  const states = { ...(archive.emailState as Record<string, RecipientState>) };
  let error: string | null = null;
  try {
    if (archive.byteLength > 7 * 1024 * 1024) throw new Error('加密备份超过邮件附件上限，请从后台下载备份并配置外部存储');
    if (backupSha256(Buffer.from(archive.data)) !== archive.sha256) throw new Error('备份校验失败，禁止发送');
    for (const email of policy.emails) {
      policy = await loadBackupPolicy();
      if (!policy.enabled || !policy.emails.includes(email)) continue;
      const state = states[email];
      if (state?.status === 'accepted' || state?.status === 'unknown' || (state?.attempts ?? 0) >= 3) continue;
      // Persist unknown before calling the provider, so interruption cannot cause duplicate automatic sends.
      states[email] = { status: 'unknown', attempts: (state?.attempts ?? 0) + 1 };
      await prisma.backupArchive.updateMany({ where: { id: archive.id, leaseToken: token }, data: { emailState: states } });
      try {
        const delivery = await deliverNotification({ channel: 'email', payload: {
          title: `风控系统数据备份 · ${date}`,
          message: `附件为完整加密逻辑备份（${archive.capturedAt.toISOString()}）。包含账户、业务、历史和操作记录，需由管理员使用服务器 BACKUP_KEY 解密恢复。\nSHA-256: ${archive.sha256}\n请妥善保管，备份密钥不随邮件发送。`,
          recipients: { emails: [email] }, type: 'BACKUP', severity: 'LOW',
        } }, process.env, [{ filename: `riskcontrol-${date}.rcbackup`, content: Buffer.from(archive.data).toString('base64'), contentType: 'application/octet-stream' }]);
        states[email].status = delivery.sentTo.includes(email) ? 'accepted' : delivery.failureKind === 'unknown' ? 'unknown' : 'failed';
        if (!delivery.success) error = delivery.error ?? '邮件服务未确认受理';
      } catch (e) { states[email].status = unknownNotificationOutcome(e) ? 'unknown' : 'failed'; error = e instanceof Error ? e.message : '邮件发送失败'; }
      await prisma.backupArchive.updateMany({ where: { id: archive.id, leaseToken: token }, data: { emailState: states } });
    }
  } catch (e) { error = e instanceof Error ? e.message : '备份邮件失败'; }
  policy = await loadBackupPolicy();
  const active = policy.emails.map(e => states[e]?.status);
  const status = active.includes('unknown') ? 'REVIEW' : active.length > 0 && active.every(s => s === 'accepted') ? 'SENT' : policy.enabled ? 'FAILED' : 'CANCELLED';
  await prisma.backupArchive.updateMany({ where: { id: archive.id, leaseToken: token }, data: { emailState: states, emailStatus: status, lastError: error, leaseToken: null, leaseUntil: null } });
  return { backupDate: date, status, error };
}
