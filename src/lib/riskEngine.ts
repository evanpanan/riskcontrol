import { Client, Batch, MarginCall, RiskLevel, BatchStatus } from "@prisma/client";
import { calculateTradingWindows } from "./utils";

export const PRIORITY_RATIO = 0.7;
export const SUBORDINATE_RATIO = 0.3;
export const WARNING_DROP_THRESHOLD = 0.15;
export const CRITICAL_DROP_THRESHOLD = 0.20;
export const HIGH_INVESTMENT_THRESHOLD = 100000;
export const HIGH_INVESTMENT_CLIENT_SPLIT = 0.4;
export const LOW_INVESTMENT_CLIENT_SPLIT = 0.3;

export interface BatchRiskMetrics {
  dropPercent: number;
  dropAmount: number;
  currentMarketValue: number;
  safetyBufferPercent: number;
  requiredMarginCall: number;
  riskLevel: RiskLevel;
  totalPnL: number;
  totalPnLPercent: number;
}

export interface RescueStats {
  totalRescueAmount: number;
  totalRescueShares: number;
  weightedAverageEntryPrice: number;
  rescueCurrentValue: number;
  rescuePnL: number;
  rescuePnLPercent: number;
  perCall: Array<{
    id: string;
    amount: number;
    entryPrice: number;
    shares: number;
    currentValue: number;
    pnl: number;
    pnlPercent: number;
  }>;
}

export interface SettlementResult {
  clientReceives: number;
  institutionReceives: number;
  clientPnL: number;
  institutionPnL: number;
  splitRatioClient: number;
  isLoss: boolean;
  marginCallReturned: number;
}

export function calculateInvestmentSplit(totalAmount: number) {
  return {
    priorityAmount: totalAmount * PRIORITY_RATIO,
    subordinateAmount: totalAmount * SUBORDINATE_RATIO,
  };
}

export function calculateProfitSplitRatio(investmentAmount: number) {
  if (investmentAmount >= HIGH_INVESTMENT_THRESHOLD) {
    return {
      client: HIGH_INVESTMENT_CLIENT_SPLIT,
      institution: 1 - HIGH_INVESTMENT_CLIENT_SPLIT,
    };
  }
  return {
    client: LOW_INVESTMENT_CLIENT_SPLIT,
    institution: 1 - LOW_INVESTMENT_CLIENT_SPLIT,
  };
}

export function calculateBatchRiskMetrics(
  initialTotalAmount: number,
  currentMarketValue: number,
  cumulativeMarginCalls: number = 0
): BatchRiskMetrics {
  const dropAmount = initialTotalAmount - currentMarketValue;
  const dropPercent = initialTotalAmount > 0 ? dropAmount / initialTotalAmount : 0;
  const safetyBufferPercent = CRITICAL_DROP_THRESHOLD - dropPercent;
  const totalPnL = currentMarketValue + cumulativeMarginCalls - initialTotalAmount;
  const totalPnLPercent = initialTotalAmount > 0 ? totalPnL / initialTotalAmount : 0;

  let riskLevel: RiskLevel = RiskLevel.NORMAL;
  if (dropPercent >= CRITICAL_DROP_THRESHOLD) {
    riskLevel = RiskLevel.CRITICAL;
  } else if (dropPercent >= WARNING_DROP_THRESHOLD) {
    riskLevel = RiskLevel.WARNING;
  }

  const requiredMarginCall = dropPercent >= CRITICAL_DROP_THRESHOLD ? dropAmount : 0;

  return {
    dropPercent: Math.max(0, dropPercent) * 100,
    dropAmount: Math.max(0, dropAmount),
    currentMarketValue,
    safetyBufferPercent: safetyBufferPercent * 100,
    requiredMarginCall,
    riskLevel,
    totalPnL,
    totalPnLPercent: totalPnLPercent * 100,
  };
}

export function calculateCurrentMarketValue(
  stockPriceAtStart: number,
  currentStockPrice: number,
  totalShares: number
): number {
  if (stockPriceAtStart <= 0) return 0;
  return totalShares * currentStockPrice;
}

export function calculateTotalShares(
  initialTotalAmount: number,
  stockPriceAtStart: number
): number {
  if (stockPriceAtStart <= 0) return 0;
  return initialTotalAmount / stockPriceAtStart;
}

