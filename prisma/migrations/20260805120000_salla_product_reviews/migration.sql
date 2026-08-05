CREATE TABLE "SallaProductReview" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku" TEXT,
    "productImageUrl" TEXT,
    "reviewerName" TEXT NOT NULL,
    "reviewerCity" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByUsername" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SallaProductReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SallaProductReview_productId_isPublished_createdAt_idx"
    ON "SallaProductReview"("productId", "isPublished", "createdAt");

CREATE INDEX "SallaProductReview_createdAt_idx"
    ON "SallaProductReview"("createdAt");

INSERT INTO "UserServicePermission" ("id", "userId", "serviceKey", "createdAt")
SELECT
    'product-reviews-' || "id",
    "id",
    'salla-product-reviews',
    CURRENT_TIMESTAMP
FROM "OrderUser"
WHERE "role" = 'STORE_MANAGER'
ON CONFLICT ("userId", "serviceKey") DO NOTHING;
