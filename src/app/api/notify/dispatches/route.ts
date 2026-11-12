import { NextRequest, NextResponse } from "next/server";
import {
  resolveSessionUser,
  unauthorized,
  forbidden,
} from "@/lib/server/apiAuth";
import { prisma } from "@/lib/prisma";
import { dispatchSummary } from "@/lib/server/notificationDispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!["ADMIN", "RISK_MANAGER"].includes(user.role)) return forbidden();
  try {
    const rows = await prisma.notificationDispatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return NextResponse.json(
      {
        dispatches: rows.map((row) => ({
          id: row.id,
          title: (row.payload as { title?: string }).title,
          createdAt: row.createdAt,
          attemptCount: row.attemptCount,
          state: row.state,
          ...dispatchSummary(row),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "通知记录暂时不可用，请稍后刷新" },
      { status: 503 },
    );
  }
}
export async function PATCH(req: NextRequest) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!["ADMIN", "RISK_MANAGER"].includes(user.role)) return forbidden();
  const body = await req.json().catch(() => null);
  if (typeof body?.id !== "string" || body.action !== "acknowledge")
    return NextResponse.json({ error: "操作参数无效" }, { status: 400 });
  try {
    const result = await prisma.notificationDispatch.updateMany({
      where: {
        id: body.id,
        status: { in: ["REVIEW", "PENDING"] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      data: {
        status: "ACKNOWLEDGED",
        reviewedBy: user.id,
        leaseToken: null,
        leaseUntil: null,
      },
    });
    if (!result.count)
      return NextResponse.json(
        { error: "记录正在投递或已经结束，请刷新后核查" },
        { status: 409 },
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "操作未保存，请稍后重试" },
      { status: 503 },
    );
  }
}
