-- Allow one published size guide to serve multiple Salla products.
CREATE TABLE "SallaSizeGuideProductLink" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "skuKey" TEXT NOT NULL,
    "productName" TEXT,
    "productImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SallaSizeGuideProductLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SallaSizeGuideProductLink_productId_key"
ON "SallaSizeGuideProductLink"("productId");

CREATE INDEX "SallaSizeGuideProductLink_guideId_idx"
ON "SallaSizeGuideProductLink"("guideId");

CREATE INDEX "SallaSizeGuideProductLink_skuKey_idx"
ON "SallaSizeGuideProductLink"("skuKey");

ALTER TABLE "SallaSizeGuideProductLink"
ADD CONSTRAINT "SallaSizeGuideProductLink_guideId_fkey"
FOREIGN KEY ("guideId") REFERENCES "SallaSizeGuide"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every existing one-to-one product link as the first relation row.
INSERT INTO "SallaSizeGuideProductLink" (
    "id", "guideId", "productId", "sku", "skuKey",
    "productName", "productImageUrl", "createdAt", "updatedAt"
)
SELECT
    'legacy_' || md5("id" || ':' || "productId"),
    "id", "productId", "sku", "skuKey",
    "productName", "productImageUrl", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SallaSizeGuide"
WHERE "productId" IS NOT NULL
ON CONFLICT ("productId") DO NOTHING;
