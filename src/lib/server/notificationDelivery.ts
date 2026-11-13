import { NotificationTransportError, unknownNotificationOutcome } from "./notificationErrors";
import { formatTelegramAlert, sendTelegramChannel } from "./telegram";

type Channel = "email" | "telegram";
type Env = Record<string, string | undefined>;
const configured = (value?: string): value is string =>
  !!value?.trim() && !/example\.com|your[-_.]|x{4}|placeholder|riskcontrol\.local/i.test(value);
const emailValid = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const phoneValid = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function provider(channel: Channel, env: Env) {
  if (channel === "email" && configured(env.EMAIL_WEBHOOK_URL)) return "webhook";
  if (channel === "email") {
    if (configured(env.RESEND_API_KEY)) return "resend";
    if (configured(env.POSTMARK_SERVER_TOKEN)) return "postmark";
    if (configured(env.SENDGRID_API_KEY)) return "sendgrid";
  } else {
    if (configured(env.TELEGRAM_BOT_TOKEN)) return "telegram";
  }
  return "none";
}

export function notificationReadiness(env: Env = process.env) {
  const authConfigured = (env.NOTIFICATION_SEND_TOKEN?.trim().length ?? 0) >= 32;
  const channels = Object.fromEntries((["email", "telegram"] as const).map((channel) => {
    const selected = provider(channel, env);
    const issues: string[] = [];
    if (selected === "none") issues.push(channel === "email" ? "邮件发送服务尚未开通，请联系系统运维启用" : "Telegram 频道服务尚未配置，请联系管理员设置 Bot Token");
    if (channel === "email" && selected !== "webhook" && selected !== "none" &&
        !configured(env.NOTIFICATION_FROM_EMAIL)) issues.push("发件邮箱尚未验证，请联系系统运维完成发件地址验证");
    return [channel, { provider: selected, ready: !issues.length, issues }];
  })) as Record<Channel, { provider: string; ready: boolean; issues: string[] }>;
  return { authConfigured, ...channels };
}

async function request(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(12000) });
  } catch {
    throw new NotificationTransportError("服务商响应超时或连接失败；是否受理未知，请先核查服务商记录，勿立即重发。", "unknown");
  }
  if (response.status >= 500 || response.status === 408) throw new NotificationTransportError("服务商响应异常，是否受理未知，请人工核查", "unknown");
  if (!response.ok) {
    // Never return the provider's raw body: webhook URLs, credentials or recipient data may be echoed.
    throw new Error(`服务商拒绝请求（HTTP ${response.status}），请核对凭据、发件资格、模板及收件人授权。`);
  }
  return response;
}

function allowedWebhook(value: string, configuredUrl: string) {
  if (value !== configuredUrl) throw new Error("转发地址必须与系统已配置的地址完全一致；留空即可使用系统默认通道。");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("转发地址必须使用不含账号密码的 HTTPS 地址。");
  }
  // Only an operator-controlled server environment can choose the destination; redirects are disabled.
  return url.toString();
}

export type EmailAttachment = { filename: string; content: string; contentType: string };

