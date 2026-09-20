# AJEX tracking callback

Send POST requests to `/api/webhooks/ajex/tracking` with `Content-Type: application/json`
and `Authorization: Bearer <AJEX_WEBHOOK_BEARER_TOKEN>`.
Configure a dedicated production secret in Vercel; never commit its value.

The body follows AJEX API v1.7 section 9: trackingId, referenceId, status, timezone
(nonempty strings), statusCode (integer), eventTime (Unix milliseconds, integer).
Optional and unknown fields are retained, and unknown status codes are accepted.
Successful persistence returns HTTP 200 and `{"responseCode":"200","responseMessage":"Success"}`.
Incorrect auth returns 401, unconfigured auth 503, invalid events 400,
unsupported content type 415, and storage failure 500 so AJEX can retry.
Only POST is supported.

Each accepted delivery is stored in the existing WebhookLog table with event
`ajex.tracking` and verified=true. Retries are retained as separate log entries.
Authorization headers are never stored.

## Warehouse shipment linking

After the callback is stored, it is applied to the scanned warehouse shipments
(both الواردة and الصادرة) that carry the same waybill, mirroring the SMSA scan
feed. The normalized status is written to `Shipment.ajexLiveStatus`, with
`ajexLiveStatusUpdatedAt` (when it was written) and `ajexLiveStatusEventAt` (the
carrier event time). `Shipment` rows are matched by tracking-number prefix,
because warehouse scans capture the piece barcode (`AJA…001`) while callbacks
report the shipment waybill (`AJA…`). A callback older than the stored
`ajexLiveStatusEventAt` is ignored, so retries and out-of-order deliveries never
roll a shipment back to an earlier status. A failed link is logged but still
acknowledged with 200, because the event is already stored and can be replayed.

`/app/warehouse` renders the AJEX status in the same column and details dialog as
SMSA via `resolveShipmentLiveStatus` (`lib/shipment-live-status.ts`); AJEX status
codes map to Arabic labels in `lib/ajex-status.ts`, and unknown codes fall back to
the raw `status` text.

Migration: `prisma/migrations/20260920120000_shipment_ajex_live_status`.
Replay stored callbacks onto existing shipments with
`npm run backfill:ajex-live-status` (add `-- --dry-run` to preview).

Test: `npm run test:ajex`.
