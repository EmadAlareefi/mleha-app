-- Add embroidery cost captured during the production cycle (receive step)
ALTER TABLE "TailorFabricIssue" ADD COLUMN "embroideryCost" DECIMAL(12,2);
