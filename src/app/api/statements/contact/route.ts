import { statementErrorMessage } from "@/lib/server/monthlyStatements";
import { prisma } from "@/lib/prisma";
import {
  resolveSessionUser,
  unauthorized,
  forbidden,
  jsonNoStore,
} from "@/lib/server/apiAuth";
import {
  statementCustomers,
  canManageStatements,
  validStatementEmail,
} from "@/lib/server/monthlyStatements";
export async function PUT(req: Request) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!canManageStatements(user)) return forbidden("当前账号只可查看月结单");
  try {
    const { month, key, email } = await req.json();
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key))
      throw new Error("客户无效");
    if (
      typeof email !== "string" ||
      (email.trim() && !validStatementEmail(email.trim()))
    )
      throw new Error("请输入有效邮箱");
    if (
      !(await statementCustomers(month, user)).has(key) &&
      !(await prisma.monthlyStatement.findUnique({
        where: { month_customerKey: { month, customerKey: key } },
      }))
    )
      return forbidden("无权修改该客户邮箱");
    await prisma.$transaction(async (tx) => {
      await tx.clientStatementContact.upsert({
        where: { customerKey: key },
        create: { customerKey: key, email: email.trim(), updatedBy: user.id },
        update: { email: email.trim(), updatedBy: user.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          role: user.role,
          action: "statement_contact_update",
          resource: key,
        },
      });
    });
    return jsonNoStore({ ok: true });
  } catch (e) {
    return jsonNoStore({ error: statementErrorMessage(e) }, 400);
  }
}
