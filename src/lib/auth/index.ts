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
