import {NextRequest} from 'next/server';
import {authorizedCron,runRiskMonitor} from '@/lib/server/riskMonitor';
import {json} from '@/lib/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
export async function GET(req:NextRequest){if(!authorizedCron(req.headers.get('authorization')))return json({error:'未授权'},401);try{const result=await runRiskMonitor();return json(result,result.status==='OK'||result.status==='BUSY'?200:503);}catch{return json({error:'后台监控失败，请检查服务日志'},503);}}
