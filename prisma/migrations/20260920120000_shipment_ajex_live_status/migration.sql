ALTER TABLE "Shipment" ADD COLUMN "ajexLiveStatus" JSONB;
ALTER TABLE "Shipment" ADD COLUMN "ajexLiveStatusUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN "ajexLiveStatusEventAt" TIMESTAMP(3);
