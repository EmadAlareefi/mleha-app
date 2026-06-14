-- Allow tailors to submit purchased fabric details for admin approval.
ALTER TABLE "TailorFabricRequest" ALTER COLUMN "fabricId" DROP NOT NULL;

ALTER TABLE "TailorFabricRequest" ADD COLUMN "requestType" TEXT NOT NULL DEFAULT 'stock_request';
ALTER TABLE "TailorFabricRequest" ADD COLUMN "purchaseName" TEXT;
ALTER TABLE "TailorFabricRequest" ADD COLUMN "purchaseSku" TEXT;
ALTER TABLE "TailorFabricRequest" ADD COLUMN "purchaseColor" TEXT;
ALTER TABLE "TailorFabricRequest" ADD COLUMN "purchaseFabricType" TEXT;
ALTER TABLE "TailorFabricRequest" ADD COLUMN "purchaseSupplier" TEXT;
ALTER TABLE "TailorFabricRequest" ADD COLUMN "purchaseUnitCost" DECIMAL(10,2);
ALTER TABLE "TailorFabricRequest" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "TailorFabricRequest" ADD COLUMN "approvedAt" TIMESTAMP(3);

CREATE INDEX "TailorFabricRequest_requestType_idx" ON "TailorFabricRequest"("requestType");
