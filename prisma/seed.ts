import { PrismaClient, AppRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashPasswordPbkdf2 } from '../src/lib/server/passwordKdf';

const prisma = new PrismaClient();

/** 生产口令最小长度：共享口令 + 六位口令是上线阻塞项，这里统一抬高到 12 位。 */
const MIN_PASSWORD_LENGTH = 12;

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
 * 初始口令来源（仅首次初始化使用）：
 *   生产环境：必须为每个账号单独指定 RC_SEED_PASSWORDS（JSON），禁止共享口令；
 *             未指定口令的账号一律不创建（杜绝弱口令 / 演示账号被带上生产）。
 *   开发环境：可用 RC_SEED_DEFAULT_PASSWORD（>= 12 位）或随机生成并打印一次。
 */
function resolveSeedPassword(email: string, isProd: boolean): { password?: string; reason?: string } {
  const perUserRaw = process.env.RC_SEED_PASSWORDS;
  if (perUserRaw && perUserRaw.trim()) {
    try {
      const parsed = JSON.parse(perUserRaw) as Record<string, unknown>;
      const hit = parsed[email];
      if (typeof hit === 'string' && hit.length > 0) {
        if (hit.length < MIN_PASSWORD_LENGTH) {
          throw new Error(`[seed] ${email} 的初始口令长度不足 ${MIN_PASSWORD_LENGTH} 位。`);
        }
        return { password: hit };
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('[seed]')) throw err;
      /* JSON 解析失败则继续走统一口令（仅开发环境可用） */
    }
  }
  if (isProd) {
    return { reason: '生产环境必须通过 RC_SEED_PASSWORDS 为该账号单独指定口令（>= 12 位），已跳过创建。' };
  }
  const shared = process.env.RC_SEED_DEFAULT_PASSWORD;
  if (shared && shared.trim()) {
    if (shared.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`[seed] RC_SEED_DEFAULT_PASSWORD 长度不足 ${MIN_PASSWORD_LENGTH} 位。`);
    }
    return { password: shared };
  }
  const generated = `Rc-${randomBytes(12).toString('base64url')}`;
  console.log(`[seed] 未配置初始口令，已为 ${email} 生成临时口令：${generated}`);
  return { password: generated };
}

async function main() {
  // 生产初始化必须是一次性、明确授权的操作：容器每次启动都跑 seed 会把演示账号与
  // 默认口令重新带回生产库。这里要求显式设置 RC_ALLOW_SEED=1 才执行。
  if (process.env.RC_ALLOW_SEED !== '1') {
    console.log('[seed] 未显式授权（需设置 RC_ALLOW_SEED=1），跳过账号初始化。');
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';
  const force = process.env.RC_SEED_FORCE_PASSWORD === '1';
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const u of DEMO_USERS) {
    const role = asAppRole(u.role);
    const existing = await prisma.appUser.findUnique({ where: { email: u.email } });
    const profile = {
      displayName: u.displayName,
      role,
      avatarInitials: u.avatarInitials,
      bdManagerFullName: u.bdManagerFullName ?? null,
    };

    if (existing && !force) {
      // 已存在的账号一律不改写资料（角色/姓名等），避免每次启动把人工调整覆盖回去。
      skipped += 1;
      continue;
    }

    const resolved = resolveSeedPassword(u.email, isProd);
    if (!resolved.password) {
      console.log(`[seed] 跳过 ${u.email}：${resolved.reason ?? '未提供可用口令'}`);
      skipped += 1;
      continue;
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPasswordPbkdf2(resolved.password, salt);

    if (!existing) {
      await prisma.appUser.create({
        data: { email: u.email, ...profile, passwordSalt: salt, passwordHash },
      });
      created += 1;
      continue;
    }

    // 仅在显式 --force 时改写已有账号资料与口令。
    await prisma.appUser.update({
      where: { email: u.email },
      data: { ...profile, passwordSalt: salt, passwordHash },
    });
    updated += 1;
  }

  console.log(`[seed] 账号初始化完成：新建 ${created} 个，改写 ${updated} 个，跳过 ${skipped} 个`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
