type Channel = "email" | "whatsapp";
type Env = Record<string, string | undefined>;
const configured = (value?: string): value is string =>
  !!value?.trim() && !/example\.com|your[-_.]|x{4}|placeholder|riskcontrol\.local/i.test(value);
const emailValid = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const phoneValid = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function provider(channel: Channel, env: Env) {
  if (configured(env[channel === "email" ? "EMAIL_WEBHOOK_URL" : "WHATSAPP_WEBHOOK_URL"])) return "webhook";
  if (channel === "email") {
    if (configured(env.RESEND_API_KEY)) return "resend";
    if (configured(env.POSTMARK_SERVER_TOKEN)) return "postmark";
    if (configured(env.SENDGRID_API_KEY)) return "sendgrid";
  } else {
    if (configured(env.TWILIO_ACCOUNT_SID) && configured(env.TWILIO_AUTH_TOKEN)) return "twilio";
    if (configured(env.META_WA_ACCESS_TOKEN) && configured(env.META_WA_PHONE_NUMBER_ID)) return "meta";
  }
  return "none";
}

export function notificationReadiness(env: Env = process.env) {
  const authConfigured = (env.NOTIFICATION_SEND_TOKEN?.trim().length ?? 0) >= 32;
  const channels = Object.fromEntries((["email", "whatsapp"] as const).map((channel) => {
    const selected = provider(channel, env);
    const issues: string[] = [];
    if (!authConfigured) issues.push("配置 NOTIFICATION_SEND_TOKEN（至少32位）");
    if (selected === "none") issues.push(channel === "email" ? "配置 Resend API Key 和已验证的发件地址" : "配置 Twilio 或 Meta WhatsApp 服务");
    if (channel === "email" && selected !== "webhook" && selected !== "none" &&
        !configured(env.NOTIFICATION_FROM_EMAIL)) issues.push("配置已验证的 NOTIFICATION_FROM_EMAIL");
    if (selected === "twilio") {
      if (!phoneValid((env.TWILIO_WHATSAPP_FROM_NUMBER ?? "").replace(/^whatsapp:/, ""))) issues.push("配置 WhatsApp 发件号码");
      if (!configured(env.TWILIO_WHATSAPP_CONTENT_SID)) issues.push("配置审核通过的 WhatsApp 模板 Content SID");
    }
    if (selected === "meta" && (!configured(env.META_WA_TEMPLATE_NAME) || !configured(env.META_GRAPH_API_VERSION))) {
      issues.push("配置审核通过的模板名和当前受支持的 Graph API 版本");
    }
    return [channel, { provider: selected, ready: !issues.length, issues }];
  })) as Record<Channel, { provider: string; ready: boolean; issues: string[] }>;
  return { authConfigured, ...channels };
}

async function request(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(12000) });
  } catch {
    throw new Error("服务商响应超时或连接失败；是否受理未知，请先核查服务商记录，勿立即重发。");
  }
  if (!response.ok) {
    // Never return the provider's raw body: webhook URLs, credentials or recipient data may be echoed.
    throw new Error(`服务商拒绝请求（HTTP ${response.status}），请核对凭据、发件资格、模板及收件人授权。`);
  }
  return response;
}

function allowedWebhook(value: string, configuredUrl: string) {
  if (value !== configuredUrl) throw new Error("Webhook 必须与服务端配置的地址完全一致；留空即可使用服务端配置。");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Webhook 必须使用不含账号密码的 HTTPS 地址。");
  }
  // Only an operator-controlled server environment can choose the destination; redirects are disabled.
  return url.toString();
}

