CREATE TABLE "ClientStatementContact" (
  "customerKey" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientStatementContact_pkey" PRIMARY KEY ("customerKey")
);
CREATE TABLE "MonthlyStatement" (
  "id" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "customerKey" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "bdManager" TEXT NOT NULL,
  "report" JSONB NOT NULL,
  "pdf" BYTEA NOT NULL,
  "generatedBy" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  "emailAddress" TEXT,
  "sendToken" TEXT,
  "sendStartedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "MonthlyStatement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonthlyStatement_month_customerKey_key" ON "MonthlyStatement"("month", "customerKey");
CREATE INDEX "MonthlyStatement_emailStatus_idx" ON "MonthlyStatement"("emailStatus");
