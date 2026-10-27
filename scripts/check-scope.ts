/**
 * 服务端工作区归属隔离回归脚本（纯函数，不依赖数据库）。
 * 验证商务经理的数据范围收敛与账本写入合并规则。
 * 运行：npx tsx scripts/check-scope.ts
 */
import assert from "node:assert/strict";
import {
  collectOwnedScope,
  ledgersContainOwnedClient,
  ledgerOwnsBd,
  mergeLedgerWriteForBd,
  redactLedgerForBd,
  readLedgerShape,
} from "../src/lib/server/workspaceScope";

const BD_A = "李晓明 (Evan Li)";
const BD_B = "王思远 (Sylvia Wang)";

function client(id: string, bd: string, amount: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    batchId: "batch-1",
    name: `客户-${id}`,
    bdManager: bd,
    investmentAmount: amount,
    status: "ACTIVE",
    signDate: "2026-01-01",
    ...extra,
  };
}

function ledger(clients: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    fingerprint: "fp-1",
    clientFingerprints: Object.fromEntries(clients.map((c) => [c.id as string, `hash-${c.id as string}`])),
    batch: {
      id: "batch-1",
      totalShares: 10000,
      currentStockPrice: 80,
      clients,
      finance: {
        version: 2,
        revision: 3,
        originalCapital: 1000000,
        settlements: { a: { institutionPnL: 1 } },
        trades: [{ id: "t1", clientId: "a", amount: 100 }],
      },
      ...extra,
    },
  };
}

const serverLedger = ledger([
  client("a", BD_A, 350000, { settlement: { institutionPnL: 999 } }),
  client("b", BD_B, 650000),
  client("c", BD_B, 220000),
]);

let count = 0;
function test(name: string, run: () => void) {
  run();
  count++;
  process.stdout.write(`PASS ${name}\n`);
}

test("归属识别与范围收集：只覆盖本人客户", () => {
  assert.equal(ledgerOwnsBd(serverLedger, BD_A), true);
  assert.equal(ledgerOwnsBd(serverLedger, "不存在的人"), false);
  const scope = collectOwnedScope([{ key: "batch-1", payload: serverLedger }], BD_A);
  assert.deepEqual([...scope.batchIds], ["batch-1"]);
  assert.deepEqual([...scope.clientIds], ["a"]);
  const scopeB = collectOwnedScope([{ key: "batch-1", payload: serverLedger }], BD_B);
  assert.deepEqual([...scopeB.clientIds].sort(), ["b", "c"]);
  assert.equal(ledgersContainOwnedClient([{ payload: serverLedger }], "a", BD_A), true);
  assert.equal(ledgersContainOwnedClient([{ payload: serverLedger }], "a", BD_B), false);
});

test("读脱敏：他人客户行变为占位行，自有客户与数组长度保留", () => {
  const redacted = readLedgerShape(redactLedgerForBd(serverLedger, BD_A))!;
  assert.equal(redacted.clients.length, 3);
  assert.equal(redacted.clients[0].id, "a");
  assert.equal(redacted.clients[0].investmentAmount, 350000);
  assert.equal(redacted.clients[1].__redacted, true);
  assert.equal(redacted.clients[1].investmentAmount, null);
  assert.equal(redacted.clients[1].bdManager, "（已隐藏）");
  assert.equal(redacted.clients[2].__redacted, true);
  const fps = redacted.root.clientFingerprints as Record<string, string>;
  assert.deepEqual(Object.keys(fps), ["a"]);
});

test("写合并：篡改他人客户余额 / 归属被服务端覆盖", () => {
  const incoming = structuredClone(serverLedger);
  const b = incoming.batch.clients as any[];
  b[1].investmentAmount = 1;
  b[1].bdManager = BD_A;
  b[1].status = "SETTLED";
  const merged = mergeLedgerWriteForBd(serverLedger, incoming, BD_A);
  assert.equal(merged.ok, true);
  const out = readLedgerShape(merged.payload)!;
  assert.equal(out.clients[1].investmentAmount, 650000);
  assert.equal(out.clients[1].bdManager, BD_B);
  assert.equal(out.clients[1].status, "ACTIVE");
});

test("写合并：代持占位行不会覆盖真实他人客户", () => {
  const redacted = redactLedgerForBd(serverLedger, BD_A);
  const merged = mergeLedgerWriteForBd(serverLedger, redacted, BD_A);
  assert.equal(merged.ok, true);
  const out = readLedgerShape(merged.payload)!;
  assert.equal(out.clients[1].id, "b");
  assert.equal(out.clients[1].investmentAmount, 650000);
  assert.equal(out.clients[2].investmentAmount, 220000);
});

test("写合并：批次级与财务账本一律以服务端为准，仅保留 revision 推进", () => {
  const incoming = structuredClone(serverLedger);
  incoming.batch.totalShares = 1;
  incoming.batch.currentStockPrice = 999;
  (incoming.batch.finance as any).originalCapital = 1;
  (incoming.batch.finance as any).settlements = { a: { institutionPnL: -1 } };
  (incoming.batch.finance as any).revision = 4;
  const merged = mergeLedgerWriteForBd(serverLedger, incoming, BD_A);
  assert.equal(merged.ok, true);
  const out = readLedgerShape(merged.payload)!;
  assert.equal(out.batch.totalShares, 10000);
  assert.equal(out.batch.currentStockPrice, 80);
  const fin = out.batch.finance as any;
  assert.equal(fin.originalCapital, 1000000);
  assert.deepEqual(fin.settlements, { a: { institutionPnL: 1 } });
  assert.equal(fin.revision, 4);
  assert.equal(fin.version, 2);
});

test("写合并：自有客户修改被接受，归属被强制回本人", () => {
  const incoming = structuredClone(serverLedger);
  const b = incoming.batch.clients as any[];
  b[0].status = "EXIT_REQUESTED";
  b[0].bdManager = BD_B;
  const merged = mergeLedgerWriteForBd(serverLedger, incoming, BD_A);
  assert.equal(merged.ok, true);
  const out = readLedgerShape(merged.payload)!;
  assert.equal(out.clients[0].status, "EXIT_REQUESTED");
  assert.equal(out.clients[0].bdManager, BD_A);
});

test("写合并：注入新客户 / 越权写入无自有客户的批次被拒绝", () => {
  const injected = structuredClone(serverLedger);
  (injected.batch.clients as any[]).push(client("evil", BD_A, 999999));
  assert.equal(mergeLedgerWriteForBd(serverLedger, injected, BD_A).ok, false);

  const foreignOnly = ledger([client("x", BD_B, 100), client("y", BD_B, 200)]);
  assert.equal(mergeLedgerWriteForBd(foreignOnly, foreignOnly, BD_A).ok, false);

  const missing = mergeLedgerWriteForBd(serverLedger, { hello: "world" }, BD_A);
  assert.equal(missing.ok, false);
  const noIdentity = mergeLedgerWriteForBd(serverLedger, serverLedger, undefined);
  assert.equal(noIdentity.ok, false);
});

test("写合并：删除他人客户会被服务端恢复", () => {
  const incoming = structuredClone(serverLedger);
  incoming.batch.clients = [client("a", BD_A, 350000)];
  const merged = mergeLedgerWriteForBd(serverLedger, incoming, BD_A);
  assert.equal(merged.ok, true);
  const out = readLedgerShape(merged.payload)!;
  assert.deepEqual(out.clients.map((c) => c.id), ["a", "b", "c"]);
});

process.stdout.write(`\nALL ${count} SCOPE SCENARIOS PASSED\n`);
