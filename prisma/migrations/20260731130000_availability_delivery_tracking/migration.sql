-- Correlate a back-in-stock request with the provider message and distinguish
-- API acceptance from delivery to the customer's WhatsApp account.
ALTER TABLE "MessageLog"
    ADD COLUMN "availabilityRequestId" TEXT;

ALTER TABLE "SallaProductAvailabilityRequest"
    ADD COLUMN "providerMessageId" TEXT,
    ADD COLUMN "deliveryStatus" TEXT,
    ADD COLUMN "deliveredAt" TIMESTAMP(3),
    ADD COLUMN "deliveryFailedAt" TIMESTAMP(3);

CREATE INDEX "MessageLog_availabilityRequestId_idx"
    ON "MessageLog"("availabilityRequestId");

CREATE INDEX "MessageLog_zokoMsgId_idx"
    ON "MessageLog"("zokoMsgId");

CREATE UNIQUE INDEX "SallaProductAvailabilityRequest_providerMessageId_key"
    ON "SallaProductAvailabilityRequest"("providerMessageId");

-- Make the public ingest idempotent even when two browser requests race between
-- the duplicate lookup and insert. Scope this to storefront rows so historical
-- staff-entered duplicates do not block the migration.
CREATE UNIQUE INDEX "SallaAvailability_storefront_open_request_key"
    ON "SallaProductAvailabilityRequest"(
      "customerPhone",
      "productId",
      COALESCE("variationId", '')
    )
    WHERE "source" = 'storefront'
      AND "status" IN ('pending', 'notifying');
