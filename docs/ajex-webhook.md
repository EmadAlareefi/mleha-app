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
Authorization headers are never stored. This receiver does not update shipments
or order statuses. No database migration is required.

Test: `node --test --import tsx app/lib/__tests__/ajex-webhook.test.ts`.
