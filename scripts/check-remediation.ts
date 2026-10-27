import assert from 'node:assert/strict';
import { signSessionJwt,verifySessionJwt } from '../src/lib/auth/session';
import { contractDates,addContractMonths } from '../src/lib/contractDates';
import { getExitEligibility,addBusinessDays,type BatchLike,type ClientLike } from '../src/lib/riskEngine';
import { getNYSEInfo } from '../src/lib/liveQuote';
import { hashServerPassword,verifyServerPassword } from '../src/lib/auth/server';
import { getMockData } from '../src/lib/mockData';
async function main(){
 const env={...process.env};
 try {
  Object.assign(process.env,{NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'production',VERCEL_URL:'public.vercel.app',VERCEL_GIT_COMMIT_SHA:'public-sha'});delete process.env.NEXT_RC_AUTH_SECRET;
  const user={id:'test',email:'test@example.invalid',role:'ADMIN' as const,displayName:'Test',avatarInitials:'TE'};
  await assert.rejects(()=>signSessionJwt(user),/32 characters/);
  process.env.NEXT_RC_AUTH_SECRET='independent-test-secret-at-least-32-characters';
  const a=await signSessionJwt(user);const b=await signSessionJwt(user);assert.notEqual(a,b);assert.equal((await verifySessionJwt(a))?.id,'test');
  assert.equal(getMockData().batches.length,0);console.log('PASS missing secret fails closed on Vercel; unique tokens; production never generates synthetic ledger');
  const hash=await hashServerPassword('TestPassword2026!');assert(await verifyServerPassword('TestPassword2026!',hash));assert(!await verifyServerPassword('wrong',hash));assert.notEqual(hash,await hashServerPassword('TestPassword2026!'));console.log('PASS randomized scrypt passwords');
  assert.equal(addContractMonths('2026-08-31',6).toISOString().slice(0,10),'2027-02-28');
  assert.equal(addContractMonths('2024-02-29',24).toISOString().slice(0,10),'2026-02-28');
  const batch={signDate:'2026-01-01',noticePeriodDays:30,exitWindowMonths:3,exitWindowDays:14} as unknown as BatchLike;
  const client={signDate:'2026-01-01',exitRequestedAt:'2026-09-01'} as unknown as ClientLike;
  assert(getExitEligibility(batch,client,new Date('2026-10-10')).canExit);
  assert(!getExitEligibility(batch,client,new Date('2026-10-27')).canExit);
  assert.equal(getExitEligibility({...batch,noticePeriodDays:90},client,new Date('2026-10-10')).noticePeriodDays,90);
  assert(!getExitEligibility({...batch,noticePeriodDays:90},client,new Date('2026-10-10')).canExit);
  assert.throws(()=>contractDates('invalid'));
  console.log('PASS month-end clamping, leap year, quarterly exit windows and configured notice period');
  assert.equal(addBusinessDays('2026-06-18T18:00:00Z',2).toISOString().slice(0,10),'2026-06-23');
  assert.equal(addBusinessDays('2026-04-02T18:00:00Z',2).toISOString().slice(0,10),'2026-04-07');
  assert(!getNYSEInfo(Date.parse('2026-07-03T15:00:00Z')).isTradingDay);
  assert(!getNYSEInfo(Date.parse('2026-11-27T19:00:00Z')).inRegularSession);
  assert.throws(()=>addBusinessDays('2029-01-01',2),/日历超出/);
  console.log('PASS NYSE holidays, Good Friday, early close and unsupported calendar protection');
 }finally{for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
}
main().catch(e=>{console.error(e);process.exitCode=1});
