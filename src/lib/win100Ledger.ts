/**
 * Phase 7: WIN100 履约台账
 *
 * 三张台账：
 *  1. 担保品台账 — WIN100 每笔担保品的存入（初始担保 + 补仓）、释放（客户退出）、当前盯市市值
 *  2. 收益台账 — WIN100 从每笔客户退出中获得的收益（客户让渡的分成 + 担保品本身盈亏）
 *  3. 履约台账 — 每笔补仓指令的 T+2 到账情况、违约记录、罚息
 *
 * 不修改 riskEngine 核心计算，只做只读聚合。
 */
import type { BatchLike, MarginRound } from "./riskEngine";
import {
  calculateRescueStats,
  getCollateralRatio,
  SUBORDINATE_RATIO,
  PRIORITY_RATIO,
  MARGIN_CALL_T2_DAYS,
} from "./riskEngine";

const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/* ------------------------------ 类型定义 ------------------------------ */

/** 担保品台账条目：每个批次 + 每笔资金注入 */
export interface CollateralLedgerEntry {
  id: string;              // 批次 id + 资金 id 或 "initial"
  batchId: string;
  batchNumber: string;
  type: "initial" | "margin_call";     // 初始担保 / 补仓担保
  tradeId?: string;
  triggerDate?: string;
  entryPrice: number;
  principal: number;      // 本金（美元）
  shares: number;         // 持股数（初始担保 = subordinateAmount / entryPrice）
  releasedShares: number;    // 已释放股数（客户结算释放）
  releasedAmount: number;   // 已释放本金（美元）
  remainingShares: number;
  currentPrice: number;
  currentValue: number; // 剩余部分当前市值
  pnl: number;          // 剩余部分浮动盈亏
  status: "active" | "fully_released";
}

/** 担保品台账汇总 */
export interface CollateralLedgerSummary {
  entries: CollateralLedgerEntry[];
  totalInjected: number;       // 累计注入本金
  totalReleased: number;     // 累计释放本金
  totalRemainingPrincipal: number;
  totalCurrentValue: number;
  totalUnrealizedPnL: number;
  collateralRatio: number;   // WIN100 担保市值 / 客户股票市值
}

/** 收益台账条目：每笔已结算客户 */
export interface RevenueLedgerEntry {
  id: string;
  batchId: string;
  batchNumber: string;
  clientId: string;
  clientName: string;
  settledAt: string;
  stockPrice: number;
  entryPrice: number;
  principal: number;
  isEarlyExit: boolean;
  earlyExitFee: number;
  earlyExitFeeRecipient?: string;
  clientReceives: number;
  // WIN100 收益拆解（按结算快照）：
  institutionInitialPnL: number;   // 初始劣后仓位盈亏（担保品初始部分）
  institutionClientShare: number; // 客户让渡的上涨收益（分成中 WIN100 应得部分）
  institutionRescuePnL: number;    // 救援/补仓担保品盈亏
  institutionTotalPnL: number;   // WIN100 合计
  win100PnL: number; // 综合（= institutionTotalPnL）
}

/** 收益台账汇总 */
export interface RevenueLedgerSummary {
  entries: RevenueLedgerEntry[];
  totalSettledCount: number;
  totalClientReceives: number;
  totalEarlyExitFee: number;
  totalInstitutionPnL: number;
  avgWin100PnL: number;
}

/** 履约台账条目：每笔补仓轮次 */
export interface PerformanceLedgerEntry {
  id: string;
  batchId: string;
  batchNumber: string;
  roundNumber: number;
  triggerDate: string;
  dueDate: string;          // T+2
  requiredAmount: number;
  fulfilledAmount: number;
  fulfilledDate?: string;
  status: "PENDING" | "FULLFILLED" | "EXPIRED" | "CANCELLED" | "OVERDUE";
  collateralType?: "cash" | "stock";
  isOverdue: boolean;
  overdueDays: number;
  penaltyAmount: number;    // 罚息（如有，按规则计算）
  note?: string;
}

