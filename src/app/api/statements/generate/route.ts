import { statementErrorMessage } from "@/lib/server/monthlyStatements";
import {
  resolveSessionUser,
  unauthorized,
  forbidden,
  jsonNoStore,
} from "@/lib/server/apiAuth";
import {
  generateStatement,
  canManageStatements,
} from "@/lib/server/monthlyStatements";
import { statementMonthBounds } from "@/lib/monthlyStatement";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: Request) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (!canManageStatements(user))
    return forbidden("仅管理员和风控总监可生成月结单");
  try {
    const body = await req.json();
    statementMonthBounds(body.month);
    if (
      !Array.isArray(body.keys) ||
      !body.keys.length ||
      body.keys.length > 2 ||
      body.keys.some(
        (k: unknown) => typeof k !== "string" || !/^[a-f0-9]{64}$/.test(k),
      )
    )
      throw new Error("客户列表无效");
    const results = [];
    const prices = new Map<string, Promise<number>>();
    for (const key of body.keys) {
      try {
        results.push({
          key,
          ...(await generateStatement(body.month, key, user, prices)),
        });
      } catch (e) {
        results.push({ key, error: statementErrorMessage(e) });
      }
    }
    return jsonNoStore({ results });
  } catch (e) {
    return jsonNoStore({ error: statementErrorMessage(e) }, 400);
  }
}
