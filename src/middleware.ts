import { NextRequest, NextResponse } from 'next/server';
import { RC_SESSION_COOKIE, verifySessionJwt } from '@/lib/auth/session';
import type { AppRole } from '@/types/auth';

export const config = {
  matcher: [
    '/',
    '/clients/:path*',
    '/batch/:path*',
    '/settings/:path*',
    '/settings',
  ],
};

const PUBLIC_PATHS = new Set(['/login', '/_next', '/favicon.ico', '/api/auth/login', '/api/auth/logout', '/api/auth/me']);
const INSTITUTION_ROLES: AppRole[] = ['ADMIN', 'RISK_MANAGER', 'BD_MANAGER', 'OPERATIONS'];

function isApi(path: string): boolean {
  return path.startsWith('/api/');
}

function requiresInstitutionRole(path: string): boolean {
  return path === '/settings' || path.startsWith('/settings');
}

function toAbsoluteLoginUrl(req: NextRequest, next: string): string {
  const protocol = req.headers.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = req.headers.get('host') ?? 'localhost';
  const base = `${protocol}://${host}`;
  const qs = next && next !== '/' && next !== '' ? `?next=${encodeURIComponent(next)}` : '';
  return `${base}/login${qs}`;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PATHS.has(path) || path.startsWith('/_next/') || path.startsWith('/__nextjs') || path.startsWith('/api/auth/')) {
    return NextResponse.next();
  }
  if (isApi(path) && !path.startsWith('/api/auth/')) {
    return NextResponse.next();
  }
  const token = req.cookies.get(RC_SESSION_COOKIE)?.value;
  if (!token) {
    const next = req.nextUrl.pathname + req.nextUrl.search;
    return NextResponse.redirect(toAbsoluteLoginUrl(req, next));
  }
  let user = null;
  try {
    user = await verifySessionJwt(token);
  } catch {
    user = null;
  }
  if (!user) {
    const next = req.nextUrl.pathname + req.nextUrl.search;
    const res = NextResponse.redirect(toAbsoluteLoginUrl(req, next));
    res.cookies.set(RC_SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
    return res;
  }
  const role: AppRole = user.role;
  if (requiresInstitutionRole(path) && !INSTITUTION_ROLES.includes(role)) {
    const protocol = req.headers.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
    const host = req.headers.get('host') ?? 'localhost';
    return NextResponse.redirect(`${protocol}://${host}/?reason=role_insufficient_settings`);
  }
  return NextResponse.next();
}
