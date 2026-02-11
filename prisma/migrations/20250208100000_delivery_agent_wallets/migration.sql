-- CreateEnum
CREATE TYPE "DeliveryAgentWalletTransactionType" AS ENUM ('SHIPMENT_COMPLETED', 'TASK_COMPLETED', 'PAYOUT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "DeliveryAgentWalletTransaction" (
    "id" TEXT NOT NULL,
    "deliveryAgentId" TEXT NOT NULL,
    "type" "DeliveryAgentWalletTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT,
    CONSTRAINT "DeliveryAgentWalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAgentWalletTransaction_referenceType_referenceId_key" ON "DeliveryAgentWalletTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "DeliveryAgentWalletTransaction_deliveryAgentId_idx" ON "DeliveryAgentWalletTransaction"("deliveryAgentId");

-- CreateIndex
CREATE INDEX "DeliveryAgentWalletTransaction_type_idx" ON "DeliveryAgentWalletTransaction"("type");

-- AddForeignKey
ALTER TABLE "DeliveryAgentWalletTransaction" ADD CONSTRAINT "DeliveryAgentWalletTransaction_deliveryAgentId_fkey" FOREIGN KEY ("deliveryAgentId") REFERENCES "OrderUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAgentWalletTransaction" ADD CONSTRAINT "DeliveryAgentWalletTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "OrderUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
