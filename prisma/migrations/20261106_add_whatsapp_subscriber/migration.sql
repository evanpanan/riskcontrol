-- CreateTable: WhatsApp 订阅者
CREATE TABLE "WhatsAppSubscriber" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "displayName" TEXT,
    "source" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSubscriber_phone_key" ON "WhatsAppSubscriber"("phone");
CREATE INDEX "WhatsAppSubscriber_active_idx" ON "WhatsAppSubscriber"("active");
CREATE INDEX "WhatsAppSubscriber_lastMessageAt_idx" ON "WhatsAppSubscriber"("lastMessageAt");
