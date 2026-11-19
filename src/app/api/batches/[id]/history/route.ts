import { loadBatchHistoryView } from '@/lib/server/batchHistoryView';
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
    let warning: string | null = null;
    const rows = await prisma.batchDailySnapshot.findMany({ where: { batchId: id }, orderBy: { tradingDate: 'asc' }, select: { tradingDate: true, summary: true, capturedAt: true, source: true } }).catch(() => {
      warning = '每日留存暂不可用，当前按历史收盘价回算';
      return [];
    });
    const history = await loadBatchHistoryView((ledger.payload as any).batch as BatchLike, rows);
    return jsonNoStore({ rows: history.rows, warning: history.warning ?? warning });
  } catch { return jsonNoStore({ error: '历史数据暂不可用，请稍后重试' }, 503); }
}
