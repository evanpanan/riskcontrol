import { Batch, Client, MarginCall } from "@prisma/client";
import {
  getEnabledRecipientEmails,
  getEnabledRecipientWhatsApps,
  getRiskRecipients,
} from "./riskRecipients";

const SETTINGS_LS_KEY = "risk_control_settings";

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
      emailWebhook: typeof parsed?.emailWebhook === "string" ? parsed.emailWebhook : undefined,
      whatsappWebhook: typeof parsed.whatsappWebhook === "string" ? parsed.whatsappWebhook : undefined,
      defaultRiskEmail: typeof parsed.defaultRiskEmail === "string" ? parsed.defaultRiskEmail : undefined,
      emergencyPhone: typeof parsed.emergencyPhone === "string" ? parsed.emergencyPhone : undefined,
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
}

export const LAST_NOTIFICATIONS_KEY = "risk_control_last_notifications";

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
    "BD_MANAGER",
    "OPERATIONS",
  ];
  const bdEmails = bdManagers?.length
    ? getRiskRecipients()
        .filter(
          (r) => r.role === "BD_MANAGER" && bdManagers.includes(r.name)
        )
        .map((r) => r.email)
    : [];
  const bdWhatsApps = bdManagers?.length
    ? getRiskRecipients()
        .filter(
          (r) =>
            r.role === "BD_MANAGER" && r.whatsapp && bdManagers.includes(r.name)
        )
        .map((r) => r.whatsapp as string)
    : [];

  return {
    type: "MARGIN_CALL",
    severity: "CRITICAL",
    title: `【紧急补仓警报】批次 ${batch.batchNumber} 已触发补仓机制`,
    message: `批次 ${batch.batchNumber}（${batch.stockSymbol}）当前市值跌幅达到 ${(
      marginCall.dropPercent * 100
    ).toFixed(2)}%，已触发 20% 补仓预警线。请立即处理补仓事宜。需补仓金额：${(
      marginCall.requiredAmount / 1000000
    ).toFixed(2)}M USD（$${marginCall.requiredAmount.toLocaleString()}）。`,
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
    .filter((r) => r.role === "BD_MANAGER" && bdNames.includes(r.name))
    .map((r) => r.email);

  return {
    type: "CLIENT_ADDED",
    severity: "LOW",
    title: `【新客户录入】批次 ${batch.batchNumber} 新增客户 ${client.name}`,
    message: `客户 ${client.name} 已成功录入批次 ${batch.batchNumber}（${
      batch.stockSymbol
    }），投资金额：$${client.investmentAmount.toLocaleString()}，负责 BD：${
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

  if (payload.recipients.emails.length) {
    try {
      const resp = await fetch("/api/notify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "email",
          payload,
          webhookOverride: config.emailWebhook,
        }),
      });
      const data = (await resp.json().catch(() => null)) as any;
      if (!resp.ok) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      result.channels.email = {
        success: true,
        sentTo: data?.sentTo || payload.recipients.emails,
        error: data?.error || undefined,
      };
    } catch (error) {
      // 后端不可用时，降级直接请求 webhook
      try {
        const hook = config.emailWebhook || process.env.EMAIL_WEBHOOK_URL;
        if (hook) {
          await fetch(hook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: payload.recipients.emails,
              subject: payload.title,
              body: payload.message,
              severity: payload.severity,
              details: payload.details,
            }),
          });
        } else {
          throw new Error(error instanceof Error ? error.message : "未配置 Email Webhook");
        }
      } catch (fallbackErr) {
        result.channels.email = {
          success: false,
          sentTo: [],
          error: fallbackErr instanceof Error ? fallbackErr.message : "Unknown error",
        };
        result.success = false;
      }
    }
  }

  if (payload.recipients.whatsapps.length) {
    try {
      const resp = await fetch("/api/notify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "whatsapp",
          payload,
          webhookOverride: config.whatsappWebhook,
        }),
      });
      const data = (await resp.json().catch(() => null)) as any;
      if (!resp.ok) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      result.channels.whatsapp = {
        success: true,
        sentTo: data?.sentTo || payload.recipients.whatsapps,
        error: data?.error || undefined,
      };
    } catch (error) {
      try {
        const hook = config.whatsappWebhook || process.env.WHATSAPP_WEBHOOK_URL;
        if (hook) {
          await fetch(hook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: payload.recipients.whatsapps,
              message: `*${payload.title}*\n\n${payload.message}`,
              severity: payload.severity,
            }),
          });
        } else {
          throw new Error(error instanceof Error ? error.message : "未配置 WhatsApp Webhook");
        }
      } catch (fallbackErr) {
        result.channels.whatsapp = {
          success: false,
          sentTo: [],
          error: fallbackErr instanceof Error ? fallbackErr.message : "Unknown error",
        };
        result.success = false;
      }
    }
  }

  if (typeof window !== "undefined") {
    console.groupCollapsed(
      `%c[NOTIFICATION ${payload.severity}] ${payload.title}`,
      "color: #fff; background: #000; padding: 2px 6px; border-radius: 4px;"
    );
    console.log("Payload:", payload);
    console.log("Result:", result);
    console.groupEnd();
  }

  pushLog({
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    payload,
    result,
  });

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
  bdManagers?: string[]
): Promise<NotificationResult> {
  const notification = buildMarginCallNotification(batch, marginCall, bdManagers);
  return sendNotification(notification);
}

export async function triggerWarningAlert(
  batch: Batch,
  dropPercent: number,
  safetyBufferPercent: number
): Promise<NotificationResult> {
  const notification = buildWarningNotification(
    batch,
    dropPercent,
    safetyBufferPercent
  );
  return sendNotification(notification);
}

export async function triggerClientAddedAlert(
  batch: Batch,
  client: { name: string; investmentAmount: number; bdManager: string }
): Promise<NotificationResult> {
  const notification = buildClientAddedNotification(batch, client);
  return sendNotification(notification);
}
