import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runFlashMonitorCycle } from "@/lib/server/flashMonitor";
import { runDashboardSnapshotCycle } from "@/lib/server/dashboardSnapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() || process.env.RC_MONITOR_CRON_TOKEN?.trim() || "";
  if (!secret) return false;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const startedAt = Date.now();
  try {
    const now = new Date();
    const [flash, snapshots] = await Promise.all([
      runFlashMonitorCycle({ now }),
      runDashboardSnapshotCycle(now),
    ]);
    return NextResponse.json(
      {
        ok: true,
        flash,
        snapshots,
        elapsedMs: Date.now() - startedAt,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "monitor failed",
        elapsedMs: Date.now() - startedAt,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
