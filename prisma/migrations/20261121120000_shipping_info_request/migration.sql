-- International orders held until the customer completes their shipping info.
-- Additive only. Apply with `prisma db execute` through DIRECT_URL BEFORE
-- deploying code: the order-prep queue SQL references "ShippingInfoRequest".
CREATE TABLE IF NOT EXISTS "ShippingInfoRequest" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderNumber" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "holdActive" BOOLEAN NOT NULL DEFAULT true,
  "missingFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "country" TEXT,
  "customerPhone" TEXT,
  "customerName" TEXT,
  "originalStatusId" TEXT,
  "holdStatusSet" BOOLEAN NOT NULL DEFAULT false,
  "sentAt" TIMESTAMP(3),
  "sendError" TEXT,
  "reminderSentAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "submittedData" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "appliedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "resolvedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShippingInfoRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingInfoRequest_merchantId_orderId_key" ON "ShippingInfoRequest"("merchantId", "orderId");
CREATE INDEX IF NOT EXISTS "ShippingInfoRequest_status_createdAt_idx" ON "ShippingInfoRequest"("status", "createdAt");
