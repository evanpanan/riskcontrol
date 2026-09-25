import { Batch, Client, MarginCall } from "@prisma/client";
import {
  getEnabledRecipientEmails,
  getEnabledRecipientWhatsApps,
  getRiskRecipients,
} from "./riskRecipients";

const SETTINGS_LS_KEY = "risk_control_settings";
let notificationSendToken = "";
export function setNotificationSendToken(value: string) { notificationSendToken = value.trim(); }
export function hasNotificationSendToken() { return !!notificationSendToken; }

export interface RuntimeNotificationConfig {
  emailWebhook?: string;
  whatsappWebhook?: string;
  defaultRiskEmail?: string;
  emergencyPhone?: string;
}

export function getRuntimeNotificationConfig(): RuntimeNotificationConfig {
  const empty: RuntimeNotificationConfig = {};
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(SETTINGS_LS_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as any;
    return {
      emailWebhook: typeof parsed?.emailWebhook === "string" && !/example\.com/.test(parsed.emailWebhook) ? parsed.emailWebhook : undefined,
      whatsappWebhook: typeof parsed.whatsappWebhook === "string" ? parsed.whatsappWebhook : undefined,
      defaultRiskEmail: typeof parsed.defaultRiskEmail === "string" && parsed.defaultRiskEmail !== "risk-control@institution.com" ? parsed.defaultRiskEmail : undefined,
      emergencyPhone: typeof parsed.emergencyPhone === "string" && parsed.emergencyPhone !== "+852-9123-4567" ? parsed.emergencyPhone : undefined,
    };
  } catch {
    return empty;
  }
}

export interface NotificationPayload {
  type: "MARGIN_CALL" | "SETTLEMENT" | "WARNING" | "INFO" | "CLIENT_ADDED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  message: string;
  batchId?: string;
  batchNumber?: string;
  stockSymbol?: string;
  details?: Record<string, unknown>;
  recipients: {
    emails: string[];
    whatsapps: string[];
    roles?: string[];
  };
  timestamp: Date;
}

export interface NotificationResult {
  success: boolean;
  sentAt: Date;
  recipientCount: { emails: number; whatsapps: number };
  channels: {
    email: { success: boolean; sentTo: string[]; error?: string };
    whatsapp: { success: boolean; sentTo: string[]; error?: string };
    internal: { success: boolean; error?: string };
  };
  logError?: string;
}

export const LAST_NOTIFICATIONS_KEY = "risk_control_xmax_notifications_v1";

export interface NotificationLogEntry {
  id: string;
  payload: NotificationPayload;
  result: NotificationResult;
}

function getLog(): NotificationLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LAST_NOTIFICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function pushLog(entry: NotificationLogEntry) {
  if (typeof window === "undefined") return;
  const existing = getLog();
  existing.unshift(entry);
    localStorage.setItem(
    LAST_NOTIFICATIONS_KEY,
    JSON.stringify(existing.slice(0, 200))
  );
}

export function getNotificationLogs(): NotificationLogEntry[] {
  return getLog();
}

export function buildMarginCallNotification(
  batch: Batch,
  marginCall: MarginCall,
  bdManagers?: string[]
): NotificationPayload {
  const roles: ("RISK_MANAGER" | "BD_MANAGER" | "OPERATIONS")[] = [
    "RISK_MANAGER",
    "OPERATIONS",
  ];
  const bdEmails = bdManagers?.length
    ? getRiskRecipients()
        .filter(
          (r) => r.enabled && r.role === "BD_MANAGER" && bdManagers.includes(r.name.replace(/^(?:BD经理|商务经理)\s*-\s*/, ""))
        )
        .map((r) => r.email)
    : [];
  const bdWhatsApps = bdManagers?.length
    ? getRiskRecipients()
        .filter(
          (r) =>
            r.enabled && r.role === "BD_MANAGER" && r.whatsapp && bdManagers.includes(r.name.replace(/^(?:BD经理|商务经理)\s*-\s*/, ""))
        )
        .map((r) => r.whatsapp as string)
    : [];

  return {
    type: "MARGIN_CALL",
    severity: "CRITICAL",
    title: `【紧急补仓警报】批次 ${batch.batchNumber} 已触发补仓机制`,
    message: `批次 ${batch.batchNumber}（${batch.stockSymbol}）当前仓位价值跌幅达到 ${(
      marginCall.dropPercent * 100
    ).toFixed(2)}%，已触发 20% 补仓预警线。请立即处理补仓事宜。需补仓金额：${(
      Math.max(0, marginCall.requiredAmount - (marginCall.fulfilledAmount ?? 0)) / 1000000
    ).toFixed(2)}M USD（$${Math.max(0, marginCall.requiredAmount - (marginCall.fulfilledAmount ?? 0)).toLocaleString()}）。`,
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    stockSymbol: batch.stockSymbol,
    details: {
      batchNumber: batch.batchNumber,
      stockSymbol: batch.stockSymbol,
      stockName: batch.stockName,
      initialTotalAmount: batch.initialTotalAmount,
      currentMarketValue: batch.currentMarketValue,
      triggerMarketValue: marginCall.triggerMarketValue,
      dropPercent: marginCall.dropPercent,
      requiredAmount: marginCall.requiredAmount,
      signDate: batch.signDate,
      maturityDate: batch.maturityDate,
      bdManagers: bdManagers || [],
    },
    recipients: {
      emails: getEnabledRecipientEmails(roles, bdEmails),
      whatsapps: getEnabledRecipientWhatsApps(roles, bdWhatsApps),
      roles,
    },
    timestamp: new Date(),
  };
}

