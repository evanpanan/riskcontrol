/** Requires two disposable, migrated and initially EMPTY databases. Never run on production. */
import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { prisma } from '../src/lib/prisma';
import { initializeBatchFinance, executeInstitutionTopup, type BatchLike } from '../src/lib/riskEngine';
import { runBatchDailySnapshotCycle } from '../src/lib/server/batchDailySnapshots';
import { runDailyBackupCycle, backupModels } from '../src/lib/server/dailyBackup';
import { decryptBackup } from '../src/lib/server/backupCrypto';
import { BACKUP_POLICY_KEY } from '../src/lib/backupPolicy';
async function main() {
  if (process.env.RC_DAILY_TEST_DATABASE !== '1' || !process.env.DATABASE_URL?.includes('127.0.0.1') || !process.env.RESTORE_DATABASE_URL?.includes('127.0.0.1')) throw new Error('Requires explicitly enabled localhost disposable databases');
  for (const model of Prisma.dmmf.datamodel.models) {
    if (await (prisma as any)[model.name[0].toLowerCase() + model.name.slice(1)].count()) throw new Error('Refuses a nonempty test source');
  }
  const batch = { id: 'qa-batch', batchNumber: 'QA-001', stockSymbol: 'QA', stockPriceAtStart: 100, currentStockPrice: 70, initialTotalAmount: 1000000, priorityAmount: 700000, subordinateAmount: 300000, totalShares: 10000, cumulativeMarginCalls: 0, marginCalls: [], signDate: new Date('2026-11-01'), maturityDate: new Date('2028-11-01'), clients: [{ id: 'qa-client', batchId: 'qa-batch', name: 'QA', bdManager: 'QA', investmentAmount: 700000, status: 'ACTIVE', signDate: new Date('2026-11-01') }] } as BatchLike;
  initializeBatchFinance(batch); executeInstitutionTopup(batch, { amount: 100000, collateralType: 'cash' });
  batch.finance!.trades.forEach(t => { t.createdAt = '2026-11-12T19:00:00Z'; });
  await prisma.workspaceRecord.create({ data: { kind: 'ledger', key: batch.id, payload: JSON.parse(JSON.stringify({ batch })) } });
  const history = async () => ({ provider: 'YAHOO_FINANCE' as const, candles: [{ time: Date.parse('2026-11-12T14:30:00Z'), open: 75, high: 76, low: 70, close: 70, volume: 100 }] });
  await Promise.all([runBatchDailySnapshotCycle(new Date('2026-11-12T23:00:00Z'), history), runBatchDailySnapshotCycle(new Date('2026-11-12T23:00:00Z'), history)]);
  assert.equal(await prisma.batchDailySnapshot.count(), 1);
  const snapshot = await prisma.batchDailySnapshot.findFirstOrThrow(); assert.equal((snapshot.summary as any).cash, 100000); assert.equal((snapshot.summary as any).topupAmount, 100000);
  batch.currentStockPrice = 140;
  await prisma.workspaceRecord.update({ where: { kind_key: { kind: 'ledger', key: batch.id } }, data: { payload: JSON.parse(JSON.stringify({ batch })) } });
  await runBatchDailySnapshotCycle(new Date('2026-11-12T23:30:00Z'), history);
  assert.deepEqual((await prisma.batchDailySnapshot.findFirstOrThrow()).summary, snapshot.summary);
  console.log('PASS PostgreSQL immutable daily capture, concurrent dedupe, actual cash/topup');
  await prisma.workspaceRecord.create({ data: { kind: 'config', key: BACKUP_POLICY_KEY, payload: { enabled: true, emails: ['first@qa.test', 'second@qa.test'], everyDays: 1, sendHour: 8 } } });
  const originalFetch = globalThis.fetch; const sent: string[] = []; let failSecond = true;
  process.env.EMAIL_WEBHOOK_URL = 'https://qa.test/mail'; process.env.BACKUP_KEY = 'local-backup-integration-key-'.repeat(3);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); sent.push(body.to[0]);
    assert.ok(body.attachments[0].content);
    if (body.to[0] === 'second@qa.test' && failSecond) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify({ success: true, sentTo: body.to }), { status: 200 });
  };
  try {
    const now = new Date('2026-11-13T00:00:00Z');
    await Promise.all([runDailyBackupCycle(now), runDailyBackupCycle(now)]);
    assert.equal(sent.filter(e => e === 'first@qa.test').length, 1);
    assert.equal(sent.filter(e => e === 'second@qa.test').length, 1);
    failSecond = false; await runDailyBackupCycle(now);
    assert.equal(sent.filter(e => e === 'first@qa.test').length, 1);
    assert.equal(sent.filter(e => e === 'second@qa.test').length, 2);
    const archive = await prisma.backupArchive.findUniqueOrThrow({ where: { backupDate: '2026-11-13' } });
    assert.equal(archive.emailStatus, 'SENT'); assert.equal(await prisma.backupArchive.count(), 1);
    const decoded = decryptBackup(Buffer.from(archive.data), process.env.BACKUP_KEY);
    assert.equal(Object.keys(decoded.tables).length, backupModels.length); assert.equal(decoded.tables.BatchDailySnapshot.length, 1); assert.ok(!decoded.tables.BackupArchive);
    console.log('PASS PostgreSQL complete archive, concurrent email lease, partial retry skips accepted recipients');
    globalThis.fetch = async () => { throw new Error('simulated timeout'); };
    await runDailyBackupCycle(new Date('2026-11-14T00:00:00Z'));
    assert.equal((await prisma.backupArchive.findUniqueOrThrow({ where: { backupDate: '2026-11-14' } })).emailStatus, 'REVIEW');
    globalThis.fetch = async () => { assert.fail('unknown delivery must not retry'); };
    await runDailyBackupCycle(new Date('2026-11-14T00:00:00Z'));
    console.log('PASS PostgreSQL uncertain email outcome retained for review without resend');
    const file = join(tmpdir(), `riskcontrol-qa-${process.pid}.rcbackup`); await writeFile(file, archive.data, { mode: 0o600 });
    try {
      const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/restore-daily-backup.ts', file, '--restore'], { env: process.env }); let output = '';
        child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c); child.once('error', reject); child.once('close', code => resolve({ code, output }));
      });
      assert.equal(result.code, 0, result.output);
      const restored = new PrismaClient({ datasources: { db: { url: process.env.RESTORE_DATABASE_URL } } });
      try {
        assert.equal(await restored.batchDailySnapshot.count(), 1); assert.equal(await restored.workspaceRecord.count(), decoded.tables.WorkspaceRecord.length);
        assert.deepEqual((await restored.batchDailySnapshot.findFirstOrThrow()).summary, snapshot.summary);
        assert.equal(await restored.session.count(), 0);
      } finally { await restored.$disconnect(); }
      console.log('PASS decrypt/restore into migrated EMPTY PostgreSQL preserves history and ledger');
    } finally { await unlink(file); }
  } finally { globalThis.fetch = originalFetch; }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