export function calculateRescueStats(
  batch: Batch & { marginCalls?: MarginCall[] },
  currentStockPrice: number
): RescueStats {
  const perCall: RescueStats["perCall"] = [];
  let totalRescueAmount = 0;
  let totalRescueShares = 0;
  let totalWeightedCost = 0;

  for (const mc of batch.marginCalls || []) {
    const amount = (mc as any).fulfilledAmount || 0;
    if (amount <= 0) continue;
    const entryPrice = (mc as any).averageEntryPrice || 0;
    const explicitShares = (mc as any).rescueShares;
    const shares = explicitShares && explicitShares > 0
      ? explicitShares
      : (entryPrice > 0 ? amount / entryPrice : 0);
    if (shares <= 0) continue;

    const currentValue = shares * (currentStockPrice || 0);
    const pnl = currentValue - amount;
    const pnlPercent = amount > 0 ? (pnl / amount) * 100 : 0;

    perCall.push({
      id: mc.id,
      amount,
      entryPrice,
      shares,
      currentValue,
      pnl,
      pnlPercent,
    });
    totalRescueAmount += amount;
    totalRescueShares += shares;
    totalWeightedCost += amount * entryPrice;
  }

  const rescueCurrentValue = totalRescueShares * (currentStockPrice || 0);
  const rescuePnL = rescueCurrentValue - totalRescueAmount;
  const rescuePnLPercent = totalRescueAmount > 0 ? (rescuePnL / totalRescueAmount) * 100 : 0;
  const weightedAverageEntryPrice = totalRescueShares > 0
    ? totalRescueAmount / totalRescueShares
    : 0;

  return {
    totalRescueAmount,
    totalRescueShares,
    weightedAverageEntryPrice,
    rescueCurrentValue,
    rescuePnL,
    rescuePnLPercent,
    perCall,
  };
}

export function calculateClientSettlement(
  client: Client,
  batch: Batch & { marginCalls?: MarginCall[] },
  finalMarketValue: number,
  finalStockPrice: number
): SettlementResult {
  const priorityPool = batch.priorityAmount || batch.initialTotalAmount * PRIORITY_RATIO;
  const subordinatePool = batch.subordinateAmount || batch.initialTotalAmount * SUBORDINATE_RATIO;
  const weight = priorityPool > 0 ? client.investmentAmount / priorityPool : 0;

  const clientShares = (batch.totalShares || 0) * PRIORITY_RATIO * weight;
  const instInitialShares = (batch.totalShares || 0) * SUBORDINATE_RATIO;

  const rescue = calculateRescueStats(batch as any, finalStockPrice);
  const instRescueShares = rescue.totalRescueShares;
  const instRescueReturnedAmount = rescue.totalRescueAmount;
  const instRescuePnL = rescue.rescuePnL;

  const stockPriceAtStart = batch.stockPriceAtStart;
  const isPriceAboveStart = stockPriceAtStart > 0 && finalStockPrice > stockPriceAtStart;

  // ① 规则1：只有股价超买入价，客户才参与利润分成；否则客户只保本。
  // 客户初始仓位盈利 = max(0, (finalPrice - startPrice) × clientShares)
  const clientInitialPosPnL = isPriceAboveStart && clientShares > 0
    ? Math.max(0, (finalStockPrice - stockPriceAtStart) * clientShares)
    : 0;

  // 客户按分成比例取自己那部分
  const split = calculateProfitSplitRatio(client.investmentAmount);
  const clientPnL = clientInitialPosPnL * split.client;
  const clientReceives = client.investmentAmount + clientPnL;

  // 机构收款 = 总市值 - 客户收款。机构盈利 = 三部分相加
  //  1) 机构初始劣后仓位 PnL = (finalPrice - startPrice) × instInitialShares
  //  2) 机构补仓救援仓位 PnL = rescuePnL (独立核算，规则3)
  //  3) 客户盈利中机构分到的部分 = clientInitialPosPnL × split.institution
  const totalPoolFromSale = finalMarketValue;
  const institutionReceives = Math.max(0, totalPoolFromSale - clientReceives);
  const isLoss = clientPnL <= 0;

  const marginCallReturned = rescue.totalRescueAmount;

  return {
    clientReceives: Math.max(0, clientReceives),
    institutionReceives,
    clientPnL,
    institutionPnL: institutionReceives - (subordinatePool + rescue.totalRescueAmount),
    splitRatioClient: split.client * 100,
    isLoss,
    marginCallReturned,
  };
}

