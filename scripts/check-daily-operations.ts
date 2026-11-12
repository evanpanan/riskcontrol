import assert from 'node:assert/strict';
import { ClientStatus } from '@prisma/client';
import { initializeBatchFinance, executeInstitutionTopup, calculateRescueStats, getBatchMetrics, settleClientPosition, requestClientExit, type BatchLike } from '../src/lib/riskEngine';
import { dailyCaptureDate, marketDate, candleDate, summarizeDailyBatch } from '../src/lib/batchDaily';
import { parseBackupPolicy, backupEmailDue } from '../src/lib/backupPolicy';
import { encryptBackup, decryptBackup, backupSha256 } from '../src/lib/server/backupCrypto';
import { validateSpecialExitWrite } from '../src/lib/server/specialExitGuard';
import { deliverNotification } from '../src/lib/server/notificationDelivery';
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);
function make(price = 70): BatchLike {
  const b = { id: 'test', batchNumber: 'TEST', stockSymbol: 'TEST', stockPriceAtStart: 100, currentStockPrice: price, initialTotalAmount: 1000000, priorityAmount: 700000, subordinateAmount: 300000, totalShares: 10000, cumulativeMarginCalls: 0, marginCalls: [], signDate: new Date(), maturityDate: new Date(Date.now() + 730 * 86400000), clients: [{ id: 'a', batchId: 'test', name: 'A', bdManager: 'B', investmentAmount: 700000, status: ClientStatus.ACTIVE, signDate: new Date(), profitSplitClient: 40, profitSplitInstitution: 60 }] } as BatchLike;
  initializeBatchFinance(b); return b;
}
async function main() {
  const stock = make(); const required = getBatchMetrics(stock).requiredMarginCall;
  near(executeInstitutionTopup(stock, { amount: required }), required);
  near(calculateRescueStats(stock, 70).totalRescueShares, required / 70);
  near(calculateRescueStats(stock, 140).rescueCurrentValue, required * 2);
  const cash = make(); executeInstitutionTopup(cash, { amount: required, collateralType: 'cash' });
  near(calculateRescueStats(cash, 140).rescueCurrentValue, required);
  near(calculateRescueStats(cash, 140).unpricedAmount!, 0);
  near(calculateRescueStats(cash, 140).totalRescueShares, 0);
  const mixed = make(); executeInstitutionTopup(mixed, { amount: required / 2, collateralType: 'cash' }); executeInstitutionTopup(mixed, { amount: required / 2, collateralType: 'stock' });
  near(calculateRescueStats(mixed, 140).weightedAverageEntryPrice, 70);
  console.log('PASS equivalent stock/cash, default stock, mixed valuation');
  const locked = make(100); const previous = structuredClone(locked);
  assert.throws(() => requestClientExit(locked, 'a'), /锁仓期/);
  assert.throws(() => settleClientPosition(locked, 'a', { force: true }), /二次确认/);
  const settled = settleClientPosition(locked, 'a', { force: true, confirmLockedExit: true, operatorName: 'Admin' });
  assert.ok(settled.lockupExitConfirmedAt); near(settled.earlyExitFee!, 7000);
  assert.equal(validateSpecialExitWrite({ batch: previous }, { batch: locked }, 'ADMIN'), null);
  assert.match(validateSpecialExitWrite({ batch: previous }, { batch: locked }, 'OPERATIONS')!, /仅管理员/);
  const missing = structuredClone(locked); delete missing.finance!.settlements.a.lockupExitConfirmedAt;
  assert.match(validateSpecialExitWrite({ batch: previous }, { batch: missing }, 'ADMIN')!, /二次确认/);
  console.log('PASS lockup explicit confirmation, role enforcement, fee unchanged');
  assert.equal(dailyCaptureDate(new Date('2026-11-12T20:59:00Z')), null);
  assert.equal(dailyCaptureDate(new Date('2026-11-12T22:00:00Z')), '2026-11-12');
  assert.equal(dailyCaptureDate(new Date('2026-07-15T21:00:00Z')), '2026-07-15');
  assert.equal(dailyCaptureDate(new Date('2026-11-14T23:00:00Z')), null);
  assert.equal(candleDate(Date.parse('2026-11-12T00:00:00Z')), '2026-11-12');
  assert.equal(candleDate(Date.parse('2026-11-12T14:30:00Z')), '2026-11-12');
  const day = summarizeDailyBatch(stock, marketDate(new Date()), 140);
  near(day.topupAmount, required); near(day.topups.reduce((s, t) => s + t.shares, 0), required / 70);
  assert.equal(day.price, 140); assert.ok(Number.isFinite(day.yieldPct));
  const cashDay = summarizeDailyBatch(cash, marketDate(new Date()), 140); near(cashDay.cash, required);
  console.log('PASS NY DST close, weekend exclusion, actual topup markers/daily valuation');
  const policy = parseBackupPolicy({ enabled: true, emails: ['A@domain.test', 'a@domain.test'], everyDays: 7, sendHour: 8 });
  assert.equal(policy.emails.length, 1);
  assert.equal(backupEmailDue(policy, new Date('2026-11-06T00:00:00Z'), new Date('2026-11-13T00:00:00Z')), true);
  assert.equal(backupEmailDue(policy, new Date('2026-11-07T00:00:00Z'), new Date('2026-11-13T00:00:00Z')), false);
  assert.equal(backupEmailDue(policy, null, new Date('2026-11-12T23:59:00Z')), false);
  assert.throws(() => parseBackupPolicy({ ...policy, emails: ['bad'] }));
  const key = 'independent-backup-key-'.repeat(3); const data = { format: 'riskcontrol-json-v1', secret: 'private', table: [1, 2] };
  const bytes = encryptBackup(data, key); assert.deepEqual(decryptBackup(bytes, key), data);
  assert.ok(!bytes.includes(Buffer.from('private'))); assert.equal(backupSha256(bytes).length, 64);
  assert.throws(() => decryptBackup(bytes, 'wrong-key'.repeat(5)));
  const bad = Buffer.from(bytes); bad[bad.length - 1] ^= 1; assert.throws(() => decryptBackup(bad, key));
  console.log('PASS schedule, validation, encryption roundtrip, wrong key/tamper rejection');
  const originalFetch = globalThis.fetch;
  const attachment = { filename: 'daily.rcbackup', content: bytes.toString('base64'), contentType: 'application/octet-stream' };
  try {
    for (const provider of ['RESEND_API_KEY', 'POSTMARK_SERVER_TOKEN', 'SENDGRID_API_KEY', 'EMAIL_WEBHOOK_URL']) {
      let body: any;
      globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ ErrorCode: 0 }), { status: 200 }); };
      const env = { [provider]: provider === 'EMAIL_WEBHOOK_URL' ? 'https://notify.domain.test' : 'live-secret-token', NOTIFICATION_FROM_EMAIL: 'sender@domain.test' };
      const result = await deliverNotification({ channel: 'email', payload: { title: '备份', message: 'test', recipients: { emails: ['owner@domain.test'] } } }, env, [attachment]);
      assert.equal(result.success, true);
      const files = body.attachments ?? body.Attachments; assert.equal(files.length, 1);
      const content = files[0].content ?? files[0].Content; assert.equal(content, attachment.content);
    }
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS attachments across Resend/Postmark/SendGrid/webhook (mock transport, no real mail)');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
