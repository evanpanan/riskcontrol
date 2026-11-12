ALTER TABLE "FlashCrashAlert"
ADD COLUMN "sentChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "deliveryLeaseUntil" TIMESTAMP(3),
ADD COLUMN "deliveryLeaseToken" TEXT;
CREATE INDEX "FlashCrashAlert_delivered_nextAttemptAt_idx" ON "FlashCrashAlert"("delivered", "nextAttemptAt");
