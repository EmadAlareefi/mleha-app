CREATE INDEX IF NOT EXISTS "OrderAssignment_merchantId_orderNumber_idx"
  ON "OrderAssignment" ("merchantId", "orderNumber");

CREATE INDEX IF NOT EXISTS "OrderHistory_merchantId_orderNumber_idx"
  ON "OrderHistory" ("merchantId", "orderNumber");

CREATE INDEX IF NOT EXISTS "SallaOrder_merchantId_orderNumber_idx"
  ON "SallaOrder" ("merchantId", "orderNumber");

CREATE INDEX IF NOT EXISTS "SallaOrder_merchantId_referenceId_idx"
  ON "SallaOrder" ("merchantId", "referenceId");

CREATE INDEX IF NOT EXISTS "SallaOrder_merchantId_customerMobile_idx"
  ON "SallaOrder" ("merchantId", "customerMobile");