export function buildWarningNotification(
  batch: Batch,
  dropPercent: number,
  safetyBufferPercent: number
): NotificationPayload {
  const roles: ("RISK_MANAGER" | "RISK_ANALYST" | "BD_MANAGER")[] = [
    "RISK_MANAGER",
    "RISK_ANALYST",
  ];
  return {
    type: "WARNING",
    severity: "MEDIUM",
    title: `【风险预警】批次 ${batch.batchNumber} 接近补仓预警线`,
    message: `批次 ${batch.batchNumber}（${batch.stockSymbol}）当前跌幅 ${dropPercent.toFixed(
      2
    )}%，距离 20% 补仓线仅剩 ${safetyBufferPercent.toFixed(
      2
    )}%，请密切关注行情波动，准备应对预案。`,
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    stockSymbol: batch.stockSymbol,
    details: {
      batchNumber: batch.batchNumber,
      stockSymbol: batch.stockSymbol,
      dropPercent,
      safetyBufferPercent,
      currentMarketValue: batch.currentMarketValue,
      initialTotalAmount: batch.initialTotalAmount,
    },
    recipients: {
      emails: getEnabledRecipientEmails(roles),
      whatsapps: getEnabledRecipientWhatsApps(roles),
      roles,
    },
    timestamp: new Date(),
  };
}

export function buildClientAddedNotification(
  batch: Batch,
  client: { name: string; investmentAmount: number; bdManager: string }
): NotificationPayload {
  const bdNames = [client.bdManager];
  const bdEmails = getRiskRecipients()
    .filter((r) => r.enabled && r.role === "BD_MANAGER" && bdNames.includes(r.name.replace(/^(?:BD经理|商务经理)\s*-\s*/, "")))
    .map((r) => r.email);

  return {
    type: "CLIENT_ADDED",
    severity: "LOW",
    title: `【新客户录入】批次 ${batch.batchNumber} 新增客户 ${client.name}`,
    message: `客户 ${client.name} 已成功录入批次 ${batch.batchNumber}（${
      batch.stockSymbol
    }），投资金额：$${client.investmentAmount.toLocaleString()}，负责商务经理：${
      client.bdManager
    }。`,
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    stockSymbol: batch.stockSymbol,
    details: {
      clientName: client.name,
      investmentAmount: client.investmentAmount,
      bdManager: client.bdManager,
    },
    recipients: {
      emails: getEnabledRecipientEmails(["RISK_MANAGER", "OPERATIONS"], bdEmails),
      whatsapps: getEnabledRecipientWhatsApps(["RISK_MANAGER"]),
    },
    timestamp: new Date(),
  };
}

export async function sendNotification(
  payload: NotificationPayload,
  overrideConfig?: Partial<RuntimeNotificationConfig>
): Promise<NotificationResult> {
  const runtime = getRuntimeNotificationConfig();
  const config = { ...runtime, ...(overrideConfig || {}) };
  const result: NotificationResult = {
    success: true,
    sentAt: new Date(),
    recipientCount: {
      emails: payload.recipients.emails.length,
      whatsapps: payload.recipients.whatsapps.length,
    },
    channels: {
      email: { success: true, sentTo: payload.recipients.emails },
      whatsapp: { success: true, sentTo: payload.recipients.whatsapps },
      internal: { success: true },
    },
  };

  for (const channel of ["email", "whatsapp"] as const) {
    const targets = channel === "email" ? payload.recipients.emails : payload.recipients.whatsapps;
    result.channels[channel] = { success: false, sentTo: [] };
    if (!targets.length) continue;
    try {
      const resp = await fetch("/api/notify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${notificationSendToken}` },
        body: JSON.stringify({
          channel,
          payload,
          webhookOverride: channel === "email" ? config.emailWebhook : config.whatsappWebhook,
        }),
      });
      const data = (await resp.json().catch(() => null)) as any;
      const sentTo = Array.isArray(data?.sentTo) ? data.sentTo : [];
      const success = resp.ok && data?.success === true && sentTo.length === new Set(targets).size;
      result.channels[channel] = {
        success, sentTo,
        error: success ? undefined : data?.error || `发送未获确认（HTTP ${resp.status}），请先核查服务商记录。`,
      };
      if (!success) result.success = false;
    } catch {
      result.channels[channel] = { success: false, sentTo: [],
        error: "连接中断，是否已受理未知；请先核查服务商记录，勿直接重复发送。" };
      result.success = false;
    }
  }
  if (!payload.recipients.emails.length && !payload.recipients.whatsapps.length) result.success = false;
  try {
    pushLog({ id: `n_${crypto.randomUUID()}`, payload, result });
    window.dispatchEvent(new CustomEvent("risk-control:notifications-changed"));
  } catch {
    result.logError = "通知结果未能保存到本地，请核查服务商记录；不要因此重新发送。";
  }

  return result;
}

