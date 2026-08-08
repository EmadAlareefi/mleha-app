-- Rate-limit ledger for the public order lookup endpoint.
CREATE TABLE "PublicOrderLookupAttempt" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "merchantId" TEXT,
    "reference" TEXT,
    "found" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicOrderLookupAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicOrderLookupAttempt_ipHash_createdAt_idx" ON "PublicOrderLookupAttempt"("ipHash", "createdAt");

CREATE INDEX "PublicOrderLookupAttempt_createdAt_idx" ON "PublicOrderLookupAttempt"("createdAt");
