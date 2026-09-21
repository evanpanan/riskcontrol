import assert from "node:assert/strict";
import {
  type BatchLike, type ClientLike, initializeBatchFinance, syncBatchFinance,
  executeInstitutionTopup, summarizeBatchMarginFromClients, getBatchMetrics,
  calculateBatchPnLSplit, calculateRescueStats, settleClientPosition,
  calculateClientSettlement, calculateProfitSplitRatio, getClientProfitSplit, addClientPosition,
} from "../src/lib/riskEngine";
import { commitBatchFinance, FINANCE_STORE_KEY } from "../src/lib/mockData";

const storage = new Map<string, string>();
let storageFailure = false;
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (storageFailure) throw new Error("Quota exceeded");
    storage.set(key, value);
  },
};
Object.assign(globalThis, { window: { localStorage, dispatchEvent() {} }, localStorage });
const near = (actual: number, expected: number, label = "") =>
  assert.ok(Math.abs(actual - expected) < 0.03, `${label}: ${actual} != ${expected}`);
function client(id: string, amount = 350000): ClientLike {
  return {
    id, name: id, investmentAmount: amount, status: "ACTIVE", batchId: "test",
    profitSplitClient: 40, profitSplitInstitution: 60, signDate: new Date("2026-01-01"),
    bdManager: "Test", settledAt: null, createdAt: new Date(), updatedAt: new Date(),
  } as ClientLike;
}
function batch(price = 80): BatchLike {
  const b = {
    id: "test", stockSymbol: "TEST", stockPriceAtStart: 100, currentStockPrice: price,
    initialTotalAmount: 1000000, priorityAmount: 700000, subordinateAmount: 300000,
    totalShares: 10000, cumulativeMarginCalls: 0, marginCalls: [],
    signDate: new Date("2026-01-01"), clients: [client("a"), client("b")],
  } as unknown as BatchLike;
  initializeBatchFinance(b);
  return b;
}
let count = 0;
function test(name: string, run: () => void) {
  storage.clear();
  storageFailure = false;
  run();
  count++;
  process.stdout.write(`PASS ${name}\n`);
}

test("80% inclusive threshold and locked per-client allocation", () => {
  assert.equal(summarizeBatchMarginFromClients(batch(80.01)).totalPending, 0);
  const b = batch();
  near(summarizeBatchMarginFromClients(b).totalPending, 200000);
  const other = structuredClone(b.clients![1].marginState);
  near(executeInstitutionTopup(b, { clientId: "a", amount: 100000 }), 100000);
  assert.deepEqual(b.clients![1].marginState, other);
  near(summarizeBatchMarginFromClients(b).totalPending, 100000);
  near(b.initialTotalAmount, 1000000);
  near(b.currentStockPrice!, 80);
  near(b.currentMarketValue!, 900000);
  near(executeInstitutionTopup(b, { amount: 100000 }), 100000);
  near(b.currentMarketValue!, 1000000);
  near(getBatchMetrics(b).totalPnL, -200000);
  near(calculateBatchPnLSplit(b, b.currentMarketValue!).institutionTotalPnL, -200000);
  assert.equal(executeInstitutionTopup(b, { amount: 200000 }), 0);
});

test("second 20% decline creates a new round and preserves the old ledger", () => {
  const b = batch();
  const oldId = summarizeBatchMarginFromClients(b).roundId;
  executeInstitutionTopup(b, { amount: 200000 });
  b.currentStockPrice = 64;
  syncBatchFinance(b);
  const summary = summarizeBatchMarginFromClients(b);
  assert.notEqual(summary.roundId, oldId);
  near(summary.totalPending, 200000);
  assert.equal(executeInstitutionTopup(b, { amount: 200000, expectedRoundId: oldId }), 0);
  executeInstitutionTopup(b, { amount: summary.totalPending });
  near(b.currentMarketValue!, 1000000);
  near(calculateRescueStats(b, 64).rescuePnL, -40000);
  near(b.cumulativeMarginCalls, 400000);
  near(getBatchMetrics(b).totalPnL, -400000);
});

test("in-round price changes never rewrite obligations or trigger a small immediate refill", () => {
  const b = batch();
  const roundId = summarizeBatchMarginFromClients(b).roundId;
  executeInstitutionTopup(b, { amount: 100000, clientId: "a" });
  b.currentStockPrice = 78;
  syncBatchFinance(b);
  near(summarizeBatchMarginFromClients(b).totalPending, 100000);
  near(b.clients![1].marginState!.required, 100000);
  executeInstitutionTopup(b, { amount: 100000 });
  near(b.currentMarketValue!, 977500);
  assert.equal(summarizeBatchMarginFromClients(b).roundId, roundId);
  assert.equal(summarizeBatchMarginFromClients(b).totalPending, 0);
  assert.equal(b.finance!.rounds.length, 1);
  const before = structuredClone(b);
  getBatchMetrics(b);
  summarizeBatchMarginFromClients(b);
  calculateBatchPnLSplit(b, b.currentMarketValue!);
  assert.deepEqual(b, before);
});

