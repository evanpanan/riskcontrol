import { prisma } from '@/lib/prisma';
import { resolveSessionUser, unauthorized, forbidden, jsonNoStore } from '@/lib/server/apiAuth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const user = await resolveSessionUser(); if (!user) return unauthorized(); if (user.role !== 'ADMIN') return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonNoStore({ error: '请选择备份' }, 400);
  const archive = await prisma.backupArchive.findUnique({ where: { id } });
  if (!archive) return jsonNoStore({ error: '备份不存在' }, 404);
  await prisma.auditLog.create({ data: { actorId: user.id, actorEmail: user.email, role: user.role, action: 'backup_download', resource: `backup:${id}` } });
  return new Response(new Uint8Array(archive.data), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="riskcontrol-${archive.backupDate}.rcbackup"`, 'Cache-Control': 'no-store', 'X-Backup-SHA256': archive.sha256 } });
}
