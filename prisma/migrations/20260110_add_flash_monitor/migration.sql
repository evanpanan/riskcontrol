-- CreateTable
CREATE TABLE "QuotePricePoint" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotePricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlashCrashAlert" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "dropPercent" DOUBLE PRECISION NOT NULL,
    "actualDropPercent" DOUBLE PRECISION NOT NULL,
    "highPrice" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveryNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlashCrashAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotePricePoint_batchId_asOf_idx" ON "QuotePricePoint"("batchId", "asOf");

-- CreateIndex
CREATE INDEX "QuotePricePoint_createdAt_idx" ON "QuotePricePoint"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlashCrashAlert_dedupeKey_key" ON "FlashCrashAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "FlashCrashAlert_batchId_createdAt_idx" ON "FlashCrashAlert"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "FlashCrashAlert_delivered_idx" ON "FlashCrashAlert"("delivered");
