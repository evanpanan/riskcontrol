import { statementErrorMessage } from "@/lib/server/monthlyStatements";
import {
  resolveSessionUser,
  unauthorized,
  forbidden,
  jsonNoStore,
} from "@/lib/server/apiAuth";
import {
  canManageStatements,
  queueStatementEmails,
  sendPendingStatements,
} from "@/lib/server/monthlyStatements";
import { statementMonthBounds } from "@/lib/monthlyStatement";
export const maxDuration = 60;
export async function POST(req: Request) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!canManageStatements(user))
    return forbidden("当前账号不可发送客户月结单");
  try {
    const { month, mode } = await req.json();
    statementMonthBounds(month);
    if (mode === "queue")
      return jsonNoStore(await queueStatementEmails(month, user));
    if (mode !== "drain") throw new Error("发送请求无效");
    return jsonNoStore(await sendPendingStatements(2, month));
  } catch (e) {
    return jsonNoStore({ error: statementErrorMessage(e) }, 400);
  }
}
