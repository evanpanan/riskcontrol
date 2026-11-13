import { prisma } from "@/lib/prisma";
import { resolveSessionUser, unauthorized, jsonNoStore } from "@/lib/server/apiAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await resolveSessionUser();
  if (!user) return unauthorized();
  if (user.role === "BD_MANAGER") {
    return jsonNoStore({ managers: user.bdManagerFullName ? [user.bdManagerFullName] : [] });
  }
  const rows = await prisma.appUser.findMany({
    where: { role: "BD_MANAGER", enabled: true, bdManagerFullName: { not: null } },
    select: { bdManagerFullName: true },
    orderBy: { bdManagerFullName: "asc" },
  });
  return jsonNoStore({ managers: rows.map((row) => row.bdManagerFullName).filter(Boolean) });
}
