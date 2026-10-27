import { prisma } from '@/lib/prisma';
export const DEFAULT_SETTINGS={warningThreshold:15,marginThreshold:20,vipThreshold:100000,vipClient:40,normalClient:30};
export async function financialSettings() {const row=await prisma.appConfig.findUnique({where:{id:'finance'}});return {...DEFAULT_SETTINGS,...(row?.value as object ?? {})};}
