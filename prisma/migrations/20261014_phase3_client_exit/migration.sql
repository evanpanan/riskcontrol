-- Phase 3: 客户退出全流程
-- Client 表新增退出相关字段

ALTER TABLE "Client" ADD COLUMN "exitRequestedAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "exitEligibleAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "earlyExitFee" DOUBLE PRECISION;
ALTER TABLE "Client" ADD COLUMN "exitAmount" DOUBLE PRECISION;
