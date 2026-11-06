import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSessionUser, unauthorized, forbidden } from "@/lib/server/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notify/whatsapp/subscribers
 * 列出所有 WhatsApp 订阅者（仅管理员）。
 */
export async function GET() {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const subscribers = await prisma.whatsAppSubscriber.findMany({
    orderBy: { lastMessageAt: "desc" },
  });
  return NextResponse.json({ subscribers });
}
