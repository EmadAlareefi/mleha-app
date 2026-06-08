-- CreateTable
CREATE TABLE "AffiliateCampaignRequest" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "platform" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateCampaignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliateCampaignRequest_affiliateId_idx" ON "AffiliateCampaignRequest"("affiliateId");

-- CreateIndex
CREATE INDEX "AffiliateCampaignRequest_status_idx" ON "AffiliateCampaignRequest"("status");

-- CreateIndex
CREATE INDEX "AffiliateCampaignRequest_createdAt_idx" ON "AffiliateCampaignRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "AffiliateCampaignRequest" ADD CONSTRAINT "AffiliateCampaignRequest_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "OrderUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
