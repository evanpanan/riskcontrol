import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUser, json, readJson } from '@/lib/server/http';
import { userPatch, userSelect } from '@/lib/server/userManagement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser(req); const { id } = await params;
  if (!actor) return json({ ok: false, error: '未登录' }, 401);
  if (actor.role !== 'ADMIN') return json({ ok: false, error: '仅管理员可管理账号' }, 403);
  let patch;
  try {
    patch = await userPatch(await readJson(req));
    if (actor.id === id && (patch.enabled === false || (patch.role && patch.role !== 'ADMIN'))) throw new Error('不能禁用或降级当前管理员');
  } catch(e) { return json({ ok: false, error: (e as Error).message }, 400); }
  try {
    const user = await prisma.$transaction(async tx => {
      const u = await tx.appUser.update({ where: { id }, data: patch, select: userSelect });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, role: actor.role, action: 'account_update', resource: id, detail: { fields: Object.keys(patch) } } });
      return u;
    });
    return json({ ok: true, stored: 'db', user });
  } catch(e: any) { return json({ ok: false, error: '账号未更新' }, e.code === 'P2025' ? 404 : 503); }
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser(req); const { id } = await params;
  if (!actor) return json({ ok: false, error: '未登录' }, 401);
  if (actor.role !== 'ADMIN') return json({ ok: false, error: '仅管理员可管理账号' }, 403);
  if (id === actor.id) return json({ ok: false, error: '不能删除当前管理员' }, 400);
  try {
    // Retain ownership and historical audit references; disable instead of erasing identities.
    await prisma.$transaction(async tx => {
      await tx.appUser.update({ where: { id }, data: { enabled: false } });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, role: actor.role, action: 'account_delete', resource: id } });
    });
    return json({ ok: true, stored: 'db', removed: { id } });
  } catch(e: any) { return json({ ok: false, error: '账号未停用' }, e.code === 'P2025' ? 404 : 503); }
}