export function calculateRealtimeClientMetrics(
  client: Client,
  batch: Batch & { marginCalls?: MarginCall[] },
  currentMarketValue: number
) {
  const priorityPool = batch.priorityAmount || batch.initialTotalAmount * PRIORITY_RATIO;
  const weight = priorityPool > 0 ? client.investmentAmount / priorityPool : 0;
  const currentStockPrice = batch.currentStockPrice ?? batch.stockPriceAtStart;
  const stockPriceAtStart = batch.stockPriceAtStart;

  const estimatedFinal = calculateClientSettlement(
    client,
    batch as any,
    currentMarketValue,
    currentStockPrice
  );

  // 规则1 核心：只有股价 > 买入价，客户才有"浮盈"；否则一律 = 0（保本/浮亏状态都不显示盈利）
  const isPriceAboveStart = stockPriceAtStart > 0 && (currentStockPrice || 0) > stockPriceAtStart;
  const clientShares = (batch.totalShares || 0) * PRIORITY_RATIO * weight;
  const clientInitialPosPnL = isPriceAboveStart && clientShares > 0
    ? Math.max(0, ((currentStockPrice || 0) - stockPriceAtStart) * clientShares)
    : 0;
  const split = calculateProfitSplitRatio(client.investmentAmount);
  const realtimePnL = clientInitialPosPnL * split.client;

  // 当前客户对应市值（不代表客户最终能拿到，仅代表市场价值占位）
  const marketValueShare = (currentMarketValue || 0) * weight;

  return {
    realtimePnL,
    estimatedExitAmount: estimatedFinal.clientReceives,
    marketValueShare,
    // UI 额外显示用
    clientShares,
    isPriceAboveStart,
  };
}

export function calculateBatchStatus(batch: Batch): BatchStatus {
  const trading = calculateTradingWindows(batch.signDate);
  if (trading.monthsElapsed >= 24) return BatchStatus.CLOSED;
  return trading.isLocked ? BatchStatus.LOCKED : BatchStatus.TRADING_OPEN;
}

export interface PortfolioSummary {
  totalAUM: number;
  totalPriority: number;
  totalSubordinate: number;
  totalMarginCalls: number;
  totalPnL: number;
  totalPnLPercent: number;
  institutionPnL: number;
  institutionPnLPercent: number;
  allClientsPnL: number;
  allClientsPnLPercent: number;
  profitableCount: number;
  normalCount: number;
  warningCount: number;
  criticalCount: number;
  totalBatches: number;
  currentMarketValueTotal: number;
  rescueTotalInjected: number;
  rescueTotalCurrentValue: number;
  rescueTotalPnL: number;
}

export interface BatchPnLSplit {
  clientTotalPnL: number;
  clientTotalPnLPercent: number;
  institutionTotalPnL: number;
  institutionTotalPnLPercent: number;
  perClient: Map<string, { name: string; pnl: number; pnlPercent: number; isProfitable: boolean }>;
  rescueStats: RescueStats | null;
  breakdown: {
    institutionInitialSubordinatePnL: number;
    institutionClientSplitShare: number;
    institutionRescuePnL: number;
  };
}

export function calculateBatchPnLSplit(
  batch: Batch & { clients?: Client[]; marginCalls?: MarginCall[] },
  currentMarketValue: number
): BatchPnLSplit {
  let clientTotalPnL = 0;
  let institutionClientSplitShare = 0;
  const perClient = new Map<
    string,
    { name: string; pnl: number; pnlPercent: number; isProfitable: boolean }
  >();

  const priorityPool = batch.priorityAmount || batch.initialTotalAmount * PRIORITY_RATIO;
  const subordinatePool = batch.subordinateAmount || batch.initialTotalAmount * SUBORDINATE_RATIO;
  const currentStockPrice = (batch.currentStockPrice ?? batch.stockPriceAtStart) || 0;
  const stockPriceAtStart = batch.stockPriceAtStart || 0;
  const isPriceAboveStart = stockPriceAtStart > 0 && currentStockPrice > stockPriceAtStart;
  const totalShares = batch.totalShares || 0;

  const instInitialShares = totalShares * SUBORDINATE_RATIO;
  const institutionInitialSubordinatePnL = instInitialShares * (currentStockPrice - stockPriceAtStart);

  const rescue = calculateRescueStats(batch as any, currentStockPrice);
  const institutionRescuePnL = rescue.rescuePnL;

  if (batch.clients) {
    for (const client of batch.clients) {
      const weight = priorityPool > 0 ? client.investmentAmount / priorityPool : 0;
      const split = calculateProfitSplitRatio(client.investmentAmount);

      const clientShares = totalShares * PRIORITY_RATIO * weight;
      const clientInitialPosPnL = isPriceAboveStart && clientShares > 0
        ? Math.max(0, (currentStockPrice - stockPriceAtStart) * clientShares)
        : 0;

      const pnl = clientInitialPosPnL * split.client;
      const instFromClient = clientInitialPosPnL * split.institution;

      clientTotalPnL += pnl;
      institutionClientSplitShare += instFromClient;

      perClient.set(client.id, {
        name: client.name,
        pnl,
        pnlPercent:
          client.investmentAmount > 0
            ? (pnl / client.investmentAmount) * 100
            : 0,
        isProfitable: pnl > 0,
      });
    }
  }

  const institutionTotalPnL =
    institutionInitialSubordinatePnL +
    institutionClientSplitShare +
    institutionRescuePnL;

  const instBase = subordinatePool + rescue.totalRescueAmount;

  return {
    clientTotalPnL,
    clientTotalPnLPercent:
      priorityPool > 0 ? (clientTotalPnL / priorityPool) * 100 : 0,
    institutionTotalPnL,
    institutionTotalPnLPercent:
      instBase > 0 ? (institutionTotalPnL / instBase) * 100 : 0,
    perClient,
    rescueStats: rescue.totalRescueAmount > 0 ? rescue : null,
    breakdown: {
      institutionInitialSubordinatePnL,
      institutionClientSplitShare,
      institutionRescuePnL,
    },
  };
}

