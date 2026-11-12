import assert from "node:assert/strict";
import { scopedDeliveryPolicy, notificationMessage } from "../src/lib/server/notificationContext";
import { notificationIdentity } from "../src/lib/server/notificationDispatch";
import { initialDispatchState, dispatchStatus } from "../src/lib/notificationPolicy";
import { createHash } from "node:crypto";
const policy = { telegramEnabled: true, criticalEmailEnabled: true, fallbackEmailEnabled: true, coreEmails: [] };
const auto = { batchId: "batch", type: "MARGIN_CALL", severity: "CRITICAL", title: "告警", message: "风险详情" };
const manual = (channel: "email" | "telegram") => ({ ...auto, details: { deliveryContext: { kind: "manual", channel, actorId: "a", actorName: "张三", actorEmail: "a@company.test" } } });
const tg = initialDispatchState(scopedDeliveryPolicy(policy, manual("telegram")), true);
assert.equal(tg.telegram.status, "pending"); assert.equal(tg.emailReason, undefined); assert.deepEqual(tg.emails, {});
tg.telegram = { status: "accepted", sentTo: ["-100123"] }; assert.equal(dispatchStatus(tg), "COMPLETE");
const emailPolicy = scopedDeliveryPolicy({ ...policy, criticalEmailEnabled: false, coreEmails: ["core@company.test"] }, manual("email"));
const email = initialDispatchState(emailPolicy, true); assert.equal(email.telegram.status, "skipped"); assert.equal(email.emails["core@company.test"].status, "pending"); assert.equal(emailPolicy.fallbackEmailEnabled, false);
assert.notEqual(notificationIdentity(manual("email")), notificationIdentity(manual("telegram")));
assert.notEqual(notificationIdentity(manual("telegram")), notificationIdentity(auto));
assert.equal(notificationIdentity(auto), createHash("sha256").update(JSON.stringify(["batch", "MARGIN_CALL", "CRITICAL", "", ""])).digest("hex"));
assert.match(notificationMessage(manual("telegram")), /手动发送.*\n发起人：张三/);
assert.match(notificationMessage(auto), /系统自动提醒/);
console.log("PASS: explicit channel isolation, TG success without email config, manual actor labels, automatic identity/cooldown preserved");
async function checkManualClient() {
  const { notifyBatchChannel } = await import('../src/lib/notifier');
  const original = globalThis.fetch;
  const batch = { id: 'test', batchNumber: 'TEST', stockSymbol: 'TEST', stockPriceAtStart: 100, currentStockPrice: 80, initialTotalAmount: 1000, priorityAmount: 700, subordinateAmount: 300, currentMarketValue: 800, totalShares: 10, cumulativeMarginCalls: 0, signDate: new Date(), maturityDate: new Date(), clients: [], marginCalls: [] } as any;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.mode, 'manual'); assert.equal(body.channel, 'telegram');
      return new Response(JSON.stringify({ status: 'COMPLETE', channels: { telegram: { success: true, sentTo: ['-100123'] } } }));
    };
    assert.equal(await notifyBatchChannel(batch, 'telegram'), 'Telegram发送成功');
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).channel, 'email');
      return new Response(JSON.stringify({ status: 'REVIEW', channels: { email: { success: false, error: '邮箱投递未确认' }, telegram: { success: true } } }));
    };
    await assert.rejects(notifyBatchChannel(batch, 'email'), /邮箱投递未确认/);
    console.log('PASS: manual client sends selected channel only and displays that channel outcome');
  } finally { globalThis.fetch = original; }
}
checkManualClient().catch(e => { console.error(e); process.exitCode = 1; });
