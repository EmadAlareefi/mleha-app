-- AlterTable: capture-source and delivery bookkeeping for storefront "notify me" requests.
-- All columns are nullable or defaulted so existing rows keep working; pre-existing
-- rows are treated as staff-entered, which is what they are.
ALTER TABLE "SallaProductAvailabilityRequest"
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'staff',
    ADD COLUMN "customerId" TEXT,
    ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "pageUrl" TEXT,
    ADD COLUMN "locale" TEXT,
    ADD COLUMN "ipHash" TEXT,
    ADD COLUMN "userAgent" TEXT,
    ADD COLUMN "notifyChannel" TEXT,
    ADD COLUMN "notifyAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "notifyError" TEXT,
    ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
    ADD COLUMN "backInStockAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SallaProductAvailabilityRequest_source_createdAt_idx"
    ON "SallaProductAvailabilityRequest"("source", "createdAt");

-- CreateIndex
CREATE INDEX "SallaProductAvailabilityRequest_status_lastCheckedAt_idx"
    ON "SallaProductAvailabilityRequest"("status", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "SallaProductAvailabilityRequest_customerPhone_productId_idx"
    ON "SallaProductAvailabilityRequest"("customerPhone", "productId");

-- CreateIndex
CREATE INDEX "SallaProductAvailabilityRequest_ipHash_createdAt_idx"
    ON "SallaProductAvailabilityRequest"("ipHash", "createdAt");
