"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { sendTestNotification } from "@/lib/notifier";
export function TelegramChannelPanel() {
  const { role } = useCurrentUser();
  const canEdit = role === "ADMIN";
  const [chatId, setChatId] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [channel, setChannel] = useState<{
    title: string;
    chatId: string;
    joinUrl?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [managed, setManaged] = useState(false);
  const [bot, setBot] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    try {
      const res = await fetch("/api/notify/telegram/channel", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBot(data.botConfigured);
      setManaged(data.managedByEnv);
      setChannel(data.channel);
      if (data.channel) {
        setChatId(data.channel.chatId);
        setJoinUrl(data.channel.joinUrl || "");
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/notify/telegram/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, joinUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setChannel(data.channel);
      toast.success("频道已验证并保存，请发送测试消息核对收件");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      const result = await sendTestNotification("telegram", []);
      if (!result.channels.telegram.success)
        throw new Error(result.channels.telegram.error);
      toast.success("Telegram 已受理测试消息，请在频道中核对");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "测试失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Telegram 风控频道</CardTitle>
        <p className="text-xs text-muted-foreground">
          用户加入频道即可查看后续提醒，不需要添加机器人或单独订阅。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">首次接入说明</summary>
          <ol className="mt-2 space-y-2 list-decimal pl-4">
            <li>创建 Telegram 频道，并通过 @BotFather 创建一个机器人。</li>
            <li>将机器人加入频道，设为管理员并允许发布消息。</li>
            <li>由运维在服务器配置 TELEGRAM_BOT_TOKEN，然后在这里验证频道。</li>
          </ol>
        </details>
        <p className="text-xs">
          {bot ? "机器人凭据已配置" : "等待配置机器人凭据"}
          {managed ? " · 当前频道由服务器管理" : ""}
        </p>
        {error && (
          <p className="text-xs text-warning" role="alert">
            {error}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="tg-channel">频道用户名 / ID</Label>
            <Input
              id="tg-channel"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="@risk_alerts 或 -1001234567890"
              disabled={managed || !canEdit}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tg-join">
              频道加入链接（私有频道可填邀请链接）
            </Label>
            <Input
              id="tg-join"
              value={joinUrl}
              onChange={(e) => setJoinUrl(e.target.value)}
              placeholder="https://t.me/..."
              disabled={managed || !canEdit}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={save}
            disabled={busy || managed || !chatId.trim() || !canEdit}
          >
            {busy ? "正在验证…" : "验证权限并保存频道"}
          </Button>
          <Button variant="outline" onClick={load}>
            刷新配置
          </Button>
          <Button variant="outline" onClick={test} disabled={busy || !channel}>
            发送频道测试
          </Button>
          {channel?.joinUrl && (
            <a
              className="text-sm text-primary underline self-center"
              href={channel.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开风控频道
            </a>
          )}
        </div>
        {channel && (
          <p className="text-xs text-muted-foreground">
            当前频道：{channel.title} · {channel.chatId}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
