import {
  MOCK_USER_META,
  type MockUserKey,
  type AppRole,
  isAllowedRole,
} from '@/types/auth';

const TEXT_ENCODER = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function generateSalt(byteLength = 16): string {
  const cryptoObj =
    (typeof globalThis !== 'undefined' && globalThis.crypto) ||
    (typeof window !== 'undefined' && window.crypto);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const arr = new Uint8Array(byteLength);
    cryptoObj.getRandomValues(arr);
    return toHex(arr.buffer);
  }
  let out = '';
  const chars = 'abcdef0123456789';
  for (let i = 0; i < byteLength * 2; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = TEXT_ENCODER.encode(`${salt}::${password}`);
  let digest: ArrayBuffer;
  const cryptoSubtle =
    (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) ||
    (typeof window !== 'undefined' && window.crypto?.subtle);
  if (cryptoSubtle && typeof cryptoSubtle.digest === 'function') {
    digest = await cryptoSubtle.digest('SHA-256', data);
  } else {
    digest = fnv1a256Fallback(data);
  }
  return toHex(digest);
}

function fnv1a256Fallback(data: Uint8Array): ArrayBuffer {
  let h = 0x811c9dc5;
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  const pad = new Uint8Array(32);
  const dv = new DataView(pad.buffer);
  dv.setUint32(0, h >>> 0, false);
  dv.setUint32(4, (~h) >>> 0, false);
  for (let i = 8; i < 32; i += 4) dv.setUint32(i, (h * (i + 1)) >>> 0, false);
  return pad.buffer;
}

