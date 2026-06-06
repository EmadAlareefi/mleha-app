CREATE INDEX IF NOT EXISTS "Shipment_warehouseId_scannedAt_idx"
  ON "Shipment" ("warehouseId", "scannedAt");

CREATE INDEX IF NOT EXISTS "Shipment_warehouseId_company_scannedAt_idx"
  ON "Shipment" ("warehouseId", "company", "scannedAt");

CREATE INDEX IF NOT EXISTS "Shipment_warehouseId_type_scannedAt_idx"
  ON "Shipment" ("warehouseId", "type", "scannedAt");

CREATE INDEX IF NOT EXISTS "ReturnRequest_type_exchangeOrderNumber_idx"
  ON "ReturnRequest" ("type", "exchangeOrderNumber");

CREATE INDEX IF NOT EXISTS "OrderAssignment_completedAt_assignedAt_idx"
  ON "OrderAssignment" ("completedAt", "assignedAt");

CREATE INDEX IF NOT EXISTS "OrderAssignment_sallaStatus_assignedAt_idx"
  ON "OrderAssignment" ("sallaStatus", "assignedAt");

CREATE INDEX IF NOT EXISTS "ShipmentAssignment_deliveryAgentId_assignedAt_idx"
  ON "ShipmentAssignment" ("deliveryAgentId", "assignedAt");

CREATE INDEX IF NOT EXISTS "ShipmentAssignment_status_assignedAt_idx"
  ON "ShipmentAssignment" ("status", "assignedAt");

CREATE INDEX IF NOT EXISTS "ShipmentAssignment_deliveryAgentId_status_assignedAt_idx"
  ON "ShipmentAssignment" ("deliveryAgentId", "status", "assignedAt");
