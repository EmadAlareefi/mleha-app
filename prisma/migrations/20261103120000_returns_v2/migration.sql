-- Returns v2: per-piece return/exchange, in-app refund, restock and processing.
-- Additive only. Apply manually with `prisma db execute` against DIRECT_URL.

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "couponAmount" DECIMAL(10,2),
ADD COLUMN     "refundStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "refundTransactionId" TEXT,
ADD COLUMN     "refundedAmount" DECIMAL(10,2),
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundError" TEXT,
ADD COLUMN     "processingStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "processingAudit" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "processedBy" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "receivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReturnItem" ADD COLUMN     "orderItemId" TEXT,
ADD COLUMN     "unitIndex" INTEGER,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'return',
ADD COLUMN     "ribbonRemoved" BOOLEAN,
ADD COLUMN     "refundIncluded" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "restockStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "restockedAt" TIMESTAMP(3);

-- Backfill: legacy items take the request's type.
UPDATE "ReturnItem" AS i
SET "type" = r."type"
FROM "ReturnRequest" AS r
WHERE i."returnRequestId" = r."id" AND r."type" IN ('return', 'exchange');

-- Backfill: requests already closed need no processing.
UPDATE "ReturnRequest" SET "processingStatus" = 'done' WHERE "status" IN ('completed', 'cancelled', 'rejected');

-- CreateIndex
CREATE INDEX "ReturnItem_orderItemId_idx" ON "ReturnItem"("orderItemId");
CREATE INDEX "ReturnRequest_processingStatus_idx" ON "ReturnRequest"("processingStatus");
