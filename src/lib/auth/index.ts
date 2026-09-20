/**
 * Auth 统一入口（演示模式 = Mock Provider；生产可切换）
 * Provider 选择规则（生产扩展点）：
 *  - 默认 NEXT_PUBLIC_AUTH_PROVIDER === 'supabase' → 真实 Supabase Auth
 *  - 否则 (默认) → Mock LS Session 演示模式
 */
export { AuthProvider, useAuthContext, MOCK_USER_META, SESSION_UPDATED_EVENT } from './authProvider';
export type { MockUserKey } from '@/types/auth';
export { useCurrentUser } from './useCurrentUser';
export { logAuthDeny } from './audit';
export {
  APP_ROLES,
  type AppRole,
  type AppSessionUser,
  ALLOWED_ROLES,
  isAllowedRole,
  MOCK_USER_META as MOCK_USER_DEFS,
} from '@/types/auth';

import type { AppRole, AppSessionUser } from '@/types/auth';
import { APP_ROLES } from '@/types/auth';
import type { Batch, Client } from '@prisma/client';

export const INSTITUTION_ROLES: readonly AppRole[] = [
  APP_ROLES.ADMIN,
  APP_ROLES.RISK_MANAGER,
  APP_ROLES.OPERATIONS,
] as const;

export function hasInstitutionView(user: AppSessionUser | null | undefined): boolean {
  if (!user) return false;
  return (INSTITUTION_ROLES as readonly string[]).includes(user.role);
}

export function isBDManager(user: AppSessionUser | null | undefined): boolean {
  return !!user && user.role === APP_ROLES.BD_MANAGER;
}

export function bdOwnershipMatcher(user: AppSessionUser): (bdName?: string) => boolean {
  const needles = new Set<string>();
  if (user?.bdManagerFullName) needles.add(user.bdManagerFullName);
  if (user?.displayName) needles.add(user.displayName);
  const dn = user?.displayName;
  if (dn) {
    needles.add(dn);
    const paren = dn.split('(')[0]?.trim();
    if (paren) needles.add(paren);
    const inside = dn.match(/\(([^)]+)\)/)?.[1];
    if (inside) needles.add(inside);
  }
  return (bdName) => {
    if (!bdName) return needles.size === 0;
    return needles.has(bdName);
  };
}

type BatchWithClients = Batch & { clients?: Client[] | readonly Client[] };

export function filterBatchesForUser<T extends BatchWithClients>(
  batches: readonly T[],
  user: AppSessionUser | null | undefined
): T[] {
  if (!user || hasInstitutionView(user)) return batches.slice();
  const match = bdOwnershipMatcher(user);
  return batches.filter((b) =>
    (b.clients ?? [] as readonly Client[]).some((c: any) => match(c.bdManagerFullName ?? c.bdManager))
  );
}

export function filterClientsForUser<T extends { bdManagerFullName?: string; bdManager?: string }>(
  clients: readonly T[],
  user: AppSessionUser | null | undefined
): T[] {
  if (!user || hasInstitutionView(user)) return clients.slice();
  const match = bdOwnershipMatcher(user);
  return clients.filter((c) => match(c.bdManagerFullName ?? c.bdManager));
}