export async function deliverNotification(body: any, env: Env = process.env) {
  const channel = body?.channel as Channel;
  if (channel !== "email" && channel !== "whatsapp") throw new Error("通知渠道无效。");
  const payload = body?.payload;
  if (typeof payload?.title !== "string" || typeof payload.message !== "string" ||
      !payload.title.trim() || payload.title.length > 200 || payload.message.length > 4000) {
    throw new Error("请提供有效通知标题和正文（最多200和4000字符）。");
  }
  const raw = payload.recipients?.[channel === "email" ? "emails" : "whatsapps"];
  if (!Array.isArray(raw) || !raw.length || raw.length > 20 || raw.some((v: unknown) => typeof v !== "string")) {
    throw new Error("每次需提供1至20位有效收件人。");
  }
  const targets = [...new Set<string>(raw.map((v: string) => channel === "email"
    ? v.trim() : v.trim().replace(/[\s()-]/g, "")))];
  if (targets.some((v) => !(channel === "email" ? emailValid(v) : phoneValid(v)))) {
    throw new Error(channel === "email" ? "收件邮箱格式无效。" : "WhatsApp 号码须含国家区号，例如 +85291234567。");
  }
  const status = notificationReadiness(env)[channel];
  if (!status.ready) throw new Error(status.issues.join("；"));
  const configuredUrl = env[channel === "email" ? "EMAIL_WEBHOOK_URL" : "WHATSAPP_WEBHOOK_URL"] ?? "";
  if (body.webhookOverride && body.webhookOverride !== configuredUrl) {
    throw new Error("Webhook 未获服务端授权。请让管理员配置相同地址，或清空输入使用服务端通道。");
  }
  const selected = provider(channel, env);
  const sentTo: string[] = [];
  const errors: string[] = [];
  const json = (value: unknown, headers = {}): RequestInit => ({
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
  });
  const message = `${payload.title}\n\n${payload.message}`;
  // WhatsApp template parameters cannot contain newlines or tab characters.
  const templateMessage = message.replace(/\s+/g, " ").trim();
  const from = env.NOTIFICATION_FROM_EMAIL!;
  const html = `<h2>${escapeHtml(payload.title)}</h2><p>${escapeHtml(payload.message).replace(/\n/g, "<br>")}</p>`;

  if (selected === "webhook") {
    const response = await request(allowedWebhook(body.webhookOverride || configuredUrl, configuredUrl), json({
      channel, to: targets, subject: payload.title, title: payload.title,
      message: payload.message, body: payload.message, text: message, html,
      severity: payload.severity, type: payload.type, batchId: payload.batchId, details: payload.details,
    }));
    const data = await response.json().catch(() => null);
    if (data?.success === false) throw new Error("Webhook 返回业务失败，请检查自动化流程执行记录。");
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
            { from, to: [target], subject: payload.title, text: message, html },
            { Authorization: `Bearer ${env.RESEND_API_KEY}` }));
        } else if (selected === "postmark") {
          const response = await request("https://api.postmarkapp.com/email", json({
            From: from, To: target, Subject: payload.title, TextBody: message, HtmlBody: html,
          }, { "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN! }));
          const data = await response.json().catch(() => null);
          if (!data || data.ErrorCode !== 0) throw new Error("Postmark 未确认受理，请检查服务商日志。");
        } else if (selected === "sendgrid") {
          const fromEmail = from.match(/<([^>]+)>/)?.[1] ?? from;
          await request("https://api.sendgrid.com/v3/mail/send", json({
            from: { email: fromEmail }, personalizations: [{ to: [{ email: target }] }],
            subject: payload.title, content: [{ type: "text/plain", value: message }, { type: "text/html", value: html }],
          }, { Authorization: `Bearer ${env.SENDGRID_API_KEY}` }));
        } else if (selected === "twilio") {
          const form = new URLSearchParams({
            From: `whatsapp:${env.TWILIO_WHATSAPP_FROM_NUMBER!.replace(/^whatsapp:/, "")}`,
            To: `whatsapp:${target}`, ContentSid: env.TWILIO_WHATSAPP_CONTENT_SID!,
            ContentVariables: JSON.stringify({ "1": templateMessage }),
          });
          await request(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`, {
            method: "POST", headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            }, body: form.toString(),
          });
        } else if (selected === "meta") {
          if (!/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION!)) throw new Error("Graph API 版本格式应为 v数字.数字。");
          await request(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(env.META_WA_PHONE_NUMBER_ID!)}/messages`, json({
            messaging_product: "whatsapp", to: target.slice(1), type: "template",
            template: { name: env.META_WA_TEMPLATE_NAME, language: { code: env.META_WA_TEMPLATE_LANGUAGE || "zh_CN" },
              components: [{ type: "body", parameters: [{ type: "text", text: templateMessage }] }] },
          }, { Authorization: `Bearer ${env.META_WA_ACCESS_TOKEN}` }));
        }
        sentTo.push(target);
      } catch (err) {
        errors.push(`${target}: ${err instanceof Error ? err.message : "发送失败"}`);
      }
    }
  }
  return { success: sentTo.length === targets.length && !errors.length, sentTo,
    status: sentTo.length === targets.length ? "accepted" : sentTo.length ? "partial" : "failed",
    error: errors.length ? errors.join("；") : undefined };
}
