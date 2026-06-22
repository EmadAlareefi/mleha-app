-- Add optional dress size to models and to issued/delivered dresses
ALTER TABLE "DesignModel" ADD COLUMN "size" TEXT;
ALTER TABLE "TailorFabricIssue" ADD COLUMN "size" TEXT;
