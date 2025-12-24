-- CreateTable
CREATE TABLE "SallaProductLocation" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT,
    "merchantId" TEXT,
    "location" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SallaProductLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SallaProductLocation_sku_key" ON "SallaProductLocation"("sku");

-- CreateIndex
CREATE INDEX "SallaProductLocation_merchantId_idx" ON "SallaProductLocation"("merchantId");

-- CreateIndex
CREATE INDEX "SallaProductLocation_location_idx" ON "SallaProductLocation"("location");

-- CreateIndex
CREATE INDEX "SallaProductLocation_updatedAt_idx" ON "SallaProductLocation"("updatedAt");
