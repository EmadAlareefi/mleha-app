-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sallaEvent" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT,
    "rawPayload" JSONB NOT NULL,
    "signature" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uniqueKey" TEXT
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "toPhone" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateName" TEXT,
    "body" TEXT,
    "zokoMsgId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_uniqueKey_key" ON "WebhookEvent"("uniqueKey");
