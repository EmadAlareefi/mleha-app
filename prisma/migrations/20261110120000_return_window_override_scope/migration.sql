-- Window exceptions (استثناء مدة الإرجاع) scoped to return, exchange or both.
-- Additive only. Existing rows become 'both' (today's behaviour).
-- Apply manually with `prisma db execute` against DIRECT_URL, BEFORE deploying the code.

-- AlterTable
ALTER TABLE "ReturnWindowOverride" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'both',
ADD COLUMN "note" TEXT;
