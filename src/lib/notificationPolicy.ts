export interface NotificationPolicy {
  telegramEnabled: boolean;
  criticalEmailEnabled: boolean;
  fallbackEmailEnabled: boolean;
  coreEmails: string[];
}
export const NOTIFICATION_POLICY_KEY = "risk_control_notification_policy";
export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  telegramEnabled: true,
  criticalEmailEnabled: true,
  fallbackEmailEnabled: true,
  coreEmails: [],
};
export function parseNotificationPolicy(raw: unknown): NotificationPolicy {
  if (!raw || typeof raw !== "object") throw new Error("通知策略格式无效");
  const value = raw as Record<string, unknown>;
  for (const key of [
    "telegramEnabled",
    "criticalEmailEnabled",
    "fallbackEmailEnabled",
  ])
    if (typeof value[key] !== "boolean") throw new Error("请明确设置通知开关");
  if (
    !Array.isArray(value.coreEmails) ||
    value.coreEmails.some(
      (email) =>
        typeof email !== "string" ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim()),
    )
  )
    throw new Error("核心负责人邮箱格式无效");
  const emails = [
    ...new Set(
      value.coreEmails.map((email) => (email as string).trim().toLowerCase()),
    ),
  ];
  if (emails.length > 10) throw new Error("核心负责人邮箱最多10个");
  if (
    (value.criticalEmailEnabled || value.fallbackEmailEnabled) &&
    !emails.length
  )
    throw new Error("启用邮件提醒时，至少配置一个核心负责人邮箱");
  return {
    telegramEnabled: value.telegramEnabled as boolean,
    criticalEmailEnabled: value.criticalEmailEnabled as boolean,
    fallbackEmailEnabled: value.fallbackEmailEnabled as boolean,
    coreEmails: emails,
  };
}
export type AttemptStatus =
  | "pending"
  | "accepted"
  | "failed"
  | "unknown"
  | "skipped";
export interface ChannelAttempt {
  status: AttemptStatus;
  sentTo: string[];
  error?: string;
}
export interface DispatchState {
  telegram: ChannelAttempt;
  emails: Record<string, ChannelAttempt>;
  emailReason?: "critical" | "fallback";
}
export function criticalNotification(payload: {
  type?: string;
  severity?: string;
}) {
  return payload.type === "MARGIN_CALL" || payload.severity === "CRITICAL";
}
export function initialDispatchState(
  policy: NotificationPolicy,
  critical: boolean,
): DispatchState {
  return {
    telegram: {
      status: policy.telegramEnabled ? "pending" : "skipped",
      sentTo: [],
    },
    emails: Object.fromEntries(
      policy.coreEmails.map((email) => [
        email,
        {
          status:
            critical && policy.criticalEmailEnabled ? "pending" : "skipped",
          sentTo: [],
        },
      ]),
    ),
    ...(critical && policy.criticalEmailEnabled
      ? { emailReason: "critical" as const }
      : {}),
  };
}
export function dispatchStatus(
  state: DispatchState,
): "PENDING" | "REVIEW" | "COMPLETE" | "SKIPPED" {
  const attempts = [
    ...(state.emailReason === "fallback" && state.telegram.status === "failed"
      ? []
      : [state.telegram]),
    ...Object.values(state.emails),
  ];
  if (attempts.some((a) => a.status === "pending" || a.status === "failed"))
    return "PENDING";
  if (attempts.some((a) => a.status === "unknown")) return "REVIEW";
  return attempts.some((a) => a.status === "accepted") ? "COMPLETE" : "SKIPPED";
}

export function notificationChannelLabel(channel?: {
  status?: string;
  success?: boolean;
  sentTo?: string[];
}) {
  if (!channel) return "未确认";
  if (channel.status === "skipped") return "本次不发送";
  if (channel.status === "pending") return "排队／处理中";
  if (channel.status === "unknown") return "需人工核查";
  if (channel.status === "accepted" || channel.success) return "已受理";
  if (channel.status === "failed")
    return channel.sentTo?.length ? "部分受理" : "未受理";
  return channel.sentTo?.length ? "部分受理" : "未确认";
}
