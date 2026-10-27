BEGIN;
-- CreateTable
CREATE TABLE "LedgerValuation" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "LedgerValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalLease" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "MonitorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskNotification" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,

    CONSTRAINT "RiskNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerValuation_bucketAt_idx" ON "LedgerValuation"("bucketAt");

-- CreateIndex
CREATE INDEX "LedgerValuation_batchId_bucketAt_idx" ON "LedgerValuation"("batchId", "bucketAt");

-- CreateIndex
CREATE INDEX "MonitorRun_startedAt_idx" ON "MonitorRun"("startedAt");

-- CreateIndex
CREATE INDEX "RiskNotification_status_createdAt_idx" ON "RiskNotification"("status", "createdAt");


COMMIT;
