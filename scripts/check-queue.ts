/**
 * 资金写入队列回归：连续操作不得丢失后一次提交的幂等键与审计意图。
 * 用本地模拟 fetch 复现「第一笔在途时排入第二笔」的场景，不发送真实外部请求。
 * 运行：npx tsx scripts/check-queue.ts
 */
import assert from "node:assert/strict";

interface CapturedRequest {
  kind: string;
  key: string;
  payload: any;
  baseRevision: number;
  opId?: string;
  audit?: Array<{ action: string; detail?: Record<string, unknown> }>;
}

const requests: CapturedRequest[] = [];
let releaseFirst: (() => void) | null = null;

(globalThis as any).CustomEvent = class CustomEvent {
  constructor(public type: string, public init?: unknown) {}
};
(globalThis as any).window = {
  dispatchEvent: () => {},
  addEventListener: () => {},
};
(globalThis as any).fetch = (url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as CapturedRequest;
  requests.push(body);
  const revision = requests.length + 1;
  const response = {
    status: 200,
    ok: true,
    json: async () => ({ ok: true, revision, version: `v${revision}` }),
  };
  // 第一笔请求挂起，模拟「仍在途」，用于在途期间排入第二笔操作。
  if (requests.length === 1) {
    return new Promise((resolve) => {
      releaseFirst = () => resolve(response);
    });
  }
  return Promise.resolve(response);
};

async function settle(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 2));
}

async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("等待条件超时");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let count = 0;
async function test(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  count++;
  process.stdout.write(`PASS ${name}\n`);
}

const ledgerPayload = (tag: string, revision: number) => ({
  fingerprint: "fp",
  batch: { id: "b1", finance: { revision }, tag },
});

async function main(): Promise<void> {
  const { upsertWorkspaceRecord, flushWorkspaceWrites } = await import("../src/lib/workspaceStore");

  await test("连续资金操作各自携带自己的 opId 与审计意图，不被后续写入覆盖", async () => {
    upsertWorkspaceRecord("ledger", "b1", ledgerPayload("amount100", 2), {
      opId: "first-op",
      audits: [{ action: "margin_topup", detail: { appliedAmount: 100 } }],
    });
    await settle();
    assert.equal(requests.length, 1, "第一笔应已发出并在途");
    assert.equal(requests[0].opId, "first-op");

    // 第一笔仍在途时排入第二笔资金操作。
    upsertWorkspaceRecord("ledger", "b1", ledgerPayload("amount200", 3), {
      opId: "second-op",
      audits: [{ action: "margin_topup", detail: { appliedAmount: 200 } }],
    });
    releaseFirst?.();
    await waitUntil(() => requests.length === 2);
    await flushWorkspaceWrites();
    await settle();

    // 第一笔：原始金额与原始 opId / 审计，绝不被第二笔改写。
    assert.equal(requests[0].payload.batch.tag, "amount100");
    assert.equal(requests[0].opId, "first-op");
    assert.equal(requests[0].audit?.[0]?.detail?.appliedAmount, 100);
    // 第二笔：自己的金额、自己的 opId 与审计，且基于第一笔确认后的版本。
    assert.equal(requests[1].payload.batch.tag, "amount200");
    assert.equal(requests[1].opId, "second-op");
    assert.equal(requests[1].audit?.[0]?.detail?.appliedAmount, 200);
    assert.equal(requests[1].baseRevision, 2);
  });

  await test("普通（非资金）写入仍按最后一次合并，不产生多余请求", async () => {
    upsertWorkspaceRecord("config", "k1", { value: "v1" });
    upsertWorkspaceRecord("config", "k1", { value: "v2" });
    await settle();
    const configRequests = requests.filter((r) => r.kind === "config");
    assert.equal(configRequests.length, 1, "同键普通写入应合并为一次请求");
    assert.deepEqual(configRequests[0].payload, { value: "v2" });
    assert.equal(configRequests[0].opId, undefined);
  });

  process.stdout.write(`\nALL ${count} QUEUE SCENARIOS PASSED\n`);
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