/** 履约台账汇总 */
export interface PerformanceLedgerSummary {
  entries: PerformanceLedgerEntry[];
  totalRequired: number;
  totalFulfilled: number;
  pendingCount: number;
  overdueCount: number;
  totalPenalty: number;
  fulfillmentRate: number;  // 已履约 / 应履约
}

/* ------------------------------ 工具函数 ------------------------------ */

const PENALTY_RATE_PER_DAY = 0.0005; // 逾期每日罚息 0.05%（万分之五），可调整

function fmtMoney(n: number): number {
  return money(n);
}

function getCurrentPrice(batch: BatchLike): number {
  return batch.currentStockPrice ?? batch.stockPriceAtStart ?? 0;
}

function getEntryPrice(batch: BatchLike): number {
  return (batch.stockPriceAtStart ?? (batch as any).entryPrice ?? getCurrentPrice(batch));
}

function getSubordinateAmount(batch: BatchLike): number {
  return (batch.subordinateAmount ?? (batch.initialTotalAmount ?? 0) * SUBORDINATE_RATIO);
}

/* ------------------------------ 担保品台账 ------------------------------ */

export function buildCollateralLedger(batches: BatchLike[]): CollateralLedgerSummary {
  const entries: CollateralLedgerEntry[] = [];

  for (const batch of batches) {
    const price = getCurrentPrice(batch);
    const entryPrice = getEntryPrice(batch);
    const subAmount = getSubordinateAmount(batch);
    const finance = (batch as any).finance;
    const rescue = calculateRescueStats(batch, price);

    // 计算已结算客户释放的本金比例
    const settledClients = (batch.clients ?? []).filter(
      (c) => c.status === "SETTLED" || (finance?.settlements && finance.settlements[c.id])
    );
    const settledWeight =
      (batch.priorityAmount ?? 0) > 0
        ? settledClients.reduce((s, c) => s + (c.investmentAmount ?? 0), 0) / (batch.priorityAmount ?? 0)
        : 0;

    // 初始担保条目
    const initialShares = entryPrice > 0 ? subAmount / entryPrice : 0;
    const releasedInitialShares = initialShares * settledWeight;
    const releasedInitialAmount = subAmount * settledWeight;
    const remainingInitialShares = Math.max(0, initialShares - releasedInitialShares);
    const remainingInitialPrincipal = Math.max(0, subAmount - releasedInitialAmount);
    const initialCurrentValue = remainingInitialShares * price;
    entries.push({
      id: `${batch.id}-initial`,
      batchId: batch.id,
      batchNumber: (batch as any).batchNumber ?? batch.id,
      type: "initial",
      entryPrice,
      principal: subAmount,
      shares: initialShares,
      releasedShares: releasedInitialShares,
      releasedAmount: releasedInitialAmount,
      remainingShares: remainingInitialShares,
      currentPrice: price,
      currentValue: initialCurrentValue,
      pnl: initialCurrentValue - remainingInitialPrincipal,
      status: remainingInitialShares < 1e-6 ? "fully_released" : "active",
    });

    // 每笔补仓（救援）条目：核销已在成交层按客户归属完成（remainingFraction），
    // 不能再按 settledWeight 二次扣减，否则会重复释放并低估剩余担保价值。
    for (const perCall of rescue.perCall) {
      const remainingRescueShares = perCall.shares;
      const remainingRescuePrincipal = perCall.amount;
      const releasedRescueShares = Math.max(0, perCall.originalShares - perCall.shares);
      const releasedRescueAmount = Math.max(0, perCall.originalAmount - perCall.amount);
      const currentValue = remainingRescueShares * price;
      entries.push({
        id: `${batch.id}-${perCall.id}`,
        batchId: batch.id,
        batchNumber: (batch as any).batchNumber ?? batch.id,
        type: "margin_call",
        tradeId: perCall.id,
        triggerDate: (batch as any).finance?.rounds?.find(
          (r: MarginRound) => r.allocations && Object.keys(r.allocations).length > 0
        )?.triggerDate,
        entryPrice: perCall.entryPrice,
        principal: perCall.amount,
        shares: perCall.shares,
        releasedShares: releasedRescueShares,
        releasedAmount: releasedRescueAmount,
        remainingShares: remainingRescueShares,
        currentPrice: price,
        currentValue,
        pnl: currentValue - remainingRescuePrincipal,
        status: remainingRescueShares < 1e-6 ? "fully_released" : "active",
      });
    }
  }

  const totalInjected = entries.reduce((s, e) => s + e.principal, 0);
  const totalReleased = entries.reduce((s, e) => s + e.releasedAmount, 0);
  const totalRemainingPrincipal = entries.reduce((s, e) => s + Math.max(0, e.principal - e.releasedAmount), 0);
  const totalCurrentValue = entries.reduce((s, e) => s + e.currentValue, 0);
  const totalUnrealizedPnL = entries.reduce((s, e) => s + e.pnl, 0);

  // 整体担保比例
  const clientStockValue = batches.reduce((s, b) => {
    const cr = getCollateralRatio(b);
    const ratio = cr.ratio ?? 0;
    return s + (ratio > 0 ? (b.currentTotalMarketValue ?? 0) : 0);
  }, 0);
  const collateralRatio = clientStockValue > 0 ? totalCurrentValue / clientStockValue : 0;

  return {
    entries,
    totalInjected: fmtMoney(totalInjected),
    totalReleased: fmtMoney(totalReleased),
    totalRemainingPrincipal: fmtMoney(totalRemainingPrincipal),
    totalCurrentValue: fmtMoney(totalCurrentValue),
    totalUnrealizedPnL: fmtMoney(totalUnrealizedPnL),
    collateralRatio,
  };
}

