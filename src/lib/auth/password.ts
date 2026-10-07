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

const BUILTIN_PASSWORDS: Record<MockUserKey, { password: string; hint?: string }> = {
  admin_root: { password: 'Admin@Risk2026', hint: '仅演示环境可用' },
  risk_evan: { password: 'Evan@Risk2026', hint: '风控总监演示口令' },
  bd_lixiaoming: { password: 'Li@Client2026', hint: '商务经理演示口令' },
  bd_wangsy: { password: 'Wang@Client2026', hint: '商务经理演示口令' },
  bd_zhangzhiq: { password: 'Zhang@Client2026', hint: '商务经理演示口令' },
  bd_liujia: { password: 'Liu@Client2026', hint: '商务经理演示口令' },
};

const BUILTIN_CACHE = new Map<MockUserKey, BuiltInMockAccountRecord>();
const BUILTIN_INIT_PROMISE: Promise<void> | null =
  typeof window === 'undefined' ? null : (async () => {
    const keys = Object.keys(MOCK_USER_META) as MockUserKey[];
    for (const key of keys) {
      const meta = MOCK_USER_META[key];
      if (!meta) continue;
      const cred = BUILTIN_PASSWORDS[key];
      const salt = `mock-builtin-${key}-${meta.id}-s4lt`;
      const passwordHash = await hashPassword(cred?.password ?? String(Date.now()), salt);
      BUILTIN_CACHE.set(key, {
        enabled: true,
        passwordHash,
        salt,
        defaultPasswordHint: cred?.hint,
      });
    }
  })();

export async function getBuiltInMockAccountByEmail(email: string): Promise<(BuiltInMockAccountRecord & { key: MockUserKey }) | null> {
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

export async function resolveMockAccountByIdentifier(
  identifier: string
): Promise<ResolvedMockAccount | null> {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const entries = Object.entries(MOCK_USER_META) as Array<[MockUserKey, typeof MOCK_USER_META[MockUserKey]]>;
  const hit = entries.find(([key, meta]) => key === trimmed || meta.email === trimmed);
  if (!hit) return null;
  const [key, meta] = hit;
  const cred = BUILTIN_PASSWORDS[key];
  const passwordPlain = cred?.password ?? `${key}__${String(Date.now())}`;
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
