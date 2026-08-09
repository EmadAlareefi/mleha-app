-- Store draft and published size guides for the public Salla storefront widget.
CREATE TABLE "SallaSizeGuide" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "skuKey" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT,
    "productImageUrl" TEXT,
    "draftData" JSONB NOT NULL,
    "publishedData" JSONB,
    "validationIssues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "sourceFileName" TEXT,
    "lastImportedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByUsername" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedByUsername" TEXT,
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "publishedByUsername" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SallaSizeGuide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SallaSizeGuide_skuKey_key" ON "SallaSizeGuide"("skuKey");
CREATE UNIQUE INDEX "SallaSizeGuide_productId_key" ON "SallaSizeGuide"("productId");
CREATE INDEX "SallaSizeGuide_hasIssues_updatedAt_idx" ON "SallaSizeGuide"("hasIssues", "updatedAt");
CREATE INDEX "SallaSizeGuide_publishedAt_idx" ON "SallaSizeGuide"("publishedAt");
CREATE INDEX "SallaSizeGuide_updatedAt_idx" ON "SallaSizeGuide"("updatedAt");
