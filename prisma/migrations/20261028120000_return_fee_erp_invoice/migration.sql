-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "erpFeeInvoiceId" TEXT,
ADD COLUMN     "erpFeeSyncedAt" TIMESTAMP(3),
ADD COLUMN     "erpFeeSyncError" TEXT;
