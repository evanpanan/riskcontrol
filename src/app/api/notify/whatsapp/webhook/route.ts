import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WhatsApp 机器人入站 Webhook（Twilio）。
 * 用户给机器人号发任意消息 → 自动订阅；发"退订"/"stop"/"unsubscribe" → 取消订阅。
 * Twilio 以 application/x-www-form-urlencoded POST，带 X-Twilio-Signature。
 */

const SUBSCRIBE_WORDS = ["订阅", "subscribe", "sub", "开始", "start", "on"];
const UNSUBSCRIBE_WORDS = ["退订", "取消订阅", "stop", "unsubscribe", "off", "quit", "unsub"];

function normalizePhone(raw: string): string {
  // Twilio From 形如 whatsapp:+85291234567
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function verifyTwilioSignature(req: NextRequest, body: string, url: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) return true; // 未配置凭据时跳过校验（开发模式）
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!signature) return false;
  // Twilio 签名：URL + 所有 POST 参数按字母序拼接，HMAC-SHA1，base64
  const params = new URLSearchParams(body);
  const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const data = url + sorted.map(([k, v]) => k + v).join("");
  const expected = createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  try {
    const a = Buffer.from(signature, "base64");
    const b = Buffer.from(expected, "base64");
    return a.length === b.length && a.every((v, i) => v === b[i]);
  } catch {
    return false;
  }
}

function twiml(message: string): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`,
    { headers: { "Content-Type": "text/xml" } }
  );
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const url = req.url;

  if (!verifyTwilioSignature(req, body, url)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const params = new URLSearchParams(body);
  const fromRaw = params.get("From") ?? "";
  const bodyText = (params.get("Body") ?? "").trim();
  const profileName = params.get("ProfileName") ?? null;

  if (!fromRaw) {
    return new NextResponse("Missing From", { status: 400 });
  }

  const phone = normalizePhone(fromRaw);
  const lower = bodyText.toLowerCase();
  const isUnsubscribe = UNSUBSCRIBE_WORDS.some((w) => lower === w || lower.startsWith(w));
  const isSubscribe = !isUnsubscribe && SUBSCRIBE_WORDS.some((w) => lower === w || lower.startsWith(w));

  try {
    const existing = await prisma.whatsAppSubscriber.findUnique({ where: { phone } });

    if (isUnsubscribe) {
      if (existing) {
        await prisma.whatsAppSubscriber.update({
          where: { phone },
          data: { active: false, lastMessageAt: new Date() },
        });
      }
      return twiml("已取消订阅，不再接收风控消息。回复任意消息可重新订阅。");
    }

    // 订阅（含首次发任意消息、或重新激活）
    if (existing) {
      await prisma.whatsAppSubscriber.update({
        where: { phone },
        data: {
          active: true,
          lastMessageAt: new Date(),
          displayName: profileName ?? existing.displayName,
        },
      });
    } else {
      await prisma.whatsAppSubscriber.create({
        data: {
          phone,
          displayName: profileName,
          source: "twilio",
          active: true,
          lastMessageAt: new Date(),
        },
      });
    }

    return twiml(
      "订阅成功！之后有补仓预警、风险警报等消息会自动推送给你。\n回复「退订」可随时取消。"
    );
  } catch (err) {
    console.error("[whatsapp-webhook] subscribe failed:", err);
    return twiml("处理失败，请稍后重试。");
  }
}
