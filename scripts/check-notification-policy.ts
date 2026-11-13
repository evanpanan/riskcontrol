import assert from "node:assert/strict";
import {
  dispatchNotification,
  processNotificationDispatch,
  retryPendingNotifications,
  enqueueNotification,
  resolveNotificationEmails,
} from "../src/lib/server/notificationDispatch";
import { parseNotificationPolicy, parseNotificationRecipients } from "../src/lib/notificationPolicy";
import { notificationHarness, testEnv } from "./helpers/notificationHarness";
import { prisma } from "../src/lib/prisma";
const payload = (batchId: string, type = "WARNING", severity = "HIGH") => ({
  batchId,
  type,
  severity,
  title: "Risk alert",
  message: "Verify the position",
  recipients: { emails: ["not-core@recipient.test"] },
});
async function main() {
  const recipients = parseNotificationRecipients({
    accountIds: ["selected", "disabled", "deleted"],
    externalRecipients: [
      { email: " External@recipient.test ", note: " 外部顾问 " },
      { email: "unchecked@recipient.test", note: "" },
    ],
  });
  assert.deepEqual(recipients.externalRecipients[0], {
    email: "external@recipient.test",
    note: "外部顾问",
  });
  assert.deepEqual(resolveNotificationEmails(recipients, [
    { id: "selected", email: "updated@recipient.test", enabled: true },
    { id: "disabled", email: "disabled@recipient.test", enabled: false },
    { id: "unchecked", email: "unchecked@recipient.test", enabled: true },
  ]), ["updated@recipient.test", "external@recipient.test"]);
  const h = notificationHarness();
  const t = h.test;
  try {
    const ordinary = await dispatchNotification(payload("normal"), testEnv);
    assert.equal(ordinary.status, "COMPLETE");
    assert.deepEqual(t.calls, [
      { channel: "telegram", target: testEnv.TELEGRAM_CHANNEL_ID },
    ]);
    const duplicate = await dispatchNotification(payload("normal"), testEnv);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(t.calls.length, 1);
    const upgraded = await dispatchNotification(
      payload("normal", "MARGIN_CALL", "CRITICAL"),
      testEnv,
    );
    assert.equal(upgraded.status, "COMPLETE");
    assert.equal(t.calls.filter((c) => c.channel === "email").length, 1);
    assert.equal(t.calls.at(-1)?.target, "lead@recipient.test");
    assert.ok(t.locks >= 3);
    t.calls.length = 0;
    t.tg = "failed";
    const fallback = await dispatchNotification(payload("fallback"), testEnv);
    assert.equal(fallback.status, "COMPLETE");
    assert.equal(h.rows.get(fallback.dispatchId).state.emailReason, "fallback");
    assert.equal(t.calls.length, 2);
    t.calls.length = 0;
    t.tg = "unknown";
    const unknown = await dispatchNotification(payload("unknown"), testEnv);
    assert.equal(unknown.status, "REVIEW");
    assert.equal(t.calls.filter((c) => c.channel === "email").length, 0);
    h.due(unknown.dispatchId);
    await processNotificationDispatch(unknown.dispatchId, testEnv);
    assert.equal(t.calls.length, 1, "Unknown outcomes must not be retried");
    t.tg = "accepted";
    t.policy.coreEmails = ["lead@recipient.test", "backup@recipient.test"];
    t.badEmails.add("backup@recipient.test");
    t.calls.length = 0;
    const partial = await dispatchNotification(
      payload("partial", "MARGIN_CALL", "CRITICAL"),
      testEnv,
    );
    assert.equal(partial.status, "PENDING");
    assert.equal(partial.channels.email.sentTo.length, 1);
    t.badEmails.clear();
    t.calls.length = 0;
    h.due(partial.dispatchId);
    const completed = await processNotificationDispatch(
      partial.dispatchId,
      testEnv,
    );
    assert.equal(completed.status, "COMPLETE");
    assert.deepEqual(t.calls, [
      { channel: "email", target: "backup@recipient.test" },
    ]);
    t.calls.length = 0;
    t.tg = "unknown";
    t.badEmails.add("backup@recipient.test");
    const mixed = await dispatchNotification(
      payload("mixed", "MARGIN_CALL", "CRITICAL"),
      testEnv,
    );
    assert.equal(mixed.status, "PENDING");
    t.badEmails.clear();
    t.calls.length = 0;
    h.due(mixed.dispatchId);
    assert.equal(
      (await processNotificationDispatch(mixed.dispatchId, testEnv)).status,
      "REVIEW",
    );
    assert.deepEqual(t.calls, [
      { channel: "email", target: "backup@recipient.test" },
    ]);
    t.tg = "failed";
    t.policy.coreEmails = ["lead@recipient.test"];
    t.badEmails.add("lead@recipient.test");
    const retry = await dispatchNotification(payload("old"), testEnv);
    const row = h.rows.get(retry.dispatchId);
    row.createdAt = new Date(Date.now() - 2 * 3600000);
    h.due(row.id);
    t.badEmails.clear();
    t.calls.length = 0;
    await retryPendingNotifications(testEnv);
    assert.equal(h.rows.get(row.id).status, "COMPLETE");
    assert.deepEqual(t.calls, [
      { channel: "email", target: "lead@recipient.test" },
    ]);
    t.tg = "accepted";
    t.policy.criticalEmailEnabled = false;
    t.policy.fallbackEmailEnabled = false;
    t.calls.length = 0;
    await dispatchNotification(
      payload("tg-only", "MARGIN_CALL", "CRITICAL"),
      testEnv,
    );
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].channel, "telegram");
    t.policy.telegramEnabled = false;
    t.calls.length = 0;
    assert.equal(
      (await dispatchNotification(payload("off"), testEnv)).status,
      "SKIPPED",
    );
    assert.equal(t.calls.length, 0);
    t.policy.telegramEnabled = true;
    t.policy.criticalEmailEnabled = true;
    const queued = await enqueueNotification(payload("concurrent"));
    t.calls.length = 0;
    await Promise.all([
      processNotificationDispatch(queued.dispatch.id, testEnv),
      processNotificationDispatch(queued.dispatch.id, testEnv),
    ]);
    assert.equal(
      t.calls.filter((c) => c.channel === "telegram").length,
      1,
      "Only the lease owner sends",
    );
    // Disabling email fallback keeps retrying the primary TG channel without sending email.
    t.policy = {
      ...t.policy,
      telegramEnabled: true,
      criticalEmailEnabled: false,
      fallbackEmailEnabled: true,
      coreEmails: ["lead@recipient.test"],
    };
    t.tg = "failed";
    t.badEmails.add("lead@recipient.test");
    const cancelFallback = await dispatchNotification(
      payload("cancel-fallback"),
      testEnv,
    );
    t.policy.fallbackEmailEnabled = false;
    t.tg = "accepted";
    t.badEmails.clear();
    t.calls.length = 0;
    h.due(cancelFallback.dispatchId);
    assert.equal(
      (await processNotificationDispatch(cancelFallback.dispatchId, testEnv))
        .status,
      "COMPLETE",
    );
    assert.deepEqual(t.calls, [
      { channel: "telegram", target: testEnv.TELEGRAM_CHANNEL_ID },
    ]);
    // An explicit Telegram configuration failure also qualifies for email fallback.
    t.policy = {
      ...t.policy,
      telegramEnabled: true,
      criticalEmailEnabled: true,
      fallbackEmailEnabled: true,
      coreEmails: ["lead@recipient.test"],
    };
    t.calls.length = 0;
    const noTg = await dispatchNotification(payload("no-tg-config"), {
      ...testEnv,
      TELEGRAM_BOT_TOKEN: "",
    });
    assert.equal(noTg.status, "COMPLETE");
    assert.deepEqual(t.calls, [
      { channel: "email", target: "lead@recipient.test" },
    ]);
    // Disabling a paid channel or removing recipients cancels outstanding sends.
    t.tg = "accepted";
    t.badEmails.add("lead@recipient.test");
    const cancelled = await dispatchNotification(
      payload("cancel", "MARGIN_CALL", "CRITICAL"),
      testEnv,
    );
    t.policy.criticalEmailEnabled = false;
    t.calls.length = 0;
    h.due(cancelled.dispatchId);
    assert.equal(
      (await processNotificationDispatch(cancelled.dispatchId, testEnv)).status,
      "COMPLETE",
    );
    assert.equal(t.calls.length, 0);
    t.badEmails.clear();
    t.policy.criticalEmailEnabled = true;
    t.policy.coreEmails = ["lead@recipient.test"];
    t.badEmails.add("lead@recipient.test");
    const removed = await dispatchNotification(
      payload("removed", "MARGIN_CALL", "CRITICAL"),
      testEnv,
    );
    t.policy.coreEmails = ["new-core@recipient.test"];
    t.calls.length = 0;
    h.due(removed.dispatchId);
    await processNotificationDispatch(removed.dispatchId, testEnv);
    assert.equal(
      t.calls.length,
      0,
      "Do not retarget already queued events after a settings edit",
    );
    t.badEmails.clear();
    // The cooldown starts from actual settlement, not an old queued event's creation time.
    t.calls.length = 0;
    const delayed = await dispatchNotification(
      payload("delayed-complete"),
      testEnv,
    );
    const delayedRow = h.rows.get(delayed.dispatchId);
    delayedRow.createdAt = new Date(Date.now() - 2 * 3600000);
    t.calls.length = 0;
    assert.equal(
      (await dispatchNotification(payload("delayed-complete"), testEnv))
        .deduplicated,
      true,
    );
    assert.equal(t.calls.length, 0);
    delayedRow.updatedAt = new Date(Date.now() - 31 * 60000);
    assert.equal(
      (await dispatchNotification(payload("delayed-complete"), testEnv))
        .deduplicated,
      false,
    );
    const round1 = await dispatchNotification(
      {
        ...payload("round", "MARGIN_CALL", "CRITICAL"),
        details: { marginCallId: "round-1" },
      },
      testEnv,
    );
    const round2 = await dispatchNotification(
      {
        ...payload("round", "MARGIN_CALL", "CRITICAL"),
        details: { marginCallId: "round-2" },
      },
      testEnv,
    );
    assert.notEqual(
      round1.dispatchId,
      round2.dispatchId,
      "A new margin round is a new event",
    );
    // A setting changed while Telegram is in flight must stop subsequent paid sends.
    t.policy.criticalEmailEnabled = true;
    t.policy.fallbackEmailEnabled = true;
    t.policy.coreEmails = ["new-core@recipient.test"];
    t.calls.length = 0;
    const transport = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      const response = await transport(url, init);
      if (String(url).includes("api.telegram.org")) {
        t.policy.criticalEmailEnabled = false;
        t.policy.fallbackEmailEnabled = false;
      }
      return response;
    }) as typeof fetch;
    const changedInFlight = await dispatchNotification(
      payload("changed-inflight", "MARGIN_CALL", "CRITICAL"),
      testEnv,
    );
    assert.equal(changedInFlight.status, "COMPLETE");
    assert.equal(t.calls.length, 1);
    globalThis.fetch = transport;
    t.policy.criticalEmailEnabled = true;
    t.policy.fallbackEmailEnabled = true;
    // If the provider accepts but a checkpoint fails, the durable pre-call state stays unknown.
    const db = prisma as any;
    const originalUpdate = db.notificationDispatch.updateMany;
    db.notificationDispatch.updateMany = async (args: any) => {
      if (args.data.state?.telegram?.status === "accepted")
        throw new Error("checkpoint unavailable");
      return originalUpdate(args);
    };
    const fault = await enqueueNotification(payload("checkpoint"));
    t.calls.length = 0;
    await assert.rejects(
      processNotificationDispatch(fault.dispatch.id, testEnv),
    );
    assert.equal(h.rows.get(fault.dispatch.id).status, "REVIEW");
    assert.equal(
      h.rows.get(fault.dispatch.id).state.telegram.status,
      "unknown",
    );
    db.notificationDispatch.updateMany = originalUpdate;
    h.due(fault.dispatch.id);
    await processNotificationDispatch(fault.dispatch.id, testEnv);
    assert.equal(t.calls.length, 1);
    assert.throws(
      () => parseNotificationPolicy({ ...t.policy, coreEmails: [] }),
      /至少/,
    );
    assert.throws(
      () => parseNotificationPolicy({ ...t.policy, coreEmails: ["bad"] }),
      /格式/,
    );
    console.log(
      "PASS policy routing, escalation, core recipients, fallback, unknown outcome review, per-recipient retry, old backlog, switches and concurrency lease",
    );
  } finally {
    h.restore();
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
