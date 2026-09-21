import {
  Batch,
  Client,
  MarginCall,
  StockHistory,
  RiskLevel,
  BatchStatus,
  ClientStatus,
  MarginCallStatus,
} from "@prisma/client";
import {
  calculateBatchRiskMetrics,
  calculateInvestmentSplit,
  calculateProfitSplitRatio,
  calculateTotalShares,
  calculateCurrentMarketValue,
  initializeBatchFinance,
  syncBatchFinance,
  type BatchLike,
} from "./riskEngine";
import { mergeClientStatusOnClient } from "./clientStatusStore";
import { calculateTradingWindows } from "./utils";

export interface MockDataSet {
  batches: (Batch & { clients: Client[]; marginCalls: MarginCall[] })[];
  stockHistory: StockHistory[];
}

const STOCKS = [
  { symbol: "NVDA", name: "NVIDIA Corporation", basePrice: 115.21 },
  { symbol: "TSLA", name: "Tesla, Inc.", basePrice: 243.27 },
  { symbol: "AAPL", name: "Apple Inc.", basePrice: 226.73 },
  { symbol: "MSFT", name: "Microsoft Corporation", basePrice: 412.15 },
  { symbol: "META", name: "Meta Platforms, Inc.", basePrice: 571.43 },
  { symbol: "GOOGL", name: "Alphabet Inc.", basePrice: 160.27 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", basePrice: 181.55 },
  { symbol: "AMD", name: "Advanced Micro Devices, Inc.", basePrice: 151.64 },
];

export const BD_MANAGERS = ["李晓明 (Evan Li)", "王思远 (Sylvia Wang)", "张志强 (Jack Zhang)", "刘佳 (Jennifer Liu)"];

const CLIENT_FIRST_NAMES = [
  "伟", "芳", "娜", "敏", "静", "秀英", "丽", "强", "磊", "军",
  "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "霞", "平",
];
const CLIENT_LAST_NAMES = ["王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴"];

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const MOCK_BASE_SEED = 20260306;

function createSeededRandom(seedOffset: number) {
  const rand = mulberry32(MOCK_BASE_SEED + seedOffset);
  const int = (min: number, max: number): number => Math.floor(rand() * (max - min + 1)) + min;
  const float = (min: number, max: number, decimals: number = 2): number =>
    Number((rand() * (max - min) + min).toFixed(decimals));
  const from = <T>(arr: T[]): T => arr[int(0, arr.length - 1)];
  const r = rand;
  return { rand, int, float, from, r };
}

function deterministicOffsetDate(baseDate: Date, offsetDays: number, fracHours: number = 0): Date {
  return new Date(baseDate.getTime() + offsetDays * 86400000 + Math.round(fracHours * 3600000));
}

export function generateMockData(): MockDataSet {
  const now = new Date();
  const batches: (Batch & { clients: Client[]; marginCalls: MarginCall[] })[] = [];
  const stockHistory: StockHistory[] = [];

  const globalRng = createSeededRandom(0);

  const BASE_SIGN_DATE = new Date("2025-03-06T00:00:00.000Z");

  STOCKS.forEach((stock, sIdx) => {
    const rng = createSeededRandom(1000 + sIdx);
    stockHistory.push({
      id: `sh-${stock.symbol}`,
      symbol: stock.symbol,
      name: stock.name,
      usageCount: rng.int(1, 5),
      lastUsed: deterministicOffsetDate(BASE_SIGN_DATE, 120 + rng.int(0, 30), rng.rand() * 12),
      createdAt: deterministicOffsetDate(BASE_SIGN_DATE, -30 - rng.int(0, 30), rng.rand() * 8),
      updatedAt: deterministicOffsetDate(now, -5 - rng.int(0, 3), rng.rand() * 6),
    });
  });

  for (let i = 0; i < 8; i++) {
    const stock = STOCKS[i % STOCKS.length];
    const batchRng = createSeededRandom(10000 + i * 97);
    const signDate = deterministicOffsetDate(BASE_SIGN_DATE, i * 14 + batchRng.int(0, 3), batchRng.rand() * 12);
    const maturityDate = new Date(signDate);
    maturityDate.setUTCMonth(maturityDate.getUTCMonth() + 24);

    const initialAmounts = [1000000, 2000000, 750000, 5000000, 3000000, 1500000, 800000, 4000000];
    const initialTotalAmount = initialAmounts[i];
    const split = calculateInvestmentSplit(initialTotalAmount);

    const priceDropScenarios = [0.05, 0.12, 0.18, 0.24, 0.02, 0.16, 0.08, 0.21];
    const dropPercent = priceDropScenarios[i];

    const stockPriceAtStart = stock.basePrice;
    const currentStockPrice = Number((stock.basePrice * (1 - dropPercent + (batchRng.rand() - 0.5) * 0.02)).toFixed(2));
    const currentDayChange = Number(((batchRng.rand() - 0.5) * 4).toFixed(2));
    const currentDayChangePercent = Number((currentDayChange / stockPriceAtStart * 100).toFixed(2));

    const totalShares = calculateTotalShares(initialTotalAmount, stockPriceAtStart);
    const currentMarketValue = calculateCurrentMarketValue(stockPriceAtStart, currentStockPrice, totalShares);

    const metrics = calculateBatchRiskMetrics(initialTotalAmount, currentMarketValue, 0);

    let cumulativeMarginCalls = 0;
    const marginCalls: MarginCall[] = [];

    if (metrics.riskLevel === RiskLevel.CRITICAL || (i === 3 || i === 7)) {
      const required = initialTotalAmount * 0.2;
      const fulfilled = i === 7 ? 0 : required * 0.8;
      cumulativeMarginCalls = fulfilled;

      const triggerDate = new Date(signDate);
      triggerDate.setUTCMonth(triggerDate.getUTCMonth() + batchRng.int(4, 12));
      const mcEntryPrice1 = Number((stockPriceAtStart * (1 - 0.22)).toFixed(2));
      const rescueShares1 = fulfilled > 0 && mcEntryPrice1 > 0 ? fulfilled / mcEntryPrice1 : 0;

      marginCalls.push({
        id: `mc-${i}-1`,
        batchId: `batch-${2026}-${String(i + 1).padStart(3, "0")}`,
        triggerDate,
        triggerMarketValue: Number((initialTotalAmount * 0.78).toFixed(2)),
        dropPercent: 0.22,
        requiredAmount: required,
        fulfilledAmount: fulfilled > 0 ? fulfilled : null,
        fulfilledDate: fulfilled > 0 ? new Date(triggerDate.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
        status: fulfilled === 0 ? MarginCallStatus.PENDING : (fulfilled >= required ? MarginCallStatus.FULLFILLED : MarginCallStatus.PENDING),
        note: fulfilled === 0 ? "等待机构补仓资金到账" : "部分补仓已完成，请关注剩余额度",
        notifiedEmails: "risk-control@institution.com,head-of-risk@institution.com",
        notifiedWhatsApps: "+852-9123-4567",
        averageEntryPrice: mcEntryPrice1,
        rescueShares: rescueShares1,
        createdAt: triggerDate,
      } as any);

      if (i === 3) {
        const triggerDate2 = new Date(triggerDate);
        triggerDate2.setUTCMonth(triggerDate2.getUTCMonth() + 2);
        const required2 = initialTotalAmount * 0.05;
        const mcEntryPrice2 = Number((stockPriceAtStart * 0.75).toFixed(2));
        const rescueShares2 = mcEntryPrice2 > 0 ? required2 / mcEntryPrice2 : 0;
        marginCalls.push({
          id: `mc-${i}-2`,
          batchId: `batch-${2026}-${String(i + 1).padStart(3, "0")}`,
          triggerDate: triggerDate2,
          triggerMarketValue: Number((initialTotalAmount * 0.75 - fulfilled).toFixed(2)),
          dropPercent: 0.05,
          requiredAmount: required2,
          fulfilledAmount: required2,
          fulfilledDate: new Date(triggerDate2.getTime() + 1 * 24 * 60 * 60 * 1000),
          status: MarginCallStatus.FULLFILLED,
          note: "二次补仓已完成，市值回归至安全区域",
          notifiedEmails: "risk-control@institution.com",
          notifiedWhatsApps: "+852-9123-4567",
          averageEntryPrice: mcEntryPrice2,
          rescueShares: rescueShares2,
          createdAt: triggerDate2,
        } as any);
        cumulativeMarginCalls += required2;
      }
    }

    const metricsWithMargin = calculateBatchRiskMetrics(
      initialTotalAmount,
      currentMarketValue,
      cumulativeMarginCalls
    );

    const tradingInfo = calculateTradingWindows(signDate);
    let status: BatchStatus = BatchStatus.LOCKED;
    if (tradingInfo.monthsElapsed >= 24) {
      status = BatchStatus.CLOSED;
    } else if (tradingInfo.isLocked) {
      status = BatchStatus.LOCKED;
    } else {
      status = BatchStatus.TRADING_OPEN;
    }

    const clients: Client[] = [];
    const clientCounts = [8, 12, 5, 15, 10, 6, 4, 18];
    const numClients = clientCounts[i];
    const priorityPool = split.priorityAmount;

    for (let c = 0; c < numClients; c++) {
      const clientRng = createSeededRandom(100000 + i * 1000 + c);
      let investmentAmount: number;
      if (c === 0) {
        investmentAmount = priorityPool * 0.25;
      } else if (c === numClients - 1) {
        investmentAmount = priorityPool - clients.reduce((sum, cl) => sum + cl.investmentAmount, 0);
        investmentAmount = Math.max(10000, Number(investmentAmount.toFixed(2)));
      } else {
        const isBig = clientRng.rand() < 0.3;
        investmentAmount = isBig
          ? clientRng.int(100000, 300000)
          : clientRng.int(20000, 80000);
      }
      investmentAmount = Number(investmentAmount.toFixed(2));

      const profitSplit = calculateProfitSplitRatio(investmentAmount, true);

      const clientSignDate = deterministicOffsetDate(signDate, clientRng.int(0, 3), clientRng.rand() * 24);

      let clientStatus: ClientStatus = ClientStatus.ACTIVE;
      if (i === 4 && c < 2) {
        clientStatus = ClientStatus.SETTLED;
      } else if (i === 1 && c === 3) {
        clientStatus = ClientStatus.EXIT_REQUESTED;
      }

      const lastName = CLIENT_LAST_NAMES[clientRng.int(0, CLIENT_LAST_NAMES.length - 1)];
      const firstName = CLIENT_FIRST_NAMES[clientRng.int(0, CLIENT_FIRST_NAMES.length - 1)];
      const clientName = `${lastName}${firstName}`;

      clients.push({
        id: `client-${i}-${c}`,
        batchId: `batch-${2026}-${String(i + 1).padStart(3, "0")}`,
        name: clientName,
        investmentAmount,
        bdManager: clientRng.from(BD_MANAGERS),
        bdUserId: null,
        signDate: clientSignDate,
        profitSplitClient: profitSplit.client * 100,
        profitSplitInstitution: profitSplit.institution * 100,
        realtimePnL: 0,
        estimatedExitAmount: 0,
        status: clientStatus,
        settledAt: clientStatus === ClientStatus.SETTLED
          ? deterministicOffsetDate(clientSignDate, clientRng.int(30, 180), clientRng.rand() * 24)
          : null,
        settlementNote: clientStatus === ClientStatus.SETTLED ? "客户申请退出，已按结算规则完成清算" : null,
        createdAt: clientSignDate,
        updatedAt: now,
      });
    }

    batches.push({
      id: `batch-${2026}-${String(i + 1).padStart(3, "0")}`,
      batchNumber: `BATCH-${2026}-${String(i + 1).padStart(3, "0")}`,
      stockSymbol: stock.symbol,
      stockName: stock.name,
      stockPriceAtStart,
      currentStockPrice,
      currentDayChange: currentDayChangePercent,
      initialTotalAmount,
      priorityAmount: split.priorityAmount,
      subordinateAmount: split.subordinateAmount,
      signDate,
      maturityDate,
      totalShares,
      currentMarketValue,
      totalPnL: metricsWithMargin.totalPnL,
      totalPnLPercent: metricsWithMargin.totalPnLPercent,
      cumulativeMarginCalls,
      status,
      riskLevel: metrics.riskLevel,
      nextTradingWindow: tradingInfo.nextTradingDate,
      clients,
      marginCalls,
      createdAt: signDate,
      updatedAt: now,
    });
  }

  return { batches, stockHistory };
}

const MOCK_PERSIST_KEY = "risk_control_mock_margin_patches_v1";

interface ClientMarginPatch {
  _f: string; // fingerprint: `${name}|${investment}|${initialInvestment ?? investmentAmount}
  initialInvestment: number;
  required: number;
  fulfilled: number;
  history: Array<{
    id: string;
    clientId: string;
    amount: number;
    fulfilledAt: string;
    source?: "batch_one_click" | "client_single" | "manual";
    operatorName?: string;
    notes?: string;
  }>;
}

interface BatchPatch {
  cumulativeMarginCallsDelta?: number;
  clients: Record<string, ClientMarginPatch>;
}

interface MockPatches {
  batches: Record<string, BatchPatch>;
  persistedAt: string;
}

function clientFingerprint(client: any, initialInvestment: number = 0): string {
  const name: string = client?.name ?? "";
  const invest: number =
    typeof client?.investmentAmount === "number"
      ? client.investmentAmount
      : initialInvestment;
  return `${name}|${Number(invest).toFixed(2)}|${Number(initialInvestment || invest).toFixed(2)}`;
}

function isClientLike(c: unknown): c is { id: string; investmentAmount?: number; initialInvestment?: number } {
  return !!c && typeof (c as any).id === "string";
}

function readPatches(): MockPatches | null {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(MOCK_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockPatches;
    return parsed && typeof parsed.batches === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writePatches(p: MockPatches): void {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return;
    p.persistedAt = new Date().toISOString();
    localStorage.setItem(MOCK_PERSIST_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota / SSR */
  }
}

export function applyPersistedClientMarginPatches(data: MockDataSet): MockDataSet {
  const patches = readPatches();
  if (!patches) return data;
  for (const batch of data.batches) {
    const bp = patches.batches[batch.id];
    if (!bp) continue;
    const clientsArr = Array.isArray(batch.clients) ? batch.clients : [];
    let verified = true;
    for (const client of clientsArr as any[]) {
      const cp = bp.clients[client.id];
      if (!cp) continue;
      const fp = typeof cp._f === "string" ? cp._f : null;
      const expected = clientFingerprint(client, cp.initialInvestment);
      if (!fp || fp !== expected) {
        verified = false;
        // 旧版非确定性 LS patch，指纹不匹配 -> 丢弃，避免错配到同 id 但不同客户
        continue;
      }
      (client as any).marginState = {
        initialInvestment:
          cp.initialInvestment ?? (client as any).initialInvestment ?? client.investmentAmount ?? 0,
        required: cp.required ?? 0,
        fulfilled: cp.fulfilled ?? 0,
        history: Array.isArray(cp.history) ? cp.history : [],
      };
    }
    if (verified && typeof bp.cumulativeMarginCallsDelta === "number") {
      batch.cumulativeMarginCalls = (batch.cumulativeMarginCalls ?? 0) + bp.cumulativeMarginCallsDelta;
    }
  }
  return data;
}

export function persistClientMarginPatch(
  data: MockDataSet,
  batchId: string,
  clientOrClientId:
    | { id: string; investmentAmount?: number; initialInvestment?: number; marginState?: any; name?: string }
    | string,
  state: {
    initialInvestment: number;
    required: number;
    fulfilled: number;
    history: Array<{
      id: string;
      clientId: string;
      amount: number;
      fulfilledAt: string;
      source?: "batch_one_click" | "client_single" | "manual";
      operatorName?: string;
      notes?: string;
    }>;
  },
  cumulativeDelta: number = 0
): void {
  let clientId: string;
  let clientLike: any = null;
  if (isClientLike(clientOrClientId)) {
    clientId = clientOrClientId.id;
    clientLike = clientOrClientId;
  } else {
    clientId = clientOrClientId as string;
    const batch = data.batches.find((b) => b.id === batchId);
    if (batch && Array.isArray((batch as any).clients)) {
      clientLike = (batch as any).clients.find((c: any) => c.id === clientId) ?? null;
    }
  }
  const existing = readPatches();
  const next: MockPatches = existing ?? { batches: {}, persistedAt: new Date().toISOString() };
  if (!next.batches[batchId]) {
    next.batches[batchId] = { clients: {} };
  }
  const bp = next.batches[batchId];
  const fp = clientLike
    ? clientFingerprint(clientLike, state.initialInvestment)
    : `__compat__|${Number(state.initialInvestment).toFixed(2)}|${Number(state.initialInvestment).toFixed(2)}`;
  bp.clients[clientId] = {
    _f: fp,
    initialInvestment: state.initialInvestment,
    required: state.required,
    fulfilled: state.fulfilled,
    history: state.history,
  };
  if (typeof cumulativeDelta === "number" && cumulativeDelta !== 0) {
    bp.cumulativeMarginCallsDelta = (bp.cumulativeMarginCallsDelta ?? 0) + cumulativeDelta;
  }
  writePatches(next);
}

export function persistBatchLevelTopup(
  data: MockDataSet,
  batchId: string,
  appliedAmount: number,
  clients: Array<{
    id: string;
    name?: string;
    investmentAmount?: number;
    marginState?: any;
  }>
): void {
  const existing = readPatches();
  const next: MockPatches = existing ?? { batches: {}, persistedAt: new Date().toISOString() };
  if (!next.batches[batchId]) {
    next.batches[batchId] = { clients: {} };
  }
  const bp = next.batches[batchId];
  bp.cumulativeMarginCallsDelta = (bp.cumulativeMarginCallsDelta ?? 0) + appliedAmount;
  for (const c of clients) {
    const ms = (c as any).marginState;
    if (!ms) continue;
    const initialInvestment =
      typeof ms.initialInvestment === "number"
        ? ms.initialInvestment
        : (c as any).initialInvestment ?? c.investmentAmount ?? 0;
    const fp = clientFingerprint(c, initialInvestment);
    bp.clients[c.id] = {
      _f: fp,
      initialInvestment,
      required: ms.required ?? 0,
      fulfilled: ms.fulfilled ?? 0,
      history: Array.isArray(ms.history) ? ms.history : [],
    };
  }
  writePatches(next);
}

export function clearMockMarginPatches(): void {
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.removeItem(MOCK_PERSIST_KEY);
    }
  } catch {
    /* ignore */
  }
}

let cachedMockData: MockDataSet | null = null;

export const FINANCE_STORE_KEY = "risk_control_finance_v2";
type FinanceRecord = { fingerprint: string; clientFingerprints?: Record<string, string>; batch: BatchLike };
type FinanceStore = Record<string, FinanceRecord>;

function batchFingerprint(batch: BatchLike): string {
  return `${batch.id}|${batch.stockSymbol}|${batch.stockPriceAtStart}`;
}

function financeRecord(batch: BatchLike): FinanceRecord {
  return {
    fingerprint: batchFingerprint(batch),
    clientFingerprints: Object.fromEntries((batch.clients ?? []).map((c) => [c.id, clientFingerprint(c, c.initialInvestment ?? c.investmentAmount)])),
    batch,
  };
}

function readFinanceStore(): FinanceStore {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(FINANCE_STORE_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("资金账本格式无效，请保留数据并联系管理员核对。");
  }
  return parsed;
}

function reviveBatch(batch: BatchLike): BatchLike {
  for (const key of ["signDate", "maturityDate", "createdAt", "updatedAt", "nextTradingWindow"] as const) {
    if (batch[key]) (batch as any)[key] = new Date(batch[key]!);
  }
  for (const c of batch.clients ?? []) {
    for (const key of ["signDate", "settledAt", "createdAt", "updatedAt"] as const) {
      if (c[key]) (c as any)[key] = new Date(c[key]!);
    }
    (c as any).__financeManaged = true;
  }
  return batch;
}

/** Stage, persist, then publish. Failed storage or a stale tab cannot partially book an action. */
export function commitBatchFinance<T>(batch: BatchLike, mutate: (draft: BatchLike) => T): T {
  if (typeof window === "undefined") throw new Error("请在已登录的浏览器中执行资金操作。");
  const store = readFinanceStore();
  const saved = store[batch.id];
  if (saved && saved.batch.finance?.revision !== batch.finance?.revision) {
    throw new Error("此批次已在其他页面更新，请刷新后重新确认。");
  }
  const draft = reviveBatch(structuredClone(batch));
  const result = mutate(draft);
  initializeBatchFinance(draft);
  draft.finance!.revision = (batch.finance?.revision ?? 0) + 1;
  store[batch.id] = financeRecord(draft);
  try {
    window.localStorage.setItem(FINANCE_STORE_KEY, JSON.stringify(store));
  } catch {
    throw new Error("资金记录保存失败，本次操作未入账。请检查浏览器存储空间后重试。");
  }
  Object.assign(batch, draft);
  window.dispatchEvent(new CustomEvent("risk-control:finance-changed", { detail: { batchId: batch.id } }));
  return result;
}

export function getMockData(): MockDataSet {
  if (!cachedMockData) {
    const loaded = applyPersistedClientMarginPatches(generateMockData());
    const store = readFinanceStore();
    for (const batch of loaded.batches) {
      const saved = store[batch.id];
      if (saved) {
        if (saved.fingerprint !== batchFingerprint(batch) || saved.batch.finance?.version !== 2) {
          throw new Error("资金账本与批次身份不匹配，请联系管理员核对，勿重复补仓。");
        }
        for (const c of saved.batch.clients ?? []) {
          if (saved.clientFingerprints && saved.clientFingerprints[c.id] !== clientFingerprint(c, c.initialInvestment ?? c.investmentAmount)) {
            throw new Error("客户身份与资金账本不匹配，请保留数据并联系管理员核对。");
          }
        }
        for (const originalCall of batch.marginCalls) {
          const imported = saved.batch.finance.rounds.find((r) => r.id === `obligation_${originalCall.id}`);
          if (originalCall.status === "PENDING" && imported?.requiredAmount === 0 &&
              Object.keys(imported.allocations).length === 0 && imported.fulfilledAmount === 0) {
            imported.requiredAmount = originalCall.requiredAmount;
            imported.status = "PENDING";
            saved.batch.finance.revision++;
          }
        }
        // Upgrade the initial v2 import only if no new financial actions have been booked.
        if (!saved.batch.finance.legacyAllocationVersion &&
            saved.batch.finance.trades.every((t) => t.source === "legacy") &&
            Object.keys(saved.batch.finance.settlements).length === 0) {
          const revision = saved.batch.finance.revision;
          const original = batch as BatchLike;
          original.currentStockPrice = saved.batch.currentStockPrice;
          original.clients = original.clients?.map((c) => ({
            ...c, status: saved.batch.clients?.find((s) => s.id === c.id)?.status ?? c.status,
          }));
          initializeBatchFinance(original);
          original.finance!.revision = revision + 1;
          store[batch.id] = financeRecord(original);
          reviveBatch(original);
          continue;
        }
        Object.assign(batch, reviveBatch(saved.batch));
        syncBatchFinance(batch);
      } else {
        batch.clients = batch.clients.map((c) => mergeClientStatusOnClient(c));
        initializeBatchFinance(batch);
        reviveBatch(batch);
      }
    }
    // Persist initial round IDs once so concurrent tabs refer to the same obligations.
    if (typeof window !== "undefined") {
      for (const batch of loaded.batches) {
        if (!store[batch.id]) store[batch.id] = financeRecord(batch);
      }
      window.localStorage.setItem(FINANCE_STORE_KEY, JSON.stringify(store));
    }
    cachedMockData = loaded;
  }
  return cachedMockData;
}

export function refreshMockDataPrices(): MockDataSet {
  const data = getMockData();
  const now = new Date();

  data.batches.forEach((batch) => {
    if (!batch.currentStockPrice) return;
    const changePercent = (Math.random() - 0.5) * 0.03;
    const newPrice = Number((batch.currentStockPrice * (1 + changePercent)).toFixed(2));
    commitBatchFinance(batch, (draft) => {
      draft.currentStockPrice = newPrice;
      draft.currentDayChange = Number((changePercent * 100).toFixed(2));
      draft.updatedAt = now;
      syncBatchFinance(draft);
    });
  });

  return data;
}
