/**
 * 加密备份 CLI
 *
 * 备份：npm run db:backup -- /secure/offsite/ledger-YYYYMMDD.rcbackup
 * 恢复：npm run db:backup -- restore /secure/offsite/ledger-YYYYMMDD.rcbackup
 *
 * 需要环境变量：
 *   DATABASE_URL            连接源（备份来源）
 *   BACKUP_KEY              ≥32 字符的独立随机密钥，不得与备份文件一同存放
 *   RESTORE_DATABASE_URL    恢复目标（必须是一个独立的空库）
 *   RESTORE_CONFIRM_DATABASE 精确等于目标库名，用于二次确认
 */
import { backupDatabase, restoreDatabase } from './operations/backup';

async function main() {
  const source = process.env.DATABASE_URL;
  const key = process.env.BACKUP_KEY;
  if (!source || !key) throw new Error('DATABASE_URL and BACKUP_KEY are required');

  if (process.argv[2] === 'restore') {
    if (!process.env.RESTORE_DATABASE_URL || !process.argv[3]) {
      throw new Error('Provide RESTORE_DATABASE_URL and an authenticated backup file');
    }
    console.log(
      JSON.stringify(
        await restoreDatabase(
          process.argv[3],
          source,
          process.env.RESTORE_DATABASE_URL,
          key,
          process.env.RESTORE_CONFIRM_DATABASE ?? ''
        )
      )
    );
    return;
  }

  if (!process.argv[2]) throw new Error('Provide a backup destination path');
  console.log(JSON.stringify(await backupDatabase(source, process.argv[2], key)));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
