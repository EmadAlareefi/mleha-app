-- CreateTable
CREATE TABLE "OrderDoNotShipFlag" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "trackingNumber" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderDoNotShipFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderDoNotShipFlag_merchantId_orderId_key" ON "OrderDoNotShipFlag"("merchantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderDoNotShipFlag_merchantId_idx" ON "OrderDoNotShipFlag"("merchantId");

-- CreateIndex
CREATE INDEX "OrderDoNotShipFlag_orderId_idx" ON "OrderDoNotShipFlag"("orderId");

-- CreateIndex
CREATE INDEX "OrderDoNotShipFlag_trackingNumber_idx" ON "OrderDoNotShipFlag"("trackingNumber");
