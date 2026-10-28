/**
 * 服务端口令派生（PBKDF2-HMAC-SHA256）。
 *
 * 单一 SHA-256 无法抵抗离线暴力破解：GPU 每秒可试数十亿次。
 * 生产账号口令一律使用带迭代次数的 PBKDF2，并以自描述格式落库，
 * 便于后续无痛提升迭代次数（旧哈希在登录成功时自动升级）。
 *
 * 存储格式：pbkdf2$<iterations>$<derivedHex>，salt 仍独立存放于 passwordSalt 列。
 */
import crypto from 'node:crypto';

export const PBKDF2_PREFIX = 'pbkdf2';
export const PBKDF2_ITERATIONS = 210_000;
export const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

/** 由明文口令与 salt 生成 PBKDF2 自描述哈希。 */
export function hashPasswordPbkdf2(password: string, salt: string): string {
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${derived.toString('hex')}`;
}

/** 是否为本模块生成的 PBKDF2 哈希（否则视为历史 SHA-256 哈希）。 */
export function isPbkdf2Hash(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(`${PBKDF2_PREFIX}$`);
}

/**
 * 校验 PBKDF2 哈希。使用恒定时间比较，避免通过响应时间侧信道推断哈希前缀。
 */
export function verifyPbkdf2(password: string, stored: string, salt: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0 || iterations > 5_000_000) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const derived = crypto.pbkdf2Sync(password, salt, iterations, expected.length, PBKDF2_DIGEST);
  return crypto.timingSafeEqual(derived, expected);
}

export function generateSaltHex(byteLength = 16): string {
  return crypto.randomBytes(byteLength).toString('hex');
}
