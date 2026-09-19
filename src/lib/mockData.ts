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
} from "./riskEngine";
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

const BD_MANAGERS = ["李晓明 (Evan Li)", "王思远 (Sylvia Wang)", "张志强 (Jack Zhang)", "刘佳 (Jennifer Liu)"];

const CLIENT_FIRST_NAMES = [
  "伟", "芳", "娜", "敏", "静", "秀英", "丽", "强", "磊", "军",
  "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "霞", "平",
];
const CLIENT_LAST_NAMES = ["王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴"];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals: number = 2): number {
  return Number((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomFrom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function randomDateInPastMonths(months: number): Date {
  const now = new Date();
  const ms = months * 30 * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - Math.random() * ms);
}

function generateClientName(): string {
  return `${randomFrom(CLIENT_LAST_NAMES)}${randomFrom(CLIENT_FIRST_NAMES)}`;
}

export function generateMockData(): MockDataSet {
  const now = new Date();
  const batches: (Batch & { clients: Client[]; marginCalls: MarginCall[] })[] = [];
  const stockHistory: StockHistory[] = [];

  STOCKS.forEach((stock) => {
    stockHistory.push({
      id: `sh-${stock.symbol}`,
      symbol: stock.symbol,
      name: stock.name,
      usageCount: randomInt(1, 5),
      lastUsed: randomDateInPastMonths(6),
      createdAt: randomDateInPastMonths(8),
      updatedAt: randomDateInPastMonths(1),
    });
  });

  for (let i = 0; i < 8; i++) {
    const stock = STOCKS[i % STOCKS.length];
    const signDate = randomDateInPastMonths(22);
    const maturityDate = new Date(signDate);
    maturityDate.setMonth(maturityDate.getMonth() + 24);

    const initialAmounts = [1000000, 2000000, 750000, 5000000, 3000000, 1500000, 800000, 4000000];
    const initialTotalAmount = initialAmounts[i];
    const split = calculateInvestmentSplit(initialTotalAmount);

    const priceDropScenarios = [0.05, 0.12, 0.18, 0.24, 0.02, 0.16, 0.08, 0.21];
    const dropPercent = priceDropScenarios[i];

    const stockPriceAtStart = stock.basePrice;
    const currentStockPrice = Number((stock.basePrice * (1 - dropPercent + (Math.random() - 0.5) * 0.02)).toFixed(2));
    const currentDayChange = Number(((Math.random() - 0.5) * 4).toFixed(2));
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
      triggerDate.setMonth(triggerDate.getMonth() + randomInt(4, 12));

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
        createdAt: triggerDate,
      });

      if (i === 3) {
        const triggerDate2 = new Date(triggerDate);
        triggerDate2.setMonth(triggerDate2.getMonth() + 2);
        const required2 = initialTotalAmount * 0.05;
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
          createdAt: triggerDate2,
        });
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
      let investmentAmount: number;
      if (c === 0) {
        investmentAmount = priorityPool * 0.25;
      } else if (c === numClients - 1) {
        investmentAmount = priorityPool - clients.reduce((sum, cl) => sum + cl.investmentAmount, 0);
      } else {
        const isBig = Math.random() < 0.3;
        investmentAmount = isBig
          ? randomInt(100000, 300000)
          : randomInt(20000, 80000);
      }
      investmentAmount = Number(investmentAmount.toFixed(2));

      const profitSplit = calculateProfitSplitRatio(investmentAmount);

      const clientSignDate = new Date(signDate.getTime() + Math.random() * 3 * 24 * 60 * 60 * 1000);

      let clientStatus: ClientStatus = ClientStatus.ACTIVE;
      if (i === 4 && c < 2) {
        clientStatus = ClientStatus.SETTLED;
      } else if (i === 1 && c === 3) {
        clientStatus = ClientStatus.EXIT_REQUESTED;
      }

      clients.push({
        id: `client-${i}-${c}`,
        batchId: `batch-${2026}-${String(i + 1).padStart(3, "0")}`,
        name: generateClientName(),
        investmentAmount,
        bdManager: randomFrom(BD_MANAGERS),
        bdUserId: null,
        signDate: clientSignDate,
        profitSplitClient: profitSplit.client * 100,
        profitSplitInstitution: profitSplit.institution * 100,
        realtimePnL: 0,
        estimatedExitAmount: 0,
        status: clientStatus,
        settledAt: clientStatus === ClientStatus.SETTLED ? new Date(clientSignDate.getTime() + randomInt(30, 180) * 24 * 60 * 60 * 1000) : null,
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

let cachedMockData: MockDataSet | null = null;

export function getMockData(): MockDataSet {
  if (!cachedMockData) {
    cachedMockData = generateMockData();
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
    batch.currentStockPrice = newPrice;
    batch.currentDayChange = Number((changePercent * 100).toFixed(2));

    const newMarketValue = calculateCurrentMarketValue(
      batch.stockPriceAtStart,
      newPrice,
      batch.totalShares
    );
    batch.currentMarketValue = newMarketValue;

    const metrics = calculateBatchRiskMetrics(
      batch.initialTotalAmount,
      newMarketValue,
      batch.cumulativeMarginCalls
    );
    batch.totalPnL = metrics.totalPnL;
    batch.totalPnLPercent = metrics.totalPnLPercent;
    batch.riskLevel = metrics.riskLevel;
    batch.updatedAt = now;
  });

  return data;
}
