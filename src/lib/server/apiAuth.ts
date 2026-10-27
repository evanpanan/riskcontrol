import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { RC_SESSION_COOKIE, verifySessionJwt } from '@/lib/auth/session';
import type { AppRole, AppSessionUser } from '@/types/auth';

/** 允许写入业务数据的角色：商务经理仅可读写自己的客户，写入门槛在业务层再收敛。 */
export const WRITE_ROLES: readonly AppRole[] = ['ADMIN', 'RISK_MANAGER', 'BD_MANAGER', 'OPERATIONS'];

/** 从 HttpOnly 会话 Cookie 解析当前登录用户；未登录返回 null。 */
export async function resolveSessionUser(): Promise<AppSessionUser | null> {
  const token = cookies().get(RC_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySessionJwt(token);
  } catch {
    return null;
  }
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
