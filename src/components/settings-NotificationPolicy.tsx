"use client";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_NOTIFICATION_POLICY,
  parseNotificationPolicy,
  type NotificationPolicy,
} from "@/lib/notificationPolicy";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
export function NotificationPolicyPanel() {
  const { role } = useCurrentUser();
  const canEdit = role === "ADMIN";
  const [policy, setPolicy] = useState<NotificationPolicy>(
    DEFAULT_NOTIFICATION_POLICY,
  );
  const [emails, setEmails] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const response = await fetch("/api/notify/policy", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPolicy(data.policy);
      setEmails(data.policy.coreEmails.join("\n"));
      setReady(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  async function save() {
    setBusy(true);
    try {
      const value = parseNotificationPolicy({
        ...policy,
        coreEmails: emails
          .split(/[\n,;，；]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      const response = await fetch("/api/notify/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPolicy(data.policy);
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
        <label className="block space-y-1">
          <span className="text-sm font-medium">重要提醒收件人</span>
          <textarea
            aria-label="重要提醒收件人"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            disabled={!ready || busy || !canEdit}
            placeholder="每行一个邮箱，最多10个"
            rows={2}
            className="block w-full rounded-lg border border-input bg-background p-3 text-sm"
          />
          <span className="block text-xs text-muted-foreground">
            每行一个邮箱。只通知这些负责人，不向全员群发。
          </span>
        </label>
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
