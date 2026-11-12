import { NextResponse } from "next/server";
const retired = () => NextResponse.json({ error: "WhatsApp 通知已停用，请使用 Telegram 风控频道" }, { status: 410 });
export const GET = retired;
export const POST = retired;
export const PATCH = retired;
export const DELETE = retired;
