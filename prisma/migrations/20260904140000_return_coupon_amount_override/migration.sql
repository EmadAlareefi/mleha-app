ALTER TABLE "ReturnRequest" ADD COLUMN "couponAmountOverride" DECIMAL(10,2);
ALTER TABLE "ReturnRequest" ADD COLUMN "couponAmountOverrideBy" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN "couponAmountOverrideAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN "couponAmountOverrideNote" TEXT;
