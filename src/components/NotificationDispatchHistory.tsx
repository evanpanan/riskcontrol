"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import type { DispatchState } from "@/lib/notificationPolicy";
type Row = {
  id: string;
  title: string;
  createdAt: string;
  attemptCount: number;
  status: string;
  summary: string;
  nextAttemptAt: string;
  state: DispatchState;
  channels: { telegram: { sentTo: string[] }; email: { sentTo: string[] } };
};
export function NotificationDispatchHistory({
  expanded = false,
}: {
  expanded?: boolean;
}) {
  const { role } = useCurrentUser();
  const allowed = ["ADMIN", "RISK_MANAGER"].includes(role);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/notify/dispatches", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRows(data.dispatches);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "记录读取失败");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (allowed) void refresh();
  }, [allowed]);
  async function acknowledge(id: string) {
    if (
      !window.confirm(
        "请先核查频道及邮箱。此操作只停止该条提醒的自动重试，不表示消息已送达或风险已解除。",
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch("/api/notify/dispatches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "acknowledge" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  if (!allowed) return null;
  return (
    <details
      open={expanded || undefined}
      className="rounded-lg border border-border p-3"
    >
      <summary className="text-sm cursor-pointer font-medium">
        通知记录（最近 {rows.length} 条）
      </summary>
      <div className="mt-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
          刷新投递记录
        </Button>
        {error && (
          <p role="alert" className="text-xs text-warning mt-2">
            {error}
          </p>
        )}
        <div className="divide-y divide-border mt-2">
          {!rows.length && !error && (
            <p className="text-xs text-muted-foreground py-3">
              暂无记录。收到提醒请求后，会显示实际投递状态。
            </p>
          )}
          {rows.map((row) => (
            <div key={row.id} className="py-3 space-y-1">
              <p className="text-sm font-medium">{row.title}</p>
              <p
                className={
                  ["REVIEW", "PENDING"].includes(row.status)
                    ? "text-xs text-warning"
                    : "text-xs text-muted-foreground"
                }
              >
                {row.summary}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString("zh-CN")} · 处理{" "}
                {row.attemptCount} 轮 · TG 受理{" "}
                {row.channels.telegram.sentTo.length} · 邮件受理{" "}
                {row.channels.email.sentTo.length}
              </p>
              {row.status === "PENDING" && (
                <p className="text-xs text-muted-foreground">
                  下次处理不早于{" "}
                  {new Date(row.nextAttemptAt).toLocaleString("zh-CN")}
                  ，由服务端监控任务执行
                </p>
              )}
              {["PENDING", "REVIEW"].includes(row.status) && (
                <>
                  <p className="text-xs text-warning break-words">
                    {[row.state.telegram, ...Object.values(row.state.emails)]
                      .filter((value) => value.error)
                      .map((value) => value.error)
                      .join("；")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => acknowledge(row.id)}
                  >
                    已人工核查，停止本条重试
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
