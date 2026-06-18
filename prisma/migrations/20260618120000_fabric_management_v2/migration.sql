-- Fabric management v2: accessories as first-class inventory, model-driven issues, audit log.

-- Accessory inventory
CREATE TABLE "Accessory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stockQty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Accessory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Accessory_sku_key" ON "Accessory"("sku");
CREATE INDEX "Accessory_name_idx" ON "Accessory"("name");
CREATE INDEX "Accessory_sku_idx" ON "Accessory"("sku");
CREATE INDEX "Accessory_isActive_idx" ON "Accessory"("isActive");
CREATE INDEX "Accessory_stockQty_idx" ON "Accessory"("stockQty");

-- Inventory audit log (field-level change history)
CREATE TABLE "InventoryAuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryAuditLog_entityType_entityId_idx" ON "InventoryAuditLog"("entityType", "entityId");
CREATE INDEX "InventoryAuditLog_createdAt_idx" ON "InventoryAuditLog"("createdAt");

-- Model-driven issue: link issues to a design model + BOM snapshot
ALTER TABLE "TailorFabricIssue" ADD COLUMN "designModelId" TEXT;
ALTER TABLE "TailorFabricIssue" ADD COLUMN "plannedDressCount" INTEGER;
ALTER TABLE "TailorFabricIssue" ADD COLUMN "componentsIssued" JSONB;

CREATE INDEX "TailorFabricIssue_designModelId_idx" ON "TailorFabricIssue"("designModelId");

ALTER TABLE "TailorFabricIssue"
    ADD CONSTRAINT "TailorFabricIssue_designModelId_fkey"
    FOREIGN KEY ("designModelId") REFERENCES "DesignModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
