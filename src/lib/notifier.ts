import { getBatchMetrics, summarizeBatchMarginFromClients } from "./riskEngine";
import { Batch, Client, MarginCall } from "@prisma/client";
import {
  getEnabledRecipientEmails,
  getRiskRecipients,
} from "./riskRecipients";
import { readSharedSetting } from "./settingsStore";

const SETTINGS_LS_KEY = "risk_control_settings";
let notificationSendToken = "";
export function setNotificationSendToken(value: string) { notificationSendToken = value.trim(); }
export function hasNotificationSendToken() { return !!notificationSendToken; }

export interface RuntimeNotificationConfig {
  testOnly?: boolean;
  channels?: Array<"email" | "telegram">;
  emailWebhook?: string;
  defaultRiskEmail?: string;
  emergencyPhone?: string;
}

export function getRuntimeNotificationConfig(): RuntimeNotificationConfig {
  const empty: RuntimeNotificationConfig = {};
  if (typeof window === "undefined") return empty;
  try {
    const raw = readSharedSetting(SETTINGS_LS_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as any;
    return {
      emailWebhook: typeof parsed?.emailWebhook === "string" && !/example\.com/.test(parsed.emailWebhook) ? parsed.emailWebhook : undefined,
      defaultRiskEmail: typeof parsed.defaultRiskEmail === "string" && parsed.defaultRiskEmail !== "risk-control@institution.com" ? parsed.defaultRiskEmail : undefined,
      emergencyPhone: typeof parsed.emergencyPhone === "string" && parsed.emergencyPhone !== "+852-9123-4567" ? parsed.emergencyPhone : undefined,
    };
  } catch {
    return empty;
  }
}

export function getRuntimeThresholds(): { marginDropPercent?: number; warningDropPercent?: number } {
  const empty = { marginDropPercent: undefined, warningDropPercent: undefined };
  if (typeof window === "undefined") return empty;
  try {
    const raw = readSharedSetting(SETTINGS_LS_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as any;
    const warningDropPercent = typeof p?.warningThreshold === "number" && Number.isFinite(p.warningThreshold) && p.warningThreshold > 0 && p.warningThreshold < 100 ? p.warningThreshold : undefined;
    let marginDropPercent = typeof p?.marginThreshold === "number" && Number.isFinite(p.marginThreshold) && p.marginThreshold > 0 && p.marginThreshold <= 100 ? p.marginThreshold : undefined;
    if (typeof marginDropPercent === "number" && typeof warningDropPercent === "number" && marginDropPercent <= warningDropPercent) {
      marginDropPercent = Math.min(100, warningDropPercent + 0.01);
    }
    return { warningDropPercent, marginDropPercent };
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
    telegrams: string[];
    roles?: string[];
  };
  timestamp: Date;
}

export interface NotificationResult {
  success: boolean;
  sentAt: Date;
  recipientCount: { emails: number; telegrams: number };
  channels: {
    email: { success: boolean; sentTo: string[]; error?: string; status?: string };
    telegram: { success: boolean; sentTo: string[]; error?: string; status?: string };
    internal: { success: boolean; error?: string };
  };
  routing?: { dispatchId: string; status: string; summary: string; deduplicated: boolean };
  logError?: string;
}

export interface NotificationLogEntry {
  id: string;
  payload: NotificationPayload;
  result?: NotificationResult;
  status?: "success" | "failed" | "queued" | "partial";
  createdAt: string;
  updatedAt?: string;
}

export const LAST_NOTIFICATIONS_KEY_LEGACY = "risk_control_xmax_notifications_v1";
export const LAST_NOTIFICATIONS_KEY = "risk_control_notifications_v1";

function migrateNotificationLog(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = localStorage.getItem(LAST_NOTIFICATIONS_KEY_LEGACY);
    if (!legacy) return;
    if (!localStorage.getItem(LAST_NOTIFICATIONS_KEY)) {
      localStorage.setItem(LAST_NOTIFICATIONS_KEY, legacy);
    }
    localStorage.removeItem(LAST_NOTIFICATIONS_KEY_LEGACY);
  } catch {}
}

function getLog(): NotificationLogEntry[] {
  if (typeof window === "undefined") return [];
  migrateNotificationLog();
  try {
    const raw = localStorage.getItem(LAST_NOTIFICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function pushLog(entry: NotificationLogEntry) {
  if (typeof window === "undefined") return;
  migrateNotificationLog();
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

export function pushInternalNotification(payload: Omit<NotificationPayload, "recipients" | "timestamp"> & { recipients?: NotificationPayload["recipients"]; timestamp?: Date }) {
  if (typeof window === "undefined") return;
  const entry: NotificationLogEntry = {
    id: `n_${crypto.randomUUID()}`,
    payload: {
      ...payload,
      recipients: payload.recipients || { emails: [], telegrams: [] },
      timestamp: payload.timestamp || new Date(),
    },
    result: {
      success: true,
      sentAt: new Date(),
      recipientCount: { emails: 0, telegrams: 0 },
      channels: { 
        internal: { success: true },
        email: { success: true, sentTo: [] },
        telegram: { success: true, sentTo: [] }
      }
    },
    createdAt: new Date().toISOString(),
    status: "success",
  };
  pushLog(entry);
  window.dispatchEvent(new CustomEvent("risk-control:notifications-changed"));
}

export function buildMarginCallNotification(
  batch: Batch,
  marginCall: MarginCall,
  bdManagers?: string[],
  opts?: { marginDropPercent?: number; warningDropPercent?: number }
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


  const marginPct = typeof opts?.marginDropPercent === "number" && opts.marginDropPercent > 0 ? opts.marginDropPercent : 20;
  const warnPct = typeof opts?.warningDropPercent === "number" && opts.warningDropPercent > 0 ? opts.warningDropPercent : 15;
  return {
    type: "MARGIN_CALL",
    severity: "CRITICAL",
    title: `【紧急补仓警报】批次 ${batch.batchNumber} 已触发补仓机制`,
    message: `批次 ${batch.batchNumber}（${batch.stockSymbol}）当前仓位价值跌幅达到 ${(
      marginCall.dropPercent * 100
    ).toFixed(2)}%，已触发 ${marginPct.toFixed(2)}% 补仓预警线（预警阈值 ${warnPct.toFixed(
      2
    )}%）。请立即处理补仓事宜。需补仓金额：${(
      Math.max(0, marginCall.requiredAmount - (marginCall.fulfilledAmount ?? 0)) / 1000000
    ).toFixed(2)}M USD（$${Math.max(0, marginCall.requiredAmount - (marginCall.fulfilledAmount ?? 0)).toLocaleString()}）。`,
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    stockSymbol: batch.stockSymbol,
    details: {
      marginCallId: marginCall.id,
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
      warningDropPercent: warnPct,
      marginDropPercent: marginPct,
    },
    recipients: {
      emails: getEnabledRecipientEmails(roles, bdEmails),
      telegrams: [],
      roles,
    },
    timestamp: new Date(),
  };
}

export function buildWarningNotification(
  batch: Batch,
  dropPercent: number,
  safetyBufferPercent: number,
  opts?: { marginDropPercent?: number; warningDropPercent?: number }
): NotificationPayload {
  const roles: ("RISK_MANAGER" | "RISK_ANALYST" | "BD_MANAGER")[] = [
    "RISK_MANAGER",
    "RISK_ANALYST",
  ];
  const marginPct = typeof opts?.marginDropPercent === "number" && opts.marginDropPercent > 0 ? opts.marginDropPercent : 20;
  const warnPct = typeof opts?.warningDropPercent === "number" && opts.warningDropPercent > 0 ? opts.warningDropPercent : 15;
  return {
    type: "WARNING",
    severity: "MEDIUM",
    title: `【风险预警】批次 ${batch.batchNumber} 达到 ${warnPct.toFixed(2)}% 预警阈值`,
    message: `批次 ${batch.batchNumber}（${batch.stockSymbol}）当前跌幅 ${dropPercent.toFixed(
      2
    )}%，已触发 ${warnPct.toFixed(2)}% 预警阈值；距离 ${marginPct.toFixed(
      2
    )}% 补仓线仅剩 ${safetyBufferPercent.toFixed(
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
      warningDropPercent: warnPct,
      marginDropPercent: marginPct,
    },
    recipients: {
      emails: getEnabledRecipientEmails(roles),
      telegrams: [],
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
      telegrams: [],
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
      emails: 0,
      telegrams: 0,
    },
    channels: {
      email: { success: false, sentTo: [] },
      telegram: { success: false, sentTo: [] },
      internal: { success: true },
    },
  };

  if (!config.testOnly) {
    try {
      const response = await fetch('/api/notify/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${notificationSendToken}` }, body: JSON.stringify({ mode: 'policy', payload }) });
      const data = await response.json();
      if (!response.ok || !data.dispatchId) throw new Error(data.error || '通知未能持久化，请稍后重试');
      result.success = data.success;
      result.channels.email = data.channels.email;
      result.channels.telegram = data.channels.telegram;
      result.recipientCount = { emails: data.channels.email.sentTo.length, telegrams: data.channels.telegram.sentTo.length };
      result.routing = { dispatchId: data.dispatchId, status: data.status, summary: data.summary, deduplicated: data.deduplicated };
    } catch(error) {
      const message=error instanceof Error?error.message:'通知连接失败';
      result.success=false;result.channels.internal={success:false,error:message};
      result.routing={dispatchId:'',status:'ERROR',summary:message,deduplicated:false};
    }
  } else {

  for (const channel of config.channels ?? ["email", "telegram"] as const) {
    const targets = channel === "email" ? payload.recipients.emails : payload.recipients.telegrams;
    result.channels[channel] = { success: false, sentTo: [] };
    if (channel === "email" && !targets.length) continue;
    try {
      const resp = await fetch("/api/notify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${notificationSendToken}` },
        body: JSON.stringify({
          channel,
          test: true,
          payload,
          webhookOverride: channel === "email" ? config.emailWebhook : undefined,
        }),
      });
      const data = (await resp.json().catch(() => null)) as any;
      const sentTo = Array.isArray(data?.sentTo) ? data.sentTo : [];
      const success = resp.ok && data?.success === true && (channel === "telegram" ? sentTo.length > 0 : sentTo.length === new Set(targets).size);
      if (channel === "telegram") result.recipientCount.telegrams = sentTo.length;
      else result.recipientCount.emails = sentTo.length;
      result.channels[channel] = {
        success, sentTo, status: success ? "accepted" : data?.failureKind === "unknown" ? "unknown" : "failed",
        error: success ? undefined : data?.error || "发送未获确认，请先核查服务商记录，勿直接重复发送。",
      };
      if (!success) result.success = false;
    } catch {
      result.channels[channel] = { success: false, sentTo: [], status: "unknown",
        error: "连接中断，是否已受理未知；请先核查服务商记录，勿直接重复发送。" };
      result.success = false;
    }
  }
  if (!result.channels.email.sentTo.length && !result.channels.telegram.sentTo.length) result.success = false;
  }
  try {
    pushLog({ 
      id: `n_${crypto.randomUUID()}`, 
      payload, 
      result, 
      createdAt: new Date().toISOString(),
      status: result.success ? "success" : result.routing && ["PENDING", "PROCESSING", "REVIEW"].includes(result.routing.status) ? "queued" : result.recipientCount.emails + result.recipientCount.telegrams > 0 ? "partial" : "failed",
    });
    window.dispatchEvent(new CustomEvent("risk-control:notifications-changed"));
  } catch {
    result.logError = "通知结果未能保存到本地，请核查服务商记录；不要因此重新发送。";
  }

  return result;
}

