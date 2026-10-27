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
  HISTORICAL_HALF_YEAR_PRICE_SERIES,
  RECOMMENDED_BATCH_SIGN_DATES,
  LATEST_SNAPSHOT_PRICE,
} from "./historical-price-series";
import {
  calculateBatchRiskMetrics,
  calculateInvestmentSplit,
  calculateProfitSplitRatio,
  calculateTotalShares,
  calculateCurrentMarketValue,
  initializeBatchFinance,
  syncBatchFinance,
  settleClientPosition,
  requestClientExit,
  getClientPositionMetrics,
  calculateContractDates,
  getMarginRoundDueDate,
  NOTICE_PERIOD_DAYS,
  SUBORDINATE_RATIO,
  PRIORITY_RATIO,
  type BatchLike,
} from "./riskEngine";
import { mergeClientStatusOnClient } from "./clientStatusStore";
import { getNYSEInfo, LIVE_QUOTE_SETTINGS_KEY } from "./liveQuote";
import { calculateTradingWindows } from "./utils";
import { beginAuditCapture, endAuditCapture, logAudit } from "./auth/audit";
import type { WorkspaceCommitMeta } from "./workspaceStore";
import {
  bootstrapWorkspace,
  clearWorkspace,
  deleteWorkspaceRecords,
  flushWorkspaceWrites,
  isWorkspaceHydrated,
  isWorkspaceWriteBlocked,
  readWorkspaceKind,
  readWorkspaceRecord,
  registerWorkspaceInvalidator,
  upsertWorkspaceRecord,
} from "./workspaceStore";

const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export class RevisionMismatchError extends Error {
  override name = "RevisionMismatchError";
  readonly batchId?: string;
  constructor(batchId?: string, message?: string) {
    super(message ?? "此批次已在其他页面更新，请刷新后重新确认。");
    this.batchId = batchId;
  }
}

export interface MockDataSet {
  batches: (Batch & { clients: Client[]; marginCalls: MarginCall[] })[];
  stockHistory: StockHistory[];
}

// Scenario quote only, not a live market price. Actual symbol comes from settings.
const STOCKS = [{ symbol: "XMAX", name: "XMAX Corp.", basePrice: 10 }];

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

/**
 * Phase 4: 生成中阳证券子账号编号。
 * 规则：每个「客户 × 批次」= 一个独立子账户，子账号 = ZY + 客户编号（去掉 C 前缀）。
 * 例如 clientNo = C2600001 → subAccountNo = ZY2600001。
 * 由于 clientNo 已全局唯一，subAccountNo 天然唯一。
 */
export function formatSubAccountNo(clientNo: string | null | undefined): string {
  if (!clientNo) return "";
  const clean = String(clientNo).trim();
  const withoutPrefix = clean.replace(/^C/i, "");
  return `ZY${withoutPrefix}`;
}

/**
 * Phase 4: 为缺失 subAccountNo 的客户回填中阳证券子账号编号。
 * 必须在 ensureClientNosOnBatches 之后调用。
 */
export function ensureSubAccountNosOnBatches(
  batches: Array<Batch & { clients?: Client[] }>,
): void {
  for (const b of batches) {
    for (const c of b.clients ?? []) {
      const existing = (c as any).subAccountNo as string | null | undefined;
      if (existing) continue;
      const no = (c as any).clientNo as string | null | undefined;
      const sa = formatSubAccountNo(no);
      if (sa) (c as any).subAccountNo = sa;
    }
  }
}

/** 新增客户时生成下一个子账号编号（与 clientNo 同步）。 */
export function nextSubAccountNo(clientNo: string): string {
  return formatSubAccountNo(clientNo);
}

/** 当缓存被刷新时同步重置编号分配器，避免序号复用冲突。 */
function resetClientNoAllocator() { lastClientNoAllocator = null; }

