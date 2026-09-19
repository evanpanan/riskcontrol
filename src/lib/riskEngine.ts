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

export function calculateClientSettlement(
  client: Client,
  finalMarketValue: number,
  cumulativeMarginCalls: number,
  initialBatchAmount: number
): SettlementResult {
  const ratio = client.investmentAmount / (initialBatchAmount * PRIORITY_RATIO);
  const finalMarketValueAfterMarginReturn = Math.max(0, finalMarketValue - cumulativeMarginCalls);
  const marginCallReturned = finalMarketValue >= cumulativeMarginCalls ? cumulativeMarginCalls : finalMarketValue;
  const totalInitialInvested = client.investmentAmount;
  const totalProfitOrLoss = finalMarketValueAfterMarginReturn - initialBatchAmount;
  const isLoss = totalProfitOrLoss < 0;

  let clientReceives: number;
  let clientPnL: number;
  let splitRatioClient: number;

  if (isLoss) {
    clientReceives = client.investmentAmount;
    clientPnL = 0;
    splitRatioClient = 1;
  } else {
    const profit = finalMarketValueAfterMarginReturn - initialBatchAmount;
    const split = calculateProfitSplitRatio(client.investmentAmount);
    splitRatioClient = split.client;
    const clientProfitShare = profit * split.client * ratio;
    clientReceives = client.investmentAmount + clientProfitShare;
    clientPnL = clientProfitShare;
  }

  const clientShareFromPool = Math.min(clientReceives, finalMarketValueAfterMarginReturn * ratio);
  clientReceives = isLoss ? Math.min(clientReceives, finalMarketValueAfterMarginReturn * ratio) : clientReceives;

  const institutionReceives = Math.max(0, finalMarketValue - clientReceives);
  const institutionPnL = institutionReceives - (initialBatchAmount * SUBORDINATE_RATIO + cumulativeMarginCalls);

  return {
    clientReceives: Math.max(0, clientReceives),
    institutionReceives,
    clientPnL,
    institutionPnL,
    splitRatioClient: splitRatioClient * 100,
    isLoss,
    marginCallReturned,
  };
}

export function calculateRealtimeClientMetrics(
  client: Client,
  batch: Batch,
  currentMarketValue: number
) {
  const ratio = client.investmentAmount / (batch.initialTotalAmount * PRIORITY_RATIO);
  const cumulativeMarginCalls = batch.cumulativeMarginCalls || 0;
  const estimatedFinal = calculateClientSettlement(
    client,
    currentMarketValue,
    cumulativeMarginCalls,
    batch.initialTotalAmount
  );

  const clientCurrentValue = (currentMarketValue * ratio);
  const realtimePnL = isLossEstimate(batch, currentMarketValue)
    ? 0
    : Math.max(0, clientCurrentValue - client.investmentAmount);

  return {
    realtimePnL,
    estimatedExitAmount: estimatedFinal.clientReceives,
    marketValueShare: clientCurrentValue,
  };
}

function isLossEstimate(batch: Batch, currentMarketValue: number): boolean {
  return currentMarketValue + (batch.cumulativeMarginCalls || 0) < batch.initialTotalAmount;
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
}

export interface BatchPnLSplit {
  clientTotalPnL: number;
  clientTotalPnLPercent: number;
  institutionTotalPnL: number;
  institutionTotalPnLPercent: number;
  perClient: Map<string, { name: string; pnl: number; pnlPercent: number }>;
}

export function calculateBatchPnLSplit(
  batch: Batch & { clients?: Client[] },
  currentMarketValue: number
): BatchPnLSplit {
  let clientTotalPnL = 0;
  let institutionTotalPnL = 0;
  const perClient = new Map<
    string,
    { name: string; pnl: number; pnlPercent: number }
  >();

  const cm = batch.cumulativeMarginCalls || 0;
  const mvAfterMargin = Math.max(0, currentMarketValue - cm);
  const isBatchLoss = mvAfterMargin < batch.initialTotalAmount;
  const totalProfit = Math.max(0, mvAfterMargin - batch.initialTotalAmount);

  const priorityPool = batch.priorityAmount;
  let clientsAllocated = 0;

  if (batch.clients) {
    for (const client of batch.clients) {
      const weight = client.investmentAmount / priorityPool;
      const split = calculateProfitSplitRatio(client.investmentAmount);
      let pnl = 0;

      if (!isBatchLoss && totalProfit > 0) {
        pnl = totalProfit * split.client * weight;
      }

      clientTotalPnL += pnl;
      clientsAllocated += client.investmentAmount + pnl;
      perClient.set(client.id, {
        name: client.name,
        pnl,
        pnlPercent:
          client.investmentAmount > 0
            ? (pnl / client.investmentAmount) * 100
            : 0,
      });
    }
  }

  const remainingFromPriority =
    isBatchLoss
      ? priorityPool - (priorityPool - Math.min(priorityPool, mvAfterMargin))
      : priorityPool + totalProfit - clientsAllocated;
  institutionTotalPnL =
    currentMarketValue -
    batch.subordinateAmount -
    cm -
    priorityPool -
    clientTotalPnL;

  return {
    clientTotalPnL,
    clientTotalPnLPercent:
      priorityPool > 0 ? (clientTotalPnL / priorityPool) * 100 : 0,
    institutionTotalPnL,
    institutionTotalPnLPercent:
      batch.subordinateAmount + cm > 0
        ? (institutionTotalPnL / (batch.subordinateAmount + cm)) * 100
        : 0,
    perClient,
  };
}

export function calculateClientMarginCall(
  clientInvestmentAmount: number,
  batchInitialTotalAmount: number,
  batchRequiredMarginCallTotal: number
): number {
  if (batchRequiredMarginCallTotal <= 0) return 0;
  if (batchInitialTotalAmount <= 0) return 0;
  return batchRequiredMarginCallTotal * (clientInvestmentAmount / batchInitialTotalAmount);
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
    if (mv >= batch.initialTotalAmount) profitableCount++;

    const split = calculateBatchPnLSplit(batch, mv);
    institutionPnL += split.institutionTotalPnL;
    allClientsPnL += split.clientTotalPnL;

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
      totalSubordinate + totalMarginCalls > 0
        ? (institutionPnL / (totalSubordinate + totalMarginCalls)) * 100
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
  };
}
