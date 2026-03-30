-- AlterTable
ALTER TABLE "ShipmentAssignment"
ADD COLUMN "deliveryOtpAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deliveryOtpCodeHash" TEXT,
ADD COLUMN "deliveryOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN "deliveryOtpRequestedAt" TIMESTAMP(3),
ADD COLUMN "deliveryOtpVerifiedAt" TIMESTAMP(3);
