import {NextRequest} from 'next/server';
import {currentUser,json} from '@/lib/server/http';
import {prisma} from '@/lib/prisma';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){const u=await currentUser(req);if(!u)return json({error:'未登录'},401);try{return json({managers:await prisma.appUser.findMany({where:{role:'BD_MANAGER',enabled:true,...(u.role==='BD_MANAGER'?{id:u.id}:{})},select:{id:true,bdManagerFullName:true}})});}catch{return json({error:'商务经理列表不可用'},503);}}