test("legacy receipts cannot overwrite other clients or silently permit duplicate payments", () => {
  const b = batch();
  delete b.finance;
  b.marginCalls = [{
    id: "legacy", requiredAmount: 200000, fulfilledAmount: 100000, averageEntryPrice: 80,
    status: "PENDING", triggerDate: new Date("2026-02-01"),
  }];
  b.cumulativeMarginCalls = 150000;
  b.clients![0].marginState = { initialInvestment: 350000, required: 100000, fulfilled: 50000, history: [] };
  delete b.clients![1].marginState;
  initializeBatchFinance(b);
  near(b.clients![0].marginState!.fulfilled, 50000);
  near(b.clients![1].marginState!.fulfilled, 0);
  near(summarizeBatchMarginFromClients(b).totalPending, 150000);
  assert.throws(() => executeInstitutionTopup(b, { amount: 150000 }), /核对/);
  const archived = batch();
  delete archived.finance;
  archived.clients!.forEach((c) => { c.status = "SETTLED"; });
  archived.marginCalls = [{ id: "old", requiredAmount: 200000, fulfilledAmount: 0,
    status: "PENDING", triggerDate: new Date("2026-02-01") }];
  initializeBatchFinance(archived);
  near(summarizeBatchMarginFromClients(archived).totalRequired, 200000);
  assert.throws(() => executeInstitutionTopup(archived, { amount: 200000 }), /核对/);
});

test("rescue gains belong to institution; partial exit conserves assets and freezes rates", () => {
  const b = batch();
  executeInstitutionTopup(b, { amount: 200000 });
  b.currentStockPrice = 110;
  syncBatchFinance(b);
  const before = b.currentMarketValue!;
  const result = settleClientPosition(b, "a");
  near(result.clientReceives, 364000);
  near(result.institutionReceives, 323500);
  near(result.institutionRescuePnL, 37500);
  near(b.initialTotalAmount, 500000);
  near(b.currentMarketValue!, before / 2);
  near(result.clientReceives + result.institutionReceives + b.currentMarketValue!, before);
  assert.deepEqual(settleClientPosition(b, "a"), result);
  b.currentStockPrice = 140;
  syncBatchFinance(b);
  storage.set("risk_control_settings", JSON.stringify({ vipThreshold: 100000, vipClient: 10, normalClient: 5 }));
  assert.deepEqual(calculateClientSettlement(b.clients![0], b, b.currentMarketValue!, 140), result);
  const split = calculateBatchPnLSplit(b, b.currentMarketValue!);
  near(split.clientTotalPnL + split.institutionTotalPnL,
    getBatchMetrics(b).totalPnL + result.clientPnL + result.institutionPnL);
  const final = settleClientPosition(b, "b");
  near(b.currentMarketValue!, 0);
  near(b.initialTotalAmount, 0);
  assert.ok(final.clientReceives > result.clientReceives);
});

test("signing threshold is inclusive; settings never rewrite old contracts", () => {
  near(calculateProfitSplitRatio(99999.99).client, 0.3);
  near(calculateProfitSplitRatio(100000).client, 0.4);
  const old = client("old");
  storage.set("risk_control_settings", JSON.stringify({ vipThreshold: 120000, vipClient: 45.5, normalClient: 32 }));
  near(calculateProfitSplitRatio(100000).client, 0.32);
  near(calculateProfitSplitRatio(120000).client, 0.455);
  near(getClientProfitSplit(old).client, 0.4);
  near(calculateProfitSplitRatio(120000, true).client, 0.4);
});

test("later subscriptions have their own cost and institution matching capital", () => {
  const b = batch(110);
  addClientPosition(b, client("new", 70000));
  near(b.initialTotalAmount, 1100000);
  near(b.currentMarketValue!, 1200000);
  near(calculateClientSettlement(b.clients![2], b, b.currentMarketValue!, 110).clientPnL, 0);
  const before = b.currentMarketValue!;
  const result = settleClientPosition(b, "new");
  near(result.clientReceives + result.institutionReceives + b.currentMarketValue!, before);
  near(b.initialTotalAmount, 1000000);
});

test("unpriced historical topups retain cost but block settlement", () => {
  const b = batch(100);
  delete b.finance;
  b.cumulativeMarginCalls = 1000;
  initializeBatchFinance(b);
  near(calculateRescueStats(b, 120).unpricedAmount!, 1000);
  near(calculateRescueStats(b, 120).rescuePnL, 0);
  assert.throws(() => settleClientPosition(b, "a"), /核对/);
});

test("atomic persistence survives serialization; quota failure and stale tabs cannot book", () => {
  const b = batch();
  const stale = structuredClone(b);
  const baseline = structuredClone(b);
  storageFailure = true;
  assert.throws(() => commitBatchFinance(b, (draft) => executeInstitutionTopup(draft, { amount: 100000 })), /保存失败/);
  assert.deepEqual(b, baseline);
  storageFailure = false;
  commitBatchFinance(b, (draft) => executeInstitutionTopup(draft, { amount: 100000 }));
  const saved = JSON.parse(storage.get(FINANCE_STORE_KEY)!).test.batch;
  near(saved.finance.trades.reduce((sum: number, t: any) => sum + t.amount, 0), 100000);
  near(summarizeBatchMarginFromClients(saved).totalPending, 100000);
  assert.throws(() => commitBatchFinance(stale, (draft) => executeInstitutionTopup(draft, { amount: 100000 })), /其他页面/);
  near(b.cumulativeMarginCalls, 100000);
  commitBatchFinance(b, (draft) => executeInstitutionTopup(draft, { amount: 100000 }));
  commitBatchFinance(b, (draft) => settleClientPosition(draft, "a"));
  const settled = JSON.parse(storage.get(FINANCE_STORE_KEY)!).test.batch;
  assert.deepEqual(settled.finance.settlements.a, b.finance!.settlements.a);
  near(settled.finance.remainingCapital, 500000);
});

process.stdout.write(`Finance regression: ${count} scenarios passed.\n`);
