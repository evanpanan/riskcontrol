/**
 * 加固回归脚本（纯函数，不依赖数据库 / window）。
 *
 * 覆盖 Codex 审计对应的修复点：
 *  - P0-1 冲突响应越权：跨客户 / 跨批次时，服务端必须先拒绝归属，冲突快照按角色脱敏。
 *  - P0-2 资金写入识别：以「资金内容实质变化」判定，不依赖客户端上送的 revision。
 *  - P1-3 闪跌检测核心：服务端监控与浏览器端共用同一套判定逻辑。
 *
 * 运行：npx tsx scripts/check-hardening.ts
 */
import assert from "node:assert/strict";
import { financeContentChanged } from "../src/lib/server/ledgerGuard";
import {
  DEFAULT_FLASH_CRASH_THRESHOLDS,
  evaluateFlashCrash,
  sanitizeFlashCrashThresholds,
} from "../src/lib/flashCrashCore";
import {
  mergeLedgerWriteForBd,
  readLedgerShape,
  redactLedgerForBd,
} from "../src/lib/server/workspaceScope";

const BD_A = "李晓明 (Evan Li)";
const BD_B = "王思远 (Sylvia Wang)";

function client(id: string, bd: string, amount: number) {
  return {
    id,
    batchId: "batch-1",
    name: `客户-${id}`,
    bdManager: bd,
    investmentAmount: amount,
    status: "ACTIVE",
    signDate: "2026-01-01",
  };
}

function ledger(batchId: string, clients: Record<string, unknown>[]) {
  return {
    clientFingerprints: Object.fromEntries(clients.map((c) => [c.id as string, `hash-${c.id}`])),
    batch: {
      id: batchId,
      totalShares: 10000,
      currentStockPrice: 80,
      clients,
      finance: {
        revision: 3,
        originalCapital: 1000000,
        settlements: { a: { institutionPnL: 1 }, b: { principal: 70000 } },
        trades: [
          { id: "t1", clientId: "a", amount: 100 },
          { id: "t2", clientId: "b", amount: 900 },
        ],
        rounds: [{ id: "r1", allocations: { a: { required: 1 }, b: { required: 2 } } }],
      },
    },
  };
}

let count = 0;
function test(name: string, run: () => void) {
  run();
  count++;
  process.stdout.write(`PASS ${name}\n`);
}

/* ------------------------------- P0-2 资金写入识别 ------------------------------- */

test("资金内容未变、仅推进 revision：不视为资金写入", () => {
  const prev = { batch: { finance: { revision: 1, originalCapital: 100, settlements: {} } } };
  const next = { batch: { finance: { revision: 2, originalCapital: 100, settlements: {} } } };
  assert.equal(financeContentChanged(prev, next), false);
  assert.equal(financeContentChanged(prev, prev), false);
});

test("改资金字段但保留原版本号：仍判定为资金写入（不能绕过幂等与服务端审计）", () => {
  const prev = { batch: { finance: { revision: 7, originalCapital: 100, trades: [] } } };
  const next = { batch: { finance: { revision: 7, originalCapital: 200, trades: [] } } };
  assert.equal(financeContentChanged(prev, next), true);
});

test("键序不同不算变化；数组顺序与值变化算变化", () => {
  const prev = { batch: { finance: { revision: 1, x: 1, y: 2, list: [1, 2] } } };
  const reordered = { batch: { finance: { y: 2, list: [1, 2], x: 1, revision: 1 } } };
  assert.equal(financeContentChanged(prev, reordered), false);
  const reorderedList = { batch: { finance: { revision: 1, x: 1, y: 2, list: [2, 1] } } };
  assert.equal(financeContentChanged(prev, reorderedList), true);
  const valueChanged = { batch: { finance: { revision: 1, x: 1, y: 3, list: [1, 2] } } };
  assert.equal(financeContentChanged(prev, valueChanged), true);
});

test("首个账本（无历史 finance）写入即视为资金写入", () => {
  assert.equal(financeContentChanged(null, { batch: { finance: { revision: 1 } } }), true);
  assert.equal(financeContentChanged({ batch: {} }, { batch: { finance: { revision: 1 } } }), true);
});

/* ------------------------------ P1-3 闪跌检测核心 ------------------------------ */

