import {NextRequest} from 'next/server';
import {currentUser,json,readJson} from '@/lib/server/http';
import {prisma} from '@/lib/prisma';
import {resolveNotification} from '@/lib/server/notificationResolution';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){const user=await currentUser(req);if(!user)return json({error:'未登录'},401);if(!['ADMIN','RISK_MANAGER'].includes(user.role))return json({error:'无权限'},403);return json({notifications:await prisma.riskNotification.findMany({where:{status:{in:['UNKNOWN','PENDING','SENDING']}},orderBy:{createdAt:'asc'},take:100})});}
export async function POST(req:NextRequest){const user=await currentUser(req);if(!user)return json({error:'未登录'},401);if(user.role!=='ADMIN')return json({error:'无权限'},403);try{return json(await resolveNotification(user,await readJson(req)));}catch(e){return json({error:(e as Error).message},409);}}
