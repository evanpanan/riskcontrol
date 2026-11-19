// Runs only against an explicitly isolated local database. No external mail is sent.
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { initializeBatchFinance, type BatchLike } from "../src/lib/riskEngine";
import {
  statementCustomerKey,
  generateStatement,
  queueStatementEmails,
  sendPendingStatements,
  listStatements,
  canReadStatement,
} from "../src/lib/server/monthlyStatements";
import { MOCK_USER_META } from "../src/types/auth";
const db = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(db.hostname) ||
  !db.pathname.startsWith("/statements_qa_")
)
  throw new Error("This check requires the isolated statements_qa_ database");
async function main() {
  await prisma.$transaction([
    prisma.monthlyStatement.deleteMany(),
    prisma.clientStatementContact.deleteMany(),
    prisma.workspaceRecord.deleteMany({
      where: {
        kind: "ledger",
        key: { in: ["statement-a", "statement-b", "statement-c"] },
      },
    }),
  ]);
  const admin = MOCK_USER_META.admin_root;
  const bd = MOCK_USER_META.bd_lixiaoming;
  const month = "2026-10";
  const batches: BatchLike[] = [];
  for (const [id, name, manager] of [
    ["statement-a", "张三 Jennifer Zhang", bd.bdManagerFullName!],
    ["statement-b", "李四 Michael Lee", "Other BD"],
  ]) {
    const b = {
      id,
      batchNumber: id,
      stockSymbol: "STATEMENT_TEST",
      signDate: "2026-09-01",
      maturityDate: "2028-01-01",
      stockPriceAtStart: 10,
      currentStockPrice: 12,
      initialTotalAmount: 10000,
      priorityAmount: 7000,
      subordinateAmount: 3000,
      totalShares: 1000,
      cumulativeMarginCalls: 0,
      marginCalls: [],
      clients: [
        {
          id: id + "-client",
          batchId: id,
          name,
          bdManager: manager,
          investmentAmount: 7000,
          entryStockPrice: 10,
          signDate: "2026-09-01",
          status: "ACTIVE",
          profitSplitClient: 40,
          profitSplitInstitution: 60,
        },
      ],
    } as unknown as BatchLike;
    initializeBatchFinance(b);
    batches.push(b);
    await prisma.workspaceRecord.upsert({
      where: { kind_key: { kind: "ledger", key: id } },
      create: {
        kind: "ledger",
        key: id,
        payload: JSON.parse(
          JSON.stringify({
            batch: b,
            fingerprint: "fixture",
            clientFingerprints: {},
          }),
        ),
      },
      update: {},
    });
  }
  for (const [date, price] of [
    ["2026-09-30", 11],
    ["2026-10-30", 12],
  ] as const)
    await prisma.quoteHistoryCandle.upsert({
      where: {
        symbol_interval_candleTime: {
          symbol: "STATEMENT_TEST",
          interval: "1d-final",
          candleTime: new Date(date),
        },
      },
      create: {
        symbol: "STATEMENT_TEST",
        interval: "1d-final",
        candleTime: new Date(date),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 1,
        provider: "YAHOO_FINANCE",
      },
      update: {},
    });
  const before = await prisma.workspaceRecord.findMany({
    where: { kind: "ledger" },
    orderBy: { key: "asc" },
  });
  const ka = statementCustomerKey(
      batches[0].clients![0].name,
      bd.bdManagerFullName!,
    ),
    kb = statementCustomerKey(batches[1].clients![0].name, "Other BD");
  const a = await generateStatement(month, ka, admin);
  const b = await generateStatement(month, kb, admin);
  assert.equal((await generateStatement(month, ka, admin)).skipped, true);
  const rowA = await prisma.monthlyStatement.findUniqueOrThrow({
    where: { id: a.id },
  });
  assert.ok(!JSON.stringify(rowA.report).includes("Michael"));
  assert.equal(await canReadStatement(rowA, bd), true);
  assert.equal(
    await canReadStatement(
      await prisma.monthlyStatement.findUniqueOrThrow({ where: { id: b.id } }),
      bd,
    ),
    false,
  );
  assert.equal((await listStatements(month, bd)).length, 1);
  await prisma.clientStatementContact.upsert({
    where: { customerKey: ka },
    create: {
      customerKey: ka,
      email: "alice@recipient.test",
      updatedBy: admin.id,
    },
    update: { email: "alice@recipient.test" },
  });
  const queued = await queueStatementEmails(month, admin);
  assert.equal(queued.queued, 1);
  assert.equal(queued.missing, 1);
  assert.equal(
    (await queueStatementEmails(month, admin)).queued,
    0,
    "double-click queue cannot enqueue twice",
  );
  let requests = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      requests++;
      assert.equal(String(input), "https://api.resend.com/emails");
      const body = JSON.parse(init!.body as string);
      assert.deepEqual(body.to, ["alice@recipient.test"]);
      assert.equal(body.attachments.length, 1);
      assert.equal(
        Buffer.from(body.attachments[0].content, "base64")
          .subarray(0, 4)
          .toString(),
        "%PDF",
      );
      await new Promise((r) => setTimeout(r, 50));
      return Response.json({ id: "qa-message" });
    };
    await Promise.all([
      sendPendingStatements(1, month),
      sendPendingStatements(1, month),
    ]);
    assert.equal(requests, 1, "atomic claim prevents duplicate external sends");
    assert.equal(
      (await prisma.monthlyStatement.findUniqueOrThrow({ where: { id: a.id } }))
        .emailStatus,
      "SENT",
    );
    await prisma.clientStatementContact.upsert({
      where: { customerKey: kb },
      create: {
        customerKey: kb,
        email: "bob@recipient.test",
        updatedBy: admin.id,
      },
      update: { email: "bob@recipient.test" },
    });
    assert.equal((await queueStatementEmails(month, admin)).queued, 1);
    globalThis.fetch = async () => {
      requests++;
      throw new Error("simulated ambiguous network outcome");
    };
    await sendPendingStatements(1, month);
    assert.equal(
      (await prisma.monthlyStatement.findUniqueOrThrow({ where: { id: b.id } }))
        .emailStatus,
      "UNKNOWN",
    );
    assert.equal(
      (await queueStatementEmails(month, admin)).queued,
      0,
      "unknown and successful messages are never silently resent",
    );
    await sendPendingStatements(2, month);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(
    await prisma.workspaceRecord.findMany({
      where: { kind: "ledger" },
      orderBy: { key: "asc" },
    }),
    before,
  );
  const data = await prisma.monthlyStatement.findUniqueOrThrow({
    where: { id: a.id },
  });
  assert.deepEqual(data.report, rowA.report);
  assert.deepEqual(data.pdf, rowA.pdf);
  console.log(
    "PASS real database: immutable reports, missing-email skip, private individual PDF attachment, no duplicate sends under concurrency, unknown outcome held, BD isolation and unchanged business ledger",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
