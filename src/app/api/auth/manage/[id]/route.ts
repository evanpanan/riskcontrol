import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { RC_SESSION_COOKIE, verifySessionJwt } from "@/lib/auth/session";
import { hashPassword, generateSalt } from "@/lib/auth/password";
import { isAllowedRole, type AppRole, APP_ROLES } from "@/types/auth";
import type { AppSessionUser } from "@/types/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const STRING_MAX = 255;
const EMAIL_MAX = 320;

type RateEntry = { at: number };
const RATE_BUCKET = new Map<string, RateEntry[]>();

function cleanupRate(ip: string, now: number): RateEntry[] {
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

function truncate(v: unknown, max = STRING_MAX): string | null {
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

async function requireAdminSession(req: NextRequest): Promise<{ ok: boolean; res: NextResponse | null; actor: AppSessionUser | null }> {
  const now = Date.now();
  const ip = readIp(req);
  const remaining = cleanupRate(ip, now);
  if (remaining.length >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      actor: null,
      res: NextResponse.json(
        { ok: false, error: "too many requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)), "Cache-Control": "no-store" } },
      ),
    };
  }
  remaining.push({ at: now });
  RATE_BUCKET.set(ip, remaining);

  const token = cookies().get(RC_SESSION_COOKIE)?.value ?? null;
  const session: AppSessionUser | null = token ? await verifySessionJwt(token) : null;
  if (!session) {
    return {
      ok: false,
      actor: null,
      res: NextResponse.json({ ok: false, error: "未登录" }, { status: 401, headers: { "Cache-Control": "no-store" } }),
    };
  }
  if (session.role !== APP_ROLES.ADMIN) {
    return {
      ok: false,
      actor: session,
      res: NextResponse.json(
        { ok: false, error: "仅系统管理员可管理系统账号", authenticatedActor: { id: session.id, email: session.email, role: session.role } },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { ok: true, actor: session, res: null };
}

function validateEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function jsonError(error: string, code = 400) {
  return NextResponse.json({ ok: false, error }, { status: code, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminSession(req);
  if (!guard.ok) return guard.res!;
  const id = truncate(params.id);
  if (!id) return jsonError("缺少用户 ID", 400);

  let raw: Buffer;
  try { raw = await readLimited(req); }
  catch (err: any) {
    if (err?.code === "BODY_TOO_LARGE") return jsonError("payload too large", 413);
    return jsonError("invalid request", 400);
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase().split(";")[0]?.trim();
  if (ct !== "application/json") return jsonError("content-type must be application/json", 400);

  let payload: any = null;
  try { payload = raw.length > 0 ? JSON.parse(raw.toString("utf-8")) : {}; }
  catch { return jsonError("invalid json body", 400); }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return jsonError("body must be a json object", 400);

  const patch: Record<string, any> = {};
  if ("email" in payload) {
    if (!validateEmail(payload.email)) return jsonError("请填写有效邮箱", 400);
    const email = payload.email.trim().toLowerCase();
    if (email.length > EMAIL_MAX) return jsonError("邮箱过长", 400);
    patch.email = email;
  }
  if ("displayName" in payload) {
    const displayName = truncate(payload.displayName);
    if (!displayName) return jsonError("请填写姓名", 400);
    patch.displayName = displayName;
  }
  if ("role" in payload) {
    const roleRaw: unknown = payload.role;
    if (!isAllowedRole(roleRaw)) return jsonError("非法角色", 400);
    patch.role = roleRaw as AppRole;
  }
  if ("avatarInitials" in payload) {
    patch.avatarInitials = truncate(payload.avatarInitials) ?? undefined;
  }
  if ("avatarDataUrl" in payload) {
    patch.avatarDataUrl = truncate(payload.avatarDataUrl, 1024 * 1024 * 2) ?? undefined;
  }
  if ("bdManagerFullName" in payload) {
    patch.bdManagerFullName = truncate(payload.bdManagerFullName) ?? undefined;
  }

  const passwordPlain = typeof payload.password === "string" ? payload.password.trim() : "";
  const passwordHashIn = typeof payload.passwordHash === "string" ? payload.passwordHash : null;

  let targetEmailForSalt: string | null = null;
  if (passwordPlain.length > 0 || passwordHashIn) {
    if (patch.email) {
      targetEmailForSalt = patch.email;
    } else {
      try {
        const existing = await prisma.appUser.findUnique({ where: { id }, select: { email: true } });
        if (existing?.email) targetEmailForSalt = String(existing.email);
      } catch {}
    }
  }

  if (passwordPlain.length > 0) {
    if (passwordPlain.length < 6) return jsonError("密码至少 6 位", 400);
    const deterministicSalt = targetEmailForSalt
      ? `prisma-${targetEmailForSalt}-${id}-s4lt-v1`
      : `prisma-pending-email-${id}-s4lt-v1`;
    const passwordHash = await hashPassword(passwordPlain, deterministicSalt);
    patch.passwordHash = passwordHash;
  } else if (passwordHashIn) {
    patch.passwordHash = passwordHashIn;
  }

  if (Object.keys(patch).length === 0) return jsonError("没有要更新的字段", 400);
  try {
    const updated = await prisma.appUser.update({
      where: { id },
      data: patch,
      select: { id: true, email: true, displayName: true, role: true, avatarInitials: true, bdManagerFullName: true },
    });
    return NextResponse.json(
      { ok: true, receivedAt: new Date().toISOString(), stored: "db", user: updated },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: true,
        receivedAt: new Date().toISOString(),
        stored: "pending",
        dbError: String(err?.message ?? err).slice(0, 200),
        id,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminSession(req);
  if (!guard.ok) return guard.res!;
  const id = truncate(params.id);
  if (!id) return jsonError("缺少用户 ID", 400);
  if (guard.actor && id === guard.actor.id) return jsonError("不能删除当前登录账号", 400);
  try {
    const removed = await prisma.appUser.delete({ where: { id }, select: { id: true, email: true, displayName: true } });
    return NextResponse.json(
      { ok: true, receivedAt: new Date().toISOString(), stored: "db", removed },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: true,
        receivedAt: new Date().toISOString(),
        stored: "pending",
        dbError: String(err?.message ?? err).slice(0, 200),
        removed: { id },
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }
}
