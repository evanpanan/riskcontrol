CREATE TABLE "BatchDailySnapshot" (
  "id" TEXT NOT NULL, "batchId" TEXT NOT NULL, "tradingDate" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL, "summary" JSONB NOT NULL, "ledger" JSONB NOT NULL,
  CONSTRAINT "BatchDailySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BatchDailySnapshot_batchId_tradingDate_key" ON "BatchDailySnapshot"("batchId", "tradingDate");
CREATE INDEX "BatchDailySnapshot_tradingDate_idx" ON "BatchDailySnapshot"("tradingDate");
CREATE TABLE "BackupArchive" (
  "id" TEXT NOT NULL, "backupDate" TEXT NOT NULL, "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "data" BYTEA NOT NULL, "sha256" TEXT NOT NULL, "byteLength" INTEGER NOT NULL,
  "emailState" JSONB NOT NULL, "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "lastError" TEXT,
  CONSTRAINT "BackupArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BackupArchive_backupDate_key" ON "BackupArchive"("backupDate");
