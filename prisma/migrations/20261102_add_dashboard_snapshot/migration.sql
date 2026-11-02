-- CreateTable
CREATE TABLE "DashboardSnapshot" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "institutionValue" DOUBLE PRECISION NOT NULL,
    "clientValue" DOUBLE PRECISION NOT NULL,
    "totalYieldPct" DOUBLE PRECISION NOT NULL,
    "institutionYieldPct" DOUBLE PRECISION NOT NULL,
    "clientYieldPct" DOUBLE PRECISION NOT NULL,
    "totalPnL" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "institutionPnL" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clientPnL" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSnapshot_scopeType_scopeKey_bucketAt_key" ON "DashboardSnapshot"("scopeType", "scopeKey", "bucketAt");

-- CreateIndex
CREATE INDEX "DashboardSnapshot_scopeType_scopeKey_bucketAt_idx" ON "DashboardSnapshot"("scopeType", "scopeKey", "bucketAt");
