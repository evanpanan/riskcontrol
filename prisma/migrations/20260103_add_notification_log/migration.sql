-- Phase A: 通知投递记录表（预警发送成功/部分/失败均落库，便于失败追溯与补发）
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'PARTIAL', 'FAILED');

CREATE TABLE "NotificationLog" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "provider" TEXT,
  "title" TEXT NOT NULL,
  "recipients" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL,
  "error" TEXT,
  "batchId" TEXT,
  "type" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");
