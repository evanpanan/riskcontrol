import assert from "node:assert/strict";
import { generateMockData, resetMockTestData, FINANCE_STORE_KEY, commitBatchFinance, getMockData, reloadMockData } from "../src/lib/mockData";
import { initializeBatchFinance, executeInstitutionTopup, summarizeBatchMarginFromClients, settleClientPosition, isTopupBlockedByLegacyLedger, type BatchLike } from "../src/lib/riskEngine";

const records = new Map<string, string>();
let failKey = "";
const localStorage = {
  getItem: (key: string) => records.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (key === failKey) throw new Error("Quota exceeded");
    records.set(key, value);
  },
  removeItem: (key: string) => records.delete(key),
};
Object.assign(globalThis, { window: { localStorage, dispatchEvent() {} }, localStorage });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.03, `${a} != ${b}`);
const data = generateMockData();
assert.equal(data.batches.length, 8);
assert.equal(data.batches.flatMap((b) => b.clients).length, 78);
assert.deepEqual(data.batches.map((b) => b.clients.map((c) => [c.id, c.name, c.investmentAmount])),
  generateMockData().batches.map((b) => b.clients.map((c) => [c.id, c.name, c.investmentAmount])));
for (const batch of data.batches as BatchLike[]) {
  near(batch.clients!.reduce((sum, c) => sum + c.investmentAmount, 0), batch.priorityAmount);
  assert.ok(batch.clients!.every((c) => c.investmentAmount > 0 && c.status === "ACTIVE"));
  assert.equal(batch.cumulativeMarginCalls, 0);
  initializeBatchFinance(batch);
  assert.deepEqual(batch.finance!.legacyWarnings, []);
  assert.equal(batch.finance!.trades.length, 0);
  assert.equal(Object.keys(batch.finance!.settlements).length, 0);
}
const critical = (data.batches as BatchLike[]).filter((b) => summarizeBatchMarginFromClients(b).totalPending > 0);
assert.equal(critical.length, 2);
for (const original of critical) {
  const batch = structuredClone(original);
  const before = summarizeBatchMarginFromClients(batch).totalPending;
  const customer = batch.clients![0];
  const others = structuredClone(batch.clients!.slice(1).map((c) => c.marginState));
  const amount = executeInstitutionTopup(batch, { clientId: customer.id, amount: customer.marginState!.required });
  assert.ok(amount > 0);
  near(summarizeBatchMarginFromClients(batch).totalPending, before - amount);
  assert.deepEqual(batch.clients!.slice(1).map((c) => c.marginState), others);
  executeInstitutionTopup(batch, { amount: summarizeBatchMarginFromClients(batch).totalPending });
  near(summarizeBatchMarginFromClients(batch).totalPending, 0);
  const settlement = settleClientPosition(batch, customer.id);
  assert.ok(settlement.clientReceives > 0);
  assert.deepEqual(batch.finance!.settlements[customer.id], settlement);
}
records.set("risk_control_settings", '{"vipClient":45}');
records.set("rbac_mock_session_v1", "preserve-session");
records.set("risk_control_logo_v1", "preserve-logo");
records.set("risk_control_client_status_v1", "legacy-status");
records.set("risk_control_mock_margin_patches_v1", "legacy-patches");
records.set(FINANCE_STORE_KEY, "{}");
const before = new Map(records);
assert.throws(() => resetMockTestData(), /本地开发/);
assert.deepEqual(records, before);
Object.assign(process.env, { NODE_ENV: "development" });
failKey = FINANCE_STORE_KEY;
assert.throws(() => resetMockTestData(), /Quota/);
assert.equal(records.get(FINANCE_STORE_KEY), "{}");
assert.equal(records.get("risk_control_client_status_v1"), "legacy-status");
failKey = "";
const result = resetMockTestData();
assert.equal(result.clients, 78);
assert.equal(records.get("risk_control_settings"), '{"vipClient":45}');
assert.equal(records.get("rbac_mock_session_v1"), "preserve-session");
assert.equal(records.get("risk_control_logo_v1"), "preserve-logo");
assert.equal(records.has("risk_control_client_status_v1"), false);
assert.equal(records.has("risk_control_mock_margin_patches_v1"), false);
assert.equal(JSON.parse(records.get(result.backupKey)!).records[FINANCE_STORE_KEY], "{}");
assert.throws(() => commitBatchFinance(critical[0], () => {}), /其他页面/);
const loaded = getMockData().batches.find((b) => b.id === critical[0].id)!;
commitBatchFinance(loaded, (draft) => executeInstitutionTopup(draft, { amount: 100 }));
const saved = JSON.parse(records.get(FINANCE_STORE_KEY)!)[loaded.id].batch;
near(saved.cumulativeMarginCalls, 100);
assert.deepEqual(saved.finance.legacyWarnings, []);
const updatedStore = JSON.parse(records.get(FINANCE_STORE_KEY)!);
updatedStore[loaded.id].batch.finance.revision++;
updatedStore[loaded.id].batch.finance.legacyWarnings = ["存在无成交快照的历史结算"];
records.set(FINANCE_STORE_KEY, JSON.stringify(updatedStore));
assert.equal(isTopupBlockedByLegacyLedger(loaded), false);
const reloaded = reloadMockData().batches.find(b => b.id === loaded.id)!;
assert.notEqual(reloaded, loaded);
assert.equal(isTopupBlockedByLegacyLedger(reloaded), true);
assert.throws(() => commitBatchFinance(reloaded, draft => executeInstitutionTopup(draft, { amount: 100 })), /查看处理方法/);
const stableStore = records.get(FINANCE_STORE_KEY);
reloadMockData();
assert.equal(records.get(FINANCE_STORE_KEY), stableStore);
console.log("PASS: fresh 8 batches / 78 clients, deterministic identities, exact principal, two topup scenarios, single/batch topups, settlement, reset backup, preserved settings, quota failure, stale-tab rejection and persistence.");
