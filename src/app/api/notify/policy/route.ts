import { NextRequest, NextResponse } from "next/server";
import {
  resolveSessionUser,
  unauthorized,
  forbidden,
} from "@/lib/server/apiAuth";
import { prisma } from "@/lib/prisma";
import { loadNotificationPolicy } from "@/lib/server/notificationDispatch";
import {
  parseNotificationPolicy,
  NOTIFICATION_POLICY_KEY,
} from "@/lib/notificationPolicy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!["ADMIN", "RISK_MANAGER"].includes(user.role)) return forbidden();
  try {
    return NextResponse.json(
      { policy: await loadNotificationPolicy() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "通知设置暂时不可用，请联系管理员" },
      { status: 503 },
    );
  }
}
export async function POST(req: NextRequest) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();
  let policy;
  try {
    policy = parseNotificationPolicy(await req.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "通知策略无效" },
      { status: 400 },
    );
  }
  try {
    await prisma.workspaceRecord.upsert({
      where: { kind_key: { kind: "config", key: NOTIFICATION_POLICY_KEY } },
      create: {
        kind: "config",
        key: NOTIFICATION_POLICY_KEY,
        payload: { ...policy },
        updatedBy: user.id,
      },
      update: {
        payload: { ...policy },
        revision: { increment: 1 },
        updatedBy: user.id,
      },
    });
    return NextResponse.json({ policy });
  } catch {
    return NextResponse.json(
      { error: "通知策略保存失败，未生效" },
      { status: 503 },
    );
  }
}
