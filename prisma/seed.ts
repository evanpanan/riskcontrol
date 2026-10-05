import { PrismaClient, AppRole } from '@prisma/client';

const prisma = new PrismaClient();

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

async function main() {
  for (const u of DEMO_USERS) {
    const record = { ...u, role: asAppRole(u.role) };
    await prisma.appUser.upsert({
      where: { email: u.email },
      create: record,
      update: record,
    });
  }
  console.log(`[seed] Upserted ${DEMO_USERS.length} demo users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
