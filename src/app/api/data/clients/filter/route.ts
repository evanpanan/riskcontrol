import { NextRequest } from 'next/server';
import { currentUser,json } from '@/lib/server/http';
import { readLedger } from '@/lib/server/ledger';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
  const user=await currentUser(req);if(!user)return json({filtered:[],error:'未登录'},401);
  try{return json({filtered:(await readLedger(user)).flatMap(b=>b?.clients ?? [])});}catch{return json({filtered:[],error:'账本不可用'},503);}
}
