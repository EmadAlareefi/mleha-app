-- CreateTable
CREATE TABLE "SallaOrder" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "referenceId" TEXT,
    "orderNumber" TEXT,
    "statusSlug" TEXT,
    "statusName" TEXT,
    "fulfillmentStatus" TEXT,
    "paymentStatus" TEXT,
    "currency" TEXT,
    "subtotalAmount" DECIMAL(12, 2),
    "taxAmount" DECIMAL(12, 2),
    "shippingAmount" DECIMAL(12, 2),
    "discountAmount" DECIMAL(12, 2),
    "totalAmount" DECIMAL(12, 2),
    "customerId" TEXT,
    "customerName" TEXT,
    "customerMobile" TEXT,
    "customerEmail" TEXT,
    "customerCity" TEXT,
    "customerCountry" TEXT,
    "paymentMethod" TEXT,
    "fulfillmentCompany" TEXT,
    "trackingNumber" TEXT,
    "placedAt" TIMESTAMP(3),
    "updatedAtRemote" TIMESTAMP(3),
    "rawOrder" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SallaOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SallaOrder_merchantId_orderId_key" ON "SallaOrder"("merchantId", "orderId");

-- CreateIndex
CREATE INDEX "SallaOrder_merchantId_placedAt_idx" ON "SallaOrder"("merchantId", "placedAt");

-- CreateIndex
CREATE INDEX "SallaOrder_merchantId_statusSlug_idx" ON "SallaOrder"("merchantId", "statusSlug");
