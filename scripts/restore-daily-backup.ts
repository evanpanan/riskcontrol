/** Decrypt/validate or restore an encrypted daily logical archive into a NEW EMPTY database.
 * BACKUP_KEY=... npm run db:restore-daily -- file.rcbackup [--restore]
 * Restore additionally requires RESTORE_DATABASE_URL and RESTORE_CONFIRM_DATABASE.
 * No live sessions are reactivated: session rows and login throttle state are skipped on restore.
 */
import { readFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { decryptBackup } from '../src/lib/server/backupCrypto';
import { databaseFingerprint, backupModels } from '../src/lib/server/dailyBackup';
async function main() {
  const file = process.argv[2];
  if (!file || !process.env.BACKUP_KEY) throw new Error('Provide an archive path and BACKUP_KEY');
  const backup = decryptBackup(await readFile(file), process.env.BACKUP_KEY);
  if (backup.format !== 'riskcontrol-json-v1' || !backup.tables || !backup.capturedAt) throw new Error('Unsupported backup format');
  for (const model of backupModels) if (!Array.isArray(backup.tables[model.name])) throw new Error(`Missing table: ${model.name}`);
  if (!process.argv.includes('--restore')) {
    console.log(JSON.stringify({ valid: true, capturedAt: backup.capturedAt, tables: Object.fromEntries(Object.entries(backup.tables).map(([name, rows]) => [name, (rows as any[]).length])) }, null, 2));
    return;
  }
  const target = process.env.RESTORE_DATABASE_URL;
  if (!target) throw new Error('RESTORE_DATABASE_URL is required');
  const dbName = decodeURIComponent(new URL(target).pathname.slice(1));
  if (process.env.RESTORE_CONFIRM_DATABASE !== dbName) throw new Error('RESTORE_CONFIRM_DATABASE must exactly match the target database name');
  if (databaseFingerprint(target) === backup.source) throw new Error('Restore target must be a different database');
  const db = new PrismaClient({ datasources: { db: { url: target } } });
  try {
    await db.$transaction(async tx => {
      // Empty-target check includes every application table, even excluded archive bytes.
      for (const model of Prisma.dmmf.datamodel.models) {
        const delegate = model.name[0].toLowerCase() + model.name.slice(1);
        if (await (tx as any)[delegate].count()) throw new Error('Restore refuses a nonempty target database');
      }
      for (const model of backupModels) {
        if (model.name === 'Session' || model.name === 'AuthThrottle') continue;
        const delegate = model.name[0].toLowerCase() + model.name.slice(1);
        const dates = model.fields.filter(f => f.type === 'DateTime').map(f => f.name);
        const rows = backup.tables[model.name].map((value: any) => {
          const row = { ...value };
          for (const field of model.fields.filter(f => f.kind === 'object')) delete row[field.name];
          for (const name of dates) if (row[name] != null) row[name] = new Date(row[name]);
          for (const field of model.fields.filter(f => f.type === 'Json')) if (row[field.name] === null) row[field.name] = field.isRequired ? Prisma.JsonNull : Prisma.DbNull;
          return row;
        });
        for (let i = 0; i < rows.length; i += 500) await (tx as any)[delegate].createMany({ data: rows.slice(i, i + 500) });
      }
    }, { timeout: 120000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    console.log('Restore complete. Existing login sessions were not restored. Review scheduling/configuration before enabling the new environment.');
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Restore failed'); process.exitCode = 1; });
