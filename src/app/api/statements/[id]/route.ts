import { prisma } from "@/lib/prisma";
import {
  resolveSessionUser,
  unauthorized,
  forbidden,
  jsonNoStore,
} from "@/lib/server/apiAuth";
import { canReadStatement } from "@/lib/server/monthlyStatements";
export const dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const row = await prisma.monthlyStatement.findUnique({
    where: { id },
    select: {
      id: true,
      month: true,
      customerKey: true,
      report: true,
      generatedAt: true,
    },
  });
  if (!row || !(await canReadStatement(row, user)))
    return forbidden("无权查看该月结单");
  return jsonNoStore(row);
}
