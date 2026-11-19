import { statementErrorMessage } from "@/lib/server/monthlyStatements";
import {
  resolveSessionUser,
  unauthorized,
  jsonNoStore,
} from "@/lib/server/apiAuth";
import {
  listStatements,
  canManageStatements,
} from "@/lib/server/monthlyStatements";
import { previousStatementMonth } from "@/lib/monthlyStatement";
import { notificationReadiness } from "@/lib/server/notificationDelivery";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  try {
    const month =
      new URL(req.url).searchParams.get("month") || previousStatementMonth();
    return jsonNoStore({
      month,
      rows: await listStatements(month, user),
      canManage: canManageStatements(user),
      emailReady: notificationReadiness().email.ready,
    });
  } catch (e) {
    return jsonNoStore({ error: statementErrorMessage(e) }, 400);
  }
}
