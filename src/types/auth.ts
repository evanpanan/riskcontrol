export type AppRole = 'RISK_MANAGER' | 'BD_MANAGER' | 'OPERATIONS';

export const APP_ROLES = {
  RISK_MANAGER: 'RISK_MANAGER',
  BD_MANAGER: 'BD_MANAGER',
  OPERATIONS: 'OPERATIONS',
} as const;

export const ALLOWED_ROLES: readonly AppRole[] = [
  APP_ROLES.RISK_MANAGER,
  APP_ROLES.BD_MANAGER,
  APP_ROLES.OPERATIONS,
] as const;

export interface AppSessionUser {
  id: string;
  email: string;
  role: AppRole;
  displayName: string;
  avatarInitials: string;
  bdManagerFullName?: string;
}

export function isAllowedRole(r: unknown): r is AppRole {
  if (typeof r !== 'string') return false;
  return (ALLOWED_ROLES as readonly string[]).includes(r);
}

export type MockUserKey =
  | 'risk_evan'
  | 'bd_lixiaoming'
  | 'bd_wangsy'
  | 'bd_zhangzhiq'
  | 'bd_liujia';

export const MOCK_USER_META: Record<
  MockUserKey,
  {
    id: string;
    email: string;
    role: AppRole;
    displayName: string;
    avatarInitials: string;
    bdManagerFullName?: string;
    menuLabel: string;
  }
> = {
  risk_evan: {
    id: 'user_risk_evan_pan_demo_01',
    email: 'evan.pan@institution.com',
    role: APP_ROLES.RISK_MANAGER,
    displayName: 'Evan Pan (风控总监)',
    avatarInitials: 'EP',
    menuLabel: '风控总监 · Evan Pan',
  },
  bd_lixiaoming: {
    id: 'user_bd_lixiaoming_demo_02',
    email: 'evan.li@institution.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '李晓明 (Evan Li)',
    avatarInitials: 'LXM',
    bdManagerFullName: '李晓明 (Evan Li)',
    menuLabel: 'BD经理 · 李晓明',
  },
  bd_wangsy: {
    id: 'user_bd_wangsy_demo_03',
    email: 'sylvia.wang@institution.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '王思远 (Sylvia Wang)',
    avatarInitials: 'WSY',
    bdManagerFullName: '王思远 (Sylvia Wang)',
    menuLabel: 'BD经理 · 王思远',
  },
  bd_zhangzhiq: {
    id: 'user_bd_zhangzhiq_demo_04',
    email: 'jack.zhang@institution.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '张志强 (Jack Zhang)',
    avatarInitials: 'ZZQ',
    bdManagerFullName: '张志强 (Jack Zhang)',
    menuLabel: 'BD经理 · 张志强',
  },
  bd_liujia: {
    id: 'user_bd_liujia_demo_05',
    email: 'jennifer.liu@institution.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '刘佳 (Jennifer Liu)',
    avatarInitials: 'LJ',
    bdManagerFullName: '刘佳 (Jennifer Liu)',
    menuLabel: 'BD经理 · 刘佳',
  },
};
