import { PrismaClient, AppRole } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const hashPassword = (password: string, salt: string): string =>
  createHash('sha256').update(`${salt}::${password}`).digest('hex');

type DemoUserSeed = {
  email: string;
  displayName: string;
  role: AppRole | 'ADMIN';
  avatarInitials: string;
  bdManagerFullName?: string;
};

const asAppRole = (r: AppRole | 'ADMIN'): AppRole => r as unknown as AppRole;

const DEMO_USERS: DemoUserSeed[] = [
  {
    email: 'admin@riskcontrol.io',
    displayName: '系统超级管理员 (Platform Admin)',
    role: 'ADMIN',
    avatarInitials: 'SA',
  },
  {
    email: 'evan.pan@institution.com',
    displayName: 'Evan Pan (风控总监)',
    role: AppRole.RISK_MANAGER,
    avatarInitials: 'EP',
  },
  {
    email: 'evan.li@institution.com',
    displayName: '李晓明 (Evan Li)',
    role: AppRole.BD_MANAGER,
    avatarInitials: 'LXM',
    bdManagerFullName: '李晓明 (Evan Li)',
  },
  {
    email: 'sylvia.wang@institution.com',
    displayName: '王思远 (Sylvia Wang)',
    role: AppRole.BD_MANAGER,
    avatarInitials: 'WSY',
    bdManagerFullName: '王思远 (Sylvia Wang)',
  },
  {
    email: 'jack.zhang@institution.com',
    displayName: '张志强 (Jack Zhang)',
    role: AppRole.BD_MANAGER,
    avatarInitials: 'ZZQ',
    bdManagerFullName: '张志强 (Jack Zhang)',
  },
  {
    email: 'jennifer.liu@institution.com',
    displayName: '刘佳 (Jennifer Liu)',
    role: AppRole.BD_MANAGER,
    avatarInitials: 'LJ',
    bdManagerFullName: '刘佳 (Jennifer Liu)',
  },
];

/**
 * 初始口令来源优先级：
 *   1. RC_SEED_PASSWORDS        —— JSON 形如 {"email":"口令"}，可为每个账号单独指定
 *   2. RC_SEED_DEFAULT_PASSWORD —— 所有账号统一口令
 *   3. 未配置                    —— 生产环境直接报错退出；开发环境随机生成并打印一次
 */
function resolveSeedPassword(email: string): string {
  const perUserRaw = process.env.RC_SEED_PASSWORDS;
  if (perUserRaw && perUserRaw.trim()) {
    try {
      const parsed = JSON.parse(perUserRaw) as Record<string, unknown>;
      const hit = parsed[email];
      if (typeof hit === 'string' && hit.length >= 6) return hit;
    } catch {
      /* 解析失败则继续走统一口令 */
    }
  }
  const shared = process.env.RC_SEED_DEFAULT_PASSWORD;
  if (shared && shared.length >= 6) return shared;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[seed] 生产环境必须通过 RC_SEED_PASSWORDS 或 RC_SEED_DEFAULT_PASSWORD 指定初始口令（长度 >= 6）。'
    );
  }
  const generated = `Rc-${randomBytes(9).toString('base64url')}`;
  console.log(`[seed] 未配置初始口令，已为 ${email} 生成临时口令：${generated}`);
  return generated;
}

async function main() {
  const force = process.env.RC_SEED_FORCE_PASSWORD === '1';
  let created = 0;
  let updated = 0;

  for (const u of DEMO_USERS) {
    const role = asAppRole(u.role);
    const existing = await prisma.appUser.findUnique({ where: { email: u.email } });
    const profile = {
      displayName: u.displayName,
      role,
      avatarInitials: u.avatarInitials,
      bdManagerFullName: u.bdManagerFullName ?? null,
    };

    if (!existing) {
      const password = resolveSeedPassword(u.email);
      const salt = randomBytes(16).toString('hex');
      await prisma.appUser.create({
        data: {
          email: u.email,
          ...profile,
          passwordSalt: salt,
          passwordHash: hashPassword(password, salt),
        },
      });
      created += 1;
      continue;
    }

    if (!existing.passwordHash || !existing.passwordSalt || force) {
      const password = resolveSeedPassword(u.email);
      const salt = randomBytes(16).toString('hex');
      await prisma.appUser.update({
        where: { email: u.email },
        data: { ...profile, passwordSalt: salt, passwordHash: hashPassword(password, salt) },
      });
      updated += 1;
      continue;
    }

    await prisma.appUser.update({ where: { email: u.email }, data: profile });
    updated += 1;
  }

  console.log(`[seed] 账号初始化完成：新建 ${created} 个，更新 ${updated} 个`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
