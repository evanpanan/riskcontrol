-- CreateTable
CREATE TABLE "FinanceCommit" (
    "opId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceCommit_pkey" PRIMARY KEY ("opId")
);

-- CreateIndex
CREATE INDEX "FinanceCommit_createdAt_idx" ON "FinanceCommit"("createdAt");

-- CreateIndex
CREATE INDEX "FinanceCommit_key_idx" ON "FinanceCommit"("key");
