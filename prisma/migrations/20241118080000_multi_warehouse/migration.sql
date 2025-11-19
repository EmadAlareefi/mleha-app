-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "location" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "Warehouse_isActive_idx" ON "Warehouse"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseAssignment_userId_warehouseId_key" ON "WarehouseAssignment"("userId", "warehouseId");

-- CreateIndex
CREATE INDEX "WarehouseAssignment_warehouseId_idx" ON "WarehouseAssignment"("warehouseId");

-- AlterTable Shipment add column
ALTER TABLE "Shipment"
ADD COLUMN     "warehouseId" TEXT;

-- AlterTable LocalShipment add column
ALTER TABLE "LocalShipment"
ADD COLUMN     "warehouseId" TEXT;

-- CreateIndex
CREATE INDEX "Shipment_warehouseId_idx" ON "Shipment"("warehouseId");

-- CreateIndex
CREATE INDEX "LocalShipment_warehouseId_idx" ON "LocalShipment"("warehouseId");

-- AddForeignKey
ALTER TABLE "WarehouseAssignment"
ADD CONSTRAINT "WarehouseAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "OrderUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WarehouseAssignment"
ADD CONSTRAINT "WarehouseAssignment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Shipment"
ADD CONSTRAINT "Shipment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LocalShipment"
ADD CONSTRAINT "LocalShipment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
