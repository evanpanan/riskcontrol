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
export function parseNotificationPolicy(raw: unknown, requireRecipients = true): NotificationPolicy {
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
        !notificationEmailPattern.test(email.trim()),
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
    requireRecipients &&
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
export interface ExternalRecipient {
  email: string;
  note: string;
}

export interface NotificationRecipientSettings {
  accountIds: string[];
  externalRecipients: ExternalRecipient[];
}

export const notificationEmailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function parseNotificationRecipients(raw: unknown): NotificationRecipientSettings {
  if (!raw || typeof raw !== "object") throw new Error("收件人设置无效");
  const { accountIds, externalRecipients } = raw as Record<string, unknown>;
  if (!Array.isArray(accountIds) || accountIds.some((id) => typeof id !== "string" || !id || id.length > 100))
    throw new Error("所选账号无效");
  if (!Array.isArray(externalRecipients)) throw new Error("外部邮箱列表无效");
  const emails = new Set<string>();
  const recipients = externalRecipients.map((recipient) => {
    const email = typeof recipient?.email === "string" ? recipient.email.trim().toLowerCase() : "";
    if (!notificationEmailPattern.test(email) || email.length > 254)
      throw new Error("外部邮箱格式无效");
    if (emails.has(email)) throw new Error("外部邮箱重复");
    emails.add(email);
    if (typeof recipient.note !== "string" || recipient.note.length > 100)
      throw new Error("邮箱备注最多 100 个字符");
    return { email, note: recipient.note.trim() };
  });
  if (new Set(accountIds).size + recipients.length > 10) throw new Error("风控邮件收件人最多 10 位");
  return { accountIds: [...new Set<string>(accountIds)], externalRecipients: recipients };
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
