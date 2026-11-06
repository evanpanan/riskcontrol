import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSessionUser, unauthorized, forbidden } from "@/lib/server/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH  /api/notify/whatsapp/subscribers/[id]  切换 active（退订/重新订阅）
 * DELETE /api/notify/whatsapp/subscribers/[id]  删除订阅者
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const active = typeof body.active === "boolean" ? body.active : undefined;
  if (active === undefined) {
    return NextResponse.json({ error: "需提供 active 字段" }, { status: 400 });
  }
  const updated = await prisma.whatsAppSubscriber.update({
    where: { id },
    data: { active },
  });
  return NextResponse.json({ subscriber: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;
  await prisma.whatsAppSubscriber.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
