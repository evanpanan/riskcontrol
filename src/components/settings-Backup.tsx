"use client";
import { SettingsSections, SettingsSection } from "@/components/settings-Sections";
import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DEFAULT_BACKUP_POLICY, type BackupPolicy } from '@/lib/backupPolicy';
import { toast } from 'sonner';
const labels: Record<string, string> = { NOT_SCHEDULED: '已备份', SENT: '邮件已受理', FAILED: '邮件失败', REVIEW: '请核查邮箱', SENDING: '发送中', CANCELLED: '已停止发送' };
export function BackupSettingsPanel() {
  const [historyPage, setHistoryPage] = useState(0);
  const [policy, setPolicy] = useState<BackupPolicy>(DEFAULT_BACKUP_POLICY);
  const [emails, setEmails] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const r = await fetch('/api/backup/settings', { cache: 'no-store' }); const d = await r.json();
      if (!r.ok) throw new Error(d.error || '读取失败'); setData(d); setPolicy(d.policy); setEmails(d.policy.emails.join('\n')); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/backup/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policy, sendHour: 8, emails: emails.split(/[\n,;，；]+/).map(e => e.trim()).filter(Boolean) }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || '保存失败'); toast.success('备份设置已保存'); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); }
  }
  return <SettingsSections sections={[{id:"schedule",label:"备份与邮件计划"},{id:"history",label:"备份记录与下载"}]}><SettingsSection id="schedule"><Card><CardHeader><CardTitle className="text-base">每日备份</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
    <p className="text-muted-foreground">每日自动留存完整加密数据。开启邮件后，按所选周期发送最新完整备份，历史数据包含在内。</p>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {data && <>
      {(!data.readiness.key || !data.readiness.cron) && <p className="rounded-lg bg-warning/10 p-3 text-warning">请先在服务器配置 {!data.readiness.key ? 'BACKUP_KEY ' : ''}{!data.readiness.cron ? 'CRON_SECRET' : ''}，并重新部署。</p>}
      <p className="text-xs text-muted-foreground">最近定时执行：{data.heartbeat?.at ? new Date(data.heartbeat.at).toLocaleString('zh-CN') : '尚无执行记录'}{data.heartbeat?.errors?.length ? ` · ${data.heartbeat.errors.join('；')}` : ''}</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={policy.enabled} onChange={e => setPolicy({ ...policy, enabled: e.target.checked })}/>定期将备份发送到邮箱</label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2"><span>收件邮箱</span><textarea aria-label="备份收件邮箱" className="min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm" placeholder="每行一个邮箱，最多 5 个" value={emails} onChange={e => setEmails(e.target.value)}/></label>
      <label className="space-y-2"><span>发送周期</span><select className="block w-full rounded-lg border border-border bg-background p-3" value={policy.everyDays} onChange={e => setPolicy({ ...policy, everyDays: Number(e.target.value) })}><option value={1}>每天</option><option value={7}>每 7 天</option><option value={30}>每 30 天</option></select><p className="text-xs text-muted-foreground">北京时间 08:00 起，由每日定时任务执行。</p></label></div>
      <p className="text-xs text-muted-foreground">备份附件需由管理员解密恢复；密钥保存在服务器，单独妥善备存。</p>
      <Button onClick={save} disabled={busy}>{busy ? '保存中…' : '保存备份设置'}</Button>
    </>}
  </CardContent></Card></SettingsSection><SettingsSection id="history"><Card><CardHeader><CardTitle className="text-base">最近备份</CardTitle></CardHeader><CardContent className="space-y-3">
    {data?.archives?.length ? data.archives.slice(historyPage * 7, (historyPage + 1) * 7).map((a: any) => <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 text-sm"><div><p>{a.backupDate} · {(a.byteLength / 1024).toFixed(1)} KB</p><p className="text-xs text-muted-foreground">{labels[a.emailStatus] || a.emailStatus}</p>{a.lastError && <p className="text-xs text-warning break-words">{a.lastError}</p>}</div><a className="text-primary text-sm underline" href={`/api/backup/download?id=${encodeURIComponent(a.id)}`}>下载加密备份</a></div>) : <p className="text-sm text-muted-foreground">暂无备份。完成配置后，系统每日自动生成。</p>}
    {data?.archives?.length > 7 && <div className="flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">第 {historyPage + 1} / {Math.ceil(data.archives.length / 7)} 页</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={historyPage === 0} onClick={() => setHistoryPage(n => Math.max(0, n - 1))}>上一页</Button><Button size="sm" variant="outline" disabled={(historyPage + 1) * 7 >= data.archives.length} onClick={() => setHistoryPage(n => n + 1)}>下一页</Button></div></div>}
  </CardContent></Card></SettingsSection></SettingsSections>;
}
