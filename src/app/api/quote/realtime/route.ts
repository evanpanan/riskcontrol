import { NextResponse } from "next/server";
import { fetchSessionQuote } from "@/lib/server/sessionQuote";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: "symbol required" }, { status: 400 });
    }
    const data = await fetchSessionQuote(symbol);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3, stale-while-revalidate=10",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e || "failed") },
      { status: 502 },
    );
  }
}
