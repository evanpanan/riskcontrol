import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from '@/lib/prisma';
import { signSessionJwt, verifySessionJwt, RC_SESSION_MAX_AGE_SEC } from './session';
import type { AppSessionUser } from '@/types/auth';
const scrypt = promisify(scryptCallback);
export async function hashServerPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyServerPassword(password: string, encoded: string): Promise<boolean> {
  const [kind, salt, hex] = encoded.split('$');
  if (kind !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/.test(hex ?? '')) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
export const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');
export async function issueServerSession(user: AppSessionUser): Promise<string> {
  const token = await signSessionJwt(user);
  await prisma.$transaction(async tx=>{
    await tx.session.create({ data: { userId: user.id, token: tokenDigest(token), expiresAt: new Date(Date.now() + RC_SESSION_MAX_AGE_SEC * 1000) } });
    await tx.auditLog.create({data:{actorId:user.id,actorEmail:user.email,role:user.role,action:'login_success',resource:'auth:login'}});
  });
  return token;
}
export async function verifyServerSession(token: string): Promise<AppSessionUser | null> {
  try {
    if (!await verifySessionJwt(token)) return null;
    const row = await prisma.session.findUnique({ where: { token: tokenDigest(token) }, include: { user: true } });
    if (!row || row.expiresAt <= new Date() || !row.user.enabled) return null;
    const u = row.user;
    return { id: u.id, email: u.email, role: u.role, displayName: u.displayName, avatarInitials: u.avatarInitials, avatarDataUrl: u.avatarDataUrl ?? undefined, bdManagerFullName: u.bdManagerFullName ?? undefined };
  } catch { return null; }
}
