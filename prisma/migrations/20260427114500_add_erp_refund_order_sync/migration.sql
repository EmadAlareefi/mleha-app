-- CreateTable
CREATE TABLE "ERPRefundOrderSync" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderRecordId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "erpInvoiceId" TEXT,
    "erpSyncedAt" TIMESTAMP(3),
    "erpSyncError" TEXT,
    "erpSyncAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ERPRefundOrderSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ERPRefundOrderSync_orderRecordId_key" ON "ERPRefundOrderSync"("orderRecordId");

-- CreateIndex
CREATE INDEX "ERPRefundOrderSync_merchantId_erpSyncedAt_idx" ON "ERPRefundOrderSync"("merchantId", "erpSyncedAt");

-- AddForeignKey
ALTER TABLE "ERPRefundOrderSync"
ADD CONSTRAINT "ERPRefundOrderSync_orderRecordId_fkey"
FOREIGN KEY ("orderRecordId") REFERENCES "SallaOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
