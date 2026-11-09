-- Expected restock date per Salla product, shown by the storefront notify-me
-- widget. Purely additive; no existing table is touched.
CREATE TABLE IF NOT EXISTS "SallaProductRestockEta" (
    "productId" TEXT NOT NULL,
    "expectedAt" DATE NOT NULL,
    "productName" TEXT,
    "productSku" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SallaProductRestockEta_pkey" PRIMARY KEY ("productId")
);

CREATE INDEX IF NOT EXISTS "SallaProductRestockEta_expectedAt_idx" ON "SallaProductRestockEta"("expectedAt");
