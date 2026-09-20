import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NotifySendBody {
  channel: "email" | "whatsapp";
  payload: {
    type?: string;
    severity?: string;
    title: string;
    message: string;
    batchId?: string;
    stockSymbol?: string;
    details?: Record<string, unknown>;
    recipients: {
      emails?: string[];
      whatsapps?: string[];
    };
    timestamp?: string | Date;
  };
  webhookOverride?: string;
}

type DetectedProvider =
  | "resend"
  | "postmark"
  | "sendgrid"
  | "twilio"
  | "meta_graph"
  | "make"
  | "n8n"
  | "zapier"
  | "generic";

function detectProvider(urlOrHost: string, channel: "email" | "whatsapp"): DetectedProvider {
  const s = urlOrHost.toLowerCase();
  if (s.includes("api.resend.com")) return "resend";
  if (s.includes("api.postmarkapp.com")) return "postmark";
  if (s.includes("api.sendgrid.com") || s.includes("sendgrid")) return "sendgrid";
  if (s.includes("api.twilio.com")) return "twilio";
  if (s.includes("graph.facebook.com") || s.includes("graph.instagram.com")) return "meta_graph";
  if (s.includes("hook.us1.make.com") || s.includes("hook.make.com") || s.includes("make.com")) return "make";
  if (s.includes("n8n") || s.includes("webhook.n8n.io")) return "n8n";
  if (s.includes("hooks.zapier.com") || s.includes("zapier")) return "zapier";
  return "generic";
}

function buildHtmlEmail(title: string, message: string, details?: Record<string, unknown>) {
  const detailRows =
    details && Object.keys(details).length
      ? Object.entries(details)
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 8px;border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${k}</td><td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:12px;">${String(
                v ?? ""
              )}</td></tr>`
          )
          .join("")
      : "";
  const detailBlock = detailRows
    ? `<br/><div style="font-size:13px;color:#374151;"><b>详情数据：</b><br/><table style="border-collapse:collapse;margin-top:6px;">${detailRows}</table></div>`
    : "";
  const msgHtml = message
    .split("\n")
    .map((l) => `<div>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`)
    .join("");
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#111827;">
      <div style="padding:14px 18px;background:linear-gradient(90deg,#0b1220,#1e293b);border-radius:10px 10px 0 0;color:#f8fafc;">
        <div style="font-weight:700;font-size:15px;">RiskControl 风控系统</div>
        <div style="font-size:12px;opacity:.85;margin-top:2px;">Notification Service · ${new Date().toLocaleString()}</div>
      </div>
      <div style="padding:18px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;border-radius:0 0 10px 10px;background:#ffffff;">
        <h3 style="margin:0 0 10px 0;font-size:16px;">${title}</h3>
        <div style="font-size:13px;color:#1f2937;">${msgHtml}</div>
        ${detailBlock}
      </div>
      <div style="margin-top:10px;font-size:11px;color:#9ca3af;">本邮件由 RiskControl 通知服务自动发送，请勿直接回复。</div>
    </div>`;
}

function buildWaMarkdown(title: string, message: string, details?: Record<string, unknown>) {
  const detailBlock =
    details && Object.keys(details).length
      ? "\n\n*详情:*\n" +
        Object.entries(details)
          .map(([k, v]) => `• ${k}: ${String(v ?? "")}`)
          .join("\n")
      : "";
  return `*${title}*\n\n${message}${detailBlock}\n\n—— RiskControl 风控系统`;
}

async function sendGeneric(webhookUrl: string, channel: "email" | "whatsapp", bodyObj: any) {
  const r = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(`Generic webhook HTTP ${r.status}: ${text.slice(0, 500)}`);
  }
  return { ok: true, raw: text.slice(0, 400) };
}

async function sendResend(apiKey: string, from: string, to: string[], subject: string, text: string, html: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${data?.message || JSON.stringify(data)}`);
  return { ok: true, id: data?.id };
}

async function sendPostmark(apiKey: string, from: string, to: string[], subject: string, text: string, html: string) {
  const r = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": apiKey,
    },
    body: JSON.stringify({
      From: from,
      To: to.join(","),
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
    }),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Postmark HTTP ${r.status}: ${data?.Message || JSON.stringify(data)}`);
  return { ok: true, id: data?.MessageID };
}

