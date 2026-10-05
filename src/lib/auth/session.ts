import type { AppRole, AppSessionUser } from '@/types/auth';

export const RC_SESSION_COOKIE = 'rc_session_v1';
export const RC_SESSION_MAX_AGE_SEC = 60 * 60 * 12; // 12h

export interface RcSessionJwtPayload {
  sub: string; // userId
  email: string;
  role: AppRole;
  displayName: string;
  avatarInitials: string;
  avatarDataUrl?: string;
  bdManagerFullName?: string;
  iat: number;
  exp: number;
  iss: 'rc-internal';
}

const BASE64URL_REPLACEMENTS: Record<string, string> = { '+': '-', '/': '_', '=': '' };

function base64UrlEncode(input: Uint8Array | string): string {
  let b64: string;
  if (typeof input === 'string') {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input);
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes).toString('base64');
    } else {
      b64 = btoa(String.fromCharCode(...bytes));
    }
  } else {
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(input).toString('base64');
    } else {
      b64 = btoa(String.fromCharCode(...input));
    }
  }
  return b64.replace(/[+/=]/g, (m) => BASE64URL_REPLACEMENTS[m] ?? m);
}

function base64UrlDecodeToBytes(encoded: string): Uint8Array | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const b64 = base64 + pad;
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function base64UrlDecodeToString(encoded: string): string | null {
  const bytes = base64UrlDecodeToBytes(encoded);
  if (!bytes) return null;
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

function getAuthSecret(override?: string): Uint8Array {
  const raw = (override ?? process.env.NEXT_RC_AUTH_SECRET) as string | undefined;
  const fallback: string = (process.env.NODE_ENV === 'production' ? '' : `dev-session-secret-v1::${process.env.NODE_ENV ?? 'local'}::do-not-use-in-prod`);
  const chosen = (raw && raw.trim()) ? raw.trim() : fallback;
  if (!chosen) {
    throw new Error('[rc-session] NEXT_RC_AUTH_SECRET is required in production.');
  }
  const encoder = new TextEncoder();
  return encoder.encode(chosen);
}

const JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

const _textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
function encodeUtf8(s: string): Uint8Array {
  if (_textEncoder) return _textEncoder.encode(s);
  return new Uint8Array(Buffer.from(s, 'utf-8'));
}

async function hmacSha256(keyBytes: Uint8Array, messageBytes: Uint8Array): Promise<Uint8Array> {
  const crypto = globalThis.crypto;
  if (!crypto || !crypto.subtle) {
    throw new Error('[rc-session] Web Crypto API is unavailable in this runtime');
  }
  const keyBuf = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const msgBuf = messageBytes.buffer.slice(messageBytes.byteOffset, messageBytes.byteOffset + messageBytes.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC' as const, hash: 'SHA-256' as const },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign({ name: 'HMAC' as const }, key, msgBuf);
  return new Uint8Array(sig);
}

export async function signSessionJwt(user: Pick<AppSessionUser, 'id' | 'email' | 'role' | 'displayName' | 'avatarInitials' | 'avatarDataUrl' | 'bdManagerFullName'>, maxAgeSec = RC_SESSION_MAX_AGE_SEC): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: RcSessionJwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    avatarInitials: user.avatarInitials,
    avatarDataUrl: user.avatarDataUrl,
    bdManagerFullName: user.bdManagerFullName,
    iat: nowSec,
    exp: nowSec + maxAgeSec,
    iss: 'rc-internal',
  };
  const body = `${JWT_HEADER}.${base64UrlEncode(JSON.stringify(payload))}`;
  const secret = getAuthSecret();
  const signature = await hmacSha256(secret, encodeUtf8(body));
  return `${body}.${base64UrlEncode(signature)}`;
}

export async function verifySessionJwt(token: string): Promise<AppSessionUser | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (headerB64 !== JWT_HEADER) return null;
  const payloadRaw = base64UrlDecodeToString(payloadB64);
  const sigBytes = base64UrlDecodeToBytes(sigB64);
  if (!payloadRaw || !sigBytes || sigBytes.length < 16) return null;
  let payload: RcSessionJwtPayload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return null;
  }
  if (payload.iss !== 'rc-internal') return null;
  if (typeof payload.exp !== 'number') return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) return null;
  if (typeof payload.email !== 'string' || typeof payload.displayName !== 'string' || typeof payload.sub !== 'string' || typeof payload.avatarInitials !== 'string') return null;
  const role = payload.role;
  if (role !== 'ADMIN' && role !== 'RISK_MANAGER' && role !== 'BD_MANAGER' && role !== 'OPERATIONS') return null;
  const body = `${headerB64}.${payloadB64}`;
  const secret = getAuthSecret();
  const expectedBytes = await hmacSha256(secret, encodeUtf8(body));
  if (expectedBytes.length !== sigBytes.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) diff |= expectedBytes[i] ^ sigBytes[i];
  if (diff !== 0) return null;
  return {
    id: payload.sub,
    email: payload.email,
    role,
    displayName: payload.displayName,
    avatarInitials: payload.avatarInitials,
    avatarDataUrl: payload.avatarDataUrl,
    bdManagerFullName: payload.bdManagerFullName,
  };
}

export function buildSetCookieHeader(value: string, maxAgeSec = RC_SESSION_MAX_AGE_SEC, secure = process.env.NODE_ENV === 'production', sameSite: 'Lax' | 'Strict' | 'None' = 'Lax'): string {
  const parts: string[] = [
    `${RC_SESSION_COOKIE}=${value}`,
    `Max-Age=${maxAgeSec}`,
    'Path=/',
    `SameSite=${sameSite}`,
    'HttpOnly',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookieHeader(): string {
  return `${RC_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
