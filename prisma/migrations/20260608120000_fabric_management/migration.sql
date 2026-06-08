-- CreateTable
CREATE TABLE "Fabric" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "color" TEXT,
    "fabricType" TEXT,
    "supplier" TEXT,
    "unitCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stockLength" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fabric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tailor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workshopName" TEXT,
    "phone" TEXT,
    "accessCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tailor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorFabricIssue" (
    "id" TEXT NOT NULL,
    "fabricId" TEXT NOT NULL,
    "tailorId" TEXT NOT NULL,
    "issuedLength" DECIMAL(12,2) NOT NULL,
    "unitCostAtIssue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'with_tailor',
    "deliveredDressCount" INTEGER,
    "consumedLength" DECIMAL(12,2),
    "returnedLength" DECIMAL(12,2),
    "tailoringCost" DECIMAL(12,2),
    "extraCost" DECIMAL(12,2),
    "deliveryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorFabricIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorFabricRequest" (
    "id" TEXT NOT NULL,
    "fabricId" TEXT NOT NULL,
    "tailorId" TEXT NOT NULL,
    "requestedLength" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "TailorFabricRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fabric_sku_key" ON "Fabric"("sku");

-- CreateIndex
CREATE INDEX "Fabric_name_idx" ON "Fabric"("name");

-- CreateIndex
CREATE INDEX "Fabric_sku_idx" ON "Fabric"("sku");

-- CreateIndex
CREATE INDEX "Fabric_isActive_idx" ON "Fabric"("isActive");

-- CreateIndex
CREATE INDEX "Fabric_stockLength_idx" ON "Fabric"("stockLength");

-- CreateIndex
CREATE UNIQUE INDEX "Tailor_accessCode_key" ON "Tailor"("accessCode");

-- CreateIndex
CREATE INDEX "Tailor_name_idx" ON "Tailor"("name");

-- CreateIndex
CREATE INDEX "Tailor_accessCode_idx" ON "Tailor"("accessCode");

-- CreateIndex
CREATE INDEX "Tailor_isActive_idx" ON "Tailor"("isActive");

-- CreateIndex
CREATE INDEX "TailorFabricIssue_fabricId_idx" ON "TailorFabricIssue"("fabricId");

-- CreateIndex
CREATE INDEX "TailorFabricIssue_tailorId_idx" ON "TailorFabricIssue"("tailorId");

-- CreateIndex
CREATE INDEX "TailorFabricIssue_status_idx" ON "TailorFabricIssue"("status");

-- CreateIndex
CREATE INDEX "TailorFabricIssue_issueDate_idx" ON "TailorFabricIssue"("issueDate");

-- CreateIndex
CREATE INDEX "TailorFabricIssue_deliveryDate_idx" ON "TailorFabricIssue"("deliveryDate");

-- CreateIndex
CREATE INDEX "TailorFabricRequest_fabricId_idx" ON "TailorFabricRequest"("fabricId");

-- CreateIndex
CREATE INDEX "TailorFabricRequest_tailorId_idx" ON "TailorFabricRequest"("tailorId");

-- CreateIndex
CREATE INDEX "TailorFabricRequest_status_idx" ON "TailorFabricRequest"("status");

-- CreateIndex
CREATE INDEX "TailorFabricRequest_createdAt_idx" ON "TailorFabricRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "TailorFabricIssue" ADD CONSTRAINT "TailorFabricIssue_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorFabricIssue" ADD CONSTRAINT "TailorFabricIssue_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "Tailor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorFabricRequest" ADD CONSTRAINT "TailorFabricRequest_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorFabricRequest" ADD CONSTRAINT "TailorFabricRequest_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "Tailor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