export async function verifyPassword(candidate: string, expectedHash: string, salt: string): Promise<boolean> {
  if (!candidate || !expectedHash || !salt) return false;
  const candidateHash = await hashPassword(candidate, salt);
  if (candidateHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidateHash.length; i++) {
    diff |= candidateHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

export interface BuiltInMockAccountRecord {
  enabled: boolean;
  passwordHash: string;
  salt: string;
  defaultPasswordHint?: string;
}

/**
 * 内建演示账号仅在开发环境可用。
 * 生产环境一律禁用，避免演示口令变成生产后门。
 * 需要显式开启/关闭时，用 RC_ENABLE_DEV_MOCK_ACCOUNTS=1 / 0 覆盖。
 */
export function isDevMockAccountsEnabled(): boolean {
  const flag = process.env.RC_ENABLE_DEV_MOCK_ACCOUNTS;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return process.env.NODE_ENV === 'development';
}

/**
 * 开发环境演示口令来源：环境变量 RC_DEV_MOCK_PASSWORDS（JSON 形如 {"admin_root":"..."}）。
 * 源码中不再保存任何明文口令；未配置的账号视为禁用。
 */
function getDevMockPasswords(): Partial<Record<MockUserKey, string>> {
  const raw = process.env.RC_DEV_MOCK_PASSWORDS;
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<MockUserKey, string>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.length > 0) out[k as MockUserKey] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const BUILTIN_CACHE = new Map<MockUserKey, BuiltInMockAccountRecord>();
const BUILTIN_INIT_PROMISE: Promise<void> | null =
  typeof window === 'undefined' || !isDevMockAccountsEnabled()
    ? null
    : (async () => {
        const devPasswords = getDevMockPasswords();
        const keys = Object.keys(MOCK_USER_META) as MockUserKey[];
        for (const key of keys) {
          const meta = MOCK_USER_META[key];
          if (!meta) continue;
          const plain = devPasswords[key];
          const salt = `mock-builtin-${key}-${meta.id}-s4lt`;
          const passwordHash = await hashPassword(
            typeof plain === 'string' && plain.length > 0 ? plain : `${key}::disabled::${meta.id}`,
            salt
          );
          BUILTIN_CACHE.set(key, {
            enabled: typeof plain === 'string' && plain.length > 0,
            passwordHash,
            salt,
            defaultPasswordHint: '开发环境演示账号',
          });
        }
      })();

export async function getBuiltInMockAccountByEmail(email: string): Promise<(BuiltInMockAccountRecord & { key: MockUserKey }) | null> {
  if (!isDevMockAccountsEnabled()) return null;
  if (BUILTIN_INIT_PROMISE) await BUILTIN_INIT_PROMISE;
  const entries = Object.entries(MOCK_USER_META) as Array<[MockUserKey, typeof MOCK_USER_META[MockUserKey]]>;
  const hit = entries.find(([, m]) => m.email === email);
  if (!hit) return null;
  const [key] = hit;
  const rec = BUILTIN_CACHE.get(key);
  return rec ? { ...rec, key } : null;
}

export interface ResolvedMockAccount {
  kind: 'built-in';
  key: MockUserKey;
  id: string;
  email: string;
  role: AppRole;
  displayName: string;
  avatarInitials: string;
  avatarDataUrl?: string;
  bdManagerFullName?: string;
  passwordHash: string;
  salt: string;
}

export interface ResolvedPrismaAccount {
  kind: 'prisma';
  id: string;
  email: string;
  role: AppRole;
  displayName: string;
  avatarInitials: string;
  avatarDataUrl?: string;
  bdManagerFullName?: string;
  passwordHash: string;
  salt: string;
}

export type ResolvedAnyAccount = ResolvedMockAccount | ResolvedPrismaAccount;

export async function resolvePrismaAccountByIdentifier(
  identifier: string,
  prismaOpts?: { skip?: boolean }
): Promise<ResolvedPrismaAccount | null> {
  if (prismaOpts?.skip) return null;
  if (typeof globalThis === 'undefined') return null;
  let prisma: any;
  try {
    const mod = await import('@/lib/prisma');
    prisma = mod?.prisma;
  } catch {
    return null;
  }
  if (!prisma || typeof prisma?.appUser?.findFirst !== 'function') return null;
  if (!identifier) return null;
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  try {
    const where = (() => {
      if (trimmed.includes('@')) {
        return { email: trimmed.toLowerCase() };
      }
      return { OR: [{ id: trimmed }, { email: trimmed }] };
    })();
    const row = await prisma.appUser.findFirst({
      where,
      select: { id: true, email: true, role: true, displayName: true, avatarInitials: true, avatarDataUrl: true, bdManagerFullName: true, passwordHash: true, passwordSalt: true, enabled: true },
    });
    if (!row) return null;
    if (!isAllowedRole(row.role)) return null;
    // 被停用的账号一律禁止登录
    if (row.enabled === false) return null;
    // 口令必须由账号自身携带的 hash + 随机 salt 校验。
    // 未设置口令的账号一律禁止登录（不再派生任何默认口令）。
    if (typeof row.passwordHash !== 'string' || row.passwordHash.length === 0) {
      return null;
    }
    const salt: string =
      typeof row.passwordSalt === 'string' && row.passwordSalt.length > 0
        ? row.passwordSalt
        : `prisma-${row.email}-${row.id}-s4lt-v1`;
    return {
      kind: 'prisma',
      id: String(row.id),
      email: String(row.email),
      role: row.role as AppRole,
      displayName: String(row.displayName),
      avatarInitials: typeof row.avatarInitials === 'string' && row.avatarInitials.length > 0
        ? row.avatarInitials
        : (String(row.displayName || '??').slice(0, Math.min(2, String(row.displayName || '??').length)).toUpperCase()),
      avatarDataUrl: row.avatarDataUrl ?? undefined,
      bdManagerFullName: row.bdManagerFullName ?? undefined,
      passwordHash: row.passwordHash,
      salt,
    };
  } catch {
    return null;
  }
}

export async function resolveAnyAccountByIdentifier(identifier: string): Promise<ResolvedAnyAccount | null> {
  const prisma = await resolvePrismaAccountByIdentifier(identifier);
  if (prisma) return prisma;
  return resolveMockAccountByIdentifier(identifier);
}

export async function resolveMockAccountByIdentifier(
  identifier: string
): Promise<ResolvedMockAccount | null> {
  if (!isDevMockAccountsEnabled()) return null;
  if (!identifier) return null;
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const entries = Object.entries(MOCK_USER_META) as Array<[MockUserKey, typeof MOCK_USER_META[MockUserKey]]>;
  const hit = entries.find(([key, meta]) => key === trimmed || meta.email === trimmed);
  if (!hit) return null;
  const [key, meta] = hit;
  const passwordPlain = getDevMockPasswords()[key];
  if (!passwordPlain) return null;
  const salt = `mock-builtin-${key}-${meta.id}-s4lt`;
  const passwordHash = await hashPassword(passwordPlain, salt);
  if (!isAllowedRole(meta.role)) return null;
  return {
    kind: 'built-in',
    key,
    id: meta.id,
    email: meta.email,
    role: meta.role,
    displayName: meta.displayName,
    avatarInitials: meta.avatarInitials,
    avatarDataUrl: meta.avatarDataUrl,
    bdManagerFullName: meta.bdManagerFullName,
    passwordHash,
    salt,
  };
}

export interface CustomMockAccountRecord {
  id: string;
  enabled: boolean;
  passwordHash: string;
  salt: string;
}

const CUSTOM_USERS_LS_KEY = 'risk_control_users_v1';

interface CustomUserStoredWithPwd {
  id: string;
  displayName: string;
  email: string;
  role: string;
  whatsapp?: string;
  bdManagerFullName?: string;
  avatarInitials: string;
  avatarDataUrl?: string;
  enabled: boolean;
  createdAt: string;
  passwordHash?: string;
  salt?: string;
}

export async function getCustomMockAccountByEmail(email: string): Promise<CustomMockAccountRecord | null> {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_USERS_LS_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as CustomUserStoredWithPwd[];
    if (!Array.isArray(list)) return null;
    const hit = list.find((u) => u.email === email);
    if (!hit) return null;
    let { passwordHash, salt } = hit;
    if (!passwordHash || !salt) {
      salt = generateSalt();
      passwordHash = await hashPassword(`${hit.displayName}@${hit.id.slice(-4)}`, salt);
      try {
        const patched = list.map((u) => (u.id === hit.id ? { ...u, passwordHash, salt } : u));
        window.localStorage.setItem(CUSTOM_USERS_LS_KEY, JSON.stringify(patched));
      } catch { /* ignore */ }
    }
    return {
      id: hit.id,
      enabled: !!hit.enabled,
      passwordHash,
      salt,
    };
  } catch { return null; }
}

export async function hashCustomUserPassword(password: string): Promise<{ passwordHash: string; salt: string }> {
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  return { passwordHash, salt };
}
