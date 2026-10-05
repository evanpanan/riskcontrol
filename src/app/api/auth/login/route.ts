import { NextRequest, NextResponse } from 'next/server';
import { APP_ROLES, ALLOWED_ROLES, isAllowedRole, type AppSessionUser } from '@/types/auth';
import { buildSetCookieHeader, signSessionJwt } from '@/lib/auth/session';

export const runtime = 'nodejs';

interface LoginBody {
  id: string;
  email: string;
  role: string;
  displayName: string;
  avatarInitials: string;
  avatarDataUrl?: string;
  bdManagerFullName?: string;
  preVerified?: { token: string };
}

export async function POST(req: NextRequest) {
  let body: Partial<LoginBody> | null = null;
  try {
    body = (await req.json()) as Partial<LoginBody>;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request', message: '请求体必须是 JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  if (typeof body.id !== 'string' || !body.id.trim()) return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  if (!isAllowedRole(body.role)) return NextResponse.json({ ok: false, error: 'invalid_role' }, { status: 403 });
  if (typeof body.displayName !== 'string' || !body.displayName.trim()) return NextResponse.json({ ok: false, error: 'invalid_displayName' }, { status: 400 });
  if (typeof body.avatarInitials !== 'string' || !body.avatarInitials.trim()) return NextResponse.json({ ok: false, error: 'invalid_avatarInitials' }, { status: 400 });
  void APP_ROLES;
  void ALLOWED_ROLES;
  const user: AppSessionUser = {
    id: body.id.trim(),
    email: body.email.trim().toLowerCase(),
    role: body.role,
    displayName: body.displayName.trim(),
    avatarInitials: body.avatarInitials.trim(),
    avatarDataUrl: typeof body.avatarDataUrl === 'string' && body.avatarDataUrl.startsWith('data:') ? body.avatarDataUrl : undefined,
    bdManagerFullName: typeof body.bdManagerFullName === 'string' ? body.bdManagerFullName : undefined,
  };
  try {
    const token = await signSessionJwt(user);
    const res = NextResponse.json({ ok: true, user }, { status: 200 });
    res.headers.set('Set-Cookie', buildSetCookieHeader(token));
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.headers.set('Pragma', 'no-cache');
    return res;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'sign_failed', message: err?.message ?? '签名失败' }, { status: 500 });
  }
}
