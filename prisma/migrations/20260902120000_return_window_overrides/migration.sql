CREATE TABLE "ReturnWindowOverride" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ReturnWindowOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReturnWindowOverride_merchantId_orderId_key"
ON "ReturnWindowOverride"("merchantId", "orderId");

CREATE INDEX "ReturnWindowOverride_merchantId_orderNumber_idx"
ON "ReturnWindowOverride"("merchantId", "orderNumber");

CREATE INDEX "ReturnWindowOverride_revokedAt_createdAt_idx"
ON "ReturnWindowOverride"("revokedAt", "createdAt");
