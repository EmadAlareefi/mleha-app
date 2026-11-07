-- Exchange v3: replacement products become an app-created Salla order.
-- Additive only. Apply manually with `prisma db execute` against DIRECT_URL.

ALTER TABLE "ReturnRequest" ADD COLUMN     "exchangeMode" TEXT NOT NULL DEFAULT 'coupon',
ADD COLUMN     "exchangeCreditAmount" DECIMAL(10,2),
ADD COLUMN     "exchangeOrderTotal" DECIMAL(10,2),
ADD COLUMN     "exchangeCreditApplied" DECIMAL(10,2),
ADD COLUMN     "exchangeAmountDue" DECIMAL(10,2),
ADD COLUMN     "exchangePaymentMethod" TEXT,
ADD COLUMN     "exchangePaymentStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "exchangeCheckoutUrl" TEXT,
ADD COLUMN     "exchangePaymentDueAt" TIMESTAMP(3),
ADD COLUMN     "exchangeReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "exchangeCreditCouponId" TEXT,
ADD COLUMN     "leftoverCouponCode" TEXT,
ADD COLUMN     "leftoverCouponAmount" DECIMAL(10,2),
ADD COLUMN     "exchangeOrderError" TEXT;

CREATE TABLE "ReturnExchangeLine" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "variantName" TEXT,
    "imageUrl" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnExchangeLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReturnExchangeLine_returnRequestId_idx" ON "ReturnExchangeLine"("returnRequestId");
CREATE INDEX "ReturnRequest_exchangePaymentStatus_idx" ON "ReturnRequest"("exchangePaymentStatus");

ALTER TABLE "ReturnExchangeLine" ADD CONSTRAINT "ReturnExchangeLine_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
