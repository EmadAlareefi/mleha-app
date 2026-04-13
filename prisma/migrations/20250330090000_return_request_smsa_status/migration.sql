-- AlterTable
ALTER TABLE "ReturnRequest"
ADD COLUMN "smsaLiveStatus" JSONB,
ADD COLUMN "smsaLiveStatusUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LocalShipment"
ADD COLUMN "smsaLiveStatus" JSONB,
ADD COLUMN "smsaLiveStatusUpdatedAt" TIMESTAMP(3);
