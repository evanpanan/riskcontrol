CREATE TABLE "NotificationDispatch" (
"id" TEXT NOT NULL PRIMARY KEY, "identity" TEXT NOT NULL, "payload" JSONB NOT NULL, "policy" JSONB NOT NULL, "state" JSONB NOT NULL,
"status" TEXT NOT NULL DEFAULT 'PENDING', "attemptCount" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "reviewedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "NotificationDispatch_identity_updatedAt_idx" ON "NotificationDispatch"("identity", "updatedAt");
CREATE INDEX "NotificationDispatch_status_nextAttemptAt_idx" ON "NotificationDispatch"("status", "nextAttemptAt");
