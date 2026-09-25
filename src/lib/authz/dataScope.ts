import type { AppRole, AppSessionUser } from '@/types/auth';
import { APP_ROLES } from '@/types/auth';
import { logAuthDeny } from '@/lib/auth/audit';
import type { ClientStatus } from '@prisma/client';

/** 通用 Client 形状，兼容 Prisma Client + mockData 扁平客户端 */
export interface ClientLike {
  id: string;
  batchId: string;
  name: string;
  investmentAmount: number | null | undefined;
  bdManager: string;
  signDate?: string | Date;
  profitSplitClient?: number | null;
  profitSplitInstitution?: number | null;
  realtimePnL?: number | null;
  estimatedExitAmount?: number | null;
  status: ClientStatus | keyof typeof ClientStatus | string;
  settledAt?: string | Date | null;
  settlementNote?: string | null;
  batchNumber?: string;
  symbol?: string;
  riskLevel?: string;
  [k: string]: any;
}

export type BdKey = string;

export interface BdStatValue {
  count: number;
  amount: number;
  pnl: number;
}

/** 批次详情：其他商务经理 客户的脱敏占位行 */
export interface RedactedClientPlaceholder {
  id: string;
  __placeholder: true;
  __redacted: true;
  name: '— 其他商务经理 客户（已脱敏）—';
  bdManager: '（已隐藏）';
  investmentAmount: null;
  status: ClientStatus | 'ACTIVE';
  signDate?: null;
  profitSplitClient?: null;
  profitSplitInstitution?: null;
  realtimePnL?: null;
  estimatedExitAmount?: null;
}

const REDACTED_CLIENT_NAME = '— 其他商务经理 客户（已脱敏）—' as const;
const REDACTED_BD = '（已隐藏）' as const;

function isBd(role: AppRole): boolean {
  return role === APP_ROLES.BD_MANAGER;
}

function matchesBd(c: ClientLike, user: AppSessionUser): boolean {
  if (!user.bdManagerFullName) return false;
  return c.bdManager === user.bdManagerFullName;
}

/** 过滤 /clients 全局客户列表（RISK/OP 全量，BD 仅自己） */
export function filterClientsByRole(
  allClients: ClientLike[],
  user: AppSessionUser
): ClientLike[] {
  if (!isBd(user.role)) return allClients;
  const out: ClientLike[] = [];
  let redactedN = 0;
  for (const c of allClients) {
    if (matchesBd(c, user)) {
      out.push(c);
    } else {
      redactedN += 1;
    }
  }
  if (redactedN > 0) {
    logAuthDeny({
      action: 'data_scope_filtered',
      resource: 'clients.all',
      reason: 'bd_role_line_level_isolation',
      userId: user.id,
      role: user.role,
    });
  }
  return out;
}

/** 批次详情页客户表过滤：返回 visible 自己 BD + 占位行，总行数保持与原数组一致 */
export function filterBatchDetailClientsByRole(
  clients: ClientLike[],
  user: AppSessionUser
): {
  mergedRows: (ClientLike | RedactedClientPlaceholder)[];
  visibleOwnCount: number;
  redactedCount: number;
  totalOriginalCount: number;
} {
  const totalOriginalCount = clients.length;
  if (!isBd(user.role)) {
    return {
      mergedRows: clients as (ClientLike | RedactedClientPlaceholder)[],
      visibleOwnCount: clients.length,
      redactedCount: 0,
      totalOriginalCount,
    };
  }
  const visible: ClientLike[] = [];
  const redacted: RedactedClientPlaceholder[] = [];
  let i = 0;
  for (const c of clients) {
    if (matchesBd(c, user)) {
      visible.push(c);
    } else {
      redacted.push({
        id: `redacted-${i}-${c.id}`,
        __placeholder: true,
        __redacted: true,
        name: REDACTED_CLIENT_NAME,
        bdManager: REDACTED_BD,
        investmentAmount: null,
        status: 'ACTIVE',
      } as RedactedClientPlaceholder);
      i += 1;
    }
  }
  if (redacted.length > 0) {
    logAuthDeny({
      action: 'data_scope_filtered',
      resource: 'clients.batch_detail',
      reason: 'bd_role_batch_detail_redacted_rows',
      userId: user.id,
      role: user.role,
    });
  }
  return {
    mergedRows: [...visible, ...redacted],
    visibleOwnCount: visible.length,
    redactedCount: redacted.length,
    totalOriginalCount,
  };
}

/** BD 业绩分布过滤：RISK/OP=全量；BD=仅自己 1 条 + 其他商务经理 聚合为 "其他商务经理（N 位）" */
export function filterBdStatsByRole(
  bdMap: Record<BdKey, BdStatValue>,
  user: AppSessionUser
): {
  visibleEntries: [bdName: string, value: BdStatValue][];
  aggregatedOthers: null | {
    label: string;
    count: number;
    amount: number;
    pnl: number;
    countOthers: number;
  };
} {
  const entries = Object.entries(bdMap) as [string, BdStatValue][];
  if (!isBd(user.role)) {
    return { visibleEntries: entries, aggregatedOthers: null };
  }
  const meKey = user.bdManagerFullName;
  const mine: [string, BdStatValue][] = [];
  let othersCount = 0;
  let othersClientCount = 0;
  let othersAmount = 0;
  let othersPnl = 0;
  for (const [k, v] of entries) {
    if (meKey && k === meKey) {
      mine.push([k, v]);
    } else {
      othersCount += 1;
      othersClientCount += v.count ?? 0;
      othersAmount += v.amount ?? 0;
      othersPnl += v.pnl ?? 0;
    }
  }
  logAuthDeny({
    action: 'data_scope_filtered',
    resource: 'bd_stats',
    reason: 'bd_role_other_bds_aggregated',
    userId: user.id,
    role: user.role,
  });
  return {
    visibleEntries: mine,
    aggregatedOthers: othersCount > 0 ? {
      label: `其他商务经理（${othersCount} 位）`,
      count: othersClientCount,
      amount: othersAmount,
      pnl: othersPnl,
      countOthers: othersCount,
    } : null,
  };
}

/** 补仓记录 = 批次宏观信息，本轮全行可见（与 FR-1 矩阵对齐），仅占位返回 */
export function filterMarginCallsByRole<T>(mcs: T[], _user: AppSessionUser): T[] {
  return mcs;
}

/** 是否允许「新建批次 / 创建批次」：
 *  - ADMIN / RISK_MANAGER / OPERATIONS：✅ 允许
 *  - BD_MANAGER（商务经理）：❌ 严禁创建批次（需求 2）
 *  - ANALYST：❌ 仅研究只读
 */
export function canCreateBatch(role: AppRole | null | undefined): boolean {
  if (!role) return false;
  return (
    role === APP_ROLES.ADMIN ||
    role === APP_ROLES.RISK_MANAGER ||
    role === APP_ROLES.OPERATIONS
  );
}

export function canEditClient(role: AppRole | null | undefined): boolean {
  return canCreateBatch(role);
}
