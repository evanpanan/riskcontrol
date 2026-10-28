import { NextRequest, NextResponse } from 'next/server';
import {
  signSessionJwt,
  buildSetCookieHeader,
  buildClearCookieHeader,
  RC_SESSION_MAX_AGE_SEC,
} from '@/lib/auth/session';
import { isAllowedRole, type AppSessionUser } from '@/types/auth';
import {
  resolveAnyAccountByIdentifier,
  verifyPassword,
} from '@/lib/auth/password';
import type { ResolvedAnyAccount } from '@/lib/auth/password';
import { registerSession } from '@/lib/server/sessionRegistry';
import { prisma } from '@/lib/prisma';
import {
  hashPasswordPbkdf2,
  isPbkdf2Hash,
  verifyPbkdf2,
  generateSaltHex,
} from '@/lib/server/passwordKdf';
import { hitLoginThrottle, clearLoginThrottle } from '@/lib/server/loginThrottle';

export const runtime = 'nodejs';

interface LoginRequestBody {
  identifier?: unknown;
  password?: unknown;
  remember?: unknown;
}

const LOGIN_THROTTLE_WINDOW_MS = 60_000;
const LOGIN_THROTTLE_MAX_PER_IP = 10;
const LOGIN_THROTTLE_MAX_PER_ACCOUNT = 5;

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

/**
 * 登录限流（跨实例共享）：IP 维度 + 账号维度 + IP×账号维度。
 * 单看 IP 挡不住分布式撞库，单看账号挡不住批量撞库，三个维度叠加才有效。
 */
async function hitRateLimit(ip: string, accountKey: string | null): Promise<boolean> {
  const rules = [
    { key: `ip:${ip}`, max: LOGIN_THROTTLE_MAX_PER_IP, windowMs: LOGIN_THROTTLE_WINDOW_MS },
  ];
  if (accountKey) {
    rules.push(
      { key: `acct:${accountKey}`, max: LOGIN_THROTTLE_MAX_PER_ACCOUNT, windowMs: LOGIN_THROTTLE_WINDOW_MS },
      { key: `ipacct:${ip}::${accountKey}`, max: LOGIN_THROTTLE_MAX_PER_ACCOUNT, windowMs: LOGIN_THROTTLE_WINDOW_MS }
    );
  }
  return hitLoginThrottle(rules);
}

const GENERIC_DENY_MESSAGE = '凭据错误或账号不存在，请勿尝试枚举';

/**
 * 校验口令：PBKDF2 直连校验；历史单一 SHA-256 哈希校验通过后返回需升级标记，
 * 由调用方在登录成功时原地升级为 PBKDF2，实现无感平滑迁移。
 */
async function verifyCredential(
  candidate: string,
  account: ResolvedAnyAccount
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (isPbkdf2Hash(account.passwordHash)) {
    return { ok: verifyPbkdf2(candidate, account.passwordHash, account.salt), needsUpgrade: false };
  }
  const ok = await verifyPassword(candidate, account.passwordHash, account.salt);
  return { ok, needsUpgrade: ok };
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      await hitRateLimit(ip, null);
      return NextResponse.json(
        { ok: false, error: 'bad_request', message: '请求体必须是 JSON' },
        { status: 400 }
      );
    }
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      await hitRateLimit(ip, null);
      return NextResponse.json(
        { ok: false, error: 'bad_request', message: '请求体必须是 JSON' },
        { status: 400 }
      );
    }
    const body = parsed as LoginRequestBody;
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!identifier || !password) {
      await hitRateLimit(ip, null);
      return NextResponse.json(
        { ok: false, error: GENERIC_DENY_MESSAGE },
        { status: 401 }
      );
    }

    const account: ResolvedAnyAccount | null = await resolveAnyAccountByIdentifier(identifier);
    const accountKey = account?.kind === 'built-in' ? account.key : (account?.id ?? null);
    if (await hitRateLimit(ip, accountKey)) {
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

    const credential = await verifyCredential(password, account);
    if (!credential.ok) {
      return NextResponse.json(
        { ok: false, error: GENERIC_DENY_MESSAGE },
        { status: 401 }
      );
    }

    // 历史单一 SHA-256 哈希校验通过后原地升级为 PBKDF2：老账号无需重置口令即可获得强哈希。
    if (credential.needsUpgrade && account.kind === 'prisma') {
      try {
        const salt = generateSaltHex();
        await prisma.appUser.update({
          where: { id: account.id },
          data: { passwordSalt: salt, passwordHash: hashPasswordPbkdf2(password, salt) },
        });
      } catch (err) {
        // 升级失败不影响本次登录，下次登录再试。
        console.error('[auth:login] 口令哈希升级失败：', err instanceof Error ? err.message : String(err));
      }
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

    // 数据库账号必须登记服务端会话，否则该凭证在后续请求中会被判为已撤销。
    // 内建演示账号（开发环境）没有数据库行，不参与会话表校验，无需登记。
    if (account.kind === 'prisma') {
      const registered = await registerSession({
        userId: sessionUser.id,
        token,
        expiresAt: new Date(Date.now() + RC_SESSION_MAX_AGE_SEC * 1000),
        ipAddr: ip,
        userAgent: req.headers.get('user-agent'),
      });
      if (!registered) {
        return NextResponse.json(
          { ok: false, error: '登录服务暂时不可用，请稍后重试' },
          { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } }
        );
      }
    }

    const cookie = buildSetCookieHeader(token);

    // 登录成功即清零该账号维度的计数，避免正常用户被历史失败尝试拖累。
    if (accountKey) {
      await clearLoginThrottle([`acct:${accountKey}`, `ipacct:${ip}::${accountKey}`]);
    }

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
    // 仅记录到服务器日志，绝不回传客户端，避免暴露内部细节。
    try { console.error('[auth:login] unexpected error:', err instanceof Error ? err.message : String(err)); } catch {}
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
