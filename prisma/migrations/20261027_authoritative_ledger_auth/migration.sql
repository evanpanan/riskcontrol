BEGIN;
-- AlterTable
ALTER TABLE "AppUser" ADD COLUMN     "avatarDataUrl" TEXT,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "LedgerBatch" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "batchNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerCommand" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "batchId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerBatch_batchNumber_key" ON "LedgerBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "LedgerCommand_batchId_idx" ON "LedgerCommand"("batchId");


COMMIT;
