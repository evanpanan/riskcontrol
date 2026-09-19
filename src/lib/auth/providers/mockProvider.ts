import {
  APP_ROLES,
  type AppSessionUser,
  type MockUserKey,
  MOCK_USER_META,
} from '@/types/auth';

const MOCK_LS_KEY = 'rbac_mock_session_v1';
const CUSTOM_USERS_LS_KEY = 'risk_control_users_v1';

interface CustomUserStored {
  id: string;
  displayName: string;
  email: string;
  role: 'RISK_MANAGER' | 'BD_MANAGER' | 'OPERATIONS';
  whatsapp?: string;
  bdManagerFullName?: string;
  avatarInitials: string;
  enabled: boolean;
  createdAt: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getCustomMockUsers(): Record<string, typeof MOCK_USER_META[keyof typeof MOCK_USER_META]> {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(CUSTOM_USERS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CustomUserStored[];
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, typeof MOCK_USER_META[keyof typeof MOCK_USER_META]> = {};
    for (const u of parsed) {
      if (!u.enabled) continue;
      const key = `custom_${u.id}` as MockUserKey;
      const role =
        u.role === 'RISK_MANAGER'
          ? APP_ROLES.RISK_MANAGER
          : u.role === 'BD_MANAGER'
          ? APP_ROLES.BD_MANAGER
          : APP_ROLES.OPERATIONS;
      const roleShort =
        role === APP_ROLES.RISK_MANAGER ? '风控总监' : role === APP_ROLES.BD_MANAGER ? 'BD经理' : '运营';
      out[key] = {
        id: u.id,
        email: u.email,
        role,
        displayName: u.displayName,
        avatarInitials: u.avatarInitials || 'US',
        bdManagerFullName: u.bdManagerFullName,
        menuLabel: `${roleShort} · ${u.displayName}`,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function getAllMockUsersMeta(): typeof MOCK_USER_META {
  const custom = getCustomMockUsers();
  return { ...MOCK_USER_META, ...custom } as any;
}

export function getStoredSession(): AppSessionUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(MOCK_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppSessionUser;
    if (
      typeof parsed === 'object' &&
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.email === 'string' &&
      typeof parsed.displayName === 'string' &&
      typeof parsed.role === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(u: AppSessionUser): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(MOCK_LS_KEY, JSON.stringify(u));
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(MOCK_LS_KEY);
  } catch {
    /* ignore */
  }
}

export function createDefaultRiskManagerSession(): AppSessionUser {
  return {
    id: MOCK_USER_META.risk_evan.id,
    email: MOCK_USER_META.risk_evan.email,
    role: APP_ROLES.RISK_MANAGER,
    displayName: MOCK_USER_META.risk_evan.displayName,
    avatarInitials: MOCK_USER_META.risk_evan.avatarInitials,
  };
}

export function createMockSessionByKey(key: MockUserKey): AppSessionUser {
  const meta = MOCK_USER_META[key];
  return {
    id: meta.id,
    email: meta.email,
    role: meta.role,
    displayName: meta.displayName,
    avatarInitials: meta.avatarInitials,
    bdManagerFullName: meta.bdManagerFullName,
  };
}
