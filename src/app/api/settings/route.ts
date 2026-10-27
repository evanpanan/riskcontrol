import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUser,json,readJson } from '@/lib/server/http';
import {financialSettings,DEFAULT_SETTINGS} from '@/lib/server/settings';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){if(!await currentUser(req))return json({error:'未登录'},401);try{return json(await financialSettings());}catch{return json({error:'配置不可用'},503);}}
export async function POST(req:NextRequest){
  const user=await currentUser(req);if(!user)return json({error:'未登录'},401);if(user.role!=='ADMIN')return json({error:'仅管理员可修改机构财务规则'},403);
  try{
    const body=await readJson(req);const patch:Record<string,number>={};
    for(const key of Object.keys(DEFAULT_SETTINGS))if(key in body){if(typeof body[key]!=='number'||!Number.isFinite(body[key]))throw new Error('参数无效');patch[key]=body[key];}
    if(!Object.keys(patch).length)return json({error:'未提供配置'},400);
    const value={...await financialSettings(),...patch};
    if(!(value.warningThreshold>0 && value.marginThreshold>value.warningThreshold && value.marginThreshold<=100 && value.vipThreshold>0 && [value.vipClient,value.normalClient].every(x=>x>=0&&x<=100)))return json({error:'阈值或分成比例无效'},400);
    await prisma.$transaction(async tx=>{await tx.appConfig.upsert({where:{id:'finance'},create:{id:'finance',value},update:{value}});await tx.auditLog.create({data:{actorId:user.id,actorEmail:user.email,role:user.role,action:'threshold_update',resource:'finance',detail:value}});});return json({ok:true,...value});
  }catch{return json({error:'配置未保存，请检查输入并重试'},503);}
}
