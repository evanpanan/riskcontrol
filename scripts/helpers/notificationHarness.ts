import { prisma } from "../../src/lib/prisma";
import {
  DEFAULT_NOTIFICATION_POLICY,
  type NotificationPolicy,
} from "../../src/lib/notificationPolicy";
export const testEnv = {
  NOTIFICATION_SEND_TOKEN: "a".repeat(32),
  TELEGRAM_BOT_TOKEN: "123:test-token",
  TELEGRAM_CHANNEL_ID: "-10012345678",
  RESEND_API_KEY: "test-key",
  NOTIFICATION_FROM_EMAIL: "notice@verified.test",
};
export function notificationHarness() {
  const originalFetch = globalThis.fetch;
  const rows = new Map<string, any>();
  let counter = 0;
  const test = {
    policy: {
      ...DEFAULT_NOTIFICATION_POLICY,
      coreEmails: ["lead@recipient.test"],
    } as NotificationPolicy,
    calls: [] as { channel: string; target: string }[],
    tg: "accepted",
    badEmails: new Set<string>(),
    unknownEmails: new Set<string>(),
    locks: 0,
    rows,
  };
  function match(row: any, where: any): boolean {
    return Object.entries(where || {}).every(([key, value]: [string, any]) => {
      if (key === "OR") return value.some((part: any) => match(row, part));
      const actual = row[key];
      if (value === null) return actual == null;
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if (value.in && !value.in.includes(actual)) return false;
        if (value.gt && actual <= value.gt) return false;
        if (value.gte && actual < value.gte) return false;
        if (value.lte && (actual == null || actual > value.lte)) return false;
        return true;
      }
      return actual === value;
    });
  }
  const db = prisma as any;
  db.workspaceRecord.findUnique = async (args: any) =>
    args.where.kind_key.key === "risk_control_notification_policy"
      ? { payload: structuredClone(test.policy) }
      : null;
  db.workspaceRecord.findMany = async () => [];
  const dispatch = {
    findFirst: async (args: any) =>
      structuredClone(
        [...rows.values()]
          .filter((row) => match(row, args.where))
          .sort((a, b) => b.createdAt - a.createdAt)[0] || null,
      ),
    findMany: async (args: any) =>
      structuredClone(
        [...rows.values()]
          .filter((row) => match(row, args?.where))
          .slice(0, args?.take || 100),
      ),
    findUniqueOrThrow: async (args: any) => {
      const row = rows.get(args.where.id);
      if (!row) throw new Error("not found");
      return structuredClone(row);
    },
    create: async (args: any) => {
      const row = {
        id: `event_${++counter}`,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        leaseUntil: null,
        leaseToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...structuredClone(args.data),
      };
      rows.set(row.id, row);
      return structuredClone(row);
    },
    updateMany: async (args: any) => {
      let count = 0;
      for (const row of rows.values())
        if (match(row, args.where)) {
          for (const [key, value] of Object.entries(args.data) as any) {
            row[key] =
              value && typeof value === "object" && "increment" in value
                ? row[key] + value.increment
                : structuredClone(value);
          }
          row.updatedAt = new Date();
          count++;
        }
      return { count };
    },
  };
  Object.assign(db.notificationDispatch, dispatch);
  db.notificationLog.create = async () => ({});
  db.$transaction = async (fn: any) =>
    fn({
      notificationDispatch: dispatch,
      $executeRaw: async () => {
        test.locks++;
        return 1;
      },
    });
  globalThis.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(init?.body || "{}");
    const tg = String(url).includes("api.telegram.org");
    const target = tg ? String(body.chat_id) : String(body.to?.[0]);
    test.calls.push({ channel: tg ? "telegram" : "email", target });
    if (tg) {
      if (test.tg === "unknown") throw new Error("socket lost");
      return new Response(
        JSON.stringify(
          test.tg === "failed"
            ? { ok: false, error_code: 403 }
            : { ok: true, result: { message_id: 1 } },
        ),
        { status: test.tg === "failed" ? 403 : 200 },
      );
    }
    if (test.unknownEmails.has(target)) throw new Error("socket lost");
    return new Response(JSON.stringify({ id: "accepted" }), {
      status: test.badEmails.has(target) ? 429 : 200,
    });
  }) as typeof fetch;
  return {
    ...test,
    test,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    due: (id: string) => {
      rows.get(id).nextAttemptAt = new Date(0);
    },
  };
}
