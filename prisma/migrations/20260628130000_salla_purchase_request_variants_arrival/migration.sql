-- Store the selected Salla variant/size and expected arrival date for purchase requests.
ALTER TABLE "SallaPurchaseRequest" ADD COLUMN "variantId" TEXT;
ALTER TABLE "SallaPurchaseRequest" ADD COLUMN "variantName" TEXT;
ALTER TABLE "SallaPurchaseRequest" ADD COLUMN "variantSku" TEXT;
ALTER TABLE "SallaPurchaseRequest" ADD COLUMN "variantBarcode" TEXT;
ALTER TABLE "SallaPurchaseRequest" ADD COLUMN "variantOptions" JSONB;
ALTER TABLE "SallaPurchaseRequest" ADD COLUMN "expectedArrivalAt" TIMESTAMP(3);

CREATE INDEX "SallaPurchaseRequest_expectedArrivalAt_idx" ON "SallaPurchaseRequest"("expectedArrivalAt");
