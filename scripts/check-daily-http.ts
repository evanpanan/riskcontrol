import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { signSessionJwt } from '../src/lib/auth/session';
import { registerSession } from '../src/lib/server/sessionRegistry';
import { hashPasswordPbkdf2 } from '../src/lib/server/passwordKdf';
import { settleClientPosition } from '../src/lib/riskEngine';
async function main() {
  if (process.env.RC_DAILY_TEST_DATABASE !== '1' || !process.env.DATABASE_URL?.includes('127.0.0.1') || !process.env.QA_BASE_URL?.startsWith('http://127.0.0.1:')) throw new Error('Only disposable local test environment');
  const base = process.env.QA_BASE_URL;
  const sessions: Record<string, string> = {};
  for (const [role, bdName] of [['ADMIN', null], ['OPERATIONS', null], ['BD_MANAGER', 'QA'], ['BD_MANAGER', 'OTHER']] as const) {
    const id = `http-${role}-${bdName || 'none'}`; const salt = 'local-qa-salt';
    const user = await prisma.appUser.upsert({ where: { id }, create: { id, email: `${id.toLowerCase()}@qa.test`, displayName: `QA ${role}`, role, avatarInitials: 'QA', bdManagerFullName: bdName, passwordSalt: salt, passwordHash: hashPasswordPbkdf2('QaOnly2026!', salt) }, update: {} });
    const token = await signSessionJwt({ ...user, avatarDataUrl: undefined, bdManagerFullName: bdName ?? undefined });
    assert.equal(await registerSession({ userId: id, token, expiresAt: new Date(Date.now() + 3600000) }), true);
    sessions[bdName || role] = `rc_session_v1=${token}`;
  }
  async function request(path: string, who?: string, body?: any, method?: string) {
    return fetch(base + path, { headers: { ...(who ? { Cookie: sessions[who] } : {}), 'Content-Type': 'application/json' }, method: method || (body ? 'POST' : 'GET'), ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  assert.equal((await request('/api/backup/settings')).status, 401);
  assert.equal((await request('/api/backup/settings', 'OPERATIONS')).status, 403);
  assert.equal((await request('/api/backup/settings', 'ADMIN')).status, 200);
  assert.equal((await request('/api/batches/qa-batch/history', 'QA')).status, 200);
  assert.equal((await request('/api/batches/qa-batch/history', 'OTHER')).status, 403);
  assert.equal((await request('/api/batches/qa-batch/history')).status, 401);
  const archive = await prisma.backupArchive.findFirstOrThrow();
  assert.equal((await request(`/api/backup/download?id=${archive.id}`, 'OPERATIONS')).status, 403);
  const download = await request(`/api/backup/download?id=${archive.id}`, 'ADMIN'); assert.equal(download.status, 200); assert.equal((await download.arrayBuffer()).byteLength, archive.byteLength);
  assert.equal((await request('/api/internal/daily')).status, 401);
  assert.equal((await request('/api/backup/settings', 'ADMIN', { enabled: false, emails: ['owner@qa.test'], everyDays: 7, sendHour: 8 })).status, 200);
  const row = await prisma.workspaceRecord.findUniqueOrThrow({ where: { kind_key: { kind: 'ledger', key: 'qa-batch' } } });
  const root = structuredClone(row.payload) as any;
  settleClientPosition(root.batch, 'qa-client', { force: true, confirmLockedExit: true, operatorName: 'QA' });
  const put = (who: string, payload: unknown) => request('/api/data/store', who, { kind: 'ledger', key: 'qa-batch', payload, opId: randomUUID(), baseRevision: row.revision }, 'PUT');
  assert.equal((await put('OPERATIONS', root)).status, 403);
  const invalid = structuredClone(root); delete invalid.batch.finance.settlements['qa-client'].lockupExitConfirmedAt;
  assert.equal((await put('ADMIN', invalid)).status, 403);
  const result = await put('ADMIN', root); assert.equal(result.status, 200, await result.text());
  assert.equal((await request('/api/data/store', 'ADMIN', { kind: 'config', key: 'risk_control_backup_policy', payload: { enabled: true }, baseRevision: 0 }, 'PUT')).status, 403);
  console.log('PASS live HTTP sessions, admin-only backups/download, BD scope, cron auth, locked exit role+confirmation');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
