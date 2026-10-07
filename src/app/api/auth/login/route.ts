import { NextRequest, NextResponse } from 'next/server';
import { signSessionJwt, buildSetCookieHeader, buildClearCookieHeader, RC_SESSION_COOKIE } from '@/lib/auth/session';
import { isAllowedRole, type AppSessionUser } from '@/types/auth';
import {
  resolveAnyAccountByIdentifier,
  verifyPassword,
} from '@/lib/auth/password';
import type { ResolvedAnyAccount } from '@/lib/auth/password';

export const runtime = 'nodejs';

interface LoginRequestBody {
  identifier?: unknown;
  password?: unknown;
  remember?: unknown;
}

type ThrottleKey = string;
interface ThrottleEntry { first: number; count: number; }
const LOGIN_THROTTLE_WINDOW_MS = 60_000;
const LOGIN_THROTTLE_MAX_PER_IP = 10;
const LOGIN_THROTTLE_MAX_PER_ACCOUNT = 5;
const IP_RATE_LIMIT = new Map<string, ThrottleEntry>();
const ACCOUNT_RATE_LIMIT = new Map<ThrottleKey, ThrottleEntry>();

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown-ip';
}

function hitRateLimit(ip: string, accountKey: string | null): boolean {
  const now = Date.now();
  let ipE = IP_RATE_LIMIT.get(ip);
  if (!ipE || now - ipE.first > LOGIN_THROTTLE_WINDOW_MS) {
    ipE = { first: now, count: 0 };
    IP_RATE_LIMIT.set(ip, ipE);
  }
  ipE.count += 1;
  if (ipE.count > LOGIN_THROTTLE_MAX_PER_IP) return true;
  if (accountKey) {
    const k: ThrottleKey = `${ip}::${accountKey}`;
    let a = ACCOUNT_RATE_LIMIT.get(k);
    if (!a || now - a.first > LOGIN_THROTTLE_WINDOW_MS) {
      a = { first: now, count: 0 };
      ACCOUNT_RATE_LIMIT.set(k, a);
    }
    a.count += 1;
    if (a.count > LOGIN_THROTTLE_MAX_PER_ACCOUNT) return true;
  }
  return false;
}

const GENERIC_DENY_MESSAGE = '凭据错误或账号不存在，请勿尝试枚举';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      void hitRateLimit(ip, null);
      return NextResponse.json(
        { ok: false, error: 'bad_request', message: '请求体必须是 JSON' },
        { status: 400 }
      );
    }
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      void hitRateLimit(ip, null);
      return NextResponse.json(
        { ok: false, error: 'bad_request', message: '请求体必须是 JSON' },
        { status: 400 }
      );
    }
    const body = parsed as LoginRequestBody;
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!identifier || !password) {
      void hitRateLimit(ip, null);
      return NextResponse.json(
        { ok: false, error: GENERIC_DENY_MESSAGE },
        { status: 401 }
      );
    }

    const account: ResolvedAnyAccount | null = await resolveAnyAccountByIdentifier(identifier);
    const accountKey = account?.kind === 'built-in' ? account.key : (account?.id ?? null);
    if (hitRateLimit(ip, accountKey)) {
      const retryAfterSec = Math.ceil(LOGIN_THROTTLE_WINDOW_MS / 1000);
      return NextResponse.json(
        {
          ok: false,
          error: 'too_many_attempts',
          message: `登录尝试过于频繁，请在 ${retryAfterSec} 秒后重试`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec) },
        }
      );
    }

    if (!account) {
      return NextResponse.json(
        { ok: false, error: GENERIC_DENY_MESSAGE },
        { status: 401 }
      );
    }
    if (!isAllowedRole(account.role)) {
      return NextResponse.json(
        { ok: false, error: GENERIC_DENY_MESSAGE },
        { status: 401 }
      );
    }

    const verified = await verifyPassword(password, account.passwordHash, account.salt);
    if (!verified) {
      return NextResponse.json(
        { ok: false, error: GENERIC_DENY_MESSAGE },
        { status: 401 }
      );
    }

    const sessionUser: AppSessionUser = {
      id: account.id,
      email: account.email,
      role: account.role,
      displayName: account.displayName,
      avatarInitials: account.avatarInitials,
      avatarDataUrl: account.avatarDataUrl,
      bdManagerFullName: account.bdManagerFullName,
    };

    const token = await signSessionJwt(sessionUser);
    const cookie = buildSetCookieHeader(token);

    const res = NextResponse.json({
      ok: true,
      user: sessionUser,
      authenticatedBy: 'server-password-verified',
      accountKind: account.kind,
    }, { status: 200 });
    res.headers.set('Set-Cookie', cookie);
    res.headers.set('X-RC-Auth', 'v2-server-verified');
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.headers.set('Pragma', 'no-cache');
    return res;
  } catch (err) {
    const clear = buildClearCookieHeader();
    return NextResponse.json(
      { ok: false, error: GENERIC_DENY_MESSAGE },
      { status: 401, headers: { 'Set-Cookie': clear } }
    );
  }
}

export function GET() {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}