export async function sendTestNotification(
  channel: "email" | "whatsapp",
  targets: string[],
  overrideWebhook?: string
): Promise<NotificationResult> {
  const isEmail = channel === "email";
  const basePayload: NotificationPayload = {
    type: "INFO",
    severity: "LOW",
    title: isEmail ? "【测试】邮箱通道连通测试" : "【测试】WhatsApp 通道连通测试",
    message: isEmail
      ? `这是 RiskControl 风控系统通过 Email Webhook 发出的一封测试邮件。\n发送时间：${new Date().toLocaleString()}。\n如果您收到了本邮件，说明通知通道配置成功。`
      : `这是 RiskControl 风控系统通过 WhatsApp Webhook 发出的一条测试短信。\n发送时间：${new Date().toLocaleString()}。\n如您收到本条消息，说明 WhatsApp 通道已打通。`,
    recipients: {
      emails: isEmail ? targets : [],
      whatsapps: isEmail ? [] : targets,
    },
    timestamp: new Date(),
  };
  return sendNotification(basePayload, isEmail ? { emailWebhook: overrideWebhook } : { whatsappWebhook: overrideWebhook });
}

export async function triggerMarginCallAlert(
  batch: Batch,
  marginCall: MarginCall,
  bdManagers?: string[],
  channel?: "email" | "whatsapp"
): Promise<NotificationResult> {
  const notification = buildMarginCallNotification(batch, marginCall, bdManagers);
  if (channel === "email") notification.recipients.whatsapps = [];
  if (channel === "whatsapp") notification.recipients.emails = [];
  return sendNotification(notification);
}

export async function triggerWarningAlert(
  batch: Batch,
  dropPercent: number,
  safetyBufferPercent: number,
  channel?: "email" | "whatsapp"
): Promise<NotificationResult> {
  const notification = buildWarningNotification(
    batch,
    dropPercent,
    safetyBufferPercent
  );
  if (channel === "email") notification.recipients.whatsapps = [];
  if (channel === "whatsapp") notification.recipients.emails = [];
  return sendNotification(notification);
}

export async function triggerClientAddedAlert(
  batch: Batch,
  client: { name: string; investmentAmount: number; bdManager: string }
): Promise<NotificationResult> {
  const notification = buildClientAddedNotification(batch, client);
  return sendNotification(notification);
}

const pendingBatchNotifications = new Set<string>();
export async function notifyBatchChannel(
  batch: Batch & { clients?: Client[]; marginCalls?: MarginCall[] },
  channel: "email" | "whatsapp"
): Promise<string> {
  const key = `${batch.id}:${channel}`;
  if (pendingBatchNotifications.has(key)) throw new Error("该通知正在发送，请勿重复点击。");
  pendingBatchNotifications.add(key);
  try {
    const bds = [...new Set((batch.clients ?? []).map((c) => c.bdManager))];
    const current = batch.marginCalls?.find((m) => m.status === "PENDING");
    const payload = current ? buildMarginCallNotification(batch, current, bds)
      : buildWarningNotification(batch, Math.max(0, (1 - (batch.currentMarketValue ?? 0) / batch.initialTotalAmount) * 100), 0);
    const config = getRuntimeNotificationConfig();
    if (channel === "email") {
      payload.recipients.whatsapps = [];
      if (!payload.recipients.emails.length && config.defaultRiskEmail) payload.recipients.emails = [config.defaultRiskEmail];
    } else {
      payload.recipients.emails = [];
      if (!payload.recipients.whatsapps.length && config.emergencyPhone) payload.recipients.whatsapps = [config.emergencyPhone];
    }
    const targets = channel === "email" ? payload.recipients.emails : payload.recipients.whatsapps;
    if (!targets.length) throw new Error("请先到系统设置填写并启用真实收件人。");
    const result = await sendNotification(payload);
    if (!result.channels[channel].success) throw new Error(result.channels[channel].error || "通知发送失败。");
    return `服务商已受理 ${result.channels[channel].sentTo.length} 位收件人，请核对实际收件。${result.logError ?? ""}`;
  } finally {
    pendingBatchNotifications.delete(key);
  }
}
