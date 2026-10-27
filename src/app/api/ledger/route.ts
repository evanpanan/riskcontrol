import { NextRequest } from 'next/server';
import { currentUser, json, readJson } from '@/lib/server/http';
import { readLedger, mutateLedger, createLedgerBatch, refreshLedgerQuotes, LedgerError } from '@/lib/server/ledger';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req: NextRequest) {
  const user=await currentUser(req);if(!user)return json({error:'未登录'},401);
  try{return json({batches:await readLedger(user),stockHistory:[]});}catch{return json({error:'账本暂不可用，请重试'},503);}
}
export async function POST(req: NextRequest) {
  const user=await currentUser(req);if(!user)return json({error:'未登录'},401);
  try{
    const body=await readJson(req);
    if(body.operation==='create')return json({batch:await createLedgerBatch(user,body.input)});
    if(body.operation==='quotes')return json({batches:await refreshLedgerQuotes(user),stockHistory:[]});
    return json(await mutateLedger(user,body));
  }catch(e){return json({error:e instanceof LedgerError?e.message:'操作未完成，请刷新后重试'},e instanceof LedgerError?e.status:(e as any)?.code==='P2002'?409:503);}
}
