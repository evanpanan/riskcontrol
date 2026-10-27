import assert from 'node:assert/strict';
import { initializeBatchFinance,addClientPosition,getAccountMarketValue,getBatchMetrics,executeInstitutionTopup,settleClientPosition,calculateBatchPnLSplit,calculateRescueStats,type BatchLike,type ClientLike } from '../src/lib/riskEngine';
import { viewBatch } from '../src/lib/server/ledgerProjection';
const near=(a:number,b:number)=>assert(Math.abs(a-b)<0.03,`${a} != ${b}`);
function batch():BatchLike {const b={id:'ownership',stockSymbol:'TEST',stockPriceAtStart:100,currentStockPrice:100,signDate:'2024-01-01',maturityDate:'2026-01-01',initialTotalAmount:0,priorityAmount:0,subordinateAmount:0,totalShares:0,cumulativeMarginCalls:0,clients:[],marginCalls:[]} as BatchLike;initializeBatchFinance(b);return b;}
function add(b:BatchLike,id:string,bd:string,price:number,amount=70000){b.currentStockPrice=price;const c:ClientLike={id,batchId:b.id,name:id,bdManager:bd,bdUserId:bd,investmentAmount:amount,entryStockPrice:price,signDate:'2024-01-01',status:'ACTIVE',profitSplitClient:40,profitSplitInstitution:60};addClientPosition(b,c);return c;}
const user=(id:string)=>({id,email:'fixture@example.invalid',role:'BD_MANAGER' as const,displayName:'Fixture',avatarInitials:'FX',bdManagerFullName:id});
function ready(c:ClientLike){c.status='EXIT_REQUESTED';c.exitRequestedAt=new Date(Date.now()-20*86400000);}
{
 const b=batch();add(b,'a','A',100);add(b,'b','B',200);
 const before=structuredClone(b);const a=viewBatch(b,user('A'))!,bb=viewBatch(b,user('B'))!;
 near(getAccountMarketValue(a),200000);near(getAccountMarketValue(bb),100000);near(getAccountMarketValue(a)+getAccountMarketValue(bb),getAccountMarketValue(b));assert.deepEqual(b,before);
 assert(!JSON.stringify(a).includes('"bdUserId":"B"'));console.log('PASS different entry prices: 200000 / 100000, additive views, no source mutation or foreign client');
}
{
 const b=batch();const a=add(b,'a','A',100);add(b,'b','B',200,35000);b.currentStockPrice=60;
 // Recompute obligations as a normal price refresh does.
 const {syncBatchFinance}=require('../src/lib/riskEngine');syncBatchFinance(b);
 near(executeInstitutionTopup(b,{clientId:a.id,amount:1500,collateralType:'stock'}),1500);
 b.currentStockPrice=100;syncBatchFinance(b);
 const av=viewBatch(b,user('A'))!,bv=viewBatch(b,user('B'))!;
 near(getAccountMarketValue(av),102500);near(getAccountMarketValue(bv),25000);near(getAccountMarketValue(av)+getAccountMarketValue(bv),getAccountMarketValue(b));
 assert.equal(bv.finance!.trades.length,0);console.log('PASS unequal principal and targeted stock topup remain with their actual owner');
 const before=getAccountMarketValue(b);const foreign=structuredClone(b.finance!.trades.filter(t=>t.clientId!=='a'));ready(a);const settled=settleClientPosition(b,'a');
 near(settled.institutionRescueValue,2500);near(settled.marginCallReturned,1500);near(settled.institutionRescuePnL,1000);near(settled.clientReceives+settled.institutionReceives+getAccountMarketValue(b),before);
 assert.deepEqual(b.finance!.trades.filter(t=>t.clientId!=='a'),foreign);near(calculateRescueStats(b,100).totalRescueAmount,0);
 b.currentStockPrice=200;syncBatchFinance(b);const split=calculateBatchPnLSplit(b,getAccountMarketValue(b));near(split.institutionTotalPnL+split.clientTotalPnL,getBatchMetrics(b).totalPnL+settled.institutionPnL+settled.clientPnL);
 near(getAccountMarketValue(viewBatch(b,user('A'))!),0);near(getAccountMarketValue(viewBatch(b,user('B'))!),50000);console.log('PASS partial exit conserves assets, removes only owned lots, freezes realized PnL and leaves other owner intact');
}
{
 const b=batch();const a=add(b,'a','A',100);const bb=add(b,'b','B',100);b.currentStockPrice=75;require('../src/lib/riskEngine').syncBatchFinance(b);executeInstitutionTopup(b,{clientId:bb.id,amount:2000,collateralType:'cash'});
 const obligation=b.finance!.rounds.find(r=>r.status==='PENDING')!;obligation.status='OVERDUE';const due=obligation.dueDate;const roundId=obligation.id;const foreignRequired=obligation.allocations.b.required;const count=b.finance!.rounds.length;require('../src/lib/riskEngine').syncBatchFinance(b);assert.equal(b.finance!.rounds.length,count);
 const original=structuredClone(b.finance!.trades.find(t=>t.clientId==='b'));ready(a);const before=getAccountMarketValue(b);const result=settleClientPosition(b,'a');assert.deepEqual(b.finance!.trades.find(t=>t.clientId==='b'),original);near(result.clientReceives+result.institutionReceives+getAccountMarketValue(b),before);assert.equal(b.finance!.rounds.find(r=>r.id===roundId)!.dueDate,due);assert.equal(b.finance!.rounds.find(r=>r.id===roundId)!.allocations.b.required,foreignRequired);assert.equal(b.finance!.rounds.find(r=>r.id===roundId)!.status,'OVERDUE');console.log('PASS another client exit preserves foreign cash and overdue obligation without new round or reset deadline');
 b.finance!.trades.push({...b.finance!.trades[0],id:'unknown',clientId:undefined});assert.throws(()=>viewBatch(b,user('B')),/核对归属/);console.log('PASS unassigned legacy rescue lots block misleading per-owner valuation');
}