export async function sendTestNotification(
  channel: "email" | "telegram",
  targets: string[],
  overrideWebhook?: string
): Promise<NotificationResult> {
  const isEmail = channel === "email";
  const basePayload: NotificationPayload = {
    type: "INFO",
    severity: "LOW",
    title: isEmail ? "【测试】邮箱通道连通测试" : "【测试】Telegram 通道连通测试",
    message: isEmail
      ? `这是 RiskControl 风控系统发出的一封测试邮件。\n发送时间：${new Date().toLocaleString()}。\n如果您收到了本邮件，说明通知通道配置成功。`
      : `这是 RiskControl 风控系统发出的一条测试消息。\n发送时间：${new Date().toLocaleString()}。\n如您收到本条消息，说明 Telegram 通道已打通。`,
    recipients: {
      emails: isEmail ? targets : [],
      telegrams: isEmail ? [] : targets,
    },
    timestamp: new Date(),
  };
  return sendNotification(basePayload, { testOnly: true, channels: [channel], ...(isEmail ? { emailWebhook: overrideWebhook } : {}) });
}

export async function triggerMarginCallAlert(
  batch: Batch,
  marginCall: MarginCall,
  bdManagers?: string[],
  channel?: "email" | "telegram"
): Promise<NotificationResult> {
  const notification = buildMarginCallNotification(batch, marginCall, bdManagers, getRuntimeThresholds());
  if (channel === "email") notification.recipients.telegrams = [];
  if (channel === "telegram") notification.recipients.emails = [];
  return sendNotification(notification, channel ? { channels: [channel] } : undefined);
}

