-- API-key expense integration: optional caller id that blocks duplicate inserts.
-- Additive only. Apply with `prisma db execute` through DIRECT_URL BEFORE
-- deploying code: the Expense model now selects "externalId".
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_externalId_key" ON "Expense"("externalId");
