import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
  initializeBatchFinance,
  executeInstitutionTopup,
  settleClientPosition,
  type BatchLike,
} from "../src/lib/riskEngine";
import {
  buildMonthlyStatement,
  statementMonthBounds,
  previousStatementMonth,
} from "../src/lib/monthlyStatement";
import { renderStatementPdf } from "../src/lib/server/statementPdf";
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);
function batch(id: string, date: string, amount = 7000, other = false) {
  const b = {
    id,
    batchNumber: `WIN100-2026-${id}`,
    stockSymbol: "TEST",
    signDate: date,
    maturityDate: "2028-01-01",
    initialTotalAmount: (amount / 0.7) * (other ? 2 : 1),
    priorityAmount: amount * (other ? 2 : 1),
    subordinateAmount: (amount / 0.7) * 0.3 * (other ? 2 : 1),
    stockPriceAtStart: 10,
    currentStockPrice: 7,
    totalShares: (amount / 0.7 / 10) * (other ? 2 : 1),
    cumulativeMarginCalls: 0,
    marginCalls: [],
    clients: [
      {
        id: id + "-own",
        batchId: id,
        name: "张三 Jennifer Zhang",
        bdManager: "李经理",
        investmentAmount: amount,
        entryStockPrice: 10,
        signDate: date,
        status: "ACTIVE",
        profitSplitClient: 40,
        profitSplitInstitution: 60,
      },
      ...(other
        ? [
            {
              id: "private-other",
              batchId: id,
              name: "不得泄露的其他客户",
              bdManager: "其他经理",
              investmentAmount: amount,
              entryStockPrice: 10,
              signDate: date,
              status: "ACTIVE",
            },
          ]
        : []),
    ],
  } as unknown as BatchLike;
  initializeBatchFinance(b);
  return b;
}
async function main() {
  const a = batch("001", "2026-09-01", 7000, true),
    b = batch("002", "2026-10-15", 3500),
    c = batch("003", "2026-09-01");
  executeInstitutionTopup(a, {
    amount: 100,
    collateralType: "stock",
    executionPrice: 5,
    stockShares: 20,
    topupDate: "2026-10-10",
  });
  executeInstitutionTopup(a, {
    amount: 100,
    collateralType: "cash",
    topupDate: "2026-10-12",
  });
  c.currentStockPrice = 12;
  const exit = settleClientPosition(c, "003-own", {
    force: true,
    confirmLockedExit: true,
  });
  exit.settledAt = "2026-10-20T16:00:00Z";
  const source = JSON.stringify([a, b, c]);
  const input = {
    month: "2026-10",
    customerName: "张三 Jennifer Zhang",
    bdManager: "李经理",
    batches: [a, b, c],
    clientIds: new Set(["001-own", "002-own", "003-own"]),
    openingDate: "2026-09-30",
    closingDate: "2026-10-30",
    prices: new Map([
      ["TEST|2026-09-30", 11],
      ["TEST|2026-10-30", 12],
    ]),
    now: new Date("2026-11-19"),
  };
  const report = buildMonthlyStatement(input);
  near(report.openingEquity, 14560);
  near(report.deposits, 3500);
  near(report.withdrawals, 7490);
  near(report.closingEquity, 11340);
  near(report.monthlyPnL, 770);
  near(report.cumulativePnL, 1330);
  assert.equal(report.positions.length, 3);
  assert.equal(
    report.positions.find((p) => p.batchNumber.endsWith("003"))!.shares,
    0,
  );
  assert.equal(report.events.filter((e) => e.owner === "WIN100").length, 2);
  assert.equal(
    JSON.stringify([a, b, c]),
    source,
    "statement generation never mutates source financial records",
  );
  assert.ok(!JSON.stringify(report).includes("不得泄露"));
  assert.throws(
    () => buildMonthlyStatement({ ...input, prices: new Map() }),
    /真实收盘价/,
  );
  assert.throws(() => statementMonthBounds("2026-11", new Date("2026-11-19")));
  assert.throws(() => statementMonthBounds("2026-13", new Date("2026-11-19")));
  assert.equal(previousStatementMonth(new Date("2026-11-19")), "2026-10");
  // A client signing on a weekend before month start still belongs to opening holdings.
  const old = batch("old", "2026-08-01");
  old.currentStockPrice = 11;
  const oldExit = settleClientPosition(old, "old-own", {
    force: true,
    confirmLockedExit: true,
  });
  oldExit.settledAt = "2026-09-20T16:00:00Z";
  const withOld = buildMonthlyStatement({
    ...input,
    batches: [a, b, c, old],
    clientIds: new Set([...input.clientIds, "old-own"]),
  });
  near(withOld.monthlyPnL, 770);
  near(withOld.cumulativePnL, 1540);
  assert.equal(withOld.positions.length, 3);
  const weekend = batch("weekend", "2026-10-31");
  const weekendReport = buildMonthlyStatement({
    ...input,
    month: "2026-11",
    batches: [weekend],
    clientIds: new Set(["weekend-own"]),
    openingDate: "2026-10-30",
    closingDate: "2026-11-30",
    prices: new Map([
      ["TEST|2026-10-30", 10],
      ["TEST|2026-11-30", 10],
    ]),
    now: new Date("2026-12-10"),
  });
  near(weekendReport.openingEquity, 7000);
  near(weekendReport.monthlyPnL, 0);
  const unreconciled = structuredClone(a);
  unreconciled.finance!.trades[0].entryPrice = null;
  unreconciled.finance!.trades[0].needsReconciliation = true;
  assert.throws(
    () => buildMonthlyStatement({ ...input, batches: [unreconciled, b, c] }),
    /尚未核对/,
  );
  const pdf = await renderStatementPdf(report);
  assert.ok(pdf.subarray(0, 4).toString() === "%PDF");
  assert.ok(pdf.length > 1000);
  await writeFile("/tmp/riskcontrol-statement-qa.pdf", pdf);
  console.log(
    "PASS statement accounting, multi-batch grouping, gains/fees/exits, institution-only topups, weekend opening, true-price requirement, privacy, frozen source data and Chinese PDF",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
