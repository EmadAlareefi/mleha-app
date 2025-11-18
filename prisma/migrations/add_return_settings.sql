-- Add Settings model
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Settings_key_key" ON "Settings"("key");

-- Add return fee and shipping fields to ReturnRequest
ALTER TABLE "ReturnRequest" ADD COLUMN "returnFee" DECIMAL(10,2);
ALTER TABLE "ReturnRequest" ADD COLUMN "shippingAmount" DECIMAL(10,2);
