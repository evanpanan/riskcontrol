import { NextRequest, NextResponse } from 'next/server';
import { buildClearCookieHeader, RC_SESSION_COOKIE } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.headers.set('Set-Cookie', buildClearCookieHeader());
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.headers.append('Clear-Site-Data', '"cookies", "storage"');
    void req;
    void RC_SESSION_COOKIE;
    return res;
  } catch {
    return NextResponse.json({ ok: true }, { status: 200, headers: { 'Set-Cookie': buildClearCookieHeader() } });
  }
}
