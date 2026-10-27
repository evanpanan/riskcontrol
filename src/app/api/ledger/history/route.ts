import {NextRequest} from 'next/server';
import {currentUser,json} from '@/lib/server/http';
import {readValuationHistory} from '@/lib/server/valuationHistory';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){const user=await currentUser(req);if(!user)return json({error:'未登录'},401);const since=new Date(req.nextUrl.searchParams.get('since') ?? Date.now()-30*86400000);if(!Number.isFinite(since.getTime()))return json({error:'日期无效'},400);try{return json(await readValuationHistory(user,since));}catch{return json({error:'无法读取历史记录，请联系管理员检查数据库及查询容量'},503);}}
