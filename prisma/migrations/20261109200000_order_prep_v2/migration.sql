-- Order prep v2 (app/lib/order-prep). Purely additive and idempotent: new
-- nullable columns, new indexes, one new table, and a backfill of the custom
-- status id for open orders. No existing column or row is changed otherwise.
--
-- Apply by hand (the prod migration history is empty):
--   DATABASE_URL="$DIRECT_URL" npx prisma db execute --schema prisma/schema.prisma \
--     --file prisma/migrations/20261109200000_order_prep_v2/migration.sql

-- 1. SallaOrder: Salla's custom status id, so "طلب جديد" (449146439) can be told
--    apart from its review sub-statuses, which share statusSlug 'under_review'.
ALTER TABLE "SallaOrder" ADD COLUMN IF NOT EXISTS "statusCustomId" TEXT;

CREATE INDEX IF NOT EXISTS "SallaOrder_merchantId_statusCustomId_placedAt_idx"
  ON "SallaOrder"("merchantId", "statusCustomId", "placedAt");

-- Open orders only (~2.5k rows); every other row gets the value on its next
-- webhook. Same rule as deriveStatusCustomId() in app/lib/salla-orders.ts.
UPDATE "SallaOrder"
SET "statusCustomId" = COALESCE(
  "rawOrder"->'status'->'customized'->>'id',
  "rawOrder"->'status'->>'id'
)
WHERE "statusCustomId" IS NULL
  AND "statusSlug" IN ('under_review', 'in_progress');

-- 2. OrderPrepAssignment: claim leases, live-check result, scan method.
ALTER TABLE "OrderPrepAssignment" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "OrderPrepAssignment" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "OrderPrepAssignment" ADD COLUMN IF NOT EXISTS "verifyIssue" TEXT;
ALTER TABLE "OrderPrepAssignment" ADD COLUMN IF NOT EXISTS "scanMethod" TEXT;

CREATE INDEX IF NOT EXISTS "OrderPrepAssignment_userId_status_assignedAt_idx"
  ON "OrderPrepAssignment"("userId", "status", "assignedAt");
CREATE INDEX IF NOT EXISTS "OrderPrepAssignment_merchantId_status_leaseExpiresAt_idx"
  ON "OrderPrepAssignment"("merchantId", "status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "OrderPrepAssignment_completedAt_idx"
  ON "OrderPrepAssignment"("completedAt");

-- 3. OrderPrepUnavailableItem: why it was reported and how it was closed.
ALTER TABLE "OrderPrepUnavailableItem" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "OrderPrepUnavailableItem" ADD COLUMN IF NOT EXISTS "resolution" TEXT;

-- 4. Outbox of Salla status changes made by order prep.
CREATE TABLE IF NOT EXISTS "OrderPrepSallaSync" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "kind" TEXT NOT NULL,
    "targetStatusId" INTEGER NOT NULL,
    "note" TEXT,
    "assignmentId" TEXT,
    "escalationId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "liveStatus" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderPrepSallaSync_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderPrepSallaSync_state_nextAttemptAt_idx"
  ON "OrderPrepSallaSync"("state", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "OrderPrepSallaSync_merchantId_orderId_idx"
  ON "OrderPrepSallaSync"("merchantId", "orderId");
