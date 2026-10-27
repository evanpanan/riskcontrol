import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUser, json, readJson } from '@/lib/server/http';
import { userPatch, userSelect } from '@/lib/server/userManagement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const actor = await currentUser(req);
  if (!actor) return json({ ok: false, error: '未登录' }, 401);
  if (actor.role !== 'ADMIN') return json({ ok: false, error: '仅管理员可管理账号' }, 403);
  try { return json({ ok: true, stored: 'db', users: await prisma.appUser.findMany({ select: userSelect, orderBy: { createdAt: 'desc' } }) }); }
  catch { return json({ ok: false, error: '数据库不可用' }, 503); }
}
export async function POST(req: NextRequest) {
  const actor = await currentUser(req);
  if (!actor) return json({ ok: false, error: '未登录' }, 401);
  if (actor.role !== 'ADMIN') return json({ ok: false, error: '仅管理员可管理账号' }, 403);
  let patch;
  try { patch = await userPatch(await readJson(req), true); }
  catch (e) { return json({ ok: false, error: (e as Error).message }, 400); }
  try {
    const user = await prisma.$transaction(async tx => {
      const u = await tx.appUser.create({ data: patch, select: userSelect });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, role: actor.role, action: 'account_create', resource: u.id } });
      return u;
    });
    return json({ ok: true, stored: 'db', user });
  } catch (e: any) { return json({ ok: false, error: e.code === 'P2002' ? '邮箱或商务经理名称已存在' : '账号未保存，请稍后重试' }, e.code === 'P2002' ? 409 : 503); }
}
