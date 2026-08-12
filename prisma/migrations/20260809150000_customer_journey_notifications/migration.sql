CREATE TABLE "CustomerJourneyNotification" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'template',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerJourneyNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerJourneyNotification_dedupeKey_key"
    ON "CustomerJourneyNotification"("dedupeKey");
CREATE UNIQUE INDEX "CustomerJourneyNotification_providerMessageId_key"
    ON "CustomerJourneyNotification"("providerMessageId");
CREATE INDEX "CustomerJourneyNotification_status_scheduledFor_idx"
    ON "CustomerJourneyNotification"("status", "scheduledFor");
CREATE INDEX "CustomerJourneyNotification_status_nextAttemptAt_idx"
    ON "CustomerJourneyNotification"("status", "nextAttemptAt");
CREATE INDEX "CustomerJourneyNotification_merchantId_orderId_idx"
    ON "CustomerJourneyNotification"("merchantId", "orderId");
