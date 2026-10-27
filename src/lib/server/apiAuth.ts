import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { RC_SESSION_COOKIE, verifySessionJwt } from '@/lib/auth/session';
import { isSessionActive } from '@/lib/server/sessionRegistry';
import { prisma } from '@/lib/prisma';
import { isDevMockAccountsEnabled } from '@/lib/auth/password';
import { MOCK_USER_META, type AppRole, type AppSessionUser } from '@/types/auth';

/** 允许写入业务数据的角色：商务经理仅可读写自己的客户，写入门槛在业务层再收敛。 */
export const WRITE_ROLES: readonly AppRole[] = ['ADMIN', 'RISK_MANAGER', 'BD_MANAGER', 'OPERATIONS'];

/** 内建演示账号（仅开发环境）没有数据库行，其会话不参与服务端会话表校验。 */
const BUILTIN_DEV_ACCOUNT_IDS: ReadonlySet<string> = new Set(
  Object.values(MOCK_USER_META).map((m) => m.id)
);

/**
 * 从会话 Cookie 解析当前登录用户。
 *
 * 校验顺序（任一不通过即视为未登录）：
 * 1. JWT 签名与过期时间；
 * 2. 服务端会话表仍存在该会话（退出 / 撤销后旧 JWT 立即失效）；
 * 3. 账号在库中存在且未被停用。
 *
 * 返回身份以数据库为准（角色 / 姓名 / 归属），确保降权、改名即时生效。
 */
export async function resolveSessionUserFromToken(
  token: string | null | undefined
): Promise<AppSessionUser | null> {
  if (!token) return null;
  let claims: AppSessionUser | null = null;
  try {
    claims = await verifySessionJwt(token);
  } catch {
    return null;
  }
  if (!claims) return null;

  // 内建演示账号只在开发环境存在，且不落库，单独放行（生产环境该分支恒不成立）。
  if (BUILTIN_DEV_ACCOUNT_IDS.has(claims.id) && isDevMockAccountsEnabled()) return claims;

  try {
    const active = await isSessionActive(token);
    if (!active) return null;
    const row = await prisma.appUser.findUnique({
      where: { id: claims.id },
      select: {
        id: true,
        email: true,
        role: true,
        displayName: true,
        avatarInitials: true,
        avatarDataUrl: true,
        bdManagerFullName: true,
        enabled: true,
      },
    });
    if (!row || row.enabled === false) return null;
    return {
      id: row.id,
      email: row.email,
      role: row.role as AppRole,
      displayName: row.displayName,
      avatarInitials: row.avatarInitials,
      avatarDataUrl: row.avatarDataUrl ?? undefined,
      bdManagerFullName: row.bdManagerFullName ?? undefined,
    };
  } catch {
    // 服务端数据源不可用：拒绝访问（fail closed），避免在故障窗口绕过会话撤销。
    return null;
  }
}

/** 从 HttpOnly 会话 Cookie 解析当前登录用户；未登录返回 null。 */
export async function resolveSessionUser(): Promise<AppSessionUser | null> {
  const token = cookies().get(RC_SESSION_COOKIE)?.value;
  return resolveSessionUserFromToken(token);
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function forbidden(error = 'forbidden'): NextResponse {
  return NextResponse.json(
    { ok: false, error },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
