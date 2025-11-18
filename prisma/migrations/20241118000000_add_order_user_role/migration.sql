-- CreateEnum
CREATE TYPE "OrderUserRole" AS ENUM ('ORDERS', 'STORE_MANAGER', 'WAREHOUSE');

-- AlterTable
ALTER TABLE "OrderUser"
ADD COLUMN "role" "OrderUserRole" NOT NULL DEFAULT 'ORDERS';