/* ------------------------------收益台账 ------------------------------ */

export function buildRevenueLedger(batches: BatchLike[]): RevenueLedgerSummary {
  const entries: RevenueLedgerEntry[] = [];

  for (const batch of batches) {
    const finance = (batch as any).finance;
    const settlements = finance?.settlements ?? {};
    const settledClients = (batch.clients ?? []).filter(
      (c) => settlements[c.id] || c.status === "SETTLED"
    );

    for (const client of settledClients) {
      const snap = settlements[client.id] ?? (client as any).settlement;
      if (!snap) continue;
      const entryPrice = (client as any).entryStockPrice ?? batch.stockPriceAtStart ?? 0;
      entries.push({
        id: snap.id ?? `${batch.id}-${client.id}`,
        batchId: batch.id,
        batchNumber: (batch as any).batchNumber ?? batch.id,
        clientId: client.id,
        clientName: client.name,
        settledAt: snap.settledAt,
        stockPrice: snap.stockPrice,
        entryPrice,
        principal: client.investmentAmount,
        isEarlyExit: !!snap.isEarlyExit,
        earlyExitFee: snap.earlyExitFee ?? 0,
        earlyExitFeeRecipient: snap.earlyExitFeeRecipient,
        clientReceives: snap.clientReceives,
        institutionInitialPnL: snap.institutionInitialPnL ?? 0,
        institutionClientShare: snap.institutionClientShare ?? 0,
        institutionRescuePnL: snap.institutionRescuePnL ?? 0,
        institutionTotalPnL:
          (snap.institutionInitialPnL ?? 0) +
          (snap.institutionClientShare ?? 0) +
          (snap.institutionRescuePnL ?? 0),
        win100PnL:
          (snap.institutionInitialPnL ?? 0) +
          (snap.institutionClientShare ?? 0) +
          (snap.institutionRescuePnL ?? 0),
      });
    }
  }

  entries.sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));

  const totalSettledCount = entries.length;
  const totalClientReceives = entries.reduce((s, e) => s + e.clientReceives, 0);
  const totalEarlyExitFee = entries.reduce((s, e) => s + e.earlyExitFee, 0);
  const totalInstitutionPnL = entries.reduce((s, e) => s + e.institutionTotalPnL, 0);

  return {
    entries,
    totalSettledCount,
    totalClientReceives: fmtMoney(totalClientReceives),
    totalEarlyExitFee: fmtMoney(totalEarlyExitFee),
    totalInstitutionPnL: fmtMoney(totalInstitutionPnL),
    avgWin100PnL: totalSettledCount > 0 ? fmtMoney(totalInstitutionPnL / totalSettledCount) : 0,
  };
}

