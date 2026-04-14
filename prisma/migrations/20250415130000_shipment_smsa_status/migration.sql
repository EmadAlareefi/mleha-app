-- AlterTable
ALTER TABLE "Shipment"
ADD COLUMN "smsaLiveStatus" JSONB,
ADD COLUMN "smsaLiveStatusUpdatedAt" TIMESTAMP(3);
