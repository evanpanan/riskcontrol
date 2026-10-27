import {NextRequest} from 'next/server';
import {currentUser,json} from '@/lib/server/http';
import {monitorRecipients} from '@/lib/server/riskMonitor';
import {notificationReadiness} from '@/lib/server/notificationDelivery';
import {prisma} from '@/lib/prisma';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){const user=await currentUser(req);if(!user)return json({error:'未登录'},401);if(user.role!=='ADMIN'&&user.role!=='RISK_MANAGER')return json({error:'无权限'},403);try{const last=await prisma.monitorRun.findFirst({orderBy:{startedAt:'desc'}});const uncertain=await prisma.riskNotification.count({where:{status:{in:['UNKNOWN','SENDING']}}});const pending=await prisma.riskNotification.count({where:{status:'PENDING'}});const recent=!!last?.completedAt && Date.now()-last.completedAt.getTime()<10*60000;const configured=process.env.MONITOR_ENABLED==='true'&&process.env.MONITOR_NOTIFICATIONS_ENABLED==='true'&&monitorRecipients().valid&&notificationReadiness().email.ready;const ready=configured&&last?.status==='OK'&&recent&&!pending&&!uncertain;return json({database:'OK',monitor:{lastRun:last,recent,configured},notifications:{pending,uncertain},operationalMonitorReady:ready,productionSignoff:'REQUIRES_DEPLOYMENT_RESTORE_RECONCILIATION_AND_CONTRACT_ACCEPTANCE'},ready?200:503);}catch{return json({error:'数据库或运行状态不可用'},503);}}
