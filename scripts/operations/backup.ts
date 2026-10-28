/**
 * 加密数据库备份与恢复（运维工具）
 *
 * 设计要点：
 *   - 备份：pg_dump 一致性快照 → AES-256-GCM 加密 → 0600 文件权限
 *   - 密钥：独立 BACKUP_KEY（≥32 字符）经 scrypt 派生，不随备份一起存放
 *   - 恢复：先完整校验密文与认证标签，再接触目标库；拒绝同库、拒绝非空库、要求库名精确确认
 *
 * 本工具只做「备份文件」与「目标库」两件事，不自动创建异地存储或调度。
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, mkdir, link, unlink, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';

// 进程环境未提供变量时回退读取本地 .env（生产由编排系统注入，通常不需要）
function loadDotEnvFallback(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* 没有 .env 时忽略 */
  }
}
loadDotEnvFallback();

/** 文件头：MAGIC + salt(16) + iv(12) + authTag(16) */
const MAGIC = Buffer.from('RCBKP01\n');
const HEADER = MAGIC.length + 16 + 12 + 16;

function key(password: string, salt: Buffer): Buffer {
  if (password.length < 32) throw new Error('BACKUP_KEY needs at least 32 independent characters');
  return scryptSync(password, salt, 32);
}

function database(url: string): URL {
  const u = new URL(url);
  if (!['postgresql:', 'postgres:'].includes(u.protocol) || !u.pathname.slice(1)) {
    throw new Error('Invalid database URL');
  }
  return u;
}

const PG_ENV_MAP: Record<string, string> = {
  sslrootcert: 'PGSSLROOTCERT',
  sslcert: 'PGSSLCERT',
  sslkey: 'PGSSLKEY',
  connect_timeout: 'PGCONNECT_TIMEOUT',
};

function child(command: string, args: string[], url: string) {
  const db = database(url);
  const ssl = db.searchParams.get('sslmode');
  const extraEnv = Object.fromEntries(
    Object.keys(PG_ENV_MAP).flatMap((k) =>
      db.searchParams.has(k) ? [[PG_ENV_MAP[k], db.searchParams.get(k)!]] : []
    )
  );
  const proc = spawn(command, args, {
    env: {
      ...process.env,
      PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
      PGHOST: db.hostname,
      PGPORT: db.port || '5432',
      PGUSER: decodeURIComponent(db.username),
      PGPASSWORD: decodeURIComponent(db.password),
      ...(ssl ? { PGSSLMODE: ssl } : {}),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let error = '';
  proc.stderr!.on('data', (chunk) => {
    error += chunk.toString();
    if (error.length > 16000) error = error.slice(-16000);
  });
  const done = new Promise<void>((ok, fail) => {
    proc.once('error', () => fail(new Error(`${command} could not start`)));
    proc.once('exit', (code) =>
      code === 0 ? ok() : fail(new Error(`${command} failed; inspect database availability and tool compatibility`))
    );
  });
  done.catch(() => {});
  return { proc, done };
}

export async function backupDatabase(url: string, destination: string, password: string) {
  process.umask(0o077);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(password, salt), iv);
  const path = resolve(destination);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  try {
    await stat(path);
    throw new Error('Backup destination already exists');
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }

  const partial = path + `.partial-${randomBytes(6).toString('hex')}`;
  const file = await open(partial, 'wx', 0o600);
  await file.write(Buffer.concat([MAGIC, salt, iv, Buffer.alloc(16)]));
  await file.close();

  const { proc, done } = child('pg_dump', ['--format=custom', '--no-owner', '--no-privileges'], url);
  try {
    await pipeline(proc.stdout!, cipher, createWriteStream(partial, { flags: 'a', mode: 0o600 }));
    await done;
    const handle = await open(partial, 'r+');
    await handle.write(cipher.getAuthTag(), 0, 16, MAGIC.length + 16 + 12);
    await handle.sync();
    await handle.close();
    await link(partial, path);
    await unlink(partial);
    return { path, encrypted: true, format: 'AES-256-GCM / pg_dump custom' };
  } catch (e) {
    proc.kill('SIGTERM');
    await unlink(partial).catch(() => {});
    throw e;
  }
}

export async function restoreDatabase(
  backup: string,
  sourceUrl: string,
  targetUrl: string,
  password: string,
  confirmation: string
) {
  const source = database(sourceUrl);
  const target = database(targetUrl);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (
    source.hostname === target.hostname &&
    (source.port || '5432') === (target.port || '5432') &&
    source.pathname === target.pathname
  ) {
    throw new Error('Restore target must be a different database');
  }
  if (confirmation !== name) {
    throw new Error('RESTORE_CONFIRM_DATABASE must exactly match target database name');
  }

  process.umask(0o077);
  const temp = await mkdtemp(join(tmpdir(), 'riskcontrol-restore-'));
  const plain = join(temp, 'verified.dump');
  try {
    const input = await open(backup, 'r');
    const header = Buffer.alloc(HEADER);
    const read = await input.read(header, 0, HEADER, 0);
    await input.close();
    if (read.bytesRead !== HEADER || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Invalid backup header');
    }
    const salt = header.subarray(MAGIC.length, MAGIC.length + 16);
    const iv = header.subarray(MAGIC.length + 16, MAGIC.length + 28);
    const tag = header.subarray(MAGIC.length + 28, HEADER);
    const decipher = createDecipheriv('aes-256-gcm', key(password, salt), iv);
    decipher.setAuthTag(tag);
    // 在 pg_restore 接触目标库之前，先完成整个归档的认证校验
    await pipeline(createReadStream(backup, { start: HEADER }), decipher, createWriteStream(plain, { flags: 'wx', mode: 0o600 }));

    const probe = child(
      'psql',
      [
        '-X',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')",
      ],
      targetUrl
    );
    let count = '';
    probe.proc.stdout!.on('data', (chunk) => {
      count += chunk.toString();
    });
    await probe.done;
    if (count.trim() !== '0') {
      throw new Error('Restore refuses a nonempty database; it never deletes or overwrites existing data');
    }

    const restore = child(
      'pg_restore',
      ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname', name, plain],
      targetUrl
    );
    // 目标库名非敏感信息，连接凭证仍通过环境变量传递
    await restore.done;
    return { restored: true, database: name };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
