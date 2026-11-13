import { NextRequest, NextResponse } from "next/server";
import { resolveSessionUser, unauthorized, forbidden } from "@/lib/server/apiAuth";
import { prisma } from "@/lib/prisma";
import {
  loadNotificationPolicy,
  notificationPolicyWhere,
  resolveNotificationEmails,
  recipientsFromLegacyEmails,
} from "@/lib/server/notificationDispatch";
import {
  parseNotificationPolicy,
  parseNotificationRecipients,
  NOTIFICATION_POLICY_KEY,
} from "@/lib/notificationPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function listAccounts() {
  return prisma.appUser.findMany({
    select: { id: true, email: true, displayName: true, enabled: true },
    orderBy: [{ displayName: "asc" }, { email: "asc" }],
  });
}

export async function GET() {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!["ADMIN", "RISK_MANAGER"].includes(user.role)) return forbidden();
  try {
    const [record, accounts] = await Promise.all([
      prisma.workspaceRecord.findUnique({ where: notificationPolicyWhere }),
      listAccounts(),
    ]);
    const stored = record?.payload as Record<string, unknown> | undefined;
    const policy = stored
      ? parseNotificationPolicy({ ...stored, coreEmails: stored.coreEmails ?? [] }, false)
      : await loadNotificationPolicy();
    const recipients = stored && "accountIds" in stored
      ? parseNotificationRecipients(stored)
      : recipientsFromLegacyEmails(policy.coreEmails, accounts);
    const accountIds = new Set(accounts.map(({ id }) => id));
    recipients.accountIds = recipients.accountIds.filter((id) => accountIds.has(id));
    return NextResponse.json(
      { policy: { ...policy, coreEmails: resolveNotificationEmails(recipients, accounts) }, accounts, recipients },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "通知设置暂时不可用，请联系管理员" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();
  try {
    const raw = await req.json().catch(() => null);
    const accounts = await listAccounts();
    let policy;
    let recipients;
    try {
      recipients = parseNotificationRecipients(raw);
      if (recipients.accountIds.some((id) => !accounts.some((account) => account.id === id)))
        throw new Error("所选账号已变更，请刷新后重新选择");
      if (recipients.externalRecipients.some(({ email }) =>
        accounts.some((account) => account.email.trim().toLowerCase() === email),
      ))
        throw new Error("该邮箱属于系统账号，请通过账号列表设置");
      policy = parseNotificationPolicy({
        ...raw,
        coreEmails: resolveNotificationEmails(recipients, accounts),
      }, false);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "通知策略无效" },
        { status: 400 },
      );
    }
    const payload = {
      telegramEnabled: policy.telegramEnabled,
      criticalEmailEnabled: policy.criticalEmailEnabled,
      fallbackEmailEnabled: policy.fallbackEmailEnabled,
      accountIds: recipients.accountIds,
      externalRecipients: recipients.externalRecipients.map(({ email, note }) => ({ email, note })),
    };
    await prisma.workspaceRecord.upsert({
      where: notificationPolicyWhere,
      create: { kind: "config", key: NOTIFICATION_POLICY_KEY, payload, updatedBy: user.id },
      update: { payload, revision: { increment: 1 }, updatedBy: user.id },
    });
    return NextResponse.json({ policy, recipients, accounts });
  } catch {
    return NextResponse.json({ error: "通知策略保存失败，未生效" }, { status: 503 });
  }
}
