import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { RC_SESSION_COOKIE } from "@/lib/auth/session";
import { resolveSessionUserFromToken } from "@/lib/server/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_ACTION_ALLOWLIST = new Set<string>([
  "login_success",
  "login_failed",
  "logout",
  "page_view",
  "api_mutation",
  "threshold_update",
  "account_create",
  "account_delete",
  "account_update",
  "client_edit",
  "client_delete",
  "margin_topup",
  "client_settle",
  "client_exit_request",
  "client_exit_cancel",
  "batch_notify",
  "ledger_clear",
  "auth_denied",
]);

const MAX_BODY_BYTES = 2 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 100;
const DETAIL_MAX_BYTES = 32 * 1024;
const STRING_FIELD_MAX = 255;

type RateEntry = { at: number };
const RATE_BUCKET = new Map<string, RateEntry[]>();

function cleanupRate(ip: string, now: number) {
  const all = RATE_BUCKET.get(ip) ?? [];
  const filtered = all.filter((e) => now - e.at < RATE_LIMIT_WINDOW_MS);
  if (filtered.length === 0) {
    RATE_BUCKET.delete(ip);
    return [];
  }
  RATE_BUCKET.set(ip, filtered);
  return filtered;
}

function readIp(req: NextRequest): string {
  try {
    const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  } catch {}
  return "127.0.0.1";
}

function truncate(v: unknown, max = STRING_FIELD_MAX): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  if (s.length === 0) return null;
  return s.length > max ? s.slice(0, max) : s;
}

async function readLimited(req: NextRequest): Promise<Buffer> {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        try { reader.releaseLock(); } catch {}
        const err: any = new Error(`body too large: ${size}`);
        err.code = "BODY_TOO_LARGE";
        throw err;
      }
      chunks.push(value);
    }
  }
  try { reader.releaseLock(); } catch {}
  return Buffer.concat(chunks as any, size);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const now = Date.now();
  const ip = readIp(req);

  const remaining = cleanupRate(ip, now);
  if (remaining.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    return NextResponse.json(
      { ok: false, error: "too many requests", retryAfterMs: RATE_LIMIT_WINDOW_MS },
      { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) } },
    );
  }
  remaining.push({ at: now });
  RATE_BUCKET.set(ip, remaining);

  const token = cookies().get(RC_SESSION_COOKIE)?.value ?? null;
  const session = await resolveSessionUserFromToken(token);

  let raw: Buffer;
  try { raw = await readLimited(req); }
  catch (err: any) {
    if (err?.code === "BODY_TOO_LARGE") {
      return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  if (raw.length === 0) {
    return NextResponse.json({ ok: false, error: "empty body" }, { status: 400 });
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase().split(";")[0]?.trim();
  if (ct !== "application/json") {
    return NextResponse.json({ ok: false, error: "content-type must be application/json" }, { status: 400 });
  }

  let payload: any = null;
  try { payload = JSON.parse(raw.toString("utf-8")); }
  catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ ok: false, error: "body must be a json object" }, { status: 400 });
  }

  const actionRaw = payload.action;
  const action = typeof actionRaw === "string" ? actionRaw : null;
  if (!action || !AUDIT_ACTION_ALLOWLIST.has(action)) {
    return NextResponse.json({ ok: false, error: "invalid audit action" }, { status: 400 });
  }
  if (!session && action !== "login_failed") {
    return NextResponse.json(
      { ok: false, error: "未登录" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const resource = truncate(payload.resource);

  // 强制采用服务端权威身份，绝不信任客户端声明的 actorId / actorEmail / role
  const actorId = session?.id ?? null;
  const actorEmail = session ? truncate(session.email) : null;
  const role = session?.role ? truncate(session.role, 64) : null;

  let detail: any | null = null;
  if (payload.detail !== null && payload.detail !== undefined) {
    if (typeof payload.detail !== "object" || Array.isArray(payload.detail)) {
      return NextResponse.json({ ok: false, error: "detail must be a plain object or null" }, { status: 400 });
    }
    const str = JSON.stringify(payload.detail);
    if (Buffer.byteLength(str, "utf-8") > DETAIL_MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "detail too large" }, { status: 413 });
    }
    detail = payload.detail;
  }
  if (!session && action === "login_failed") {
    const attemptedEmail = truncate(payload.actorEmail);
    if (attemptedEmail) {
      detail = {
        ...(detail ?? {}),
        attemptedEmail,
      };
    }
  }

  // 可选 createdAt：如果客户端上报 30 分钟时差内的 ISO 用客户端，否则取服务端 now
  let createdAt: Date = new Date(now);
  const clientAt = typeof payload.createdAt === "string" ? payload.createdAt : null;
  if (clientAt) {
    try {
      const cd = new Date(clientAt);
      const diff = cd.getTime() - now;
      if (!Number.isNaN(cd.getTime()) && Math.abs(diff) <= 30 * 60 * 1000) createdAt = cd;
    } catch {}
  }

  let writtenId: string | null = null;
  let stored: "db" | "pending" = "pending";
  let dbError: string | null = null;
  try {
    const row = await prisma.auditLog.create({
      data: {
        actorId,
        actorEmail,
        role,
        action,
        resource,
        detail: detail ?? undefined,
        createdAt,
      },
      select: { id: true },
    });
    writtenId = row.id;
    stored = "db";
  } catch (err: any) {
    // DB 连接失败或 prisma schema 未 push → 吞掉，202 Accepted 告诉前端已经收到并本地 pending
    stored = "pending";
    dbError = "database_unavailable";
    try { console.error("[audit:post] db unavailable, stored=pending:", err?.message ?? String(err)); } catch {}
  }

  const baseHeaders = { "Cache-Control": "no-store" };
  const resp = NextResponse.json(
    {
      ok: true,
      receivedAt: new Date(now).toISOString(),
      writtenId,
      stored,
      dbError,
      authenticatedActor: { actorId, actorEmail, role },
    },
    { status: stored === "db" ? 200 : 202, headers: baseHeaders },
  );
  return resp;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = cookies().get(RC_SESSION_COOKIE)?.value ?? null;
  const session = await resolveSessionUserFromToken(token);
  if (!session) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (session.role !== "ADMIN" && session.role !== "RISK_MANAGER") {
    return NextResponse.json({ ok: false, error: "当前角色无权限查看操作记录" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(2000, Number(limitRaw) || 500));
  try {
    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        actorId: true,
        actorEmail: true,
        role: true,
        action: true,
        resource: true,
        detail: true,
        createdAt: true,
      },
    });
    return NextResponse.json(
      {
        ok: true,
        logs: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "操作记录暂时不可用" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
