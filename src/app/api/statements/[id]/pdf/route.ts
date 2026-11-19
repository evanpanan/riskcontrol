import { prisma } from "@/lib/prisma";
import {
  resolveSessionUser,
  unauthorized,
  forbidden,
} from "@/lib/server/apiAuth";
import { canReadStatement } from "@/lib/server/monthlyStatements";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const row = await prisma.monthlyStatement.findUnique({ where: { id } });
  if (!row || !(await canReadStatement(row, user)))
    return forbidden("无权查看该月结单");
  return new Response(new Uint8Array(row.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${new URL(req.url).searchParams.has("download") ? "attachment" : "inline"}; filename="Win100-${row.month}-${row.customerKey.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
