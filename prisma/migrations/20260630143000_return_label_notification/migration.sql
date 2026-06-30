ALTER TABLE "ReturnRequest"
  ADD COLUMN "returnLabelUrl" TEXT,
  ADD COLUMN "returnLabelNotificationSentAt" TIMESTAMP(3),
  ADD COLUMN "returnLabelNotificationError" TEXT,
  ADD COLUMN "returnLabelNotificationResponse" JSONB;