/* ------------------------------ 履约台账 ------------------------------ */

function calcPenalty(round: MarginRound): { isOverdue: boolean; overdueDays: number; penalty: number } {
  const now = new Date();
  const due = round.dueDate ? new Date(round.dueDate) : null;
  if (!due) return { isOverdue: false, overdueDays: 0, penalty: 0 };
  const fulfilled = round.fulfilledAmount ?? 0;
  const isFulfilled = round.status === "FULLFILLED";
  if (isFulfilled || round.status === "CANCELLED" || round.status === "EXPIRED") {
    return { isOverdue: false, overdueDays: 0, penalty: 0 };
  }
  const diffMs = now.getTime() - due.getTime();
  const overdueDays = diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0;
  const isOverdue = overdueDays > 0;
  const outstanding = Math.max(0, round.requiredAmount - fulfilled);
  const penalty = isOverdue ? outstanding * PENALTY_RATE_PER_DAY * overdueDays : 0;
  return { isOverdue, overdueDays, penalty };
}

export function buildPerformanceLedger(batches: BatchLike[]): PerformanceLedgerSummary {
  const entries: PerformanceLedgerEntry[] = [];

  for (const batch of batches) {
    const rounds = (batch as any).finance?.rounds ?? [];
    for (const round of rounds) {
      const { isOverdue, overdueDays, penalty } = calcPenalty(round);
      entries.push({
        id: round.id,
        batchId: batch.id,
        batchNumber: (batch as any).batchNumber ?? batch.id,
        roundNumber: round.number,
        triggerDate: round.triggerDate,
        dueDate: round.dueDate,
        requiredAmount: round.requiredAmount,
        fulfilledAmount: round.fulfilledAmount ?? 0,
        fulfilledDate: round.fulfilledDate,
        status: isOverdue ? "OVERDUE" : round.status,
        collateralType: round.collateralType,
        isOverdue,
        overdueDays,
        penaltyAmount: fmtMoney(penalty),
        note: round.win100Decision,
      });
    }
  }

  entries.sort((a, b) => (a.triggerDate < b.triggerDate ? 1 : -1));

  const totalRequired = entries.reduce((s, e) => s + e.requiredAmount, 0);
  const totalFulfilled = entries.reduce((s, e) => s + e.fulfilledAmount, 0);
  const pendingCount = entries.filter((e) => e.status === "PENDING" || e.status === "OVERDUE").length;
  const overdueCount = entries.filter((e) => e.isOverdue).length;
  const totalPenalty = entries.reduce((s, e) => s + e.penaltyAmount, 0);
  const fulfillmentRate = totalRequired > 0 ? totalFulfilled / totalRequired : 0;

  return {
    entries,
    totalRequired: fmtMoney(totalRequired),
    totalFulfilled: fmtMoney(totalFulfilled),
    pendingCount,
    overdueCount,
    totalPenalty: fmtMoney(totalPenalty),
    fulfillmentRate,
  };
}

/* ------------------------------ 统一聚合 ------------------------------ */

export interface Win100LedgerData {
  collateral: CollateralLedgerSummary;
  revenue: RevenueLedgerSummary;
  performance: PerformanceLedgerSummary;
}

export function buildWin100Ledger(batches: BatchLike[]): Win100LedgerData {
  return {
    collateral: buildCollateralLedger(batches),
    revenue: buildRevenueLedger(batches),
    performance: buildPerformanceLedger(batches),
  };
}

export { MARGIN_CALL_T2_DAYS, PRIORITY_RATIO, SUBORDINATE_RATIO };
