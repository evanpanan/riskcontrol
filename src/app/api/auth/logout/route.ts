import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tokenDigest } from '@/lib/auth/server';
import { buildClearCookieHeader, RC_SESSION_COOKIE } from '@/lib/auth/session';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const token = req.cookies.get(RC_SESSION_COOKIE)?.value;
  try {
    if (token) await prisma.$transaction(async tx=>{
      const session=await tx.session.findUnique({where:{token:tokenDigest(token)},include:{user:true}});
      await tx.session.deleteMany({where:{token:tokenDigest(token)}});
      if(session) await tx.auditLog.create({data:{actorId:session.userId,actorEmail:session.user.email,role:session.user.role,action:'logout',resource:'auth:logout'}});
    });
    return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': buildClearCookieHeader(), 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: '登出失败，请重试' }, { status: 503 });
  }
}
