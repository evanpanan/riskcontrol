import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type AppSessionUser } from "@/types/auth";
import {
  buildMonthlyStatement,
  statementMonthBounds,
  statementClientInMonth,
  statementClientEnd,
  type MonthlyStatementReport,
} from "@/lib/monthlyStatement";
import { contractDate } from "@/lib/batchDaily";
import { type BatchLike } from "@/lib/riskEngine";
import { tradingDates, getOrArchiveDailyClose } from "./batchHistoryBackfill";
import { renderStatementPdf } from "./statementPdf";
import {
  deliverNotification,
  notificationReadiness,
} from "./notificationDelivery";
import { unknownNotificationOutcome } from "./notificationErrors";

export function statementErrorMessage(
  error: unknown,
  fallback = "月结单服务暂不可用，请稍后重试",
) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError
  )
    return fallback;
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
    ? error.message.slice(0, 250)
    : fallback;
}
export const validStatementEmail = (value: string) =>
  value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
export const canManageStatements = (user: AppSessionUser) =>
  ["ADMIN", "RISK_MANAGER"].includes(user.role);
export function statementCustomerKey(name: string, bdManager: string) {
  return createHash("sha256").update(`${name}\u0001${bdManager}`).digest("hex");
}
export async function statementCustomers(month: string, user: AppSessionUser) {
  const bounds = statementMonthBounds(month);
  const ledgers = await prisma.workspaceRecord.findMany({
    where: { kind: "ledger" },
    select: { payload: true },
  });
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      bdManager: string;
      clientIds: Set<string>;
      batches: BatchLike[];
    }
  >();
  for (const ledger of ledgers) {
    const batch = (ledger.payload as any)?.batch as BatchLike | undefined;
    if (!batch?.clients) continue;
    for (const c of batch.clients) {
      if (!statementClientInMonth(batch, c, bounds.start, bounds.end)) continue;
      if (
        user.role === "BD_MANAGER" &&
        (!user.bdManagerFullName || c.bdManager !== user.bdManagerFullName)
      )
        continue;
      const name = String(c.name),
        bd = String(c.bdManager ?? "");
      const key = statementCustomerKey(name, bd);
      let g = groups.get(key);
      if (!g) {
        g = { key, name, bdManager: bd, clientIds: new Set(), batches: [] };
        groups.set(key, g);
      }
      g.clientIds.add(c.id);
      if (!g.batches.some((b) => b.id === batch.id)) g.batches.push(batch);
    }
  }
  // Include earlier closed accounts for lifetime net PnL, without adding them
  // to the current month's holdings or cash-flow totals.
  for (const ledger of ledgers) {
    const batch = (ledger.payload as any)?.batch as BatchLike | undefined;
    if (!batch?.clients) continue;
    for (const c of batch.clients) {
      if (contractDate(c.signDate) > bounds.end) continue;
      const group = groups.get(
        statementCustomerKey(String(c.name), String(c.bdManager ?? "")),
      );
      if (!group || group.clientIds.has(c.id)) continue;
      group.clientIds.add(c.id);
      if (!group.batches.some((b) => b.id === batch.id))
        group.batches.push(batch);
    }
  }
  return groups;
}
export async function listStatements(month: string, user: AppSessionUser) {
  const groups = await statementCustomers(month, user);
  const bounds = statementMonthBounds(month);
  const docs = await prisma.monthlyStatement.findMany({
    where: {
      month,
      ...(user.role === "BD_MANAGER"
        ? { customerKey: { in: [...groups.keys()] } }
        : {}),
    },
    select: {
      id: true,
      customerKey: true,
      customerName: true,
      bdManager: true,
      emailStatus: true,
      emailAddress: true,
      lastError: true,
      generatedAt: true,
      sentAt: true,
    },
  });
  const contacts = await prisma.clientStatementContact.findMany({
    where: {
      customerKey: {
        in: [...groups.keys(), ...docs.map((d) => d.customerKey)],
      },
    },
  });
  const emails = new Map(contacts.map((c) => [c.customerKey, c.email]));
  const saved = new Map(docs.map((d) => [d.customerKey, d]));
  const rows = [...groups.values()].map((g) => ({
    key: g.key,
    name: g.name,
    bdManager: g.bdManager,
    email: emails.get(g.key) ?? "",
    accounts: g.batches.reduce(
      (sum, b) =>
        sum +
        (b.clients ?? []).filter(
          (c) =>
            g.clientIds.has(c.id) &&
            statementClientInMonth(b, c, bounds.start, bounds.end),
        ).length,
      0,
    ),
    statement: saved.get(g.key) ?? null,
  }));
  for (const d of docs)
    if (!groups.has(d.customerKey))
      rows.push({
        key: d.customerKey,
        name: d.customerName,
        bdManager: d.bdManager,
        email: emails.get(d.customerKey) ?? "",
        accounts: 0,
        statement: d,
      });
  return rows.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}
