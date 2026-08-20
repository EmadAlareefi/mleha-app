CREATE TABLE "WarehouseStockCountLog" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "productSku" TEXT,
  "productImageUrl" TEXT,
  "variantId" TEXT NOT NULL,
  "variantName" TEXT NOT NULL,
  "variantSku" TEXT,
  "barcode" TEXT,
  "countedQuantity" INTEGER NOT NULL,
  "pendingQuantity" INTEGER NOT NULL DEFAULT 0,
  "previousQuantity" INTEGER NOT NULL,
  "resultingQuantity" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "location" TEXT,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdByUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseStockCountLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WarehouseStockCountLog_operationId_idx" ON "WarehouseStockCountLog"("operationId");
CREATE INDEX "WarehouseStockCountLog_productId_createdAt_idx" ON "WarehouseStockCountLog"("productId", "createdAt");
CREATE INDEX "WarehouseStockCountLog_productSku_idx" ON "WarehouseStockCountLog"("productSku");
CREATE INDEX "WarehouseStockCountLog_variantSku_idx" ON "WarehouseStockCountLog"("variantSku");
CREATE INDEX "WarehouseStockCountLog_createdById_createdAt_idx" ON "WarehouseStockCountLog"("createdById", "createdAt");
CREATE INDEX "WarehouseStockCountLog_createdAt_idx" ON "WarehouseStockCountLog"("createdAt");
