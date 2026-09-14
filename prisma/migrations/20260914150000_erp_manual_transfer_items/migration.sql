ALTER TABLE "SallaOrder"
ADD COLUMN "erpManualTransferRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "erpManualTransferItems" JSONB;
