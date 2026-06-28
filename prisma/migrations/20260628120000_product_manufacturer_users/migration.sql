ALTER TABLE "OrderUser" ADD COLUMN "userType" TEXT NOT NULL DEFAULT 'employee';

CREATE INDEX "OrderUser_userType_idx" ON "OrderUser"("userType");

-- Existing product links pointed at Supplier records. The product page now links
-- products to OrderUser rows marked as manufacturers, so old supplier links are
-- intentionally cleared.
DELETE FROM "SallaProductSupplier";

ALTER TABLE "SallaProductSupplier" DROP CONSTRAINT IF EXISTS "SallaProductSupplier_supplierId_fkey";
DROP INDEX IF EXISTS "SallaProductSupplier_supplierId_idx";

ALTER TABLE "SallaProductSupplier" DROP COLUMN IF EXISTS "supplierId";
ALTER TABLE "SallaProductSupplier" ADD COLUMN "userId" TEXT NOT NULL;

ALTER TABLE "SallaProductSupplier"
  ADD CONSTRAINT "SallaProductSupplier_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "OrderUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SallaProductSupplier_userId_idx" ON "SallaProductSupplier"("userId");
