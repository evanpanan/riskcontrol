import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { buildClearCookieHeader, RC_SESSION_COOKIE, verifySessionJwt } from '@/lib/auth/session';
import { revokeSession } from '@/lib/server/sessionRegistry';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = (await cookies()).get(RC_SESSION_COOKIE)?.value ?? null;

  // 退出动作的审计由服务端在同一请求内落库：客户端先发审计再退出会与撤销会话竞态，
  // 导致这条最关键的记录被 401 丢掉。
  if (token) {
    try {
      const claims = await verifySessionJwt(token);
      if (claims) {
        await prisma.auditLog.create({
          data: {
            actorId: claims.id,
            actorEmail: claims.email,
            role: claims.role,
            action: 'logout',
            resource: 'auth:logout',
            detail: { source: 'server' },
          },
        });
      }
    } catch (err) {
      console.error('[auth:logout] audit failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // 退出必须同时失效服务端会话：否则被复制走的旧 JWT 在有效期内仍可继续访问。
  try {
    if (token) await revokeSession(token);
  } catch (err) {
    console.error('[auth:logout] revoke failed:', err instanceof Error ? err.message : String(err));
  }

  try {
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.headers.set('Set-Cookie', buildClearCookieHeader());
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.headers.append('Clear-Site-Data', '"cookies", "storage"');
    void req;
    return res;
  } catch {
    return NextResponse.json({ ok: true }, { status: 200, headers: { 'Set-Cookie': buildClearCookieHeader() } });
  }
}
