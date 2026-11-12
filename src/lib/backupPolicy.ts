export const BACKUP_POLICY_KEY = 'risk_control_backup_policy';
export type BackupPolicy = { enabled: boolean; emails: string[]; everyDays: number; sendHour: number };
export const DEFAULT_BACKUP_POLICY: BackupPolicy = { enabled: false, emails: [], everyDays: 1, sendHour: 8 };
export function parseBackupPolicy(value: any): BackupPolicy {
  if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.emails) || ![1, 7, 30].includes(value.everyDays) || !Number.isInteger(value.sendHour) || value.sendHour < 0 || value.sendHour > 23) throw new Error('备份设置无效');
  if (value.emails.some((v: unknown) => typeof v !== 'string')) throw new Error('收件邮箱无效');
  const emails = [...new Set<string>(value.emails.map((v: string) => v.trim().toLowerCase()))];
  if (emails.length > 5 || emails.some(v => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v))) throw new Error('最多填写 5 个有效收件邮箱');
  if (value.enabled && !emails.length) throw new Error('请填写备份收件邮箱');
  return { enabled: value.enabled, emails, everyDays: value.everyDays, sendHour: value.sendHour };
}
export function shanghaiDate(now: Date) { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function backupEmailDue(policy: BackupPolicy, lastSentAt: Date | null, now: Date) {
  if (!policy.enabled || !policy.emails.length) return false;
  const local = new Date(now.getTime() + 8 * 3600000);
  if (local.getUTCHours() < policy.sendHour) return false;
  return !lastSentAt || Date.parse(shanghaiDate(now)) - Date.parse(shanghaiDate(lastSentAt)) >= policy.everyDays * 86400000;
}