export async function deliverNotification(body: any, env: Env = process.env, attachments: EmailAttachment[] = []) {
  const channel = body?.channel as Channel;
  if (channel !== "email" && channel !== "telegram") throw new Error("通知渠道无效。");
  const payload = body?.payload;
  if (typeof payload?.title !== "string" || typeof payload.message !== "string" ||
      !payload.title.trim() || payload.title.length > 200 || payload.message.length > 4000) {
    throw new Error("请提供有效通知标题和正文（最多200和4000字符）。");
  }
  let targets: string[] = [];

  if (channel === "email") {
    const raw = payload.recipients?.emails;
    if (!Array.isArray(raw) || raw.some((v: unknown) => typeof v !== "string")) {
      throw new Error("收件人列表无效。");
    }
    targets = [...new Set<string>(raw.map((v: string) => v.trim()))];
  } else {
    const status = notificationReadiness(env).telegram;
    if (!status.ready) throw new Error(status.issues.join('；'));
    if (body.webhookOverride) throw new Error('Telegram 频道不使用自定义转发地址');
    const alert = formatTelegramAlert(payload.title, payload.message, payload.severity);
    const sentTo = await sendTelegramChannel(alert.text, env, alert.entities);
    return { success: true, sentTo, status: 'accepted', error: undefined };
  }

  if (!targets.length) {
    throw new Error("请提供收件邮箱。");
  }
  if (targets.some((v) => !emailValid(v))) {
    throw new Error("收件邮箱格式无效。");
  }
  const status = notificationReadiness(env)[channel];
  if (!status.ready) throw new Error(status.issues.join("；"));
  const configuredUrl = env.EMAIL_WEBHOOK_URL ?? "";
  if (body.webhookOverride && body.webhookOverride !== configuredUrl) {
    throw new Error("该转发地址未获授权。请让管理员配置相同地址，或清空输入使用系统默认通道。");
  }
  const selected = provider(channel, env);
  const sentTo: string[] = [];
  const errors: string[] = [];
  let unknownOutcome = false;
  const json = (value: unknown, headers = {}): RequestInit => ({
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
  });
  const message = `${payload.title}\n\n${payload.message}`;

  const from = env.NOTIFICATION_FROM_EMAIL!;
  const html = `<h2>${escapeHtml(payload.title)}</h2><p>${escapeHtml(payload.message).replace(/\n/g, "<br>")}</p>`;

  if (selected === "webhook") {
    const response = await request(allowedWebhook(body.webhookOverride || configuredUrl, configuredUrl), json({
      channel, to: targets, subject: payload.title, title: payload.title,
      message: payload.message, body: payload.message, text: message, html,
      severity: payload.severity, type: payload.type, batchId: payload.batchId, details: payload.details,
      ...(attachments.length ? { attachments } : {}),
    }));
    const data = await response.json().catch(() => null);
    if (data?.success === false) throw new Error("通知转发目标返回失败，请检查自动化流程执行记录。");
    if (Array.isArray(data?.sentTo)) {
      sentTo.push(...targets.filter((target) => data.sentTo.includes(target)));
      if (sentTo.length !== targets.length) errors.push("部分收件人未获服务商受理，请检查流程执行记录。");
    } else sentTo.push(...targets);
  } else {
    // Send individually to avoid exposing one recipient's address to the others.
    for (const target of targets) {
      try {
        if (selected === "resend") {
          await request("https://api.resend.com/emails", json(
            { from, to: [target], subject: payload.title, text: message, html, ...(attachments.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.content, content_type: a.contentType })) } : {}) },
            { Authorization: `Bearer ${env.RESEND_API_KEY}` }));
        } else if (selected === "postmark") {
          const response = await request("https://api.postmarkapp.com/email", json({
            From: from, To: target, Subject: payload.title, TextBody: message, HtmlBody: html,
            ...(attachments.length ? { Attachments: attachments.map(a => ({ Name: a.filename, Content: a.content, ContentType: a.contentType })) } : {}),
          }, { "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN! }));
          const data = await response.json().catch(() => null);
          if (!data || data.ErrorCode !== 0) throw new Error("Postmark 未确认受理，请检查服务商日志。");
        } else if (selected === "sendgrid") {
          const fromEmail = from.match(/<([^>]+)>/)?.[1] ?? from;
          await request("https://api.sendgrid.com/v3/mail/send", json({
            from: { email: fromEmail }, personalizations: [{ to: [{ email: target }] }],
            subject: payload.title, content: [{ type: "text/plain", value: message }, { type: "text/html", value: html }],
            ...(attachments.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.content, type: a.contentType, disposition: "attachment" })) } : {}),
          }, { Authorization: `Bearer ${env.SENDGRID_API_KEY}` }));
        }
        sentTo.push(target);
      } catch (err) {
        unknownOutcome ||= unknownNotificationOutcome(err);
        errors.push(`${target}: ${err instanceof Error ? err.message : "发送失败"}`);
      }
    }
  }
  return { success: sentTo.length === targets.length && !errors.length, sentTo,
    status: sentTo.length === targets.length ? "accepted" : sentTo.length ? "partial" : "failed",
    error: errors.length ? errors.join("；") : undefined, failureKind: unknownOutcome ? "unknown" as const : "failed" as const };
}
