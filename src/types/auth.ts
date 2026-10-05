export type AppRole = 'ADMIN' | 'RISK_MANAGER' | 'BD_MANAGER' | 'OPERATIONS';

export const APP_ROLES = {
  ADMIN: 'ADMIN',
  RISK_MANAGER: 'RISK_MANAGER',
  BD_MANAGER: 'BD_MANAGER',
  OPERATIONS: 'OPERATIONS',
} as const;

export const ALLOWED_ROLES: readonly AppRole[] = [
  APP_ROLES.ADMIN,
  APP_ROLES.RISK_MANAGER,
  APP_ROLES.BD_MANAGER,
  APP_ROLES.OPERATIONS,
] as const;

export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: '系统管理员',
  RISK_MANAGER: '风控总监',
  BD_MANAGER: '商务经理',
  OPERATIONS: '运营',
};

export interface AppSessionUser {
  id: string;
  email: string;
  role: AppRole;
  displayName: string;
  avatarInitials: string;
  avatarDataUrl?: string;
  bdManagerFullName?: string;
}

export function isAllowedRole(r: unknown): r is AppRole {
  if (typeof r !== 'string') return false;
  return (ALLOWED_ROLES as readonly string[]).includes(r);
}

export type MockUserKey =
  | 'admin_root'
  | 'risk_evan'
  | 'bd_lixiaoming'
  | 'bd_wangsy'
  | 'bd_zhangzhiq'
  | 'bd_liujia';

export const MOCK_DEMO_CREDENTIALS: ReadonlyArray<{
  key: MockUserKey; email: string; displayName: string; role: AppRole;
  defaultPassword: string; purpose: string;
}> = [
  {
    key: 'admin_root',
    email: 'admin@riskcontrol.io',
    displayName: '系统管理员 (Administrator)',
    role: APP_ROLES.ADMIN,
    defaultPassword: 'Admin@Risk2026',
    purpose: '系统管理员：客户删除 / 账号管理 / 阈值编辑 / 审计查看',
  },
  {
    key: 'risk_evan',
    email: 'evan.pan@institution.com',
    displayName: 'Evan Pan (风控总监)',
    role: APP_ROLES.RISK_MANAGER,
    defaultPassword: 'Evan@Risk2026',
    purpose: '风控总监：补仓执行 / 客户结算 / 机构通知 / 阈值查看',
  },
  {
    key: 'bd_lixiaoming',
    email: 'evan.li@institution.com',
    displayName: '李晓明 (Evan Li)',
    role: APP_ROLES.BD_MANAGER,
    defaultPassword: 'Li@Client2026',
    purpose: '商务经理：仅可见自有客户与对应批次',
  },
  {
    key: 'bd_wangsy',
    email: 'sylvia.wang@institution.com',
    displayName: '王思远 (Sylvia Wang)',
    role: APP_ROLES.BD_MANAGER,
    defaultPassword: 'Wang@Client2026',
    purpose: '商务经理：仅可见自有客户与对应批次',
  },
  {
    key: 'bd_zhangzhiq',
    email: 'jack.zhang@institution.com',
    displayName: '张志强 (Jack Zhang)',
    role: APP_ROLES.BD_MANAGER,
    defaultPassword: 'Zhang@Client2026',
    purpose: '商务经理：仅可见自有客户与对应批次',
  },
  {
    key: 'bd_liujia',
    email: 'jennifer.liu@institution.com',
    displayName: '刘佳 (Jennifer Liu)',
    role: APP_ROLES.BD_MANAGER,
    defaultPassword: 'Liu@Client2026',
    purpose: '商务经理：仅可见自有客户与对应批次',
  },
];

export const MOCK_USER_META: Record<
  MockUserKey,
  {
    id: string;
    email: string;
    role: AppRole;
    displayName: string;
    avatarInitials: string;
    avatarDataUrl?: string;
    bdManagerFullName?: string;
    menuLabel: string;
  }
> = {
  admin_root: {
    id: 'user_admin_root_demo_00',
    email: MOCK_DEMO_CREDENTIALS.find((x) => x.key === 'admin_root')!.email,
    role: APP_ROLES.ADMIN,
    displayName: MOCK_DEMO_CREDENTIALS.find((x) => x.key === 'admin_root')!.displayName,
    avatarInitials: 'AD',
    menuLabel: '系统管理员 · Admin',
  },
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
    menuLabel: '商务经理 · 李晓明',
  },
  bd_wangsy: {
    id: 'user_bd_wangsy_demo_03',
    email: 'sylvia.wang@institution.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '王思远 (Sylvia Wang)',
    avatarInitials: 'WSY',
    bdManagerFullName: '王思远 (Sylvia Wang)',
    menuLabel: '商务经理 · 王思远',
  },
  bd_zhangzhiq: {
    id: 'user_bd_zhangzhiq_demo_04',
    email: 'jack.zhang@institution.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '张志强 (Jack Zhang)',
    avatarInitials: 'ZZQ',
    bdManagerFullName: '张志强 (Jack Zhang)',
    menuLabel: '商务经理 · 张志强',
  },
  bd_liujia: {
    id: 'user_bd_liujia_demo_05',
    email: 'jennifer.liu@institution.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '刘佳 (Jennifer Liu)',
    avatarInitials: 'LJ',
    bdManagerFullName: '刘佳 (Jennifer Liu)',
    menuLabel: '商务经理 · 刘佳',
  },
};
