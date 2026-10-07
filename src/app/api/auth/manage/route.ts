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

export async function GET(req: NextRequest) {
  const guard = await requireAdminSession(req);
  if (!guard.ok) return guard.res!;
  try {
    const all = await prisma.appUser.findMany({
      select: { id: true, email: true, role: true, displayName: true, avatarInitials: true, bdManagerFullName: true },
      orderBy: { id: "desc" },
    });
    return NextResponse.json(
      { ok: true, receivedAt: new Date().toISOString(), users: all, stored: "db" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: true, receivedAt: new Date().toISOString(), users: [], stored: "pending", dbError: String(err?.message ?? err).slice(0, 200) },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminSession(req);
  if (!guard.ok) return guard.res!;

  let raw: Buffer;
  try { raw = await readLimited(req); }
  catch (err: any) {
    if (err?.code === "BODY_TOO_LARGE") return jsonError("payload too large", 413);
    return jsonError("invalid request", 400);
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase().split(";")[0]?.trim();
  if (ct !== "application/json") return jsonError("content-type must be application/json", 400);
  if (raw.length === 0) return jsonError("empty body", 400);

  let payload: any = null;
  try { payload = JSON.parse(raw.toString("utf-8")); }
  catch { return jsonError("invalid json body", 400); }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return jsonError("body must be a json object", 400);

  if (!validateEmail(payload.email)) return jsonError("请填写有效邮箱", 400);
  const email = payload.email.trim().toLowerCase();
  const displayName = truncate(payload.displayName);
  if (!displayName) return jsonError("请填写姓名", 400);

  const roleRaw: unknown = payload.role;
  const role: AppRole = isAllowedRole(roleRaw) ? roleRaw : APP_ROLES.OPERATIONS;
  const avatarInitials = truncate(payload.avatarInitials) ?? displayName.slice(0, Math.min(2, displayName.length)).toUpperCase();
  const avatarDataUrl = truncate(payload.avatarDataUrl, 1024 * 1024 * 2); // 2MB 头像
  const bdManagerFullName = truncate(payload.bdManagerFullName);
  const enabled = typeof payload.enabled === "boolean" ? payload.enabled : true;
  const passwordPlain = typeof payload.password === "string" ? payload.password.trim() : "";
  const passwordHashIn = typeof payload.passwordHash === "string" ? payload.passwordHash : null;

  let passwordHash: string | null = passwordHashIn;
  if (!passwordHash && passwordPlain.length >= 6) {
    const deterministicSalt = `prisma-${email}-PENDING-s4lt-v1`;
    passwordHash = await hashPassword(passwordPlain, deterministicSalt);
  }
  if (passwordPlain.length > 0 && passwordPlain.length < 6) {
    return jsonError("密码至少 6 位", 400);
  }
  if (!passwordHash) {
    return jsonError("请设置密码", 400);
  }
  if (email.length > EMAIL_MAX) return jsonError("邮箱过长", 400);

  let newId: string | null = null;
  try {
    const created = await prisma.appUser.create({
      data: {
        email,
        displayName,
        role,
        avatarInitials,
        bdManagerFullName: bdManagerFullName ?? undefined,
        passwordHash,
      },
      select: { id: true, email: true, displayName: true, role: true, avatarInitials: true, bdManagerFullName: true },
    });
    newId = created.id;
    // 二次修补：把 PENDING 的 passwordHash 替换为含真实 id 的 deterministic salt 重新 hash，保证 resolvePrismaAccountByIdentifier 中 salt 与登录一致
    const finalSalt = `prisma-${email}-${created.id}-s4lt-v1`;
    const finalPasswordHash = passwordPlain.length >= 6
      ? await hashPassword(passwordPlain, finalSalt)
      : (passwordHash ?? null);
    if (finalPasswordHash && finalPasswordHash !== passwordHash) {
      try {
        await prisma.appUser.update({ where: { id: created.id }, data: { passwordHash: finalPasswordHash } });
      } catch {}
    }
    return NextResponse.json(
      { ok: true, receivedAt: new Date().toISOString(), stored: "db", user: created },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: true,
        receivedAt: new Date().toISOString(),
        stored: "pending",
        dbError: String(err?.message ?? err).slice(0, 200),
        user: {
          id: newId ?? "u_pending_" + Date.now().toString(36),
          email,
          displayName,
          role,
          avatarInitials,
          bdManagerFullName,
        },
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }
}