test("闪跌阈值清洗：非法项剔除、按窗口升序、缺省启用", () => {
  assert.deepEqual(sanitizeFlashCrashThresholds(null), DEFAULT_FLASH_CRASH_THRESHOLDS);
  assert.deepEqual(sanitizeFlashCrashThresholds([{ windowMinutes: 0, dropPercent: 5 }]), DEFAULT_FLASH_CRASH_THRESHOLDS);
  const cleaned = sanitizeFlashCrashThresholds([
    { windowMinutes: 30, dropPercent: 20 },
    { windowMinutes: 5, dropPercent: 10, enabled: false },
    { windowMinutes: -1, dropPercent: 3 },
    { windowMinutes: 15, dropPercent: 150 },
  ]);
  assert.deepEqual(cleaned, [
    { windowMinutes: 5, dropPercent: 10, enabled: false },
    { windowMinutes: 30, dropPercent: 20, enabled: true },
  ]);
});

test("闪跌检测：窗口内跌幅达到阈值即触发", () => {
  const now = 1_700_000_000_000;
  const points = [{ ts: now - 60_000, price: 100 }];
  const hit = evaluateFlashCrash(points, 89, [{ windowMinutes: 5, dropPercent: 10, enabled: true }], now);
  assert.equal(hit.triggered, true);
  assert.equal(hit.triggeredThresholds[0].windowMinutes, 5);
  assert.ok(Math.abs(hit.details[0].actualDropPercent - 11) < 1e-6);
  const miss = evaluateFlashCrash(points, 95, [{ windowMinutes: 5, dropPercent: 10, enabled: true }], now);
  assert.equal(miss.triggered, false);
});

test("闪跌检测：窗口外历史与停用阈值不参与判定", () => {
  const now = 1_700_000_000_000;
  // 6 分钟前的旧高点，落在 5 分钟窗口之外
  const stale = [{ ts: now - 6 * 60_000, price: 100 }];
  const outOfWindow = evaluateFlashCrash(stale, 50, [{ windowMinutes: 5, dropPercent: 10, enabled: true }], now);
  assert.equal(outOfWindow.triggered, false);
  assert.equal(outOfWindow.details[0].actualDropPercent, 0);
  assert.equal(outOfWindow.details[0].highPrice, 50);

  const disabled = evaluateFlashCrash(
    [{ ts: now - 60_000, price: 100 }],
    10,
    [{ windowMinutes: 5, dropPercent: 10, enabled: false }],
    now
  );
  assert.equal(disabled.triggered, false);
  assert.equal(disabled.details.length, 0);
});

/* --------------------------- P0-1 冲突响应跨客户/跨批次 --------------------------- */

test("跨批次：无自有客户的批次写入被拒绝，不进入冲突回带路径", () => {
  const foreign = ledger("batch-2", [client("x", BD_B, 100), client("y", BD_B, 200)]);
  const result = mergeLedgerWriteForBd(foreign, foreign, BD_A);
  assert.equal(result.ok, false);
  assert.equal(result.payload, undefined);
});

test("跨客户：自有批次冲突快照仍按角色脱敏，他人客户及其财务明细不下发", () => {
  const owned = ledger("batch-1", [client("a", BD_A, 350000), client("b", BD_B, 650000)]);
  // 冲突回带使用的正是 redactLedgerForBd；结果不得包含他人客户本金与嵌套财务键。
  const snapshot = readLedgerShape(redactLedgerForBd(owned, BD_A))!;
  assert.equal(snapshot.clients.length, 2);
  assert.equal(snapshot.clients[0].investmentAmount, 350000);
  assert.equal(snapshot.clients[1].__redacted, true);
  assert.equal(snapshot.clients[1].investmentAmount, null);
  const fin = snapshot.batch.finance as Record<string, any>;
  assert.deepEqual(Object.keys(fin.settlements), ["a"]);
  assert.deepEqual(fin.trades.map((t: any) => t.id), ["t1"]);
  assert.deepEqual(Object.keys(fin.rounds[0].allocations), ["a"]);
  const fps = snapshot.root.clientFingerprints as Record<string, string>;
  assert.deepEqual(Object.keys(fps), ["a"]);
});

test("跨客户：他人提交的冲突快照对无归属商务经理不泄露任何客户", () => {
  const owned = ledger("batch-1", [client("b", BD_B, 650000)]);
  const snapshot = readLedgerShape(redactLedgerForBd(owned, BD_A))!;
  assert.equal(snapshot.clients[0].__redacted, true);
  const fin = snapshot.batch.finance as Record<string, any>;
  assert.deepEqual(Object.keys(fin.settlements), []);
  assert.deepEqual(fin.trades, []);
  assert.deepEqual(Object.keys(fin.rounds[0].allocations), []);
});

process.stdout.write(`\nALL ${count} HARDENING SCENARIOS PASSED\n`);
