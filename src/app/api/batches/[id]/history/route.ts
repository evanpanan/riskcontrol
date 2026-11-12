import { backfillBatchHistory } from '@/lib/server/batchHistoryBackfill';
import type { BatchLike } from '@/lib/riskEngine';
import { prisma } from '@/lib/prisma';
import { resolveSessionUser, unauthorized, forbidden, jsonNoStore } from '@/lib/server/apiAuth';
import { ledgerOwnsBd } from '@/lib/server/workspaceScope';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const ledger = await prisma.workspaceRecord.findUnique({ where: { kind_key: { kind: 'ledger', key: id } } });
  if (!ledger || (user.role === 'BD_MANAGER' && !ledgerOwnsBd(ledger.payload, user.bdManagerFullName))) return forbidden('无权查看该批次历史');
  try {
    const rows = await prisma.batchDailySnapshot.findMany({ where: { batchId: id }, orderBy: { tradingDate: 'asc' }, select: { tradingDate: true, summary: true, capturedAt: true, source: true } });
    let calculated: object[] = []; let warning: string | null = null;
    try { calculated = await backfillBatchHistory((ledger.payload as any).batch as BatchLike, new Set(rows.map(r => r.tradingDate))); }
    catch { warning = '历史收盘价暂不可用，当前仅显示已有留存数据，请稍后重试'; }
    const actual = rows.map(r => ({ ...r.summary as object, capturedAt: r.capturedAt.toISOString(), source: r.source, reconstructed: false }));
    return jsonNoStore({ rows: [...calculated, ...actual].sort((a: any, b: any) => a.date.localeCompare(b.date)), warning });
  } catch { return jsonNoStore({ error: '每日历史数据暂不可用，请确认数据库迁移已执行' }, 503); }
}
