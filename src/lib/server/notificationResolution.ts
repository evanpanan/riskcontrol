import {prisma} from '@/lib/prisma';
import type {AppSessionUser} from '@/types/auth';
export async function resolveNotification(user:AppSessionUser,input:{id:string;resolution:string;evidence:string}){
  if(user.role!=='ADMIN')throw new Error('仅管理员可以确认通知结果');
  if(typeof input.id!=='string'||!['CONFIRMED_SENT','CONFIRMED_NOT_SENT'].includes(input.resolution)||typeof input.evidence!=='string'||input.evidence.trim().length<10||input.evidence.length>2000)throw new Error('请提供通知编号、核验结果与服务商核对凭证（10至2000字）');
  return prisma.$transaction(async tx=>{
    const changed=await tx.riskNotification.updateMany({where:{id:input.id,status:'UNKNOWN'},data:{status:input.resolution==='CONFIRMED_SENT'?'SENT':'PENDING',error:null}});
    if(!changed.count)throw new Error('仅可处置待核对的通知，状态可能已变化');
    await tx.auditLog.create({data:{actorId:user.id,actorEmail:user.email,role:user.role,action:'notification_resolution',resource:input.id,detail:{resolution:input.resolution,evidence:input.evidence.trim()}}});
    return{resolved:true};
  });
}
