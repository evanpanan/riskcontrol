import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { notificationReadiness, deliverNotification } from "@/lib/server/notificationDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let windowStart = 0;
let requestCount = 0;

export async function GET() {
  return NextResponse.json(notificationReadiness(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  // The current app has browser-local login only. A separate server-held key protects the paid send API.
  const secret = process.env.NOTIFICATION_SEND_TOKEN?.trim();
  if (!secret || secret.length < 32) {
    return NextResponse.json({ success: false, sentTo: [], error: "管理员尚未配置通知发送授权码（至少32位）。" }, { status: 503 });
  }
  const supplied = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ success: false, sentTo: [], error: "请在系统设置输入有效的通知发送授权码。" }, { status: 401 });
  }
  if (Date.now() - windowStart > 60000) { windowStart = Date.now(); requestCount = 0; }
  if (++requestCount > 20) {
    return NextResponse.json({ success: false, sentTo: [], error: "发送过于频繁，请一分钟后重试。" }, { status: 429 });
  }
  try {
    const text = await req.text();
    if (Buffer.byteLength(text) > 32768) {
      return NextResponse.json({ success: false, sentTo: [], error: "通知内容过长。" }, { status: 413 });
    }
    const body = JSON.parse(text);
    const result = await deliverNotification(body);
    return NextResponse.json(result, { status: result.success ? 200 : result.sentTo.length ? 207 : 502 });
  } catch (err) {
    return NextResponse.json({
      success: false, sentTo: [], error: err instanceof Error ? err.message : "通知请求失败。",
    }, { status: 400 });
  }
}
