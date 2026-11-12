import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
const MAGIC = Buffer.from('RCJSON01\n');
export function assertBackupKey(password = process.env.BACKUP_KEY ?? '') {
  if (password.length < 32) throw new Error('请在服务器配置至少 32 字符的独立 BACKUP_KEY');
  return password;
}
export function encryptBackup(value: unknown, password = assertBackupKey()) {
  assertBackupKey(password);
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  const data = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value)))), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), data]);
}
export function decryptBackup(bytes: Buffer, password: string) {
  assertBackupKey(password);
  const offset = MAGIC.length;
  if (bytes.length < offset + 44 || !bytes.subarray(0, offset).equals(MAGIC)) throw new Error('备份格式无效');
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, bytes.subarray(offset, offset + 16), 32), bytes.subarray(offset + 16, offset + 28));
  decipher.setAuthTag(bytes.subarray(offset + 28, offset + 44));
  const plain = Buffer.concat([decipher.update(bytes.subarray(offset + 44)), decipher.final()]);
  return JSON.parse(gunzipSync(plain).toString('utf8'));
}
export const backupSha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
