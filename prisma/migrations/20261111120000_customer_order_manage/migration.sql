-- Customer order self-service (cancel / edit before prep).
-- Additive only. Apply with `prisma db execute` through DIRECT_URL BEFORE
-- deploying code: the order-prep queue SQL references "CustomerOrderChange".

-- One row per sign-in attempt: the one-time code, then the session it opens.
CREATE TABLE IF NOT EXISTS "CustomerOrderAccess" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderNumber" TEXT,
  "channel" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeExpiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "sessionTokenHash" TEXT,
  "sessionExpiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerOrderAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrderAccess_sessionTokenHash_key" ON "CustomerOrderAccess"("sessionTokenHash");
CREATE INDEX IF NOT EXISTS "CustomerOrderAccess_merchantId_orderId_createdAt_idx" ON "CustomerOrderAccess"("merchantId", "orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerOrderAccess_ipHash_createdAt_idx" ON "CustomerOrderAccess"("ipHash", "createdAt");

-- One row per customer action. It is the audit log, and while "holdActive" is
-- true it is also the hold that keeps the order away from packers and shippers.
CREATE TABLE IF NOT EXISTS "CustomerOrderChange" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderNumber" TEXT,
  "kind" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'held',
  "holdActive" BOOLEAN NOT NULL DEFAULT true,
  "idempotencyKey" TEXT NOT NULL,
  "accessId" TEXT,
  "ipHash" TEXT,
  "request" JSONB NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "steps" JSONB,
  "writeStatus" TEXT NOT NULL DEFAULT 'none',
  "lastError" TEXT,
  "paymentMethod" TEXT,
  "amountDelta" DECIMAL(12,2),
  "currency" TEXT,
  "refundStatus" TEXT NOT NULL DEFAULT 'none',
  "refundAmount" DECIMAL(12,2),
  "refundTransactionId" TEXT,
  "refundedAt" TIMESTAMP(3),
  "refundError" TEXT,
  "paymentStatus" TEXT,
  "paymentUrl" TEXT,
  "paymentExpiresAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolvedByName" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "staffNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CustomerOrderChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrderChange_idempotencyKey_key" ON "CustomerOrderChange"("idempotencyKey");
-- The hold: at most one change in flight per order. Prisma cannot express a
-- partial unique index, so it exists only here.
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrderChange_active_hold_key" ON "CustomerOrderChange"("merchantId", "orderId") WHERE "holdActive" = true;
CREATE INDEX IF NOT EXISTS "CustomerOrderChange_merchantId_orderId_idx" ON "CustomerOrderChange"("merchantId", "orderId");
CREATE INDEX IF NOT EXISTS "CustomerOrderChange_state_updatedAt_idx" ON "CustomerOrderChange"("state", "updatedAt");
CREATE INDEX IF NOT EXISTS "CustomerOrderChange_refundStatus_createdAt_idx" ON "CustomerOrderChange"("refundStatus", "createdAt");
