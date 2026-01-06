-- CreateTable
CREATE TABLE "OrderGiftFlag" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderGiftFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderGiftFlag_merchantId_orderId_key" ON "OrderGiftFlag"("merchantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderGiftFlag_merchantId_idx" ON "OrderGiftFlag"("merchantId");

-- CreateIndex
CREATE INDEX "OrderGiftFlag_orderId_idx" ON "OrderGiftFlag"("orderId");