export function generateMockData(): MockDataSet {
  const now = new Date();
  const nowTs = now.getTime();
  const batches: (Batch & { clients: Client[]; marginCalls: MarginCall[] })[] = [];
  const stockHistory: StockHistory[] = [];

  // ===== 根据真实历史价格，快速查找 signDate 对应 close =====
  const priceLookup = new Map<string, number>();
  for (const [d, close] of HISTORICAL_HALF_YEAR_PRICE_SERIES) priceLookup.set(d, close);
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
    return priceLookup.get(best) ?? LATEST_SNAPSHOT_PRICE;
    void targetTs;
  };

  // 当前最新价：所有批次共享
  const currentStockPrice = LATEST_SNAPSHOT_PRICE;

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

    // 入场价 = signDate 当日真实收盘价（历史行情回查）— 提前到客户循环前，用于算持股数
    const stockPriceAtStart = Number(findClosestClose(signDateISO).toFixed(4));

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
        clientNo: null,
        subAccountNo: null,
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
        sharesHeld: stockPriceAtStart > 0 ? investmentAmount / stockPriceAtStart : 0,
        avgCostPrice: stockPriceAtStart,
        brokerAccount: `ZY-${clientRng.int(10000000, 99999999)}`,
        exitRequestedAt: null,
        exitEligibleAt: null,
        earlyExitFee: null,
        exitAmount: null,
        createdAt: clientSignDate,
        updatedAt: now,
      });
    }

    const initialTotalAmount = initialTotalAmountCents / 100;
    const split = calculateInvestmentSplit(initialTotalAmount);

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
        triggerDate: callDate,
        triggerMarketValue: prelimMetrics.currentMarketValue,
        dropPercent: prelimMetrics.dropPercent,
        requiredAmount: Number(prelimMetrics.requiredMarginCall.toFixed(2)),
        fulfilledAmount: m === cumulativeMarginCalls - 1 ? 0 : Number(prelimMetrics.requiredMarginCall.toFixed(2)),
        fulfilledDate: m === cumulativeMarginCalls - 1 ? null : callDate,
        status: m === cumulativeMarginCalls - 1 ? "PENDING" : "FULLFILLED",
        dueDate: new Date(getMarginRoundDueDate(callDate)),
        collateralType: "stock",
        note: null,
        notifiedEmails: null,
        notifiedWhatsApps: null,
        createdAt: callDate,
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

    // 协议要素表 V2：期限节点
    const contractDates = calculateContractDates(signDate);
    // WIN100 担保品：按 3:7 比例买入 XMAX，市值 = 客户股票市值 × 3/7
    const win100CollateralValue = money(split.priorityAmount * SUBORDINATE_RATIO / PRIORITY_RATIO);
    const win100CollateralShares = stockPriceAtStart > 0 ? win100CollateralValue / stockPriceAtStart : 0;

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
      custodianBroker: "中阳证券有限公司",
      lockUpEndDate: contractDates.lockUpEndDate,
      exitWindowMonths: contractDates.exitWindowMonths,
      noticePeriodDays: contractDates.noticePeriodDays,
      finalMaturityDate: contractDates.finalMaturityDate,
      win100CollateralValue,
      win100CollateralShares,
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
      const entryPrice = target.stockPriceAtStart;
      const clone: Client = {
        id: `client-mb-${MOCK_BASE_SEED}-${person.name}-${part.batchIndex}-${p}`,
        clientNo: null,
        subAccountNo: null,
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
        sharesHeld: entryPrice > 0 ? part.investmentAmount / entryPrice : 0,
        avgCostPrice: entryPrice,
        brokerAccount: `ZY-${bRng.int(10000000, 99999999)}`,
        exitRequestedAt: null,
        exitEligibleAt: null,
        earlyExitFee: null,
        exitAmount: null,
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
      // 重新计算 WIN100 担保品（按 3:7）
      target.win100CollateralValue = money(target.priorityAmount * SUBORDINATE_RATIO / PRIORITY_RATIO);
      target.win100CollateralShares = target.stockPriceAtStart > 0 ? target.win100CollateralValue / target.stockPriceAtStart : 0;
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

  // ===== 历史批次模拟结算：BATCH-2026-001 / -002 / -003 中约 30% 客户 SETTLED =====
  const settleRng = createSeededRandom(2609261542);
  const priceLookupHist = new Map<string, number>();
  for (const [d, close] of HISTORICAL_HALF_YEAR_PRICE_SERIES) priceLookupHist.set(d, close);
  const sortedHist = Array.from(priceLookupHist.keys()).sort();
  const histFind = (ts: number): number => {
    let best = sortedHist[0];
    for (const d of sortedHist) {
      const dTs = new Date(d + "T00:00:00.000Z").getTime();
      if (dTs <= ts) best = d;
      else break;
    }
    return priceLookupHist.get(best)!;
  };
  for (let bIdx = 0; bIdx < Math.min(3, batches.length); bIdx++) {
    const b = batches[bIdx] as BatchLike;
    initializeBatchFinance(b);
    const f = b.finance;
    if (f) {
      f.legacyWarnings = [];
      for (const r of f.rounds) { if (r.status === "PENDING") { r.status = "FULLFILLED"; r.fulfilledAmount = r.requiredAmount; } }
      for (const t of f.trades) { t.needsReconciliation = false; }
    }
    const sortedClients = [...(b.clients || [])].sort((a, c) => new Date(a.signDate).getTime() - new Date(c.signDate).getTime());
    const settleRatio = [0.38, 0.32, 0.26][bIdx] ?? 0.3;
    const targetNum = Math.max(2, Math.round(sortedClients.length * settleRatio));
    const chosen = new Set<string>();
    for (let ci = 0; ci < targetNum && ci < sortedClients.length; ci++) {
      const c = sortedClients[ci];
      chosen.add(c.id);
    }
    for (let ci = sortedClients.length - 1; chosen.size < targetNum && ci >= 0; ci--) {
      chosen.add(sortedClients[ci].id);
    }
    let settledCount = 0;
    const clientList = b.clients ?? [];
    for (const client of clientList) {
      if (!chosen.has(client.id)) continue;
      const cSignTs = new Date(client.signDate).getTime();
      const matureTs = cSignTs + (30 + settleRng.int(0, 35)) * 86400000;
      const effectiveSettleTs = Math.min(matureTs, nowTs);
      const settlePrice = Number(histFind(effectiveSettleTs).toFixed(4));
      if (!(settlePrice > 0)) { console.log("[mock settle] skip no price", client.name, effectiveSettleTs); continue; }
      const origPrice = Number(b.currentStockPrice ?? 0);
      (b as any).currentStockPrice = settlePrice;
      try {
        // Phase 3：结算前必须先提交退出申请；此处将申请时间回拨至通知期已过，还原历史退出流程
        requestClientExit(b, client.id, { operatorName: "SYSTEM_MOCK", reason: "历史批次模拟退出" });
        client.exitRequestedAt = new Date(effectiveSettleTs - NOTICE_PERIOD_DAYS * 86400000);
        client.exitEligibleAt = new Date(effectiveSettleTs);
        settleClientPosition(b, client.id, { operatorName: "SYSTEM_MOCK" });
        settledCount++;
      } catch (settleErr: any) {
        console.log("[mock settle] fail", b.id, client.name, "price=", settlePrice, "entry=", client.entryStockPrice ?? b.stockPriceAtStart, "err=", settleErr?.message ?? settleErr);
        (b as any).currentStockPrice = origPrice;
        continue;
      }
      (b as any).currentStockPrice = origPrice;
    }
    console.log("[mock settle] batch", b.id, "chosen=", chosen.size, "settled=", settledCount, "/", clientList.length);
    syncBatchFinance(b);
    const reMetrics = calculateBatchRiskMetrics(
      b.initialTotalAmount,
      calculateCurrentMarketValue(b.stockPriceAtStart, Number(b.currentStockPrice), b.totalShares),
      b.cumulativeMarginCalls ?? 0
    );
    (b as any).totalPnL = reMetrics.totalPnL;
    (b as any).totalPnLPercent = reMetrics.totalPnLPercent;
    (b as any).riskLevel = reMetrics.riskLevel;
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

/** 本地镜像读取补仓补丁（仅用于未同步环境与离线兜底）。 */
function readLocalPatches(): MockPatches {
  const empty: MockPatches = { batches: {}, persistedAt: new Date().toISOString() };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(MOCK_PERSIST_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as MockPatches;
    return parsed && typeof parsed.batches === "object" ? parsed : empty;
  } catch {
    return empty;
  }
}

/** 逐批读取补仓补丁表：工作区已就绪时以服务端为准，否则读本地镜像。 */
function readAllBatchPatches(): Record<string, BatchPatch> {
  if (typeof window === "undefined") return {};
  if (isWorkspaceHydrated()) return readWorkspaceKind<BatchPatch>("patches");
  return readLocalPatches().batches;
}

function readPatches(): MockPatches | null {
  const batches = readAllBatchPatches();
  if (Object.keys(batches).length === 0) return null;
  return { batches, persistedAt: new Date().toISOString() };
}

/** 写入单批补丁：工作区已就绪时落库并多端共享，同时写本地镜像。 */
function writePatchForBatch(batchId: string, patch: BatchPatch): void {
  if (typeof window === "undefined") return;
  if (isWorkspaceHydrated()) upsertWorkspaceRecord("patches", batchId, patch);
  try {
    const mirror = readLocalPatches();
    mirror.batches[batchId] = patch;
    mirror.persistedAt = new Date().toISOString();
    window.localStorage.setItem(MOCK_PERSIST_KEY, JSON.stringify(mirror));
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
  const allPatches = readAllBatchPatches();
  const bp: BatchPatch = allPatches[batchId]
    ? structuredClone(allPatches[batchId])
    : { clients: {} };
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
  writePatchForBatch(batchId, bp);
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
  const allPatches = readAllBatchPatches();
  const bp: BatchPatch = allPatches[batchId]
    ? structuredClone(allPatches[batchId])
    : { clients: {} };
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
  writePatchForBatch(batchId, bp);
}

export function clearMockMarginPatches(): void {
  if (typeof window === "undefined") return;
  if (isWorkspaceHydrated()) deleteWorkspaceRecords("patches");
  try {
    window.localStorage.removeItem(MOCK_PERSIST_KEY);
  } catch {
    /* ignore */
  }
}

let cachedMockData: MockDataSet | null = null;

// Keep the previous multi-symbol ledger untouched; never import it into single-symbol fixtures.
// Migration: old key risk_control_finance_xmax_v1 -> new key risk_control_finance_v1 (symbol-agnostic)
export const FINANCE_STORE_KEY_LEGACY: string = "risk_control_finance_xmax_v1";
export const FINANCE_STORE_KEY: string = "risk_control_finance_v1";
type FinanceRecord = { fingerprint: string; clientFingerprints?: Record<string, string>; batch: BatchLike };
type FinanceStore = Record<string, FinanceRecord>;

/** Explicit local-development operation; never invoked by normal data loading. */
export function resetMockTestData(): { batches: number; clients: number; backupKey: string } {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    throw new Error("仅允许在本地开发预览中重置测试数据。");
  }
  const keys = [FINANCE_STORE_KEY, FINANCE_STORE_KEY_LEGACY, LIVE_QUOTE_SETTINGS_KEY, MOCK_PERSIST_KEY, "risk_control_client_status_v1",
    "risk_control_notifications_v1", "risk_control_xmax_notifications_v1", "risk_control_alert_ack_v1", "risk_control_xmax_alert_ack_v1"];
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
  // 工作区已就绪（浏览器多端环境）时，把重建后的账本同步到服务端，保证各端一致。
  if (isWorkspaceHydrated()) {
    const entries = Object.entries(store).map(([key, payload]) => ({ kind: "ledger" as const, key, payload }));
    void (async () => {
      try {
        await clearWorkspace(["ledger", "patches", "client_status"], { markEmpty: false });
        await bootstrapWorkspace(entries);
        await flushWorkspaceWrites();
      } catch {
        /* ignore */
      }
    })();
  }
  resetClientNoAllocator();
  lastClientNoAllocator = ensureClientNosOnBatches(fresh.batches);
  cachedMockData = fresh;
  window.dispatchEvent(new CustomEvent("risk-control:finance-changed"));
  window.dispatchEvent(new CustomEvent("risk-control:notifications-changed"));
  return { batches: fresh.batches.length,
    clients: fresh.batches.reduce((sum, batch) => sum + batch.clients.length, 0), backupKey };
}

/**
 * 业务数据清空标记。置位后账本以空数据启动，不再载入演示批次与客户。
 * 仅由后台「清空所有业务数据」入口写入或清除。
 */
export const EMPTY_LEDGER_KEY: string = "risk_control_empty_ledger_v1";

/** 账本是否已处于清空状态（不含任何批次与客户）。 */
export function isLedgerEmpty(): boolean {
  if (typeof window === "undefined") return false;
  if (isWorkspaceHydrated()) {
    const rec = readWorkspaceRecord<{ empty?: boolean }>("meta", "empty");
    return rec?.payload?.empty === true;
  }
  try {
    return window.localStorage.getItem(EMPTY_LEDGER_KEY) === "1";
  } catch {
    return false;
  }
}

/** 清空后需一并移除的派生数据键（批次/客户/补仓/结算/提醒记录）。 */
const BUSINESS_DATA_KEYS: string[] = [
  FINANCE_STORE_KEY,
  FINANCE_STORE_KEY_LEGACY,
  MOCK_PERSIST_KEY,
  "risk_control_client_status_v1",
  "risk_control_notifications_v1",
  "risk_control_xmax_notifications_v1",
  "risk_control_alert_ack_v1",
  "risk_control_xmax_alert_ack_v1",
  "risk_control_price_history",
];

/**
 * 清空全部业务数据（批次、客户、补仓与结算记录），并把系统切换为空账本启动。
 * 执行前先把当前数据整体备份到 localStorage，再清空服务端工作区；
 * 服务端清空失败时不改动本地数据，避免出现半清空状态。
 */
export async function clearAllBusinessData(): Promise<{ batches: number; clients: number; backupKey: string }> {
  if (typeof window === "undefined") throw new Error("请在已登录的浏览器中执行该操作。");
  const storage = window.localStorage;
  let batchCount = 0;
  let clientCount = 0;
  try {
    const records = Object.values(readFinanceStore());
    batchCount = records.length;
    clientCount = records.reduce((sum, r) => sum + (r?.batch?.clients?.length ?? 0), 0);
  } catch {
    batchCount = 0;
    clientCount = 0;
  }
  const backupKey = `risk_control_cleared_backup_${Date.now()}`;
  const backup = Object.fromEntries(BUSINESS_DATA_KEYS.map((key) => [key, storage.getItem(key)]));
  // 先落备份，任一步抛错都不会丢失原始数据。
  storage.setItem(backupKey, JSON.stringify({ createdAt: new Date().toISOString(), records: backup }));
  // 服务端为唯一事实来源：先清空工作区（批次/补仓/客户状态），由服务端置位空账本标记。
  if (isWorkspaceHydrated()) {
    const ok = await clearWorkspace(["ledger", "patches", "client_status"]);
    if (!ok) throw new Error("清空失败，请检查网络后重试。");
    await flushWorkspaceWrites();
  }
  // 本地镜像与派生键清理。
  storage.setItem(FINANCE_STORE_KEY, JSON.stringify({}));
  storage.setItem(EMPTY_LEDGER_KEY, "1");
  for (const key of BUSINESS_DATA_KEYS.slice(1)) storage.removeItem(key);
  resetClientNoAllocator();
  lastClientNoAllocator = ensureClientNosOnBatches([]);
  cachedMockData = null;
  window.dispatchEvent(new CustomEvent("risk-control:finance-changed"));
  window.dispatchEvent(new CustomEvent("risk-control:notifications-changed"));
  return { batches: batchCount, clients: clientCount, backupKey };
}

function batchFingerprint(batch: BatchLike): string {
  return `${batch.id}|${batch.stockSymbol}|${batch.stockPriceAtStart}`;
}

/**
 * 旧版运行态快照判别：记录里没有任何真实结算、没有任何实际到账的补仓轮次、
 * 也没有非 legacy 的手动记账交易时，说明这份账本只是历史版本的演示快照，
 * 不代表任何真实资金动作。
 */
function isPristineLedgerRecord(record: unknown): boolean {
  const finance = (record as any)?.batch?.finance;
  if (!finance) return true;
  // 没有任何客户结算
  if (Object.keys(finance.settlements ?? {}).length) return false;
  // 所有补仓轮次均未实际 fulfilled（也就是说从来没真正做过机构补仓记账）
  if ((finance.rounds ?? []).some((r: any) => Number(r.fulfilledAmount ?? 0) > 0.005)) return false;
  // 没有任何非 legacy 的手动记账交易
  if ((finance.trades ?? []).some((t: any) => (t.source ?? "legacy") !== "legacy")) return false;
  return true;
}

/** 两份批次是否包含完全相同的客户集合（用于判断快照可否整体替换）。 */
function sameClientIds(a: BatchLike, b: BatchLike): boolean {
  const idsA = (a.clients ?? []).map((c) => c.id).sort();
  const idsB = (b.clients ?? []).map((c) => c.id).sort();
  return idsA.length === idsB.length && idsA.every((id, i) => id === idsB[i]);
}

function financeRecord(batch: BatchLike): FinanceRecord {
  return {
    fingerprint: batchFingerprint(batch),
    clientFingerprints: Object.fromEntries((batch.clients ?? []).map((c) => [c.id, clientFingerprint(c, c.initialInvestment ?? c.investmentAmount)])),
    batch,
  };
}

function migrateFinanceStoreIfNeeded(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem(FINANCE_STORE_KEY_LEGACY);
    if (!legacy) return;
    const current = window.localStorage.getItem(FINANCE_STORE_KEY);
    if (!current) {
      window.localStorage.setItem(FINANCE_STORE_KEY, legacy);
    }
    window.localStorage.removeItem(FINANCE_STORE_KEY_LEGACY);
  } catch {}
}

/**
 * 读取资金账本。
 * 工作区已就绪时以服务端数据为准（多端共享同一账本）；
 * 未就绪时（如本地校验脚本、登录前）回退本地镜像。
 */
function readFinanceStore(): FinanceStore {
  if (typeof window === "undefined") return {};
  if (isWorkspaceHydrated()) {
    return readWorkspaceKind<FinanceRecord>("ledger");
  }
  migrateFinanceStoreIfNeeded();
  const raw = window.localStorage.getItem(FINANCE_STORE_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("资金账本格式无效，请保留数据并联系管理员核对。");
  }
  return parsed;
}

/** 写入资金账本：工作区已就绪时逐批落库（多端共享），同时写本地镜像。 */
function writeFinanceRecords(
  store: FinanceStore,
  ids: string[],
  commit?: WorkspaceCommitMeta
): void {
  if (typeof window === "undefined") return;
  if (isWorkspaceHydrated()) {
    // 服务端不可写（未登录 / 会话失效 / 首次同步失败）时必须中止本次记账：
    // 只更新本地会让操作员看到「已入账」，而服务端账本没有这笔钱。
    if (isWorkspaceWriteBlocked()) {
      throw new Error("服务器暂时不可用，本次资金操作未入账。请刷新页面或稍后重试。");
    }
    for (const id of ids) {
      // 幂等键与审计意图只绑定单批次写入（多批次的每笔记账各自独立）。
      upsertWorkspaceRecord("ledger", id, store[id], ids.length === 1 ? commit : undefined);
    }
    // 服务端已接管持久化，本地镜像尽力而为，写失败不影响记账结果。
    try {
      window.localStorage.setItem(FINANCE_STORE_KEY, JSON.stringify(store));
    } catch {
      /* ignore quota */
    }
    return;
  }
  // 未同步环境（登录前 / 本地校验脚本）：本地存储即事实来源，写失败必须中止本次记账。
  try {
    window.localStorage.setItem(FINANCE_STORE_KEY, JSON.stringify(store));
  } catch {
    throw new Error("资金记录保存失败，本次操作未入账。请检查浏览器存储空间后重试。");
  }
  // 无服务端写入时，捕获到的审计仍走常规通道上报，避免审计丢失。
  if (commit?.audits?.length) {
    for (const a of commit.audits) {
      logAudit({ action: a.action as Parameters<typeof logAudit>[0]["action"], resource: a.resource, detail: a.detail });
    }
  }
}

function reviveBatch(batch: BatchLike): BatchLike {
  for (const key of ["signDate", "maturityDate", "createdAt", "updatedAt", "nextTradingWindow", "lockUpEndDate", "finalMaturityDate"] as const) {
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
    throw new RevisionMismatchError(batch.id);
  }
  const draft = reviveBatch(structuredClone(batch));
  // 变更期间捕获审计意图：随账本写入在同一服务端事务内提交，避免「记账成功、审计缺失」。
  beginAuditCapture();
  let result: T;
  try {
    result = mutate(draft);
  } catch (err) {
    // 变更函数抛错：本次未记账，捕获到的审计改走常规通道，避免审计丢失。
    for (const a of endAuditCapture()) {
      logAudit({ action: a.action, resource: a.resource, detail: a.detail });
    }
    throw err;
  }
  const audits = endAuditCapture();
  initializeBatchFinance(draft);
  const nextRevision = (batch.finance?.revision ?? 0) + 1;
  draft.finance!.revision = nextRevision;
  store[batch.id] = financeRecord(draft);
  try {
    writeFinanceRecords(store, [batch.id], {
      // 幂等键：同一次资金操作的网络重试携带同一 opId，服务端不重复记账。
      opId: `fin-${batch.id}-${nextRevision}-${Math.random().toString(36).slice(2, 10)}`,
      audits,
    });
  } catch (err) {
    for (const a of audits) {
      logAudit({ action: a.action, resource: a.resource, detail: a.detail });
    }
    throw err;
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
  migrateFinanceStoreIfNeeded();
  const store: Record<string, unknown> = (() => {
    try { return JSON.parse(window.localStorage.getItem(FINANCE_STORE_KEY) || "{}"); } catch { return {}; }
  })();
  const existing = Object.values(store);
  if (!existing.length) return { didReset: false };
  const looksPristine = existing.every((entry: any) => isPristineLedgerRecord(entry));
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
  // 已清空业务数据：只从账本读取管理员后续新建的批次，不再载入演示数据。
  if (typeof window !== "undefined" && isLedgerEmpty()) {
    if (!cachedMockData) {
      const empty: MockDataSet = { batches: [], stockHistory: [] };
      const store = readFinanceStore();
      const seen = new Set<string>();
      for (const [id, record] of Object.entries(store)) {
        const rec = record as any;
        if (!rec?.batch || !rec.fingerprint) continue;
        const revived = reviveBatch(structuredClone(rec.batch)) as typeof empty.batches[number];
        if (!revived || typeof revived !== "object") continue;
        try { syncBatchFinance(revived); } catch { /* ignore */ }
        empty.batches.push(revived);
        seen.add(id);
      }
      if (seen.size !== Object.keys(store).length && !isWorkspaceHydrated()) {
        // 丢弃无法还原的脏记录，避免每次加载重复尝试（仅本地镜像环境）
        const cleaned: FinanceStore = {};
        for (const key of seen) cleaned[key] = store[key];
        try { window.localStorage.setItem(FINANCE_STORE_KEY, JSON.stringify(cleaned)); } catch { /* ignore */ }
      }
      resetClientNoAllocator();
      lastClientNoAllocator = ensureClientNosOnBatches(empty.batches);
      ensureSubAccountNosOnBatches(empty.batches);
      cachedMockData = empty;
    }
    return cachedMockData;
  }
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
        // 演示夹具中的历史结算是测试数据的一部分。运行态账本若只是一份没有任何真实记账的旧快照，
        // 仍然整体覆盖会把已结算客户永久抹成「持仓中」，因此这里保留夹具结算后的批次并回写账本。
        const fixture = batch as BatchLike;
        if (
          isPristineLedgerRecord(saved) &&
          Object.keys(fixture.finance?.settlements ?? {}).length > 0 &&
          sameClientIds(fixture, saved.batch)
        ) {
          const previousRevision = saved.batch.finance?.revision ?? 0;
          fixture.finance!.revision = Math.max(Date.now(), previousRevision + 1);
          const savedPrice = Number(saved.batch.currentStockPrice ?? 0);
          if (savedPrice > 0) fixture.currentStockPrice = savedPrice;
          if (typeof saved.batch.currentDayChange === "number") fixture.currentDayChange = saved.batch.currentDayChange;
          reviveBatch(fixture);
          syncBatchFinance(fixture);
          store[batch.id] = financeRecord(fixture);
          continue;
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
    // 首次初始化：把新批次的初始账本（含补仓轮次 ID）落库，保证多端引用同一批义务。
    if (typeof window !== "undefined") {
      const created: FinanceStore = {};
      for (const batch of loaded.batches) {
        if (!store[batch.id]) {
          store[batch.id] = financeRecord(batch);
          created[batch.id] = store[batch.id];
        }
      }
      const createdIds = Object.keys(created);
      if (isWorkspaceHydrated()) {
        // 服务端为唯一事实来源：仅把服务端尚不存在的批次落库（首次启动即写入整套演示账本）。
        if (createdIds.length) {
          void bootstrapWorkspace(
            createdIds.map((id) => ({ kind: "ledger" as const, key: id, payload: created[id] }))
          );
        }
      } else {
        const serialized = JSON.stringify(store);
        if (window.localStorage.getItem(FINANCE_STORE_KEY) !== serialized) {
          window.localStorage.setItem(FINANCE_STORE_KEY, serialized);
        }
      }
    }
    resetClientNoAllocator();
    lastClientNoAllocator = ensureClientNosOnBatches(loaded.batches);
    ensureSubAccountNosOnBatches(loaded.batches);
    cachedMockData = loaded;
  } else {
    if (!lastClientNoAllocator) {
      // 缓存中已加载但此前未经过 ensureClientNos（例如跨 tab 事件），补齐编号。
      lastClientNoAllocator = ensureClientNosOnBatches(cachedMockData.batches);
      ensureSubAccountNosOnBatches(cachedMockData.batches);
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
      const priceDiff = Math.abs(newPrice - batch.currentStockPrice);
      const chgDiff = Math.abs(newChg - (batch.currentDayChange ?? 0));
      if (priceDiff <= 1e-6 && chgDiff <= 1e-6 && (batch as any)._realtimeSynced && typeof (batch as any)._lastClientRealtimeSync === "number" && (Date.now() - (batch as any)._lastClientRealtimeSync) < 30_000) {
        continue;
      }
      try {
        commitBatchFinance(batch, (draft) => {
          draft.currentStockPrice = newPrice;
          draft.currentDayChange = newChg;
          draft.updatedAt = now;
          (draft as any)._realtimeSynced = true;
          (draft as any)._lastClientRealtimeSync = Date.now();
          syncBatchFinance(draft);
          const clientsArr = (draft.clients ?? []) as any[];
          for (const c of clientsArr) {
            if (!c || c.status === ClientStatus.SETTLED) continue;
            try {
              const m = getClientPositionMetrics(draft as any, c.id, newPrice);
              c.realtimePnL = Number.isFinite(m.realtimePnL) ? m.realtimePnL : 0;
              c.estimatedExitAmount = Number.isFinite(m.estimatedExitAmount) ? m.estimatedExitAmount : c.investmentAmount;
            } catch {}
          }
        });
        dispatchedIds.push(batch.id);
      } catch {}
    }
    if (typeof window !== "undefined") {
      const quoteDict: Record<string, { price: number; changePercent: number }> = {};
      quotes.forEach((v, k) => { quoteDict[k] = v; });
      window.dispatchEvent(new CustomEvent("risk-control:quote-changed", {
        detail: { updatedAt: Date.now(), batchIds: dispatchedIds, symbols: symbolArray, quotes: quoteDict },
      }));
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
  const stockSymbol = (input.stockSymbol || "").trim().toUpperCase();
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
  const initialTotalAmount = Math.max(0, Number(input.initialTotalAmount) || 0);
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
  // 建批次会创建资金账本（属于资金写入）：必须携带幂等键，否则服务端拒绝落库。
  writeFinanceRecords(store, [newBatch.id], {
    opId: `fin-${newBatch.id}-1-${Math.random().toString(36).slice(2, 10)}`,
  });
  // 合并现有批次列表并刷新缓存
  cachedMockData = null;
  const fresh = getMockData();
  window.dispatchEvent(new CustomEvent("risk-control:finance-changed", { detail: { batchId: newBatch.id, op: "createBatch" } }));
  return fresh.batches.find((b) => b.id === newBatch.id) || newBatch;
}

// 远端（其他端/其他用户）数据变更时清空内存缓存，使下次读取重新组装账本。
if (typeof window !== "undefined") {
  registerWorkspaceInvalidator(() => {
    cachedMockData = null;
  });
}
