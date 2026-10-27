/**
 * 服务端会话登记与撤销。
 *
 * 设计要点：
 * - JWT 只承载「签名与过期」两件事，不能单独作为访问凭证：账号被停用、降权、改密或
 *   用户主动退出后，已签发的旧 JWT 仍然在有效期内，必须在服务端逐次核对。
 * - 会话以 token 的 SHA-256 摘要落库（Session.token 唯一），明文凭证不落库，
 *   数据库泄露也无法直接复用他人会话。
 * - 撤销语义：删除 Session 行（退出单会话）或删除该用户的全部 Session 行
 *   （停用 / 降权 / 改密）。
 */

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

/** 会话凭证明文只用于签名校验；落库仅保存摘要。 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 登记一条服务端会话，返回是否登记成功（数据库不可用返回 false）。 */
export async function registerSession(params: {
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddr?: string | null;
  userAgent?: string | null;
}): Promise<boolean> {
  const tokenHash = hashSessionToken(params.token);
  try {
    // 顺带清理该用户已过期的会话，避免表无限增长。
    await prisma.session.deleteMany({
      where: { userId: params.userId, expiresAt: { lt: new Date() } },
    });
    await prisma.session.create({
      data: {
        userId: params.userId,
        token: tokenHash,
        expiresAt: params.expiresAt,
        ipAddr: params.ipAddr ?? null,
        userAgent: params.userAgent ? params.userAgent.slice(0, 512) : null,
      },
      select: { id: true },
    });
    return true;
  } catch (err) {
    console.error('[rc-session] register failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** 会话是否仍被服务端认可（未被撤销且未过期）。 */
export async function isSessionActive(token: string): Promise<boolean> {
  try {
    const row = await prisma.session.findUnique({
      where: { token: hashSessionToken(token) },
      select: { id: true, expiresAt: true },
    });
    if (!row) return false;
    if (row.expiresAt.getTime() <= Date.now()) {
      // 过期即删除，避免残留记录。
      await prisma.session.deleteMany({ where: { id: row.id } }).catch(() => undefined);
      return false;
    }
    return true;
  } catch (err) {
    // 数据库不可用时一律视为会话无效（fail closed），避免撤销机制被故障绕过。
    console.error('[rc-session] verify failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** 撤销单个会话（退出当前设备）。 */
export async function revokeSession(token: string): Promise<void> {
  try {
    await prisma.session.deleteMany({ where: { token: hashSessionToken(token) } });
  } catch (err) {
    console.error('[rc-session] revoke failed:', err instanceof Error ? err.message : String(err));
  }
}

/** 撤销某账号的全部会话（停用 / 降权 / 改密后调用）。 */
export async function revokeUserSessions(userId: string): Promise<void> {
  try {
    await prisma.session.deleteMany({ where: { userId } });
  } catch (err) {
    console.error('[rc-session] revoke user failed:', err instanceof Error ? err.message : String(err));
  }
}