export async function triggerWarningAlert(
  batch: Batch,
  dropPercent: number,
  safetyBufferPercent: number,
  channel?: "email" | "telegram"
): Promise<NotificationResult> {
  const notification = buildWarningNotification(
    batch,
    dropPercent,
    safetyBufferPercent,
    getRuntimeThresholds()
  );
  if (channel === "email") notification.recipients.telegrams = [];
  if (channel === "telegram") notification.recipients.emails = [];
  return sendNotification(notification, channel ? { channels: [channel] } : undefined);
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
  channel: "email" | "telegram" = "telegram"
): Promise<string> {
  const key = `${batch.id}:${channel}`;
  if (pendingBatchNotifications.has(key)) throw new Error('该提醒正在处理，请勿重复点击。');
  pendingBatchNotifications.add(key);
  try {
    const bds = [...new Set((batch.clients ?? []).map(c => c.bdManager))];
    const current = batch.marginCalls?.find(m => m.status === 'PENDING' && m.requiredAmount - (m.fulfilledAmount ?? 0) > 0.005);
    const thresholds = getRuntimeThresholds();
    const drop = Math.max(0, (1 - (batch.currentMarketValue ?? 0) / (batch.initialTotalAmount ?? 1)) * 100);
    const payload = current ? buildMarginCallNotification(batch, current, bds, thresholds) : buildWarningNotification(batch, drop, Math.max(0,(thresholds.marginDropPercent ?? 20)-drop), thresholds);
    const metrics = getBatchMetrics(batch as any);
    if (metrics.riskLevel === 'CRITICAL' || summarizeBatchMarginFromClients(batch as any).totalPending > 0) payload.severity = 'CRITICAL';
    const response = await fetch("/api/notify/send", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "manual", channel, payload }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "通知发送失败");
    const selected = result.channels?.[channel];
    if (!selected?.success) throw new Error(selected?.error || result.summary || "发送尚未确认，请查看通知记录");
    return result.deduplicated ? `${channel === "telegram" ? "Telegram" : "邮件"}此前已发送成功，本次未重复发送` : `${channel === "telegram" ? "Telegram" : "邮件"}发送成功`;

  } finally { pendingBatchNotifications.delete(key); }
}
