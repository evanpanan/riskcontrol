import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionJwt } from "@/lib/auth/session";
import { filterClientsByRole, type ClientLike } from "@/lib/authz/dataScope";
import type { AppSessionUser } from "@/types/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const token = cookies().get("rc_session_v1")?.value;
    const session = token ? await verifySessionJwt(token) : null;
    if (!session) {
      return NextResponse.json({ error: "未登录或会话已过期", filtered: [] }, { status: 401 });
    }
    const user = session as AppSessionUser;
    const body = (await req.json()) as { clients?: ClientLike[] };
    const raw = Array.isArray(body?.clients) ? body.clients : [];
    const filtered = filterClientsByRole(raw, user);
    return NextResponse.json({
      filtered,
      role: user.role,
      userId: user.id,
      bdManagerFullName: user.bdManagerFullName ?? null,
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({
      error: "数据过滤失败",
      filtered: [],
      detail: e?.message || String(e || "internal"),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
