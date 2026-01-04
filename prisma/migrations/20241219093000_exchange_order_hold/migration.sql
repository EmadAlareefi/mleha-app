-- AlterTable
ALTER TABLE "ReturnRequest"
ADD COLUMN     "exchangeOrderId" TEXT,
ADD COLUMN     "exchangeOrderNumber" TEXT,
ADD COLUMN     "exchangeOrderLinkedAt" TIMESTAMP(3),
ADD COLUMN     "exchangeOrderHoldActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "exchangeOrderHeldAt" TIMESTAMP(3),
ADD COLUMN     "exchangeOrderReleasedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReturnRequest_exchangeOrderId_idx" ON "ReturnRequest"("exchangeOrderId");
