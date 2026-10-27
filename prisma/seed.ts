import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { hashServerPassword } from '../src/lib/auth/server';
async function main() {
  const email=process.env.ADMIN_EMAIL?.trim().toLowerCase();const password=process.env.ADMIN_PASSWORD;
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<12) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters). No demo users are seeded.');
  if(await prisma.appUser.findUnique({where:{email}})) throw new Error('Account already exists; seed never overwrites credentials.');
  await prisma.appUser.create({data:{email,passwordHash:await hashServerPassword(password),displayName:process.env.ADMIN_NAME ?? '系统管理员',role:'ADMIN',avatarInitials:'AD',enabled:true}});
  console.log('Administrator created.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
