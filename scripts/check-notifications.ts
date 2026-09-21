import assert from "node:assert/strict";
import { deliverNotification, notificationReadiness } from "../src/lib/server/notificationDelivery";
import { sendNotification, setNotificationSendToken } from "../src/lib/notifier";
import { institutionFillIdentity, BROKER_SYNC_ENABLED } from "../src/lib/brokerSync";

const originalFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];
let respond = () => new Response(JSON.stringify({ id: "accepted" }), { status: 200 });
globalThis.fetch = (async (url: any, init?: RequestInit) => {
  calls.push({ url: String(url), init });
  return respond();
}) as typeof fetch;
const env = {
  NOTIFICATION_SEND_TOKEN: "a".repeat(32),
  RESEND_API_KEY: "test-key", NOTIFICATION_FROM_EMAIL: "notice@verified.test",
};
const payload = {
  type: "INFO" as const, severity: "LOW" as const, title: "<test>", message: "Body <script>",
  recipients: { emails: ["one@recipient.test"], whatsapps: [] as string[] }, timestamp: new Date(),
};
async function main() {
  assert.equal(notificationReadiness({}).email.ready, false);
  assert.equal(notificationReadiness(env).email.ready, true);
  const result = await deliverNotification({ channel: "email", payload }, env);
  assert.equal(result.success, true);
  const email = JSON.parse(calls[0].init!.body as string);
  assert.ok(email.html.includes("&lt;script&gt;"));
  assert.equal(calls[0].init!.redirect, "error");
  await assert.rejects(() => deliverNotification({ channel: "sms", payload }, env), /渠道/);
  await assert.rejects(() => deliverNotification({ channel: "email", payload, webhookOverride: "http://127.0.0.1" }, env), /授权/);
  calls = [];
  const waEnv = { NOTIFICATION_SEND_TOKEN: env.NOTIFICATION_SEND_TOKEN,
    TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "secret",
    TWILIO_WHATSAPP_FROM_NUMBER: "+14155238886", TWILIO_WHATSAPP_CONTENT_SID: "HXapproved" };
  const wa = { ...payload, recipients: { emails: [], whatsapps: ["+85291234567", "+85291234568"] } };
  respond = () => calls.length === 2 ? new Response("do-not-expose-secret", { status: 400 })
    : new Response("{}", { status: 200 });
  const partial = await deliverNotification({ channel: "whatsapp", payload: wa }, waEnv);
  assert.equal(partial.success, false);
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.sentTo, ["+85291234567"]);
  assert.ok(!partial.error?.includes("do-not-expose-secret"));
  const params = new URLSearchParams(calls[0].init!.body as string);
  assert.equal(params.get("To"), "whatsapp:+85291234567");
  assert.equal(params.get("From"), "whatsapp:+14155238886");
  assert.equal(params.get("ContentSid"), "HXapproved");
  assert.equal(params.has("Body"), false);
  assert.ok(!/[\n\t]/.test(JSON.parse(params.get("ContentVariables")!)["1"]));
  assert.equal(notificationReadiness({ ...waEnv, TWILIO_WHATSAPP_CONTENT_SID: "" }).whatsapp.ready, false);
  calls = [];
  respond = () => new Response("{}", { status: 200 });
  const meta = await deliverNotification({ channel: "whatsapp", payload: wa }, {
    NOTIFICATION_SEND_TOKEN: env.NOTIFICATION_SEND_TOKEN,
    META_WA_ACCESS_TOKEN: "test-token", META_WA_PHONE_NUMBER_ID: "123",
    META_WA_TEMPLATE_NAME: "risk_alert", META_GRAPH_API_VERSION: "v23.0",
  });
  assert.equal(meta.success, true);
  const metaBody = JSON.parse(calls[0].init!.body as string);
  assert.equal(metaBody.type, "template");
  assert.equal(metaBody.to, "85291234567");
  assert.ok(!/[\n\t]/.test(metaBody.template.components[0].parameters[0].text));
  respond = () => new Response(JSON.stringify({ success: false }), { status: 200 });
  await assert.rejects(() => deliverNotification({ channel: "email", payload }, {
    ...env, EMAIL_WEBHOOK_URL: "https://trusted.test/hook",
  }), /业务失败/);
  respond = () => new Response("rejected", { status: 400 });
  const failed = await deliverNotification({ channel: "email", payload }, env);
  assert.equal(failed.status, "failed");
  assert.equal(failed.success, false);
  calls = [];
  respond = () => new Response(JSON.stringify({ success: false, sentTo: [], error: "failed" }), { status: 502 });
  setNotificationSendToken(env.NOTIFICATION_SEND_TOKEN);
  const clientResult = await sendNotification(payload, { emailWebhook: "https://external.test/webhook" });
  assert.equal(clientResult.success, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/notify/send");
  calls = [];
  respond = () => new Response(JSON.stringify({ success: false, sentTo: ["+85291234567"], error: "partial" }), { status: 207 });
  const clientPartial = await sendNotification(wa);
  assert.equal(clientPartial.success, false);
  assert.deepEqual(clientPartial.channels.whatsapp.sentTo, ["+85291234567"]);
  assert.equal(calls.length, 1);
  const identity = { provider: "p", externalAccountId: "a", externalExecutionId: "id" } as any;
  assert.equal(institutionFillIdentity(identity), '["p","a","id"]');
  assert.equal(BROKER_SYNC_ENABLED, false);
  process.stdout.write("PASS: config, validation, HTML escaping, authorized destination, WhatsApp template/address, partial failure, no fallback retry, sync disabled.\n");
}
main().finally(() => { globalThis.fetch = originalFetch; }).catch((err) => { console.error(err); process.exitCode = 1; });
