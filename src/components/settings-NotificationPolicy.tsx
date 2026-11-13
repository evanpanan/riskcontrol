"use client";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_NOTIFICATION_POLICY,
  parseNotificationRecipients,
  notificationEmailPattern,
  type NotificationRecipientSettings,
  type NotificationPolicy,
} from "@/lib/notificationPolicy";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
type RecipientAccount = { id: string; displayName: string; email: string; enabled: boolean };
const emptyRecipients: NotificationRecipientSettings = { accountIds: [], externalRecipients: [] };

export function NotificationPolicyPanel() {
  const { role } = useCurrentUser();
  const canEdit = role === "ADMIN";
  const [policy, setPolicy] = useState<NotificationPolicy>(
    DEFAULT_NOTIFICATION_POLICY,
  );
  const [recipients, setRecipients] = useState(emptyRecipients);
  const [accounts, setAccounts] = useState<RecipientAccount[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ email: "", note: "" });
  const [draftError, setDraftError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const response = await fetch("/api/notify/policy", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPolicy(data.policy);
      setRecipients(data.recipients);
      setAccounts(data.accounts);
      setReady(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  function withDraft() {
    const email = draft.email.trim().toLowerCase();
    if (!notificationEmailPattern.test(email)) throw new Error("请填写有效邮箱");
    if (accounts.some((account) => account.email.trim().toLowerCase() === email))
      throw new Error("该邮箱属于系统账号，请在账号列表勾选");
    return parseNotificationRecipients({
      ...recipients,
      externalRecipients: [...recipients.externalRecipients, { email, note: draft.note }],
    });
  }

  function addExternal() {
    try {
      setRecipients(withDraft());
      closeDraft();
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "添加失败");
    }
  }

  function closeDraft() {
    setAdding(false);
    setDraft({ email: "", note: "" });
    setDraftError("");
  }

  async function save() {
    setBusy(true);
    try {
      const value = adding && (draft.email.trim() || draft.note.trim())
        ? withDraft()
        : parseNotificationRecipients(recipients);
      const response = await fetch("/api/notify/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...policy, ...value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPolicy(data.policy);
      setRecipients(data.recipients);
      setAccounts(data.accounts);
      closeDraft();
      toast.success("提醒设置已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const choices = [
    ["telegramEnabled", "TG 提醒", "普通预警和状态更新优先发布到频道。"],
    [
      "criticalEmailEnabled",
      "严重告警同时发邮件",
      "首次击穿、出现补仓缺口或严重闪跌，同时通知核心负责人。",
    ],
    [
      "fallbackEmailEnabled",
      "TG 明确发送失败时邮件兜底",
      "超时、响应不明或部分消息已发出时暂停未知渠道，不自动盲目补发。",
    ],
  ] as const;
  const summary =
    !policy.telegramEnabled && !policy.criticalEmailEnabled
      ? "当前未启用提醒发送。"
      : [
          policy.telegramEnabled ? "日常提醒发到 TG" : "TG 提醒已关闭",
          policy.criticalEmailEnabled
            ? "重要告警加发邮件"
            : "重要告警不额外发邮件",
          policy.telegramEnabled && policy.fallbackEmailEnabled
            ? "TG 明确失败时邮件兜底"
            : "",
        ]
          .filter(Boolean)
          .join("；") + "。";
  const hasRecipients = accounts.some((account) =>
    account.enabled && recipients.accountIds.includes(account.id) && notificationEmailPattern.test(account.email.trim()),
  ) || recipients.externalRecipients.some(({ email }) =>
    !accounts.some((account) => account.email.trim().toLowerCase() === email),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">提醒方式</CardTitle>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-xs text-warning">
            {error}
          </p>
        )}
        <section className="space-y-3" aria-label="风控邮件收件人">
          <div>
            <h3 className="text-sm font-medium">风控邮件收件人</h3>
            <p className="text-xs text-muted-foreground">勾选接收邮件的系统账号，或添加外部邮箱。最多 10 位，保存后生效。</p>
          </div>
          {ready && (
            <>
              <fieldset className="space-y-2" disabled={busy || !canEdit}>
                <legend className="text-xs font-medium">系统账号</legend>
                {accounts.length === 0 && <p className="text-xs text-muted-foreground">暂无系统账号</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  {accounts.map((account) => {
                    const selected = recipients.accountIds.includes(account.id);
                    return (
                      <label key={account.id} className="flex min-w-0 items-start gap-2 rounded-md border p-2">
                        <input
                          type="checkbox"
                          className="mt-1 accent-primary"
                          checked={selected}
                          disabled={!account.enabled && !selected}
                          onChange={(event) => {
                            if (event.target.checked && recipients.accountIds.length + recipients.externalRecipients.length >= 10) {
                              toast.error("风控邮件收件人最多 10 位");
                              return;
                            }
                            setRecipients((previous) => ({
                              ...previous,
                              accountIds: selected
                                ? previous.accountIds.filter((id) => id !== account.id)
                                : [...previous.accountIds, account.id],
                            }));
                          }}
                        />
                        <span className="min-w-0 break-all text-sm">
                          {account.displayName}
                          {!account.enabled && <span className="ml-2 text-xs text-muted-foreground">已停用</span>}
                          <span className="block text-xs text-muted-foreground">{account.email}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {!hasRecipients && (
                <p className="text-xs text-muted-foreground">当前没有可接收的邮箱，风控邮件将暂停发送。</p>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-medium">外部邮箱</h4>
                  {canEdit && !adding && (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAdding(true)}>
                      添加邮箱
                    </Button>
                  )}
                </div>
                {recipients.externalRecipients.length === 0 && !adding && (
                  <p className="text-xs text-muted-foreground">暂无外部邮箱</p>
                )}
                {recipients.externalRecipients.map(({ email, note }) => (
                  <div key={email} className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <span className="break-all text-sm">{email}</span>
                    <Input
                      aria-label={`${email} 的备注`}
                      placeholder="备注（选填）"
                      maxLength={100}
                      value={note}
                      readOnly={!canEdit}
                      disabled={busy}
                      onChange={(event) => setRecipients((previous) => ({
                        ...previous,
                        externalRecipients: previous.externalRecipients.map((entry) =>
                          entry.email === email ? { ...entry, note: event.target.value } : entry,
                        ),
                      }))}
                    />
                    {canEdit && (
                      <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`移除 ${email}`}
                        onClick={() => setRecipients((previous) => ({
                          ...previous,
                          externalRecipients: previous.externalRecipients.filter((entry) => entry.email !== email),
                        }))}
                      >
                        移除
                      </Button>
                    )}
                  </div>
                ))}
                {adding && (
                  <div className="space-y-2 rounded-md border p-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input type="email" aria-label="外部邮箱地址" placeholder="邮箱地址" maxLength={254}
                        value={draft.email} disabled={busy}
                        onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                      />
                      <Input aria-label="外部邮箱备注" placeholder="备注（选填）" maxLength={100}
                        value={draft.note} disabled={busy}
                        onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                      />
                    </div>
                    {draftError && <p role="alert" className="text-xs text-danger">{draftError}</p>}
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={addExternal}>添加</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={closeDraft}>取消</Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
        <details className="border-t border-border pt-3">
          <summary className="text-xs text-muted-foreground cursor-pointer">
            高级规则
          </summary>
          <div className="mt-3">
            <div className="space-y-3">
              {choices.map(([key, title, description]) => (
                <label
                  key={key}
                  className="flex items-start gap-3 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-1 accent-primary"
                    checked={policy[key]}
                    disabled={!ready || busy || !canEdit}
                    onChange={(e) =>
                      setPolicy((previous) => ({
                        ...previous,
                        [key]: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="text-sm font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground mt-1">
                      {description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              同类提醒30分钟内去重。关闭渠道或移除邮箱会停止后续尝试；已发出的请求无法撤回。
            </p>
          </div>
        </details>
        <div className="flex gap-2">
          <Button onClick={save} disabled={!ready || busy || !canEdit}>
            {busy ? "正在保存…" : "保存提醒设置"}
          </Button>
          {error && (
            <Button variant="outline" onClick={refresh}>
              重试
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
