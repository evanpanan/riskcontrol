-- CreateTable
CREATE TABLE "WorkspaceRecord" (
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceRecord_pkey" PRIMARY KEY ("kind","key")
);

-- CreateIndex
CREATE INDEX "WorkspaceRecord_kind_idx" ON "WorkspaceRecord"("kind");

-- CreateIndex
CREATE INDEX "WorkspaceRecord_updatedAt_idx" ON "WorkspaceRecord"("updatedAt");
