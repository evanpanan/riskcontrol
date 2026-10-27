import { NextRequest, NextResponse } from 'next/server';
import { verifyServerSession } from '@/lib/auth/server';
import { RC_SESSION_COOKIE } from '@/lib/auth/session';
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function currentUser(req: NextRequest) {
  const token = req.cookies.get(RC_SESSION_COOKIE)?.value;
  return token ? verifyServerSession(token) : null;
}
export async function readJson(req: NextRequest, limit = 64 * 1024): Promise<any> {
  const origin=req.headers.get('origin');
  if(origin && new URL(origin).host !== req.headers.get('host')) throw new Error('请求来源无效');
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('请求体必须为 JSON');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('请求体为空');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('请求体过大'); }
    chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请求格式无效');
  return data;
}
