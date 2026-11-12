import { getExitEligibility, type BatchLike, type SettlementSnapshot } from '@/lib/riskEngine';
export function validateSpecialExitWrite(previous: any, next: any, role: string): string | null {
  const batch = next?.batch as BatchLike | undefined;
  if (!batch) return null;
  const oldSettlements = previous?.batch?.finance?.settlements ?? {};
  for (const [clientId, value] of Object.entries(batch.finance?.settlements ?? {})) {
    if (oldSettlements[clientId]) continue;
    const settlement = value as SettlementSnapshot;
    const client = previous?.batch?.clients?.find((c: any) => c.id === clientId);
    if (!client) continue;
    const eligibility = getExitEligibility(previous.batch, client);
    if (!eligibility.canExit && role !== 'ADMIN' && role !== 'RISK_MANAGER') return '仅管理员或风控总监可特批退出';
    if (eligibility.lockUpEndDate > new Date()) {
      if (role !== "ADMIN") return "仅超级管理员可特批锁仓期退出";
      if (!settlement.lockupExitConfirmedAt || settlement.lockupEndDate !== eligibility.lockUpEndDate.toISOString()) return '锁仓期特批退出需要二次确认并记录锁仓期满日';
      const confirmed = Date.parse(settlement.lockupExitConfirmedAt);
      if (!Number.isFinite(confirmed) || confirmed > Date.now() + 60000) return '锁仓期确认时间无效，请重新确认';
    }
  }
  return null;
}
