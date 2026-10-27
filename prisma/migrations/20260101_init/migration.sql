-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('LOCKED', 'TRADING_OPEN', 'CLOSED', 'LIQUIDATED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('NORMAL', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'EXIT_REQUESTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "MarginCallStatus" AS ENUM ('PENDING', 'FULLFILLED', 'EXPIRED', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('ADMIN', 'RISK_MANAGER', 'BD_MANAGER', 'OPERATIONS');

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "AppRole" NOT NULL,
    "avatarInitials" TEXT NOT NULL,
    "bdManagerFullName" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddr" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "stockSymbol" TEXT NOT NULL,
    "stockName" TEXT,
    "stockPriceAtStart" DOUBLE PRECISION NOT NULL,
    "currentStockPrice" DOUBLE PRECISION,
    "currentDayChange" DOUBLE PRECISION DEFAULT 0,
    "initialTotalAmount" DOUBLE PRECISION NOT NULL,
    "priorityAmount" DOUBLE PRECISION NOT NULL,
    "subordinateAmount" DOUBLE PRECISION NOT NULL,
    "signDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "totalShares" DOUBLE PRECISION NOT NULL,
    "currentMarketValue" DOUBLE PRECISION,
    "totalPnL" DOUBLE PRECISION DEFAULT 0,
    "totalPnLPercent" DOUBLE PRECISION DEFAULT 0,
    "cumulativeMarginCalls" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "BatchStatus" NOT NULL DEFAULT 'LOCKED',
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'NORMAL',
    "nextTradingWindow" TIMESTAMP(3),
    "custodianBroker" TEXT NOT NULL DEFAULT '中阳证券有限公司',
    "lockUpEndDate" TIMESTAMP(3),
    "exitWindowMonths" INTEGER NOT NULL DEFAULT 3,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 15,
    "finalMaturityDate" TIMESTAMP(3),
    "win100CollateralValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "win100CollateralShares" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "clientNo" TEXT,
    "batchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "investmentAmount" DOUBLE PRECISION NOT NULL,
    "bdManager" TEXT NOT NULL,
    "bdUserId" TEXT,
    "signDate" TIMESTAMP(3) NOT NULL,
    "profitSplitClient" DOUBLE PRECISION NOT NULL,
    "profitSplitInstitution" DOUBLE PRECISION NOT NULL,
    "realtimePnL" DOUBLE PRECISION DEFAULT 0,
    "estimatedExitAmount" DOUBLE PRECISION,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "settledAt" TIMESTAMP(3),
    "settlementNote" TEXT,
    "sharesHeld" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCostPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "brokerAccount" TEXT,
    "exitRequestedAt" TIMESTAMP(3),
    "exitEligibleAt" TIMESTAMP(3),
    "earlyExitFee" DOUBLE PRECISION,
    "exitAmount" DOUBLE PRECISION,
    "subAccountNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginCall" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "triggerDate" TIMESTAMP(3) NOT NULL,
    "triggerMarketValue" DOUBLE PRECISION NOT NULL,
    "dropPercent" DOUBLE PRECISION NOT NULL,
    "requiredAmount" DOUBLE PRECISION NOT NULL,
    "fulfilledAmount" DOUBLE PRECISION,
    "fulfilledDate" TIMESTAMP(3),
    "status" "MarginCallStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "dueDate" TIMESTAMP(3),
    "collateralType" TEXT,
    "notifiedEmails" TEXT,
    "notifiedWhatsApps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarginCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockHistory" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "role" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_bdManagerFullName_key" ON "AppUser"("bdManagerFullName");

-- CreateIndex
CREATE INDEX "AppUser_role_idx" ON "AppUser"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_batchNumber_key" ON "Batch"("batchNumber");

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- CreateIndex
CREATE INDEX "Batch_riskLevel_idx" ON "Batch"("riskLevel");

-- CreateIndex
CREATE INDEX "Batch_signDate_idx" ON "Batch"("signDate");

-- CreateIndex
CREATE UNIQUE INDEX "Client_clientNo_key" ON "Client"("clientNo");

-- CreateIndex
CREATE UNIQUE INDEX "Client_subAccountNo_key" ON "Client"("subAccountNo");

-- CreateIndex
CREATE INDEX "Client_batchId_idx" ON "Client"("batchId");

-- CreateIndex
CREATE INDEX "Client_bdManager_idx" ON "Client"("bdManager");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE INDEX "Client_bdUserId_idx" ON "Client"("bdUserId");

-- CreateIndex
CREATE INDEX "Client_clientNo_idx" ON "Client"("clientNo");

-- CreateIndex
CREATE INDEX "MarginCall_batchId_idx" ON "MarginCall"("batchId");

-- CreateIndex
CREATE INDEX "MarginCall_status_idx" ON "MarginCall"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockHistory_symbol_key" ON "StockHistory"("symbol");

-- CreateIndex
CREATE INDEX "StockHistory_usageCount_idx" ON "StockHistory"("usageCount");

-- CreateIndex
CREATE INDEX "StockHistory_lastUsed_idx" ON "StockHistory"("lastUsed");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_bdUserId_fkey" FOREIGN KEY ("bdUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginCall" ADD CONSTRAINT "MarginCall_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

