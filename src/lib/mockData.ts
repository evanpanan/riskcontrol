import {
  Batch,
  Client,
  MarginCall,
  StockHistory,
  RiskLevel,
  BatchStatus,
  ClientStatus,
} from "@prisma/client";
import {
  XMAX_HALF_YEAR_PRICE_SERIES,
  RECOMMENDED_BATCH_SIGN_DATES,
  XMAX_CURRENT_LIVE_PRICE,
} from "./xmax-price-series";
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
import { getNYSEInfo } from "./liveQuote";
import { calculateTradingWindows } from "./utils";

export interface MockDataSet {
  batches: (Batch & { clients: Client[]; marginCalls: MarginCall[] })[];
  stockHistory: StockHistory[];
}

// Scenario quote only, not a live market price. All batches share this symbol.
const STOCKS = [{ symbol: "XMAX", name: "XMAX", basePrice: 10 }];

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

const MOCK_BASE_SEED = 20260923;

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

export function formatClientNo(year: number, seq: number): string {
  const yy = String(year).slice(-2);
  const pad = String(Math.max(1, seq | 0)).padStart(5, "0");
  return `C${yy}${pad}`;
}

function clientYearOf(c: Client): number {
  const d = (c.signDate ? new Date(c.signDate as any) : null) ?? (c.createdAt ? new Date((c as any).createdAt as any) : new Date());
  const y = d.getUTCFullYear();
  return Number.isFinite(y) && y > 2000 ? y : new Date().getUTCFullYear();
}

function stableBatchSortKey(b: Batch & { clients?: Client[] }): [number, string, string] {
  const sd = b.signDate ? new Date(b.signDate as any).getTime() : 0;
  return [Number.isFinite(sd) ? sd : 0, b.batchNumber || String(0), b.id];
}

export type ClientNoAllocator = { next: (forYear?: number) => string };

/**
 * 为缺失 clientNo 的客户回填稳定唯一编号，保证：
 *  - 同一客户每次 reload 编号一致（按「批次签约日期升序 → 批次号 → 批次内 clients 顺序」排序）
 *  - 按签约年份独立编号（C + 两位年份 + 5 位序号），例如 C2600001
 *  - 已存在 clientNo 的客户绝不覆盖
 *
 * getMockData() 返回前调用，兼容 localStorage 旧账本 & 新生成的种子数据。
 * 返回的 allocator.next(forYear) 用于后续新增客户时拿到下一个可用编号。
 */
