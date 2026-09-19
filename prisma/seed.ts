import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_USERS = [
  {
    email: 'evan.pan@institution.com',
    displayName: 'Evan Pan (风控总监)',
    role: 'RISK_MANAGER' as const,
    avatarInitials: 'EP',
  },
  {
    email: 'evan.li@institution.com',
    displayName: '李晓明 (Evan Li)',
    role: 'BD_MANAGER' as const,
    avatarInitials: 'LXM',
    bdManagerFullName: '李晓明 (Evan Li)',
  },
  {
    email: 'sylvia.wang@institution.com',
    displayName: '王思远 (Sylvia Wang)',
    role: 'BD_MANAGER' as const,
    avatarInitials: 'WSY',
    bdManagerFullName: '王思远 (Sylvia Wang)',
  },
  {
    email: 'jack.zhang@institution.com',
    displayName: '张志强 (Jack Zhang)',
    role: 'BD_MANAGER' as const,
    avatarInitials: 'ZZQ',
    bdManagerFullName: '张志强 (Jack Zhang)',
  },
  {
    email: 'jennifer.liu@institution.com',
    displayName: '刘佳 (Jennifer Liu)',
    role: 'BD_MANAGER' as const,
    avatarInitials: 'LJ',
    bdManagerFullName: '刘佳 (Jennifer Liu)',
  },
];

async function main() {
  for (const u of DEMO_USERS) {
    await prisma.appUser.upsert({
      where: { email: u.email },
      create: u,
      update: u,
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