export async function canReadStatement(
  doc: { month: string; customerKey: string },
  user: AppSessionUser,
) {
  return (
    user.role !== "BD_MANAGER" ||
    (await statementCustomers(doc.month, user)).has(doc.customerKey)
  );
}
export async function generateStatement(
  month: string,
  key: string,
  user: AppSessionUser,
  prices = new Map<string, Promise<number>>(),
) {
  const existing = await prisma.monthlyStatement.findUnique({
    where: { month_customerKey: { month, customerKey: key } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, skipped: true };
  const group = (await statementCustomers(month, user)).get(key);
  if (!group) throw new Error("客户在该月份没有记录");
  const bounds = statementMonthBounds(month);
  const closingDate = tradingDates(bounds.start, bounds.end).at(-1)!;
  const priorFrom = new Date(Date.parse(bounds.previousEnd) - 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  const openingDate = tradingDates(priorFrom, bounds.previousEnd).at(-1)!;
  const values = new Map<string, number>();
  for (const b of group.batches)
    for (const c of b.clients ?? []) {
      if (!group.clientIds.has(c.id)) continue;
      const exit = statementClientEnd(b, c);
      const sign = contractDate(c.signDate);
      const dates = [
        ...(!exit || exit > bounds.end ? [closingDate] : []),
        ...(sign <= bounds.previousEnd && (!exit || exit > bounds.previousEnd)
          ? [openingDate]
          : []),
      ];
      for (const date of dates) {
        const symbol = b.stockSymbol?.trim().toUpperCase();
        if (!symbol) throw new Error("批次缺少股票代码");
        const priceKey = `${symbol}|${date}`;
        if (!prices.has(priceKey))
          prices.set(
            priceKey,
            getOrArchiveDailyClose(symbol, date).then((q) => {
              if (!q) throw new Error(`${symbol} 缺少 ${date} 收盘价`);
              return q.close;
            }),
          );
        values.set(priceKey, await prices.get(priceKey)!);
      }
    }
  const report = buildMonthlyStatement({
    month,
    customerName: group.name,
    bdManager: group.bdManager,
    batches: group.batches,
    clientIds: group.clientIds,
    openingDate,
    closingDate,
    prices: values,
  });
  const pdf = await renderStatementPdf(report);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const row = await tx.monthlyStatement.create({
        data: {
          month,
          customerKey: key,
          customerName: group.name,
          bdManager: group.bdManager,
          report: report as unknown as Prisma.InputJsonValue,
          pdf,
          generatedBy: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          role: user.role,
          action: "statement_generate",
          resource: row.id,
          detail: { month, customerKey: key },
        },
      });
      return row;
    });
    return { id: row.id, skipped: false };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const row = await prisma.monthlyStatement.findUniqueOrThrow({
        where: { month_customerKey: { month, customerKey: key } },
      });
      return { id: row.id, skipped: true };
    }
    throw e;
  }
}
export async function queueStatementEmails(
  month: string,
  user: AppSessionUser,
) {
  const ready = notificationReadiness().email;
  if (!ready.ready) throw new Error(ready.issues.join("；"));
  const rows = await listStatements(month, user);
  let queued = 0,
    missing = 0,
    skipped = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const row of rows) {
        if (!row.statement) {
          skipped++;
          continue;
        }
        if (!validStatementEmail(row.email)) {
          missing++;
          continue;
        }
        const result = await tx.monthlyStatement.updateMany({
          where: {
            id: row.statement.id,
            emailStatus: { in: ["DRAFT", "FAILED"] },
          },
          data: {
            emailStatus: "PENDING",
            emailAddress: row.email,
            lastError: null,
          },
        });
        queued += result.count;
      }
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          role: user.role,
          action: "statement_email_queue",
          resource: month,
          detail: { queued, missing, skipped },
        },
      });
    },
    { timeout: 60000, maxWait: 5000 },
  );
  return { queued, missing, skipped };
}
export async function sendPendingStatements(
  limit = 2,
  month?: string,
  env: Record<string, string | undefined> = process.env,
) {
  await prisma.monthlyStatement.updateMany({
    where: {
      emailStatus: "SENDING",
      sendStartedAt: { lt: new Date(Date.now() - 10 * 60000) },
    },
    data: {
      emailStatus: "UNKNOWN",
      lastError: "发送进程中断，受理结果未知，请核查服务商记录",
    },
  });
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const row = await prisma.monthlyStatement.findFirst({
      where: { emailStatus: "PENDING", ...(month ? { month } : {}) },
      orderBy: { generatedAt: "asc" },
    });
    if (!row) break;
    const token = randomUUID();
    const claimed = await prisma.monthlyStatement.updateMany({
      where: { id: row.id, emailStatus: "PENDING" },
      data: {
        emailStatus: "SENDING",
        sendToken: token,
        sendStartedAt: new Date(),
      },
    });
    if (!claimed.count) continue;
    let status = "FAILED",
      error: string | null = null;
    try {
      if (!row.emailAddress || !validStatementEmail(row.emailAddress))
        throw new Error("收件邮箱无效");
      const report = row.report as unknown as MonthlyStatementReport;
      const result = await deliverNotification(
        {
          channel: "email",
          payload: {
            title: `Win100 ${row.month} 客户月结单`,
            message: `${row.customerName}，您好：\n\n附件为您 ${row.month} 的客户月结单，包含本月仓位、收益及资金变动。\n月末预计结算权益：$${report.closingEquity.toFixed(2)}\n\n如有疑问，请联系您的商务经理。\nWin100 / RiskControl`,
            recipients: { emails: [row.emailAddress] },
          },
        },
        env,
        [
          {
            filename: `Win100-${row.month}-${row.customerKey.slice(0, 8)}.pdf`,
            content: Buffer.from(row.pdf).toString("base64"),
            contentType: "application/pdf",
          },
        ],
      );
      status = result.success
        ? "SENT"
        : result.failureKind === "unknown"
          ? "UNKNOWN"
          : "FAILED";
      error = result.error ?? null;
    } catch (e) {
      status = unknownNotificationOutcome(e) ? "UNKNOWN" : "FAILED";
      error = e instanceof Error ? e.message : "邮件发送失败";
    }
    await prisma.$transaction(async (tx) => {
      await tx.monthlyStatement.updateMany({
        where: { id: row.id, sendToken: token, emailStatus: "SENDING" },
        data: {
          emailStatus: status,
          lastError: error,
          sentAt: status === "SENT" ? new Date() : null,
          sendToken: null,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "statement_email_result",
          resource: row.id,
          detail: { month: row.month, status },
        },
      });
    });
    processed++;
  }
  return {
    processed,
    pending: await prisma.monthlyStatement.count({
      where: { emailStatus: "PENDING", ...(month ? { month } : {}) },
    }),
  };
}
