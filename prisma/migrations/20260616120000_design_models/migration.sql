-- CreateTable
CREATE TABLE "DesignModel" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'meter',
    "colors" TEXT[],
    "imageData" TEXT,
    "recipe" JSONB NOT NULL,
    "accessories" JSONB NOT NULL,
    "tailoringCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "embroideryCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "producedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignModel_sku_key" ON "DesignModel"("sku");

-- CreateIndex
CREATE INDEX "DesignModel_sku_idx" ON "DesignModel"("sku");

-- CreateIndex
CREATE INDEX "DesignModel_status_idx" ON "DesignModel"("status");

-- CreateIndex
CREATE INDEX "DesignModel_isActive_idx" ON "DesignModel"("isActive");
