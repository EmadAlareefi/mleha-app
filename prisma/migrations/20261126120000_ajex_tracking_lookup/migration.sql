-- Hermes shipment events read the AJEX movement history from stored callbacks
-- (WebhookLog, event = 'ajex.tracking') by waybill. Partial expression index so
-- that lookup does not scan every AJEX callback.
-- Additive only; code works without it (just slower). Prisma schema cannot
-- express partial expression indexes, so it lives only here.
-- CONCURRENTLY cannot run in a transaction: apply with psql "$DIRECT_URL" -f.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "WebhookLog_ajex_trackingId_idx"
  ON "WebhookLog" ((json->>'trackingId'))
  WHERE event = 'ajex.tracking';