export function ensureClientNosOnBatches(
  batches: Array<Batch & { clients?: Client[] }>,
): ClientNoAllocator {
  const sorted = [...batches].sort((a, b) => {
    const ka = stableBatchSortKey(a);
    const kb = stableBatchSortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
  const yearMaxSeq = new Map<number, number>();
  const all: Client[] = [];
  for (const b of sorted) {
    for (const c of b.clients ?? []) all.push(c);
  }
  // first pass: 统计各年份已使用的最大 seq
  for (const c of all) {
    const no = (c as any).clientNo as string | null | undefined;
    if (!no) continue;
    const m = /^C(\d{2})(\d{5})$/.exec(no);
    if (!m) continue;
    const yy = Number(m[1]);
    const seq = Number(m[2]);
    if (!Number.isFinite(yy) || !Number.isFinite(seq)) continue;
    const century = Math.floor(new Date().getUTCFullYear() / 100);
    const year = century * 100 + yy;
    yearMaxSeq.set(year, Math.max(yearMaxSeq.get(year) ?? 0, seq));
  }
  // second pass: 按稳定顺序给缺编号的客户依次编号
  for (const c of all) {
    const no = (c as any).clientNo as string | null | undefined;
    if (no) continue;
    const year = clientYearOf(c);
    const nxt = (yearMaxSeq.get(year) ?? 0) + 1;
    yearMaxSeq.set(year, nxt);
    (c as any).clientNo = formatClientNo(year, nxt);
  }
  return {
    next: (forYear?: number) => {
      const year = forYear && forYear > 2000 ? forYear : new Date().getUTCFullYear();
      const nxt = (yearMaxSeq.get(year) ?? 0) + 1;
      yearMaxSeq.set(year, nxt);
      return formatClientNo(year, nxt);
    },
  };
}

let lastClientNoAllocator: ClientNoAllocator | null = null;

/** 从当前 mock 数据分配器拿到下一个客户编号；如果 allocator 未构建则立即构建。 */
export function nextClientNo(batches: Array<Batch & { clients?: Client[] }>, forYear?: number): string {
  if (!lastClientNoAllocator) {
    lastClientNoAllocator = ensureClientNosOnBatches(batches);
  }
  return lastClientNoAllocator.next(forYear);
}

/** 当缓存被刷新时同步重置编号分配器，避免序号复用冲突。 */
function resetClientNoAllocator() { lastClientNoAllocator = null; }

export function generateMockData(): MockDataSet {
  const now = new Date();
  const batches: (Batch & { clients: Client[]; marginCalls: MarginCall[] })[] = [];
  const stockHistory: StockHistory[] = [];

  // ===== 根据真实 XMAX 历史价格，快速查找 signDate 对应 close =====
  const priceLookup = new Map<string, number>();
  for (const [d, close] of XMAX_HALF_YEAR_PRICE_SERIES) priceLookup.set(d, close);
  const sortedDates = Array.from(priceLookup.keys()).sort();
  const findClosestClose = (targetDateStr: string): number => {
    if (priceLookup.has(targetDateStr)) return priceLookup.get(targetDateStr)!;
    // 找最近交易日 <= targetDate
    const targetTs = new Date(targetDateStr + "T00:00:00.000Z").getTime();
    let best = sortedDates[0];
    for (const d of sortedDates) {
      if (d <= targetDateStr) best = d;
      else break;
    }
    return priceLookup.get(best) ?? XMAX_CURRENT_LIVE_PRICE;
    void targetTs;
  };

  // 当前最新价：所有批次共享
  const currentStockPrice = XMAX_CURRENT_LIVE_PRICE;

  STOCKS.forEach((stock, sIdx) => {
    const rng = createSeededRandom(1000 + sIdx);
    stockHistory.push({
      id: `sh-${stock.symbol}`,
      symbol: stock.symbol,
      name: stock.name,
      usageCount: RECOMMENDED_BATCH_SIGN_DATES.length,
      lastUsed: new Date(RECOMMENDED_BATCH_SIGN_DATES[RECOMMENDED_BATCH_SIGN_DATES.length - 1] + "T12:00:00.000Z"),
      createdAt: deterministicOffsetDate(new Date(RECOMMENDED_BATCH_SIGN_DATES[0] + "T00:00:00.000Z"), -30 - rng.int(0, 30), rng.rand() * 8),
      updatedAt: deterministicOffsetDate(now, -5 - rng.int(0, 3), rng.rand() * 6),
    });
  });

  // ===== 每批次投资额档位池（保证 <10万 与 >10万 都有） =====
  // 分档：
  //   小额档 (30%概率)：$2万 ~ $9.5万  (客户层面 <10万)
  //   中额档 (50%概率)：$10万 ~ $30万
  //   大额档 (20%概率)：$30万 ~ $70万
  // 批次总 initialTotal = 客户之和，因此客户档混合后自动产生 各种 total amount
  const CLIENT_INVESTMENT_BUCKETS = [
    // 小额 <10万
    { min: 20000, max: 60000, weight: 2 },
    { min: 60000, max: 95000, weight: 2 },
    // 中额 10万~30万
    { min: 100000, max: 180000, weight: 3 },
    { min: 180000, max: 300000, weight: 2 },
    // 大额 30万+
    { min: 300000, max: 500000, weight: 1 },
  ];
  const pickClientInvestment = (batchRng: ReturnType<typeof createSeededRandom>) => {
    const totalW = CLIENT_INVESTMENT_BUCKETS.reduce((s,b)=>s+b.weight, 0);
    let r = batchRng.rand() * totalW;
    for (const b of CLIENT_INVESTMENT_BUCKETS) {
      if (r < b.weight) return batchRng.float(b.min, b.max, 2);
      r -= b.weight;
    }
    return batchRng.float(80000, 200000, 2);
  };

  const TOTAL_BATCHES = RECOMMENDED_BATCH_SIGN_DATES.length; // 24

  for (let i = 0; i < TOTAL_BATCHES; i++) {
    const stock = STOCKS[i % STOCKS.length];
    const batchRng = createSeededRandom(20000 + i * 211);
    const signDateISO = RECOMMENDED_BATCH_SIGN_DATES[i];
    const signDate = new Date(signDateISO + "T00:00:00.000Z");
    const maturityDate = new Date(signDate);
    maturityDate.setUTCMonth(maturityDate.getUTCMonth() + 24);

    // 每批次客户数：20~30（按用户要求）
    const numClients = batchRng.int(20, 30);

    // 生成客户 + 投资额（保证 <10万 与 >10万 混杂）
    const clients: Client[] = [];
    let initialTotalAmountCents = 0;
    const weights = Array.from({ length: numClients }, () => batchRng.int(1, 12));
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    // 预先确定每个客户的 investmentAmount，满足 <10万 和 >10万 都有
    const clientAmounts: number[] = [];
    // 先强制塞至少 7位 <10万，至少 8位 >10万，其余随机
    const minSmall = Math.max(1, Math.floor(numClients * 0.30));
    const minLarge = Math.max(1, Math.floor(numClients * 0.25));
    for (let c = 0; c < numClients; c++) {
      let amt: number;
      if (c < minSmall) {
        amt = batchRng.float(20000, 95000, 2);
      } else if (c < minSmall + minLarge) {
        amt = batchRng.float(110000, 480000, 2);
      } else {
        amt = pickClientInvestment(batchRng);
      }
      clientAmounts.push(amt);
    }
    // shuffle 让大小额均匀分布
    for (let k = clientAmounts.length - 1; k > 0; k--) {
      const j = Math.floor(batchRng.rand() * (k + 1));
      [clientAmounts[k], clientAmounts[j]] = [clientAmounts[j], clientAmounts[k]];
    }

    for (let c = 0; c < numClients; c++) {
      const clientRng = createSeededRandom(200000 + i * 1000 + c);
      const investmentAmount = Number(clientAmounts[c].toFixed(2));
      initialTotalAmountCents += Math.round(investmentAmount * 100);

      const profitSplit = calculateProfitSplitRatio(investmentAmount, true);
      const clientSignDate = deterministicOffsetDate(signDate, clientRng.int(0, 3), clientRng.rand() * 24);
      const lastName = CLIENT_LAST_NAMES[clientRng.int(0, CLIENT_LAST_NAMES.length - 1)];
      const firstName = CLIENT_FIRST_NAMES[clientRng.int(0, CLIENT_FIRST_NAMES.length - 1)];
      const clientName = `${lastName}${firstName}`;

      clients.push({
        id: `client-${MOCK_BASE_SEED}-${i}-${c}`,
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
        status: ClientStatus.ACTIVE,
        settledAt: null,
        settlementNote: null,
        createdAt: clientSignDate,
        updatedAt: now,
      });
    }

    const initialTotalAmount = initialTotalAmountCents / 100;
    const split = calculateInvestmentSplit(initialTotalAmount);

    // 入场价 = signDate 当日 XMAX 真实收盘价
    const stockPriceAtStart = Number(findClosestClose(signDateISO).toFixed(4));

    const totalShares = calculateTotalShares(initialTotalAmount, stockPriceAtStart);
    const currentMarketValue = calculateCurrentMarketValue(
      stockPriceAtStart,
      currentStockPrice,
      totalShares
    );

    // 补仓次数：按真实跌幅决定（风险等级由 calculateBatchRiskMetrics 计算）
    // 若 riskLevel=CRITICAL => 1 次补仓，WARNING => 0 或 1 次，其余 0
    const prelimMetrics = calculateBatchRiskMetrics(initialTotalAmount, currentMarketValue, 0);
    let cumulativeMarginCalls = 0;
    if (prelimMetrics.riskLevel === RiskLevel.CRITICAL) {
      cumulativeMarginCalls = batchRng.int(1, 2);
    } else if (prelimMetrics.riskLevel === RiskLevel.WARNING) {
      cumulativeMarginCalls = batchRng.rand() < 0.35 ? 1 : 0;
    }
    const marginCalls: MarginCall[] = [];
    for (let m = 0; m < cumulativeMarginCalls; m++) {
      const callDate = new Date(now.getTime() - (m + 1) * 86400000 - batchRng.int(0, 5) * 86400000);
      marginCalls.push({
        id: `mc-${MOCK_BASE_SEED}-${i}-${m}`,
        batchId: `batch-${2026}-${String(i + 1).padStart(3, "0")}`,
        requiredAmount: Number(prelimMetrics.requiredMarginCall.toFixed(2)),
        fulfilledAmount: m === cumulativeMarginCalls - 1 ? 0 : Number(prelimMetrics.requiredMarginCall.toFixed(2)),
        status: m === cumulativeMarginCalls - 1 ? "PENDING" : "FULFILLED",
        createdAt: callDate,
        updatedAt: callDate,
        triggeredBy: "STOCK_DROP",
        triggeredAt: callDate,
      });
    }

    const finalMetrics = calculateBatchRiskMetrics(
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

    const currentDayChangePercent = Number(((currentStockPrice / stockPriceAtStart - 1) * 100).toFixed(2));

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
      totalPnL: finalMetrics.totalPnL,
      totalPnLPercent: finalMetrics.totalPnLPercent,
      cumulativeMarginCalls,
      status,
      riskLevel: finalMetrics.riskLevel,
      nextTradingWindow: tradingInfo.nextTradingDate,
      clients,
      marginCalls,
      createdAt: signDate,
      updatedAt: now,
    });
  }

  // ===== 跨批次重复客户注入 =====
  const MULTI_BATCH_CLIENTS: Array<{
    name: string;
    bdManager: string;
    participations: Array<{
      batchIndex: number;
      investmentAmount: number;
      signOffsetDays: number;
      signOffsetHours?: number;
    }>;
  }> = [
    {
      // 张霞 (Jennifer Liu) → 跨 001/009/017 三个批次（2026-03 / 2026-05 / 2026-07）
      name: "张霞",
      bdManager: "刘佳 (Jennifer Liu)",
      participations: [
        { batchIndex: 0, investmentAmount: 168500.75, signOffsetDays: 2, signOffsetHours: 8 },
        { batchIndex: 8, investmentAmount: 94200.0, signOffsetDays: 3, signOffsetHours: 14 },
        { batchIndex: 16, investmentAmount: 272400.5, signOffsetDays: 4, signOffsetHours: 10 },
      ],
    },
    {
      // 张勇 (Jack Zhang) → 跨 003/013 两个批次
      name: "张勇",
      bdManager: "张志强 (Jack Zhang)",
      participations: [
        { batchIndex: 2, investmentAmount: 385700.22, signOffsetDays: 5, signOffsetHours: 10 },
        { batchIndex: 12, investmentAmount: 124800.0, signOffsetDays: 7, signOffsetHours: 16 },
      ],
    },
    {
      // 王芳 (Sylvia Wang) → 跨 005/019 两个批次
      name: "王芳",
      bdManager: "王思远 (Sylvia Wang)",
      participations: [
        { batchIndex: 4, investmentAmount: 54300.0, signOffsetDays: 2, signOffsetHours: 9 },
        { batchIndex: 18, investmentAmount: 112300.0, signOffsetDays: 5, signOffsetHours: 11 },
      ],
    },
    {
      // 李娜 (Evan Li) → 跨 007/015/023 三个批次
      name: "李娜",
      bdManager: "李晓明 (Evan Li)",
      participations: [
        { batchIndex: 6, investmentAmount: 78200.0, signOffsetDays: 1, signOffsetHours: 15 },
        { batchIndex: 14, investmentAmount: 236500.0, signOffsetDays: 3, signOffsetHours: 9 },
        { batchIndex: 22, investmentAmount: 45800.30, signOffsetDays: 6, signOffsetHours: 14 },
      ],
    },
  ];

  for (const person of MULTI_BATCH_CLIENTS) {
    for (let p = 0; p < person.participations.length; p++) {
      const part = person.participations[p];
      const target = batches[part.batchIndex];
      if (!target) continue;
      const bRng = createSeededRandom(990000 + person.name.charCodeAt(0) + part.batchIndex * 17 + p);
      const batchSignDate = target.signDate;
      const clientSignDate = deterministicOffsetDate(
        batchSignDate,
        part.signOffsetDays,
        part.signOffsetHours ?? bRng.rand() * 18
      );
      const profitSplit = calculateProfitSplitRatio(part.investmentAmount, true);
      const nextIdx = target.clients.length;
      const clone: Client = {
        id: `client-mb-${MOCK_BASE_SEED}-${person.name}-${part.batchIndex}-${p}`,
        batchId: target.id,
        name: person.name,
        investmentAmount: part.investmentAmount,
        bdManager: person.bdManager,
        bdUserId: null,
        signDate: clientSignDate,
        profitSplitClient: profitSplit.client * 100,
        profitSplitInstitution: profitSplit.institution * 100,
        realtimePnL: 0,
        estimatedExitAmount: 0,
        status: ClientStatus.ACTIVE,
        settledAt: null,
        settlementNote: null,
        createdAt: clientSignDate,
        updatedAt: now,
      };
      target.clients.push(clone);
      const extraPriority = part.investmentAmount;
      const extraSubTotal = calculateInvestmentSplit(target.initialTotalAmount + extraPriority);
      target.initialTotalAmount = target.initialTotalAmount + extraPriority;
      target.priorityAmount = extraSubTotal.priorityAmount;
      target.subordinateAmount = extraSubTotal.subordinateAmount;
      target.totalShares = calculateTotalShares(target.initialTotalAmount, target.stockPriceAtStart);
      target.currentMarketValue = calculateCurrentMarketValue(
        target.stockPriceAtStart,
        Number(target.currentStockPrice),
        target.totalShares
      );
      const reMetrics = calculateBatchRiskMetrics(
        target.initialTotalAmount,
        target.currentMarketValue,
        target.cumulativeMarginCalls
      );
      target.totalPnL = reMetrics.totalPnL;
      target.totalPnLPercent = reMetrics.totalPnLPercent;
      target.riskLevel = reMetrics.riskLevel;
      void nextIdx;
    }
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

// Keep the previous multi-symbol ledger untouched; never import it into XMAX fixtures.
export const FINANCE_STORE_KEY = "risk_control_finance_xmax_v1";
type FinanceRecord = { fingerprint: string; clientFingerprints?: Record<string, string>; batch: BatchLike };
type FinanceStore = Record<string, FinanceRecord>;

/** Explicit local-development operation; never invoked by normal data loading. */
export function resetMockTestData(): { batches: number; clients: number; backupKey: string } {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    throw new Error("仅允许在本地开发预览中重置测试数据。");
  }
  const keys = [FINANCE_STORE_KEY, MOCK_PERSIST_KEY, "risk_control_client_status_v1",
    "risk_control_xmax_notifications_v1", "risk_control_xmax_alert_ack_v1"];
  const storage = window.localStorage;
  const backup = Object.fromEntries(keys.map((key) => [key, storage.getItem(key)]));
  const backupKey = `risk_control_test_backup_${Date.now()}`;
  const fresh = generateMockData();
  const store: FinanceStore = {};
  const previous = readFinanceStore();
  for (const batch of fresh.batches) {
    initializeBatchFinance(batch);
    const finance = (batch as BatchLike).finance!;
    if (finance.legacyWarnings.length) throw new Error("新测试数据校验失败，旧账本未修改。");
    // Old tabs must fail the revision check rather than reintroduce the old ledger.
    finance.revision = Math.max(Date.now(), (previous[batch.id]?.batch.finance?.revision ?? 0) + 1);
    reviveBatch(batch);
    store[batch.id] = financeRecord(batch);
  }
  // 保留用户通过「创建批次」对话框新增的非经典批次（不在基础 12 条测试数据中）
  const canonicalIds = new Set(fresh.batches.map((b) => b.id));
  for (const [id, record] of Object.entries(previous)) {
    if (canonicalIds.has(id)) continue;
    if (!record || typeof record !== "object") continue;
    const rec = record as any;
    if (!rec?.batch || !rec.fingerprint) continue;
    const revived = reviveBatch(structuredClone(rec.batch)) as typeof fresh.batches[number];
    if (!revived || typeof revived !== "object") continue;
    try { syncBatchFinance(revived); } catch { /* ignore */ }
    const batchLike = revived as BatchLike;
    if (batchLike.finance) {
      batchLike.finance.revision = Math.max(Date.now(), (batchLike.finance.revision ?? 0) + 1);
    }
    store[id] = financeRecord(revived);
    fresh.batches.push(revived);
  }
  // Both writes precede removal. A quota failure cannot destroy the old active ledger.
  storage.setItem(backupKey, JSON.stringify({ createdAt: new Date().toISOString(), records: backup }));
  storage.setItem(FINANCE_STORE_KEY, JSON.stringify(store));
  for (const key of keys.slice(1)) storage.removeItem(key);
  resetClientNoAllocator();
  lastClientNoAllocator = ensureClientNosOnBatches(fresh.batches);
  cachedMockData = fresh;
  window.dispatchEvent(new CustomEvent("risk-control:finance-changed"));
  window.dispatchEvent(new CustomEvent("risk-control:notifications-changed"));
  return { batches: fresh.batches.length,
    clients: fresh.batches.reduce((sum, batch) => sum + batch.clients.length, 0), backupKey };
}

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

/**
 * 开发环境遇到批次身份升级（客户数/批次数量变化导致 fingerprint 不匹配）时，
 * 自动备份旧账本并生成新的一套 12 批次测试数据，避免首页硬崩。
 * - 仅在 NODE_ENV=development 生效；
 * - 若旧账本中存在已实际结算 (settlements)、或任何补仓已 fulfilled (fulfilledAmount>0)、
 *   或存在非 legacy 的真实交易 (trades.some(t.source!=='legacy'))，则视为真实账目资料，拒绝自动覆盖。
 * 返回 didReset=true 时调用方应清缓存并重新加载 mock data。
 */
export function tryAutoUpgradeTestLedger(): { didReset: boolean; backupKey?: string; reason?: string } {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "development") return { didReset: false };
  const store: Record<string, unknown> = (() => {
    try { return JSON.parse(window.localStorage.getItem(FINANCE_STORE_KEY) || "{}"); } catch { return {}; }
  })();
  const existing = Object.values(store);
  if (!existing.length) return { didReset: false };
  const looksPristine = existing.every((entry: any) => {
    const finance = entry?.batch?.finance;
    if (!finance) return true;
    // 没有任何客户结算
    if (Object.keys(finance.settlements ?? {}).length) return false;
    // 所有补仓轮次均未实际 fulfilled（也就是说从来没真正做过机构补仓记账）
    if ((finance.rounds ?? []).some((r: any) => Number(r.fulfilledAmount ?? 0) > 0.005)) return false;
    // 没有任何非 legacy 的手动记账交易
    if ((finance.trades ?? []).some((t: any) => (t.source ?? "legacy") !== "legacy")) return false;
    return true;
  });
  if (!looksPristine) {
    return { didReset: false, reason: "存在真实结算/补仓记录，拒绝自动覆盖。请联系管理员核对账本。" };
  }
  try {
    const { backupKey } = resetMockTestData();
    return { didReset: true, backupKey };
  } catch (e) {
    return { didReset: false, reason: e instanceof Error ? e.message : "重置失败" };
  }
}

export function getMockData(): MockDataSet {
  if (!cachedMockData) {
    const loaded = generateMockData();
    const store = readFinanceStore();
    let autoResetHandled = false;
    for (const batch of loaded.batches) {
      const saved = store[batch.id];
      if (saved) {
        if (saved.fingerprint !== batchFingerprint(batch) || saved.batch.finance?.version !== 2) {
          if (!autoResetHandled) {
            const upgrade = tryAutoUpgradeTestLedger();
            if (upgrade.didReset) {
              cachedMockData = null;
              return getMockData();
            }
          }
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
    // 账本中存在但不在基础测试批次列表中的用户创建的新批次（如管理员通过创建批次对话框新增）
    if (typeof window !== "undefined") {
      const existingIds = new Set(loaded.batches.map((b) => b.id));
      for (const [id, record] of Object.entries(store)) {
        if (existingIds.has(id)) continue;
        if (!record || typeof record !== "object") continue;
        const rec = record as any;
        if (!rec.batch || !rec.fingerprint) continue;
        const extra = reviveBatch(structuredClone(rec.batch)) as typeof loaded.batches[number];
        if (extra && typeof extra === "object") {
          try { syncBatchFinance(extra); } catch { /* ignore */ }
          loaded.batches.push(extra);
          existingIds.add(id);
        }
      }
    }
    // Persist initial round IDs once so concurrent tabs refer to the same obligations.
    if (typeof window !== "undefined") {
      for (const batch of loaded.batches) {
        if (!store[batch.id]) store[batch.id] = financeRecord(batch);
      }
      const serialized = JSON.stringify(store);
      if (window.localStorage.getItem(FINANCE_STORE_KEY) !== serialized) {
        window.localStorage.setItem(FINANCE_STORE_KEY, serialized);
      }
    }
    resetClientNoAllocator();
    lastClientNoAllocator = ensureClientNosOnBatches(loaded.batches);
    cachedMockData = loaded;
  } else {
    if (!lastClientNoAllocator) {
      // 缓存中已加载但此前未经过 ensureClientNos（例如跨 tab 事件），补齐编号。
      lastClientNoAllocator = ensureClientNosOnBatches(cachedMockData.batches);
    }
  }
  return cachedMockData;
}

/** Re-read the persisted ledger after explicit refresh or a cross-tab storage event. */
export function reloadMockData(): MockDataSet {
  cachedMockData = null;
  resetClientNoAllocator();
  return getMockData();
}

export function refreshMockDataPrices(): MockDataSet {
  const nyse = getNYSEInfo();
  if (!nyse.shouldBreathe) {
    return getMockData();
  }
  const data = getMockData();
  const now = new Date();
  const symbolsQueried = new Set<string>();
  data.batches.forEach((b) => {
    const sym = (b.stockSymbol || "").trim().toUpperCase();
    if (sym) symbolsQueried.add(sym);
  });
  const symbolArray = Array.from(symbolsQueried);
  if (!(symbolArray.length > 0 && typeof window !== "undefined")) {
    return data;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2800);
  (async () => {
    const quotes = new Map<string, { price: number; changePercent: number }>();
    try {
      for (const sym of symbolArray) {
        try {
          const res = await fetch(`/api/quote/realtime?symbol=${encodeURIComponent(sym)}`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });
          if (!res.ok) continue;
          const d: any = await res.json();
          if (!d || d.error) continue;
          const price = Number(d.price);
          const changePct = Number(d.changePct);
          if (Number.isFinite(price) && price > 0 && Number.isFinite(changePct)) {
            quotes.set(sym, { price: Number(price.toFixed(2)), changePercent: Number(changePct.toFixed(2)) });
          }
        } catch {}
      }
    } finally {
      clearTimeout(timeout);
    }
    if (quotes.size === 0) return;
    const latest = getMockData();
    const dispatchedIds: string[] = [];
    for (const batch of latest.batches) {
      if (!batch.currentStockPrice) continue;
      const sym = (batch.stockSymbol || "").trim().toUpperCase();
      const found = sym ? quotes.get(sym) : null;
      if (!found) continue;
      const newPrice = found.price;
      const newChg = found.changePercent;
      if (Math.abs(newPrice - batch.currentStockPrice) <= 1e-6 && Math.abs(newChg - (batch.currentDayChange ?? 0)) <= 1e-6) {
        continue;
      }
      try {
        commitBatchFinance(batch, (draft) => {
          draft.currentStockPrice = newPrice;
          draft.currentDayChange = newChg;
          draft.updatedAt = now;
          syncBatchFinance(draft);
        });
        dispatchedIds.push(batch.id);
      } catch {}
    }
  })();
  return data;
}

export interface NewBatchInput {
  batchNumber?: string;
  stockSymbol?: string;
  stockName?: string;
  signDate?: string | Date;
  initialTotalAmount?: number;
  maturityDate?: string | Date;
  startingDropPercent?: number;
  currentStockPrice?: number;
  status?: BatchStatus;
}

/**
 * 管理员级创建一个全新批次（空批次，无客户），仅用于新增批次操作；
 * 权限判断放在调用方（客户端）校验：仅 ADMIN / RISK_MANAGER / OPERATIONS 才能调用本函数。
 * 完成后会持久化到账本 & 触发 reloadMockData()，并派发 "risk-control:finance-changed"。
 */
export function createNewBatch(input: NewBatchInput): (Batch & { clients: Client[]; marginCalls: MarginCall[] }) {
  if (typeof window === "undefined") {
    throw new Error("请在已登录的浏览器页面中创建批次。");
  }
  const now = new Date();
  const existing = getMockData();
  const stockSymbol = (input.stockSymbol || "XMAX").trim().toUpperCase() || "XMAX";
  const stockName = (input.stockName || stockSymbol).trim() || stockSymbol;
  const maxNum = existing.batches.reduce((m, b) => {
    const m2 = String(b.batchNumber || "").match(/-(\d{3})$/);
    if (!m2) return m;
    return Math.max(m, Number(m2[1] || 0));
  }, 0);
  const nextNum = Math.max(maxNum + 1, existing.batches.length + 1);
  const numPad = String(nextNum).padStart(3, "0");
  const batchNumber = (input.batchNumber || `BATCH-${input.signDate ? new Date(input.signDate).getUTCFullYear() : 2026}-${numPad}`).trim();
  const signDate = input.signDate ? new Date(input.signDate) : new Date();
  const maturity = (() => {
    if (input.maturityDate) return new Date(input.maturityDate);
    const d = new Date(Date.UTC(signDate.getUTCFullYear(), signDate.getUTCMonth(), signDate.getUTCDate()));
    d.setUTCFullYear(d.getUTCFullYear() + 2);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  })();
  const initialTotalAmount = Math.max(1, Number(input.initialTotalAmount) || 1);
  const split = calculateInvestmentSplit(initialTotalAmount);
  const stockBasePrice = (() => {
    if (Number(input.currentStockPrice) > 0) return Number(input.currentStockPrice);
    if (typeof STOCKS?.[0]?.basePrice === "number" && STOCKS[0].basePrice > 0) return STOCKS[0].basePrice;
    return 10;
  })();
  const dropPercent = Number.isFinite(Number(input.startingDropPercent)) ? Number(input.startingDropPercent) : 0;
  const stockPriceAtStart = Number((stockBasePrice / (1 - dropPercent)).toFixed(4));
  const currentStockPrice = stockBasePrice;
  const totalShares = calculateTotalShares(initialTotalAmount, stockPriceAtStart);
  const currentMarketValue = calculateCurrentMarketValue(stockPriceAtStart, currentStockPrice, totalShares);
  const metrics = calculateBatchRiskMetrics(initialTotalAmount, currentMarketValue, 0);
  const tradingInfo = calculateTradingWindows(signDate);
  let status: BatchStatus;
  if (input.status && Object.values(BatchStatus).includes(input.status)) status = input.status as BatchStatus;
  else if (tradingInfo.monthsElapsed >= 24) status = BatchStatus.CLOSED;
  else if (tradingInfo.isLocked) status = BatchStatus.LOCKED;
  else status = BatchStatus.TRADING_OPEN;
  const id = `batch-${signDate.getUTCFullYear()}-${numPad}-${Math.random().toString(36).slice(2, 8)}`;
  const newBatch: Batch & { clients: Client[]; marginCalls: MarginCall[] } = {
    id,
    batchNumber,
    stockSymbol,
    stockName,
    stockPriceAtStart,
    currentStockPrice,
    currentDayChange: 0,
    initialTotalAmount,
    priorityAmount: split.priorityAmount,
    subordinateAmount: split.subordinateAmount,
    signDate,
    maturityDate: maturity,
    totalShares,
    currentMarketValue,
    totalPnL: metrics.totalPnL,
    totalPnLPercent: metrics.totalPnLPercent,
    cumulativeMarginCalls: 0,
    status,
    riskLevel: metrics.riskLevel,
    nextTradingWindow: tradingInfo.nextTradingDate,
    clients: [],
    marginCalls: [],
    createdAt: now,
    updatedAt: now,
    // 兼容 Prisma Batch 字段，若未定义则填默认值：
  } as any;
  // 持久化到账本
  const store = readFinanceStore();
  initializeBatchFinance(newBatch);
  (newBatch as any).finance.revision = 1;
  store[newBatch.id] = financeRecord(newBatch);
  window.localStorage.setItem(FINANCE_STORE_KEY, JSON.stringify(store));
  // 合并现有批次列表并刷新缓存
  cachedMockData = null;
  const fresh = getMockData();
  window.dispatchEvent(new CustomEvent("risk-control:finance-changed", { detail: { batchId: newBatch.id, op: "createBatch" } }));
  return fresh.batches.find((b) => b.id === newBatch.id) || newBatch;
}

