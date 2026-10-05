import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { RC_SESSION_COOKIE, verifySessionJwt } from '@/lib/auth/session';
import { buildClearCookieHeader } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  void req;
  const store = cookies();
  const token = store.get(RC_SESSION_COOKIE)?.value;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ ok: false, error: 'unauthorized', user: null }, { status: 401 });
  }
  const user = await verifySessionJwt(token);
  if (!user) {
    const res = NextResponse.json({ ok: false, error: 'invalid_or_expired_token', user: null }, { status: 401 });
    res.headers.set('Set-Cookie', buildClearCookieHeader());
    return res;
  }
  return NextResponse.json(
    { ok: true, user },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        Pragma: 'no-cache',
      },
    }
  );
}
