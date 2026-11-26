-- Track which ERP credit note reversed each return/exchange request.
ALTER TABLE "ReturnRequest" ADD COLUMN "erpCreditInvoiceId" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN "erpCreditSyncedAt" TIMESTAMP(3);
