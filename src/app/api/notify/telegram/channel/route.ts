import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionUser, unauthorized, forbidden } from '@/lib/server/apiAuth';
import { prisma } from '@/lib/prisma';
import { loadTelegramChannel, verifyTelegramChannel, TELEGRAM_CHANNEL_KEY } from '@/lib/server/telegram';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role !== 'ADMIN') return forbidden();
  try {
    const channel = await loadTelegramChannel();
    return NextResponse.json({ channel, botConfigured: !!process.env.TELEGRAM_BOT_TOKEN?.trim(), managedByEnv: !!process.env.TELEGRAM_CHANNEL_ID?.trim() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: '频道设置暂时不可用，请稍后刷新', botConfigured: !!process.env.TELEGRAM_BOT_TOKEN?.trim() }, { status: 503 }); }
}
export async function POST(req: NextRequest) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role !== 'ADMIN') return forbidden();
  if (process.env.TELEGRAM_CHANNEL_ID?.trim()) return NextResponse.json({ error: '频道由服务器环境变量管理，请联系运维修改' }, { status: 409 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.chatId !== 'string' || body.chatId.length > 80 || (body.joinUrl != null && (typeof body.joinUrl !== 'string' || body.joinUrl.length > 500))) return NextResponse.json({ error: '频道参数无效' }, { status: 400 });
  try {
    const channel = await verifyTelegramChannel(body.chatId.trim(), body.joinUrl);
    await prisma.$transaction(async tx => {
      await tx.workspaceRecord.upsert({ where: { kind_key: { kind: 'config', key: TELEGRAM_CHANNEL_KEY } },
        create: { kind: 'config', key: TELEGRAM_CHANNEL_KEY, payload: { ...channel }, updatedBy: user.id },
        update: { payload: { ...channel }, revision: { increment: 1 }, updatedBy: user.id } });
    });
    return NextResponse.json({ channel });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '频道验证或保存失败' }, { status: 400 }); }
}
