-- Shipping v2 (app/lib/shipping). Additive and idempotent: one new table and
-- one unique index on LocalShipment (verified: no duplicate pairs exist).
--
-- Apply by hand (the prod migration history is empty):
--   DATABASE_URL="$DIRECT_URL" npx prisma db execute --schema prisma/schema.prisma \
--     --file prisma/migrations/20261110120000_shipping_v2/migration.sql

-- 1. One shipping work item per order, from packed to label printed.
CREATE TABLE IF NOT EXISTS "ShippingTask" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "method" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "source" TEXT NOT NULL DEFAULT 'prep',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "blockReason" TEXT,
    "operationRef" TEXT,
    "creatingAt" TIMESTAMP(3),
    "sallaShipmentId" TEXT,
    "localShipmentId" TEXT,
    "labelReadyAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "printedById" TEXT,
    "printedByName" TEXT,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShippingTask_merchantId_orderId_key"
  ON "ShippingTask"("merchantId", "orderId");
CREATE INDEX IF NOT EXISTS "ShippingTask_state_nextAttemptAt_idx"
  ON "ShippingTask"("state", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "ShippingTask_merchantId_state_updatedAt_idx"
  ON "ShippingTask"("merchantId", "state", "updatedAt");
CREATE INDEX IF NOT EXISTS "ShippingTask_printedAt_idx"
  ON "ShippingTask"("printedAt");

-- 2. One local shipment per order: closes the findFirst→create race.
CREATE UNIQUE INDEX IF NOT EXISTS "LocalShipment_merchantId_orderNumber_key"
  ON "LocalShipment"("merchantId", "orderNumber");
