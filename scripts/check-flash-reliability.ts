import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  runFlashMonitorCycle,
  deliverFlashCrashAlert,
} from "../src/lib/server/flashMonitor";
import {
  yahooFinanceRealtime,
  fetchRealtimeWithFallback,
} from "../src/lib/quote/providers";
import { notificationHarness, testEnv } from "./helpers/notificationHarness";
async function main() {
  const h = notificationHarness();
  const originalFetch = globalThis.fetch;
  const db = prisma as any;
  db.quotePricePoint.findMany = async () => [];
  db.quotePricePoint.deleteMany = async () => ({ count: 0 });
  db.flashCrashAlert.findMany = async () => [];
  try {
    const result = await runFlashMonitorCycle({ env: testEnv });
    assert.equal(result.batches, 0);
    assert.equal(result.notificationRetries, 0);
    const sent = await deliverFlashCrashAlert(
      {
        id: "flash",
        sentChannels: [],
        batchId: "b",
        symbol: "TEST",
        windowMinutes: 5,
        dropPercent: 5,
        actualDropPercent: 7,
        highPrice: 100,
        currentPrice: 93,
      },
      { batchId: "b", symbol: "TEST", batchNumber: "b" },
      { emails: [], telegrams: [] },
      testEnv,
      "lease",
    );
    assert.equal(sent.delivered, true);
    assert.ok(h.test.calls.some((c) => c.channel === "telegram"));
    assert.ok(h.test.calls.some((c) => c.channel === "email"));
    const time = Math.floor(Date.now() / 1000) - 3600;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          chart: {
            result: [
              { meta: { regularMarketPrice: 100, regularMarketTime: time } },
            ],
          },
        }),
      );
    assert.equal((await yahooFinanceRealtime("TEST")).updatedAt, time * 1000);
    let checked = 0;
    await assert.rejects(
      fetchRealtimeWithFallback("TEST", () => {
        checked++;
        throw new Error("stale");
      }),
    );
    assert.ok(checked > 0);
    console.log(
      "PASS actual exchange timestamp, provider rejection, no-batch queue cycle and flash policy handoff",
    );
  } finally {
    globalThis.fetch = originalFetch;
    h.restore();
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