async function sendSendgrid(apiKey: string, from: string, to: string[], subject: string, text: string, html: string) {
  const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: to.map((email) => ({ email })) }],
      from: { email: from },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });
  if (!r.ok) {
    const text_ = await r.text().catch(() => "");
    throw new Error(`SendGrid HTTP ${r.status}: ${text_.slice(0, 400)}`);
  }
  return { ok: true };
}

async function sendTwilioSMS(
  accountSid: string,
  authToken: string,
  from: string,
  toNumbers: string[],
  body: string
) {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const errors: string[] = [];
  const sent: string[] = [];
  for (const to of toNumbers) {
    try {
      const cleanTo = to.replace(/[^0-9+]/g, "");
      const params = new URLSearchParams();
      params.set("From", from);
      params.set("To", cleanTo);
      params.set("Body", body);
      const r = await fetch(base, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        errors.push(`${cleanTo}: ${d?.message || d?.Message || "HTTP " + r.status}`);
      } else {
        sent.push(cleanTo);
      }
    } catch (e: any) {
      errors.push(`${to}: ${e?.message || String(e)}`);
    }
  }
  if (errors.length && !sent.length) throw new Error(errors.join("; "));
  return { ok: true, sent, errors: errors.length ? errors : undefined };
}

async function sendMetaWa(
  accessToken: string,
  phoneNumberId: string,
  toNumbers: string[],
  body: string
) {
  const errors: string[] = [];
  const sent: string[] = [];
  for (const to of toNumbers) {
    try {
      const cleanTo = to.replace(/[^0-9+]/g, "").replace(/^\+/, "");
      const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanTo,
          text: { body },
        }),
      });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        errors.push(`${cleanTo}: ${d?.error?.message || JSON.stringify(d?.error || d)}`);
      } else {
        sent.push("+" + cleanTo);
      }
    } catch (e: any) {
      errors.push(`${to}: ${e?.message || String(e)}`);
    }
  }
  if (errors.length && !sent.length) throw new Error(errors.join("; "));
  return { ok: true, sent, errors: errors.length ? errors : undefined };
}

function normalizeEmails(raw?: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x || "").trim())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

function normalizePhones(raw?: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x || "").trim())
    .filter((x) => x.replace(/[^0-9+]/g, "").length >= 8);
}

const PLACEHOLDER_RE = /(^your[-_]|your$|example\.com|xxxx|xxx|placeholder|^hk$|^your\.)/i;

function isValidWebhook(url?: string): url is string {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    new URL(url);
  } catch {
    return false;
  }
  const lower = url.toLowerCase();
  if (PLACEHOLDER_RE.test(lower)) return false;
  if (lower.includes("riskcontrol.local")) return false;
  return true;
}

