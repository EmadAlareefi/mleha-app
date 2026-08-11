CREATE TABLE "MarketingCustomerGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingCustomerGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingCustomer" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "consentStatus" TEXT NOT NULL DEFAULT 'unknown',
  "consentRecordedAt" TIMESTAMP(3),
  "consentRecordedBy" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingCampaign" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateLanguage" TEXT NOT NULL,
  "templateType" TEXT NOT NULL,
  "templateDescription" TEXT,
  "templateVariableCount" INTEGER NOT NULL DEFAULT 0,
  "templateArgs" JSONB NOT NULL,
  "claimedAudienceSize" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdByName" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingCampaignMessage" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT,
  "recipient" TEXT NOT NULL,
  "customerName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "processingStartedAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingCampaignMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingCustomerGroup_isArchived_updatedAt_idx" ON "MarketingCustomerGroup"("isArchived", "updatedAt");
CREATE INDEX "MarketingCustomerGroup_createdAt_idx" ON "MarketingCustomerGroup"("createdAt");
CREATE UNIQUE INDEX "MarketingCustomer_groupId_phone_key" ON "MarketingCustomer"("groupId", "phone");
CREATE INDEX "MarketingCustomer_groupId_isActive_consentStatus_idx" ON "MarketingCustomer"("groupId", "isActive", "consentStatus");
CREATE INDEX "MarketingCustomer_phone_idx" ON "MarketingCustomer"("phone");
CREATE INDEX "MarketingCampaign_status_createdAt_idx" ON "MarketingCampaign"("status", "createdAt");
CREATE INDEX "MarketingCampaign_groupId_createdAt_idx" ON "MarketingCampaign"("groupId", "createdAt");
CREATE UNIQUE INDEX "MarketingCampaignMessage_campaignId_recipient_key" ON "MarketingCampaignMessage"("campaignId", "recipient");
CREATE INDEX "MarketingCampaignMessage_campaignId_status_createdAt_idx" ON "MarketingCampaignMessage"("campaignId", "status", "createdAt");
CREATE INDEX "MarketingCampaignMessage_customerId_idx" ON "MarketingCampaignMessage"("customerId");
CREATE INDEX "MarketingCampaignMessage_providerMessageId_idx" ON "MarketingCampaignMessage"("providerMessageId");

ALTER TABLE "MarketingCustomer"
  ADD CONSTRAINT "MarketingCustomer_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "MarketingCustomerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingCampaign"
  ADD CONSTRAINT "MarketingCampaign_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "MarketingCustomerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketingCampaignMessage"
  ADD CONSTRAINT "MarketingCampaignMessage_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingCampaignMessage"
  ADD CONSTRAINT "MarketingCampaignMessage_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "MarketingCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
