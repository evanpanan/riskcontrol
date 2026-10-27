import { NextRequest } from 'next/server';
import { currentUser,json,readJson } from '@/lib/server/http';
import { readLedger } from '@/lib/server/ledger';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
  const user=await currentUser(req);if(!user)return json({mergedRows:[],error:'未登录'},401);
  try{const body=await readJson(req);const batch=(await readLedger(user)).find(b=>b?.id===body.batchId);const rows=batch?.clients ?? [];return json({mergedRows:rows,visibleOwnCount:rows.length,redactedCount:0,totalOriginalCount:rows.length});}catch{return json({mergedRows:[],error:'账本不可用'},503);}
}
