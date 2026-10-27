-- Phase A: 为账号表补充独立随机盐字段，配合 passwordHash 做正规口令校验
ALTER TABLE "AppUser" ADD COLUMN "passwordSalt" TEXT;