export function calculateClientMarginCall(
  clientInvestmentAmount: number,
  batchInitialTotalAmount: number,
  batchRequiredMarginCallTotal: number
): number {
  if (batchRequiredMarginCallTotal <= 0) return 0;
  if (batchInitialTotalAmount <= 0) return 0;
  return batchRequiredMarginCallTotal * (clientInvestmentAmount / (batchInitialTotalAmount * PRIORITY_RATIO));
}

export function calculatePortfolioSummary(
  batches: (Batch & {
    clients?: Client[];
    marginCalls?: MarginCall[];
  })[]
): PortfolioSummary {
  let totalAUM = 0;
  let totalPriority = 0;
  let totalSubordinate = 0;
  let totalMarginCalls = 0;
  let totalPnL = 0;
  let institutionPnL = 0;
  let allClientsPnL = 0;
  let currentMarketValueTotal = 0;
  let profitableCount = 0;
  let normalCount = 0;
  let warningCount = 0;
  let criticalCount = 0;
  let rescueTotalInjected = 0;
  let rescueTotalCurrentValue = 0;
  let rescueTotalPnL = 0;

  for (const batch of batches) {
    totalAUM += batch.initialTotalAmount;
    totalPriority += batch.priorityAmount;
    totalSubordinate += batch.subordinateAmount;
    totalMarginCalls += batch.cumulativeMarginCalls || 0;

    const mv = batch.currentMarketValue || batch.initialTotalAmount;
    currentMarketValueTotal += mv;
    const metrics = calculateBatchRiskMetrics(
      batch.initialTotalAmount,
      mv,
      batch.cumulativeMarginCalls || 0
    );
    totalPnL += metrics.totalPnL;
    // 规则1：股价超买入价 = 盈利批次
    if (
      batch.stockPriceAtStart > 0 &&
      (batch.currentStockPrice ?? 0) > batch.stockPriceAtStart
    ) {
      profitableCount++;
    }

    const split = calculateBatchPnLSplit(batch, mv);
    institutionPnL += split.institutionTotalPnL;
    allClientsPnL += split.clientTotalPnL;
    if (split.rescueStats) {
      rescueTotalInjected += split.rescueStats.totalRescueAmount;
      rescueTotalCurrentValue += split.rescueStats.rescueCurrentValue;
      rescueTotalPnL += split.rescueStats.rescuePnL;
    }

    switch (batch.riskLevel) {
      case RiskLevel.NORMAL:
        normalCount++;
        break;
      case RiskLevel.WARNING:
        warningCount++;
        break;
      case RiskLevel.CRITICAL:
        criticalCount++;
        break;
    }
  }

  return {
    totalAUM,
    totalPriority,
    totalSubordinate,
    totalMarginCalls,
    totalPnL,
    totalPnLPercent: totalAUM > 0 ? (totalPnL / totalAUM) * 100 : 0,
    institutionPnL,
    institutionPnLPercent:
      totalSubordinate + rescueTotalInjected > 0
        ? (institutionPnL / (totalSubordinate + rescueTotalInjected)) * 100
        : 0,
    allClientsPnL,
    allClientsPnLPercent:
      totalPriority > 0 ? (allClientsPnL / totalPriority) * 100 : 0,
    profitableCount,
    normalCount,
    warningCount,
    criticalCount,
    totalBatches: batches.length,
    currentMarketValueTotal,
    rescueTotalInjected,
    rescueTotalCurrentValue,
    rescueTotalPnL,
  };
}
