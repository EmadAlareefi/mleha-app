-- AlterTable
ALTER TABLE "SallaOrder" ADD COLUMN     "discountTotal" DECIMAL(12,2),
ADD COLUMN     "exchangeRate" JSONB,
ADD COLUMN     "factsComputedAt" TIMESTAMP(3),
ADD COLUMN     "isPendingPayment" BOOLEAN,
ADD COLUMN     "refundedItemsCount" INTEGER,
ADD COLUMN     "refundedItemsTotal" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "HermesApiCredential" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "rotatedFromId" TEXT,

    CONSTRAINT "HermesApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HermesAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,
    "credentialId" TEXT,
    "merchantId" TEXT,
    "action" TEXT NOT NULL,
    "scopeUsed" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "classification" TEXT NOT NULL,
    "resultCount" INTEGER,
    "durationMs" INTEGER,
    "ipHash" TEXT,
    "actorId" TEXT,
    "actorChannel" TEXT,
    "actorVerified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HermesAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HermesApiCredential_keyId_key" ON "HermesApiCredential"("keyId");

-- CreateIndex
CREATE INDEX "HermesApiCredential_merchantId_idx" ON "HermesApiCredential"("merchantId");

-- CreateIndex
CREATE INDEX "HermesApiCredential_revokedAt_idx" ON "HermesApiCredential"("revokedAt");

-- CreateIndex
CREATE INDEX "HermesAuditLog_credentialId_createdAt_idx" ON "HermesAuditLog"("credentialId", "createdAt");

-- CreateIndex
CREATE INDEX "HermesAuditLog_createdAt_idx" ON "HermesAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "HermesAuditLog_action_createdAt_idx" ON "HermesAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "SallaOrder_merchantId_customerEmail_idx" ON "SallaOrder"("merchantId", "customerEmail");

-- CreateIndex
CREATE INDEX "SallaOrder_merchantId_customerId_placedAt_idx" ON "SallaOrder"("merchantId", "customerId", "placedAt");

-- CreateIndex
CREATE INDEX "SallaOrder_merchantId_trackingNumber_idx" ON "SallaOrder"("merchantId", "trackingNumber");

