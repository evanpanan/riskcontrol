-- Phase 2: WIN100 T+2 履约流程
-- 新增 OVERDUE 枚举值、dueDate 到期日、collateralType 补仓形式

ALTER TYPE "MarginCallStatus" ADD VALUE 'OVERDUE';

ALTER TABLE "MarginCall" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "MarginCall" ADD COLUMN "collateralType" TEXT;
