import { Client, Batch, MarginCall, RiskLevel, BatchStatus, ClientStatus } from "@prisma/client";
import { calculateTradingWindows } from "./utils";
import { getProfitSettings, DEFAULT_PROFIT_SETTINGS } from "./profitSettings";

export const PRIORITY_RATIO = 0.7;
export const SUBORDINATE_RATIO = 0.3;
export const WARNING_DROP_THRESHOLD = 0.15;
export const CRITICAL_DROP_THRESHOLD = 0.20;
export const HIGH_INVESTMENT_THRESHOLD = 100000;
export const HIGH_INVESTMENT_CLIENT_SPLIT = 0.4;
export const LOW_INVESTMENT_CLIENT_SPLIT = 0.3;
const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const uid = () => `fin_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export interface ClientMarginCallEntry {
  id: string;
  clientId: string;
  amount: number;
  fulfilledAt: string;
  source?: "batch_one_click" | "client_single" | "manual";
  operatorName?: string;
  notes?: string;
  roundId?: string;
}
export interface ClientMarginState {
  initialInvestment: number;
  required: number;
  fulfilled: number;
  history: ClientMarginCallEntry[];
  roundId?: string;
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
export interface SettlementSnapshot extends SettlementResult {
  id: string;
  settledAt: string;
  stockPrice: number;
  principal: number;
  originalAccountCapital: number;
  institutionInitialCapital: number;
  institutionRescueValue: number;
  institutionInitialPnL: number;
  institutionClientShare: number;
  institutionRescuePnL: number;
}
export interface InstitutionTrade {
  id: string;
  roundId: string;
  clientId?: string;
  amount: number;
  entryPrice: number | null;
  shares: number;
  remainingFraction: number;
  createdAt: string;
  source: "batch_one_click" | "client_single" | "legacy";
  operatorName?: string;
  needsReconciliation?: boolean;
}
export interface MarginRound {
  id: string;
  number: number;
  requiredAmount: number;
  fulfilledAmount: number;
  triggerMarketValue: number;
  triggerDate: string;
  dropPercent: number;
  status: "PENDING" | "FULLFILLED" | "EXPIRED";
  allocations: Record<string, ClientMarginState>;
}
export interface BatchFinance {
  version: 2;
  legacyAllocationVersion?: 2;
  originalCapital: number;
  originalShares: number;
  originalPriority: number;
  remainingCapital: number;
  remainingShares: number;
  trades: InstitutionTrade[];
  rounds: MarginRound[];
  settlements: Record<string, SettlementSnapshot>;
  revision: number;
  legacyWarnings: string[];
}
export type ClientLike = Client & {
  entryStockPrice?: number;
  signedVipThreshold?: number;
  initialInvestment?: number;
  marginState?: ClientMarginState;
  marginHistory?: ClientMarginCallEntry[];
  settlement?: SettlementSnapshot;
};
export type BatchLike = Batch & {
  clients?: ClientLike[];
  marginCalls?: any[];
  finance?: BatchFinance;
  currentPrice?: number;
};
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
  perCall: Array<{ id: string; amount: number; entryPrice: number; shares: number; currentValue: number; pnl: number; pnlPercent: number }>;
  unpricedAmount?: number;
}

export function calculateInvestmentSplit(totalAmount: number) {
  return { priorityAmount: totalAmount * PRIORITY_RATIO, subordinateAmount: totalAmount * SUBORDINATE_RATIO };
}

// Used only at signing. Existing clients always use their stored contract rates.
export function calculateProfitSplitRatio(investmentAmount: number, defaultsOnly = false) {
  const settings = defaultsOnly ? DEFAULT_PROFIT_SETTINGS : getProfitSettings();
  const client = (investmentAmount >= settings.vipThreshold ? settings.vipClient : settings.normalClient) / 100;
  return { client, institution: 1 - client, vipThreshold: settings.vipThreshold };
}

export function isVipClient(client: Pick<ClientLike, "investmentAmount" | "signedVipThreshold">): boolean {
  return client.investmentAmount >= (client.signedVipThreshold ?? HIGH_INVESTMENT_THRESHOLD);
}

export function getClientProfitSplit(client: Pick<Client, "investmentAmount" | "profitSplitClient" | "profitSplitInstitution">) {
  const pct = client.profitSplitClient;
  if (typeof pct === "number" && Number.isFinite(pct) && pct >= 0 && pct <= 100) {
    return { client: pct / 100, institution: 1 - pct / 100 };
  }
  return calculateProfitSplitRatio(client.investmentAmount, true);
}

export function calculateBatchRiskMetrics(initialTotalAmount: number, currentMarketValue: number, activeInstitutionTopups = 0): BatchRiskMetrics {
  const dropAmount = initialTotalAmount - currentMarketValue;
  const drop = initialTotalAmount > 0 ? dropAmount / initialTotalAmount : 0;
  const critical = initialTotalAmount > 0 && currentMarketValue <= initialTotalAmount * 0.8 + 0.005;
  const totalPnL = currentMarketValue - initialTotalAmount - activeInstitutionTopups;
  return {
    dropPercent: Math.max(0, drop) * 100,
    dropAmount: Math.max(0, dropAmount),
    currentMarketValue,
    safetyBufferPercent: (CRITICAL_DROP_THRESHOLD - drop) * 100,
    requiredMarginCall: critical ? money(dropAmount) : 0,
    riskLevel: critical ? RiskLevel.CRITICAL : drop >= WARNING_DROP_THRESHOLD ? RiskLevel.WARNING : RiskLevel.NORMAL,
    totalPnL,
    totalPnLPercent: initialTotalAmount > 0 ? totalPnL / initialTotalAmount * 100 : 0,
  };
}
export function calculateCurrentMarketValue(stockPriceAtStart: number, currentStockPrice: number, totalShares: number) {
  return stockPriceAtStart > 0 ? totalShares * currentStockPrice : 0;
}
export function calculateTotalShares(initialTotalAmount: number, stockPriceAtStart: number) {
  return stockPriceAtStart > 0 ? initialTotalAmount / stockPriceAtStart : 0;
}

export function calculateRescueStats(batch: Batch & { marginCalls?: MarginCall[] }, currentStockPrice: number): RescueStats {
  const finance = (batch as BatchLike).finance;
  const trades: InstitutionTrade[] = finance?.trades ?? (batch.marginCalls ?? []).filter((m) => (m.fulfilledAmount ?? 0) > 0).map((m: any) => ({
    id: m.id, roundId: m.id, amount: m.fulfilledAmount, entryPrice: m.averageEntryPrice || null,
    shares: m.rescueShares || (m.averageEntryPrice > 0 ? m.fulfilledAmount / m.averageEntryPrice : 0),
    remainingFraction: 1, createdAt: String(m.fulfilledDate), source: "legacy",
  }));
  const perCall = trades.map((t) => {
    const amount = t.amount * t.remainingFraction;
    const shares = t.shares * t.remainingFraction;
    // Missing historical execution data is held at cost, never assigned a fabricated return.
    const currentValue = t.needsReconciliation || !t.entryPrice ? amount : shares * currentStockPrice;
    const pnl = currentValue - amount;
    return { id: t.id, amount, entryPrice: t.entryPrice ?? 0, shares, currentValue, pnl, pnlPercent: amount > 0 ? pnl / amount * 100 : 0 };
  });
  const totalRescueAmount = perCall.reduce((s, t) => s + t.amount, 0);
  const totalRescueShares = perCall.reduce((s, t) => s + t.shares, 0);
  const rescueCurrentValue = perCall.reduce((s, t) => s + t.currentValue, 0);
  const unpricedAmount = perCall.filter((t) => !t.entryPrice).reduce((s, t) => s + t.amount, 0);
  const rescuePnL = rescueCurrentValue - totalRescueAmount;
  return {
    totalRescueAmount, totalRescueShares, rescueCurrentValue, rescuePnL, perCall, unpricedAmount,
    weightedAverageEntryPrice: totalRescueShares > 0 ? (totalRescueAmount - unpricedAmount) / totalRescueShares : 0,
    rescuePnLPercent: totalRescueAmount > 0 ? rescuePnL / totalRescueAmount * 100 : 0,
  };
}

export function getAccountMarketValue(batch: BatchLike, price = batch.currentStockPrice ?? batch.stockPriceAtStart): number {
  const original = batch.finance
    ? batch.finance.remainingShares * price
    : batch.totalShares * price;
  return original + calculateRescueStats(batch, price).rescueCurrentValue;
}

export function getBatchMetrics(batch: BatchLike): BatchRiskMetrics {
  const rescue = calculateRescueStats(batch, batch.currentStockPrice ?? batch.stockPriceAtStart);
  return calculateBatchRiskMetrics(batch.finance?.remainingCapital ?? batch.initialTotalAmount, getAccountMarketValue(batch), rescue.totalRescueAmount);
}

function allocateRound(batch: BatchLike, amount: number, roundId: string): Record<string, ClientMarginState> {
  const active = (batch.clients ?? []).filter((c) => c.status !== ClientStatus.SETTLED);
  const pool = active.reduce((s, c) => s + c.investmentAmount, 0);
  let remaining = money(amount);
  return Object.fromEntries(active.map((c, index) => {
    const required = index === active.length - 1 ? remaining : money(amount * c.investmentAmount / Math.max(pool, 0.01));
    remaining = money(remaining - required);
    return [c.id, { initialInvestment: c.investmentAmount, required, fulfilled: 0, history: [], roundId }];
  }));
}

// Initialization and mutations are called at data-load / price-update / action boundaries, never during rendering.
export function initializeBatchFinance(batch: BatchLike): void {
  if (batch.finance) return;
  const finance: BatchFinance = {
    version: 2, originalCapital: batch.initialTotalAmount, originalShares: batch.totalShares,
    originalPriority: batch.priorityAmount, remainingCapital: batch.initialTotalAmount,
    remainingShares: batch.totalShares, trades: [], rounds: [], settlements: {}, revision: 0, legacyWarnings: [],
    legacyAllocationVersion: 2,
  };
  batch.finance = finance;
  const recordedPrincipal = (batch.clients ?? []).reduce((sum, c) => sum + c.investmentAmount, 0);
  const matchPriority = Math.abs(recordedPrincipal - batch.priorityAmount) <= 0.02;
  const matchInitial = Math.abs(recordedPrincipal - finance.originalCapital) <= 0.02;
  if (!matchPriority && !matchInitial) {
    finance.legacyWarnings.push("客户本金合计与批次登记资金（优先池或初始总资金）不一致，结算前需核对原始出资。");
  }
  if ((batch.clients ?? []).some((c) => c.status === ClientStatus.SETTLED)) {
    finance.legacyWarnings.push("存在无成交快照的历史结算，账户剩余仓位需核对后才能继续结算。");
  }
  for (const mc of batch.marginCalls ?? []) {
    const amount = Number(mc.fulfilledAmount ?? 0);
    if (amount <= 0) continue;
    const price = Number(mc.averageEntryPrice ?? 0);
    finance.trades.push({
      id: `legacy_${mc.id}`, roundId: mc.id, amount, entryPrice: price > 0 ? price : null,
      shares: price > 0 ? amount / price : 0, remainingFraction: 1,
      createdAt: new Date(mc.fulfilledDate ?? mc.triggerDate ?? batch.signDate).toISOString(),
      source: "legacy", needsReconciliation: price <= 0,
    });
    finance.rounds.push({
      id: mc.id, number: finance.rounds.length + 1, requiredAmount: amount, fulfilledAmount: amount,
      triggerMarketValue: mc.triggerMarketValue ?? 0, triggerDate: new Date(mc.triggerDate ?? batch.signDate).toISOString(),
      dropPercent: mc.dropPercent ?? 0, status: "FULLFILLED", allocations: {},
    });
  }
  const known = finance.trades.reduce((s, t) => s + t.amount, 0);
  const missing = money((batch.cumulativeMarginCalls ?? 0) - known);
  if (missing > 0) {
    finance.trades.push({ id: `legacy_unpriced_${batch.id}`, roundId: "legacy-unpriced", amount: missing,
      entryPrice: null, shares: 0, remainingFraction: 1, createdAt: new Date().toISOString(), source: "legacy", needsReconciliation: true });
    finance.legacyWarnings.push("旧补仓缺少成交价和份额：暂按出资成本列示，待核对后才能结算。");
  }
  if (finance.trades.some((t) => !t.entryPrice) && finance.legacyWarnings.length === 0) {
    finance.legacyWarnings.push("历史补仓成交信息不完整，收益未计，结算前需核对。");
  }
  // Old batch-level receipts have no verified client allocation. Never spread them onto other clients.
  const pending = (batch.marginCalls ?? []).find((m: any) => m.status === "PENDING" && m.requiredAmount > (m.fulfilledAmount ?? 0));
  if (pending) {
    const roundId = `obligation_${pending.id}`;
    const allocations = allocateRound(batch, pending.requiredAmount, roundId);
    let allocated = 0;
    const entries = Object.entries(allocations);
    for (const [id, state] of entries) {
      const saved = batch.clients?.find((c) => c.id === id)?.marginState;
      if (saved && saved.required > 0) {
        Object.assign(state, saved, { roundId });
      }
      allocated = money(allocated + state.fulfilled);
    }
    const requiredAmount = entries.length
      ? money(entries.reduce((sum, [, s]) => sum + s.required, 0))
      : pending.requiredAmount;
    finance.rounds.push({ id: roundId, number: finance.rounds.length + 1, requiredAmount,
      fulfilledAmount: allocated,
      triggerMarketValue: pending.triggerMarketValue ?? 0, triggerDate: new Date(pending.triggerDate ?? batch.signDate).toISOString(),
      dropPercent: pending.dropPercent ?? 0.2, status: "PENDING", allocations });
    const imported = finance.rounds[finance.rounds.length - 1];
    imported.requiredAmount = requiredAmount;
    if (allocated >= requiredAmount - 0.005) imported.status = "FULLFILLED";
    if ((pending.fulfilledAmount ?? 0) > 0) {
      finance.legacyWarnings.push("历史批次到账与客户分配缺少对应关系，已保留客户原有状态；本轮缺口需核对，禁止直接重复划款。");
    }
  }
  syncBatchFinance(batch);
}

function activeRound(batch: BatchLike): MarginRound | undefined {
  return batch.finance?.rounds.find((r) => r.status === "PENDING");
}

export function syncBatchFinance(batch: BatchLike): void {
  if (!batch.finance) return;
  const f = batch.finance;
  batch.initialTotalAmount = money(f.remainingCapital);
  batch.priorityAmount = money(f.remainingCapital * PRIORITY_RATIO);
  batch.subordinateAmount = money(f.remainingCapital * SUBORDINATE_RATIO);
  batch.totalShares = f.remainingShares;
  batch.currentMarketValue = getAccountMarketValue(batch);
  batch.cumulativeMarginCalls = money(f.trades.reduce((s, t) => s + t.amount, 0));
  const metrics = getBatchMetrics(batch);
  batch.riskLevel = metrics.riskLevel;
  batch.totalPnL = metrics.totalPnL;
  batch.totalPnLPercent = metrics.totalPnLPercent;
  if (!activeRound(batch) && metrics.requiredMarginCall > 0 && (batch.clients ?? []).some((c) => c.status !== ClientStatus.SETTLED)) {
    const id = uid();
    f.rounds.push({ id, number: f.rounds.length + 1, requiredAmount: metrics.requiredMarginCall,
      fulfilledAmount: 0, triggerMarketValue: batch.currentMarketValue,
      triggerDate: new Date().toISOString(), dropPercent: metrics.dropPercent / 100, status: "PENDING",
      allocations: allocateRound(batch, metrics.requiredMarginCall, id) });
  }
  const round = activeRound(batch) ?? f.rounds[f.rounds.length - 1];
  for (const c of batch.clients ?? []) {
    c.marginState = round?.allocations[c.id] ?? { initialInvestment: c.investmentAmount, required: 0, fulfilled: 0, history: [], roundId: round?.id };
    if (f.settlements[c.id]) c.settlement = f.settlements[c.id];
  }
  batch.marginCalls = f.rounds.map((r) => ({
    id: r.id, batchId: batch.id, triggerDate: new Date(r.triggerDate), createdAt: new Date(r.triggerDate),
    triggerMarketValue: r.triggerMarketValue, dropPercent: r.dropPercent,
    requiredAmount: r.requiredAmount, fulfilledAmount: r.fulfilledAmount, status: r.status,
    fulfilledDate: r.status === "FULLFILLED" ? new Date(f.trades.filter((t) => t.roundId === r.id).at(-1)?.createdAt ?? r.triggerDate) : null,
    note: `第 ${r.number} 轮 · 机构出资，补仓本金及收益全部归机构`,
  }));
}

export function getLockedBatchRequiredMargin(batch: BatchLike): number {
  const round = activeRound(batch) ?? batch.finance?.rounds[batch.finance.rounds.length - 1];
  return round?.requiredAmount ?? getBatchMetrics(batch).requiredMarginCall;
}
export function allocateClientMarginRequirements(batch: BatchLike, batchRequiredTotal: number, _cumulative = 0): Map<string, ClientMarginState> {
  const round = activeRound(batch) ?? batch.finance?.rounds[batch.finance.rounds.length - 1];
  return new Map(Object.entries(round?.allocations ?? allocateRound(batch, batchRequiredTotal, "uninitialized")));
}
export function summarizeBatchMarginFromClients(batch: BatchLike) {
  const round = activeRound(batch) ?? batch.finance?.rounds[batch.finance.rounds.length - 1];
  const perClient = allocateClientMarginRequirements(batch, round?.requiredAmount ?? 0);
  const totalRequired = round?.requiredAmount ?? 0;
  const totalFulfilled = round?.fulfilledAmount ?? 0;
  return {
    totalRequired, totalFulfilled, totalPending: round?.status === "PENDING" ? money(Math.max(0, totalRequired - totalFulfilled)) : 0,
    perClient, roundId: round?.id, roundNumber: round?.number ?? 0,
    clientCountWithSingleTopup: [...perClient.values()].filter((s) => s.history.some((h) => h.source === "client_single")).length,
    pendingClientCount: [...perClient.values()].filter((s) => s.required - s.fulfilled > 0.005).length,
  };
}

export function isTopupBlockedByLegacyLedger(batch: BatchLike): boolean {
  return (batch.finance?.legacyWarnings ?? []).some(warning =>
    warning.includes("历史结算") || warning.includes("客户分配"));
}

export function executeInstitutionTopup(batch: BatchLike, options: {
  amount: number; clientId?: string; operatorName?: string; expectedRoundId?: string;
}): number {
  initializeBatchFinance(batch);
  const round = activeRound(batch);
  if (!round || (options.expectedRoundId && options.expectedRoundId !== round.id)) return 0;
  const price = batch.currentStockPrice ?? batch.stockPriceAtStart;
  if (isTopupBlockedByLegacyLedger(batch)) {
    throw new Error("历史结算或补仓分配尚未核对，本次未记账。请进入批次详情，点击「重新检查账本」或「查看处理方法」。");
  }
  if (!Number.isFinite(price) || price <= 0) throw new Error("当前成交价无效，无法记录机构补仓。");
  if (!Number.isFinite(options.amount) || options.amount <= 0) return 0;
  const targets = Object.entries(round.allocations)
    .filter(([id]) => !options.clientId || id === options.clientId)
    .sort((a, b) => (b[1].required - b[1].fulfilled) - (a[1].required - a[1].fulfilled));
  let remaining = money(Math.min(options.amount, round.requiredAmount - round.fulfilledAmount));
  let applied = 0;
  for (const [clientId, state] of targets) {
    const client = batch.clients?.find((c) => c.id === clientId);
    if (!client || client.status === ClientStatus.SETTLED || remaining <= 0) continue;
    const pay = money(Math.min(remaining, Math.max(0, state.required - state.fulfilled)));
    if (pay <= 0) continue;
    const id = uid();
    const source = options.clientId ? "client_single" : "batch_one_click";
    const createdAt = new Date().toISOString();
    batch.finance!.trades.push({ id, roundId: round.id, clientId, amount: pay, entryPrice: price,
      shares: pay / price, remainingFraction: 1, createdAt, source, operatorName: options.operatorName });
    state.fulfilled = money(state.fulfilled + pay);
    state.history.push({ id, clientId, amount: pay, fulfilledAt: createdAt, source, roundId: round.id, operatorName: options.operatorName });
    remaining = money(remaining - pay);
    applied = money(applied + pay);
  }
  round.fulfilledAmount = money(round.fulfilledAmount + applied);
  if (round.requiredAmount - round.fulfilledAmount < 0.005) round.status = "FULLFILLED";
  batch.finance!.revision++;
  syncBatchFinance(batch);
  return applied;
}
export function applyBatchLevelMarginTopupRemainder(batch: BatchLike, amount: number, operatorName?: string): number {
  return executeInstitutionTopup(batch, { amount, operatorName, expectedRoundId: activeRound(batch)?.id });
}
export function registerClientSingleMargin(client: ClientLike, amount: number, extra: Partial<ClientMarginCallEntry> & { fallbackRequired?: number } = {}): ClientMarginState {
  throw new Error("请通过 executeInstitutionTopup 记录机构成交，禁止只修改客户补仓状态。");
}

export function calculateClientSettlement(client: Client, batch: BatchLike, _finalMarketValue: number, finalStockPrice: number): SettlementResult {
  const snapshot = batch.finance?.settlements[client.id] ?? (client as ClientLike).settlement;
  if (snapshot) return snapshot;
  const weight = batch.priorityAmount > 0 ? client.investmentAmount / batch.priorityAmount : 0;
  const split = getClientProfitSplit(client);
  const entryPrice = (client as ClientLike).entryStockPrice ?? batch.stockPriceAtStart;
  const shares = client.investmentAmount / entryPrice;
  const initialPnL = shares * finalStockPrice - client.investmentAmount;
  const clientPnL = money(Math.max(0, initialPnL) * split.client);
  const rescue = calculateRescueStats(batch, finalStockPrice);
  const accountSlice = shares / PRIORITY_RATIO * finalStockPrice + rescue.rescueCurrentValue * weight;
  const clientReceives = money(client.investmentAmount + clientPnL);
  const institutionReceives = money(accountSlice - clientReceives);
  const marginCallReturned = money(rescue.totalRescueAmount * weight);
  return { clientReceives, institutionReceives, clientPnL,
    institutionPnL: money(institutionReceives - batch.subordinateAmount * weight - marginCallReturned),
    splitRatioClient: split.client * 100, isLoss: initialPnL < 0, marginCallReturned };
}

export function settleClientPosition(batch: BatchLike, clientId: string): SettlementSnapshot {
  initializeBatchFinance(batch);
  const f = batch.finance!;
  if (f.settlements[clientId]) return f.settlements[clientId];
  const client = batch.clients?.find((c) => c.id === clientId);
  if (!client || client.status === ClientStatus.SETTLED) throw new Error("客户已结算或历史结算信息待核对。");
  if (f.legacyWarnings.length) throw new Error(f.legacyWarnings.join(" "));
  if (activeRound(batch)) throw new Error("本轮补仓尚未完成，请先完成机构补仓再结算。");
  if (f.trades.some((t) => t.remainingFraction > 0 && t.needsReconciliation)) throw new Error("历史补仓成交信息待核对，暂不能结算。");
  const price = batch.currentStockPrice ?? batch.stockPriceAtStart;
  if (!(price > 0)) throw new Error("结算价格无效。");
  const weight = client.investmentAmount / batch.priorityAmount;
  if (!(weight > 0 && weight <= 1 + 1e-8)) throw new Error("客户本金与账户优先池不一致，请核对。");
  const result = calculateClientSettlement(client, batch, getAccountMarketValue(batch), price);
  if (result.institutionReceives < -0.005) throw new Error("账户资产不足以保本退出，请机构补足资金后再结算。");
  const rescue = calculateRescueStats(batch, price);
  const entryPrice = client.entryStockPrice ?? batch.stockPriceAtStart;
  const initialPosPnl = client.investmentAmount * (price / entryPrice - 1);
  const snapshot: SettlementSnapshot = {
    ...result, id: uid(), settledAt: new Date().toISOString(), stockPrice: price, principal: client.investmentAmount,
    originalAccountCapital: money(f.remainingCapital * weight),
    institutionInitialCapital: money(batch.subordinateAmount * weight),
    institutionRescueValue: money(rescue.rescueCurrentValue * weight),
    institutionInitialPnL: money(initialPosPnl * SUBORDINATE_RATIO / PRIORITY_RATIO),
    institutionClientShare: money(initialPosPnl - result.clientPnL),
    institutionRescuePnL: money(rescue.rescuePnL * weight),
  };
  f.settlements[clientId] = snapshot;
  f.remainingCapital = money(f.remainingCapital - snapshot.originalAccountCapital);
  f.remainingShares = Math.max(0, f.remainingShares - client.investmentAmount / PRIORITY_RATIO / entryPrice);
  for (const t of f.trades) t.remainingFraction *= Math.max(0, 1 - weight);
  client.status = ClientStatus.SETTLED;
  client.settledAt = new Date(snapshot.settledAt);
  client.settlement = snapshot;
  f.revision++;
  syncBatchFinance(batch);
  return snapshot;
}

export function addClientPosition(batch: BatchLike, client: ClientLike): void {
  initializeBatchFinance(batch);
  if (batch.finance!.legacyWarnings.length) throw new Error("请先核对该批次历史资金记录，再新增客户。");
  if (activeRound(batch)) throw new Error("请先处理当前补仓轮次，再新增客户。");
  const price = batch.currentStockPrice ?? batch.stockPriceAtStart;
  if (!(price > 0)) throw new Error("当前成交价无效。");
  if (!Number.isFinite(client.investmentAmount) || client.investmentAmount <= 0) throw new Error("客户本金无效。");
  const capital = client.investmentAmount / PRIORITY_RATIO;
  const f = batch.finance!;
  f.originalCapital += capital;
  f.originalPriority += client.investmentAmount;
  f.remainingCapital += capital;
  f.originalShares += capital / price;
  f.remainingShares += capital / price;
  client.entryStockPrice = price;
  (client as any).__financeManaged = true;
  (batch.clients ??= []).push(client);
  f.revision++;
  syncBatchFinance(batch);
}

export function updateClientPosition(batch: BatchLike, clientId: string, patch: Partial<ClientLike>): void {
  initializeBatchFinance(batch);
  const f = batch.finance!;
  if (f.legacyWarnings.length) throw new Error("请先核对该批次历史资金记录，再修改客户。");
  const client = batch.clients?.find((c) => c.id === clientId);
  if (!client) throw new Error("未找到该客户。");
  if (client.status === ClientStatus.SETTLED) throw new Error("已结算客户不可修改。");
  if (activeRound(batch)) throw new Error("请先处理当前补仓轮次，再修改客户。");
  if (patch.investmentAmount !== undefined) {
    const newAmt = Number(patch.investmentAmount);
    if (!Number.isFinite(newAmt) || newAmt <= 0) throw new Error("客户本金无效。");
    const price = client.entryStockPrice ?? batch.stockPriceAtStart;
    if (!(price > 0)) throw new Error("当前成交价无效。");
    const delta = newAmt - Number(client.investmentAmount || 0);
    if (Math.abs(delta) > 0.005) {
      if (f.settlements[clientId]) throw new Error("已结算客户不可调整本金。");
      const capitalDelta = delta / PRIORITY_RATIO;
      f.originalCapital += capitalDelta;
      f.originalPriority += delta;
      f.remainingCapital += capitalDelta;
      f.originalShares += capitalDelta / price;
      f.remainingShares += capitalDelta / price;
    }
    (client as any).investmentAmount = newAmt;
    (client as any).initialInvestment = newAmt;
  }
  if (patch.name !== undefined) (client as any).name = String(patch.name);
  if (patch.bdManager !== undefined) (client as any).bdManager = String(patch.bdManager);
  if (patch.signDate !== undefined) (client as any).signDate = new Date(String(patch.signDate));
  if (patch.status !== undefined) (client as any).status = patch.status;
  if (patch.profitSplitClient !== undefined) (client as any).profitSplitClient = Number(patch.profitSplitClient);
  if (patch.profitSplitInstitution !== undefined) (client as any).profitSplitInstitution = Number(patch.profitSplitInstitution);
  (client as any).updatedAt = new Date();
  f.revision++;
  syncBatchFinance(batch);
}

export function removeClientPosition(batch: BatchLike, clientId: string): void {
  initializeBatchFinance(batch);
  const f = batch.finance!;
  if (f.legacyWarnings.length) throw new Error("请先核对该批次历史资金记录，再删除客户。");
  const idx = batch.clients?.findIndex((c) => c.id === clientId) ?? -1;
  if (idx < 0) throw new Error("未找到该客户。");
  const client = batch.clients![idx];
  if (client.status === ClientStatus.SETTLED) throw new Error("已结算客户不可删除。");
  if (activeRound(batch)) throw new Error("请先处理当前补仓轮次，再删除客户。");
  const price = (client as any).entryStockPrice ?? batch.stockPriceAtStart;
  if (!(price > 0)) throw new Error("当前成交价无效。");
  const capital = Number(client.investmentAmount || 0) / PRIORITY_RATIO;
  f.originalCapital = Math.max(0, f.originalCapital - capital);
  f.originalPriority = Math.max(0, f.originalPriority - Number(client.investmentAmount || 0));
  f.remainingCapital = Math.max(0, f.remainingCapital - capital);
  f.originalShares = Math.max(0, f.originalShares - capital / price);
  f.remainingShares = Math.max(0, f.remainingShares - capital / price);
  if (f.settlements[clientId]) delete f.settlements[clientId];
  batch.clients!.splice(idx, 1);
  f.revision++;
  syncBatchFinance(batch);
}

export function calculateRealtimeClientMetrics(client: Client, batch: BatchLike, currentMarketValue: number) {
  const estimated = calculateClientSettlement(client, batch, currentMarketValue, batch.currentStockPrice ?? batch.stockPriceAtStart);
  const snapshot = batch.finance?.settlements[client.id] ?? (client as ClientLike).settlement;
  const entryPrice = (client as ClientLike).entryStockPrice ?? batch.stockPriceAtStart;
  const clientShares = entryPrice > 0 ? client.investmentAmount / entryPrice : 0;
  if (client.status === ClientStatus.SETTLED && !snapshot) {
    return {
      realtimePnL: client.realtimePnL ?? 0, estimatedExitAmount: client.estimatedExitAmount ?? 0,
      marketValueShare: client.estimatedExitAmount ?? 0, clientShares: 0, isPriceAboveStart: false,
    };
  }
  return {
    realtimePnL: estimated.clientPnL, estimatedExitAmount: estimated.clientReceives,
    marketValueShare: snapshot ? snapshot.clientReceives : clientShares * (batch.currentStockPrice ?? batch.stockPriceAtStart),
    clientShares, isPriceAboveStart: snapshot ? snapshot.clientPnL > 0 : (batch.currentStockPrice ?? 0) > entryPrice,
  };
}
export function calculateBatchStatus(batch: Batch): BatchStatus {
  const trading = calculateTradingWindows(batch.signDate);
  if (trading.monthsElapsed >= 24) return BatchStatus.CLOSED;
  return trading.isLocked ? BatchStatus.LOCKED : BatchStatus.TRADING_OPEN;
}

export interface BatchPnLSplit {
  clientTotalPnL: number;
  clientTotalPnLPercent: number;
  institutionTotalPnL: number;
  institutionTotalPnLPercent: number;
  realizedClientPnL: number;
  realizedInstitutionPnL: number;
  realizedInstitutionBreakdown: { initial: number; splitShare: number; rescue: number };
  unrealizedClientPnL: number;
  unrealizedInstitutionPnL: number;
  unrealizedInstitutionBreakdown: { initial: number; splitShare: number; rescue: number };
  perClient: Map<string, {
    name: string;
    realizedPnL: number;
    unrealizedPnL: number;
    pnl: number;
    pnlPercent: number;
    isProfitable: boolean;
    isSettled: boolean;
  }>;
  rescueStats: RescueStats | null;
  breakdown: { institutionInitialSubordinatePnL: number; institutionClientSplitShare: number; institutionRescuePnL: number };
}
export function calculateBatchPnLSplit(batch: BatchLike, _currentMarketValue: number): BatchPnLSplit {
  let realizedClientPnL = 0;
  let realizedInstitutionInitial = 0;
  let realizedInstitutionSplitShare = 0;
  let realizedInstitutionRescue = 0;
  let unrealizedClientPnL = 0;
  let unrealizedInstitutionInitial = 0;
  let unrealizedInstitutionSplitShare = 0;
  let unrealizedInstitutionRescue = 0;
  const perClient: BatchPnLSplit["perClient"] = new Map();
  const price = batch.currentStockPrice ?? batch.stockPriceAtStart;
  const rescue = calculateRescueStats(batch, price);
  const fullRescuePnL = rescue.rescuePnL;
  const initialBase = (batch.totalShares * price - batch.initialTotalAmount) * SUBORDINATE_RATIO;
  for (const client of batch.clients ?? []) {
    const snapshot = batch.finance?.settlements[client.id] ?? (client as ClientLike).settlement;
    const raw = (client.investmentAmount ?? 0) * (price / ((client as ClientLike).entryStockPrice ?? batch.stockPriceAtStart) - 1);
    const clientShare = getClientProfitSplit(client as ClientLike).client;
    if (snapshot) {
      realizedClientPnL += snapshot.clientPnL;
      realizedInstitutionInitial += snapshot.institutionInitialPnL;
      realizedInstitutionRescue += snapshot.institutionRescuePnL;
      realizedInstitutionSplitShare += snapshot.institutionClientShare;
      perClient.set(client.id, {
        name: client.name,
        realizedPnL: snapshot.clientPnL,
        unrealizedPnL: 0,
        pnl: snapshot.clientPnL,
        pnlPercent: (client.investmentAmount ?? 0) > 0 ? snapshot.clientPnL / (client.investmentAmount ?? 0) * 100 : 0,
        isProfitable: snapshot.clientPnL > 0,
        isSettled: true,
      });
    } else {
      const pnl = client.status === ClientStatus.SETTLED
        ? client.realtimePnL ?? 0
        : Math.max(0, raw) * clientShare;
      const institutionShareFromRaw = raw - pnl;
      unrealizedClientPnL += pnl;
      unrealizedInstitutionSplitShare += institutionShareFromRaw;
      perClient.set(client.id, {
        name: client.name,
        realizedPnL: 0,
        unrealizedPnL: pnl,
        pnl,
        pnlPercent: (client.investmentAmount ?? 0) > 0 ? pnl / (client.investmentAmount ?? 0) * 100 : 0,
        isProfitable: pnl > 0,
        isSettled: false,
      });
    }
  }
  if (batch.finance?.settlements) {
    const settledIds = Object.keys(batch.finance.settlements);
    let realizedWeightSum = 0;
    for (const id of settledIds) {
      const c = (batch.clients ?? []).find((x) => x.id === id);
      realizedWeightSum += (c?.investmentAmount ?? 0) / PRIORITY_RATIO;
    }
    const cap = batch.finance.originalCapital ?? batch.initialTotalAmount ?? 0;
    const w = cap > 0 ? Math.min(1, realizedWeightSum / Math.max(cap, 1)) : 0;
    realizedInstitutionInitial += initialBase * w;
    unrealizedInstitutionInitial = initialBase * (1 - w);
    realizedInstitutionRescue += fullRescuePnL * w;
    unrealizedInstitutionRescue = fullRescuePnL * (1 - w);
  } else {
    unrealizedInstitutionInitial = initialBase;
    unrealizedInstitutionRescue = fullRescuePnL;
  }
  const institutionInitialSubordinatePnL = realizedInstitutionInitial + unrealizedInstitutionInitial;
  const institutionClientSplitShare = realizedInstitutionSplitShare + unrealizedInstitutionSplitShare;
  const institutionRescuePnL = realizedInstitutionRescue + unrealizedInstitutionRescue;
  const clientTotalPnL = realizedClientPnL + unrealizedClientPnL;
  const realizedInstitutionPnL = realizedInstitutionInitial + realizedInstitutionSplitShare + realizedInstitutionRescue;
  const unrealizedInstitutionPnL = unrealizedInstitutionInitial + unrealizedInstitutionSplitShare + unrealizedInstitutionRescue;
  const institutionTotalPnL = realizedInstitutionPnL + unrealizedInstitutionPnL;
  const capital = batch.finance?.originalCapital ?? batch.initialTotalAmount ?? 0;
  const injected = batch.finance?.trades.reduce((s, t) => s + t.amount, 0) ?? rescue.totalRescueAmount;
  return {
    clientTotalPnL, clientTotalPnLPercent: capital > 0 ? clientTotalPnL / (capital * PRIORITY_RATIO) * 100 : 0,
    institutionTotalPnL, institutionTotalPnLPercent: capital * SUBORDINATE_RATIO + injected > 0 ? institutionTotalPnL / (capital * SUBORDINATE_RATIO + injected) * 100 : 0,
    realizedClientPnL,
    realizedInstitutionPnL,
    realizedInstitutionBreakdown: { initial: realizedInstitutionInitial, splitShare: realizedInstitutionSplitShare, rescue: realizedInstitutionRescue },
    unrealizedClientPnL,
    unrealizedInstitutionPnL,
    unrealizedInstitutionBreakdown: { initial: unrealizedInstitutionInitial, splitShare: unrealizedInstitutionSplitShare, rescue: unrealizedInstitutionRescue },
    perClient, rescueStats: rescue.totalRescueAmount > 0 ? rescue : null,
    breakdown: { institutionInitialSubordinatePnL, institutionClientSplitShare, institutionRescuePnL },
  };
}
export function calculateClientMarginCall(clientInvestmentAmount: number, batchInitialTotalAmount: number, batchRequiredMarginCallTotal: number) {
  return batchInitialTotalAmount > 0 ? Math.max(0, batchRequiredMarginCallTotal) * clientInvestmentAmount / (batchInitialTotalAmount * PRIORITY_RATIO) : 0;
}
export interface PortfolioSummary {
  totalAUM: number; totalPriority: number; totalSubordinate: number; totalMarginCalls: number;
  totalPnL: number; totalPnLPercent: number; institutionPnL: number; institutionPnLPercent: number;
  allClientsPnL: number; allClientsPnLPercent: number; profitableCount: number; normalCount: number;
  warningCount: number; criticalCount: number; totalBatches: number; currentMarketValueTotal: number;
  rescueTotalInjected: number; rescueTotalCurrentValue: number; rescueTotalPnL: number;
  institutionRealizedPnL: number;
  institutionUnrealizedPnL: number;
  clientsRealizedPnL: number;
  clientsUnrealizedPnL: number;
  institutionRealizedPnLPercent: number;
  clientsRealizedPnLPercent: number;
  institutionUnrealizedPnLPercent: number;
  clientsUnrealizedPnLPercent: number;
}
export function calculatePortfolioSummary(batches: BatchLike[]): PortfolioSummary {
  const s: PortfolioSummary = { totalAUM: 0, totalPriority: 0, totalSubordinate: 0, totalMarginCalls: 0,
    totalPnL: 0, totalPnLPercent: 0, institutionPnL: 0, institutionPnLPercent: 0, allClientsPnL: 0,
    allClientsPnLPercent: 0, profitableCount: 0, normalCount: 0, warningCount: 0, criticalCount: 0,
    totalBatches: batches.length, currentMarketValueTotal: 0, rescueTotalInjected: 0, rescueTotalCurrentValue: 0, rescueTotalPnL: 0,
    institutionRealizedPnL: 0, institutionUnrealizedPnL: 0, clientsRealizedPnL: 0, clientsUnrealizedPnL: 0,
    institutionRealizedPnLPercent: 0, clientsRealizedPnLPercent: 0, institutionUnrealizedPnLPercent: 0, clientsUnrealizedPnLPercent: 0 };
  let originalCapital = 0;
  for (const b of batches) {
    s.totalAUM += b.initialTotalAmount; s.totalPriority += b.priorityAmount; s.totalSubordinate += b.subordinateAmount;
    originalCapital += b.finance?.originalCapital ?? b.initialTotalAmount;
    s.totalMarginCalls += b.cumulativeMarginCalls ?? 0;
    const metrics = getBatchMetrics(b);
    s.currentMarketValueTotal += metrics.currentMarketValue;
    const split = calculateBatchPnLSplit(b, metrics.currentMarketValue);
    s.institutionPnL += split.institutionTotalPnL; s.allClientsPnL += split.clientTotalPnL;
    s.institutionRealizedPnL += split.realizedInstitutionPnL;
    s.institutionUnrealizedPnL += split.unrealizedInstitutionPnL;
    s.clientsRealizedPnL += split.realizedClientPnL;
    s.clientsUnrealizedPnL += split.unrealizedClientPnL;
    s.totalPnL += split.institutionTotalPnL + split.clientTotalPnL;
    if (metrics.totalPnL > 0) s.profitableCount++;
    if (metrics.riskLevel === RiskLevel.CRITICAL) s.criticalCount++;
    else if (metrics.riskLevel === RiskLevel.WARNING) s.warningCount++;
    else s.normalCount++;
    if (split.rescueStats) {
      s.rescueTotalInjected += split.rescueStats.totalRescueAmount;
      s.rescueTotalCurrentValue += split.rescueStats.rescueCurrentValue;
      s.rescueTotalPnL += split.rescueStats.rescuePnL;
    }
  }
  const totalSubBase = originalCapital * SUBORDINATE_RATIO + s.totalMarginCalls;
  const totalPriBase = originalCapital * PRIORITY_RATIO;
  s.totalPnLPercent = originalCapital > 0 ? s.totalPnL / originalCapital * 100 : 0;
  s.institutionPnLPercent = totalSubBase > 0 ? s.institutionPnL / totalSubBase * 100 : 0;
  s.allClientsPnLPercent = totalPriBase > 0 ? s.allClientsPnL / totalPriBase * 100 : 0;
  s.institutionRealizedPnLPercent = totalSubBase > 0 ? s.institutionRealizedPnL / totalSubBase * 100 : 0;
  s.institutionUnrealizedPnLPercent = totalSubBase > 0 ? s.institutionUnrealizedPnL / totalSubBase * 100 : 0;
  s.clientsRealizedPnLPercent = totalPriBase > 0 ? s.clientsRealizedPnL / totalPriBase * 100 : 0;
  s.clientsUnrealizedPnLPercent = totalPriBase > 0 ? s.clientsUnrealizedPnL / totalPriBase * 100 : 0;
  return s;
}