export async function POST(req: NextRequest) {
  const sentTo: string[] = [];
  try {
    const body = (await req.json().catch(() => null)) as NotifySendBody | null;
    if (!body || !body.channel || !body.payload) {
      return NextResponse.json(
        { success: false, sentTo: [], error: "Invalid body: {channel, payload, webhookOverride?} required" },
        { status: 400 }
      );
    }
    const { channel, payload, webhookOverride } = body;
    const targets =
      channel === "email"
        ? normalizeEmails(payload.recipients?.emails)
        : normalizePhones(payload.recipients?.whatsapps);
    if (targets.length === 0) {
      return NextResponse.json(
        {
          success: false,
          sentTo: [],
          error:
            channel === "email"
              ? "No valid email recipients"
              : "No valid WhatsApp recipients",
        },
        { status: 400 }
      );
    }

    const envWebhook =
      channel === "email" ? process.env.EMAIL_WEBHOOK_URL : process.env.WHATSAPP_WEBHOOK_URL;
    const webhook = isValidWebhook(webhookOverride)
      ? webhookOverride!
      : isValidWebhook(envWebhook)
        ? envWebhook!
        : "";

    const title = payload.title || "RiskControl 通知";
    const message = payload.message || "";
    const details = payload.details;

    if (channel === "email") {
      const html = buildHtmlEmail(title, message, details);
      const text = `${title}\n\n${message}${
        details && Object.keys(details).length
          ? "\n\n详情:\n" +
            Object.entries(details)
              .map(([k, v]) => `${k}: ${String(v ?? "")}`)
              .join("\n")
          : ""
      }`;
      const apiKeyResend = process.env.RESEND_API_KEY;
      const apiKeyPostmark = process.env.POSTMARK_SERVER_TOKEN;
      const apiKeySendgrid = process.env.SENDGRID_API_KEY;
      const fromEmail =
        process.env.NOTIFICATION_FROM_EMAIL || "risk-control@riskcontrol.local";
      const provider = webhook ? detectProvider(webhook, "email") : "generic";

      if (webhook && (provider === "generic" || provider === "make" || provider === "n8n" || provider === "zapier")) {
        await sendGeneric(webhook, "email", {
          to: targets,
          subject: title,
          message,
          body: message,
          html,
          text,
          severity: payload.severity,
          type: payload.type,
          details,
          stockSymbol: payload.stockSymbol,
          batchId: payload.batchId,
        });
        sentTo.push(...targets);
      } else if (apiKeyResend && provider !== "postmark" && provider !== "sendgrid") {
        await sendResend(apiKeyResend, fromEmail, targets, title, text, html);
        sentTo.push(...targets);
      } else if (apiKeyPostmark) {
        await sendPostmark(apiKeyPostmark, fromEmail, targets, title, text, html);
        sentTo.push(...targets);
      } else if (apiKeySendgrid) {
        await sendSendgrid(apiKeySendgrid, fromEmail, targets, title, text, html);
        sentTo.push(...targets);
      } else if (webhook) {
        await sendGeneric(webhook, "email", {
          to: targets,
          subject: title,
          message,
          body: message,
          severity: payload.severity,
          details,
        });
        sentTo.push(...targets);
      } else {
        return NextResponse.json(
          {
            success: false,
            sentTo: [],
            error:
              "No Email channel configured. Set RESEND_API_KEY / POSTMARK_SERVER_TOKEN / SENDGRID_API_KEY / EMAIL_WEBHOOK_URL in env, or pass webhookOverride.",
          },
          { status: 503 }
        );
      }
    } else {
      const waBody = buildWaMarkdown(title, message, details);
      const twAccount = process.env.TWILIO_ACCOUNT_SID;
      const twToken = process.env.TWILIO_AUTH_TOKEN;
      const twFrom = process.env.TWILIO_WHATSAPP_FROM_NUMBER || process.env.TWILIO_FROM_NUMBER;
      const metaToken = process.env.META_WA_ACCESS_TOKEN;
      const metaPhoneId = process.env.META_WA_PHONE_NUMBER_ID;
      const provider = webhook ? detectProvider(webhook, "whatsapp") : "generic";

      if (webhook && (provider === "generic" || provider === "make" || provider === "n8n" || provider === "zapier")) {
        await sendGeneric(webhook, "whatsapp", {
          to: targets,
          message: waBody,
          title,
          severity: payload.severity,
          type: payload.type,
          details,
          stockSymbol: payload.stockSymbol,
          batchId: payload.batchId,
        });
        sentTo.push(...targets);
      } else if (twAccount && twToken && twFrom) {
        const r = await sendTwilioSMS(twAccount, twToken, twFrom, targets, waBody);
        sentTo.push(...r.sent);
      } else if (metaToken && metaPhoneId) {
        const r = await sendMetaWa(metaToken, metaPhoneId, targets, waBody);
        sentTo.push(...r.sent);
      } else if (webhook) {
        await sendGeneric(webhook, "whatsapp", {
          to: targets,
          message: waBody,
          title,
          severity: payload.severity,
          details,
        });
        sentTo.push(...targets);
      } else {
        return NextResponse.json(
          {
            success: false,
            sentTo: [],
            error:
              "No WhatsApp channel configured. Set TWILIO_ACCOUNT_SID+TOKEN+FROM / META_WA_ACCESS_TOKEN+PHONE_NUMBER_ID / WHATSAPP_WEBHOOK_URL in env, or pass webhookOverride.",
          },
          { status: 503 }
        );
      }
    }

    return NextResponse.json({ success: true, sentTo });
  } catch (e: any) {
    const err = e?.message || String(e) || "Unknown notify error";
    return NextResponse.json({ success: false, sentTo, error: err }, { status: 500 });
  }
}
