# ERP Invoice Sync – Agent Notes

This note keeps future AI agents productive when they need to debug or extend the ERP invoice sync. It ties together the ingestion jobs, UI, and ERP posting logic so you can jump straight to the right files and commands.

## What This Feature Does
- Pulls invoices/orders from Salla and stores them in `SallaInvoice` / `SallaOrder` with raw payloads for auditing.
- Lets ops teams inspect invoices at `/invoices` and `/invoices/[id]`, and orders in `/order-reports`.
- Transforms `SallaOrder` data into the ERP payload (items, shipping, COD, barcode fetch, totals validation) and posts it to the ERP API.
- Offers manual sync endpoints plus optional auto-sync via settings/webhooks.

## Data Flow & Key Modules
| Stage | Files / Routes | Notes |
| --- | --- | --- |
| **Salla ingestion** | `app/lib/salla-invoices-v2.ts`, `app/lib/salla-invoices.ts`, `scripts/run-sync-salla-invoices.js`, `scripts/sync-salla-invoices.ts`, `app/api/salla/sync-invoices/route.ts` | `salla-invoices-v2.ts` is the HTTP-compatible ingestion (orders → invoices). The CLI (`npm run sync:salla-invoices`) still points to the legacy module, so keep both in mind or update them together. Both rely on OAuth helpers in `app/lib/salla-oauth.ts` and tokens stored in `SallaAuth`. |
| **Invoice UI/API** | `app/invoices/page.tsx`, `app/invoices/[id]/page.tsx`, `app/api/invoices/*.ts` | Paginated list + details with ERP status, raw JSON view toggle, and `/api/invoices/[id]/sync-to-erp` for invoice-level sync using `app/lib/erp-integration.ts`. |
| **Order ERP payload** | `app/lib/erp-invoice.ts`, `scripts/test-erp-sync.ts`, `app/api/erp/sync-order/route.ts`, `app/api/erp/sync-orders-batch/route.ts` | Core order → ERP transformation. Handles barcode lookups, Salla API fallbacks, extra shipping/COD items, total validation and ERP posting. `scripts/test-erp-sync.ts` dumps a payload without actually calling ERP (honors `ERP_DEBUG_MODE`). |
| **Operations UI** | `app/order-reports/page.tsx`, `app/erp-settings/page.tsx`, `app/api/erp/stats/route.ts`, `app/api/erp/clear-debug-invoices/route.ts` | Order grid exposes “Sync to ERP” buttons per order plus a bulk action. `/erp-settings` shows aggregate stats, lets admins run `/api/erp/sync-orders-batch`, and toggle auto-sync settings stored in `Settings`. |
| **Auto-sync & webhooks** | `app/lib/erp-webhook-sync.ts`, `app/lib/settings.ts`, `ERP_AUTO_SYNC_SETUP.md` | When enabled, webhook handlers call `handleOrderWebhookSync` (after `shouldAutoSyncForStatus`) to push matching orders automatically. |

## Commands, Scripts & API Calls
- `npm run sync:salla-invoices -- [opts]` → CLI ingestion (legacy module). Supports `--merchant`, `--start-date`, `--end-date`, `--per-page`.
- `POST /api/salla/sync-invoices` → Server ingestion using the v2 module; accepts `merchantId`, `perPage`, `startDate`, `endDate`.
- `npx ts-node scripts/test-erp-sync.ts` → Pulls the latest order, prints the ERP payload, and (optionally) exercises `syncOrderToERP` with `ERP_DEBUG_MODE`.
- `POST /api/erp/sync-order` → Sync a single `SallaOrder` (`orderId` or `orderNumber`, optional `force`).
- `POST /api/erp/sync-orders-batch` → Sync multiple orders (IDs or filters such as `statusSlug`, `dateFrom`, `onlyUnsynced`, `force`).
- `POST /api/invoices/:id/sync-to-erp` → Invoice-level sync via `app/lib/erp-integration.ts`.
- `POST /api/erp/clear-debug-invoices` → Removes `erpSyncedAt`/`erpInvoiceId` for debug entries.
- `GET /api/erp/stats` → Summary counts for `/erp-settings`.

## Configuration & Environment
Set these before running any sync:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Prisma connection (orders/invoices live here). |
| `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET` | Needed for OAuth refresh in `app/lib/salla-oauth.ts`. |
| `ERP_LOGIN_URL`, `ERP_USERNAME`, `ERP_PASSWORD` | Used by `app/lib/erp-auth.ts` to fetch/refresh the bearer token. |
| `ERP_INVOICE_URL` | POST target for invoice payloads. |
| `ERP_BARCODE_API_URL`, `ERP_API_KEY` | Source for barcode lookups per SKU. The current implementation hard-fails the entire sync if this is missing or responds with an error. |
| `ERP_DEBUG_MODE` (optional) | When `true`, `postInvoiceToERP` skips the network call and returns mock IDs—great for dry runs. |
| `CRON_SECRET` (optional) | Protects `/api/salla/sync-invoices` if you re-enable the auth block in that handler. |

Other helpers live in `app/lib/settings.ts` (`erp_auto_sync_*` keys) and `prisma/schema.prisma` for field names (`erpSyncedAt`, `erpSyncError`, etc.).

## Debugging & Triage Workflow
1. **Reproduce the data:** make sure the relevant order/invoice exists using `npx prisma studio` or a quick Prisma script. Check `rawOrder` / `rawInvoice` to confirm Salla data is intact.
2. **Inspect the payload:** run `npx ts-node scripts/test-erp-sync.ts` and verify `API_Inv`, shipping/COD lines, and totals. Adjust `transformOrderToERPInvoice` if business logic changes (shipping, COD, discounts, etc.).
3. **Check external dependencies:** `fetchBarcodeFromERP` and `sallaMakeRequest` both hit remote APIs. Missing/expired env vars or HTTP 4xx/5xx bubble up as sync failures; logs go through `app/lib/logger.ts`.
4. **Use the APIs:** `curl -X POST /api/erp/sync-order -d '{"orderId":"...","force":true}'` reruns a single order. For batches during incidents, hit `/api/erp/sync-orders-batch` instead of looping in the browser.
5. **Review DB columns:** successful syncs set `erpSyncedAt`, `erpInvoiceId`, and clear `erpSyncError`. Debug mode produces `erpInvoiceId` values prefixed with `DEBUG-`; clear them via `/api/erp/clear-debug-invoices`.
6. **UI verification:** `/order-reports` and `/erp-settings` surface sync state immediately. `/invoices/[id]` exposes raw JSON and last ERP attempt per invoice.

## Common Tasks
1. **Adjusting the ERP payload:** edit `transformOrderToERPInvoice` (`app/lib/erp-invoice.ts`). Shipping and COD lines are assembled around lines 359–478, total validation is at 490+, and the header payload is finalized at 552+. Keep totals aligned with `rawOrder.total` or the guard will throw.
2. **Changing barcode/sku handling:** update `fetchBarcodeFromERP` and the item-building loop in `extractOrderItems`. Consider caching repeated barcodes per order if you notice timeouts.
3. **Adding new ingestion filters:** extend the `SyncOptions` + query building inside `app/lib/salla-invoices-v2.ts` and mirror the CLI flags if you still need the Node script.
4. **Automating sync triggers:** `app/lib/erp-webhook-sync.ts` plus settings keys `erp_auto_sync_enabled`, `erp_auto_sync_on_status`, `erp_sync_delay_seconds` control webhook behavior. Update `shouldAutoSyncForStatus` if new statuses arrive.

## Known Pitfalls & Follow-Ups
- **Dual ingestion implementations:** the CLI uses `app/lib/salla-invoices.ts` while the API uses `app/lib/salla-invoices-v2.ts`. If you patch one, patch or delete the other to avoid running two divergent pipelines (`scripts/sync-salla-invoices.ts:3`, `app/api/salla/sync-invoices/route.ts:3`).
- **Already-synced orders look “fresh”:** `syncOrderToERP` returns a success message when `erpSyncedAt` is already set (`app/lib/erp-invoice.ts:673-685`), and `/api/erp/sync-order` rewrites `erpSyncedAt`/`erpInvoiceId` regardless (`app/api/erp/sync-order/route.ts:48-58`). Consider short-circuiting the update or surfacing a “skipped” status so ops can tell whether a resend actually hit the ERP.
- **ERP response handling:** `postInvoiceToERP` blindly calls `response.json()` on success (`app/lib/erp-invoice.ts:620-645`). If your ERP responds with plain text or an empty body, the JSON parse throws and records a false failure. Wrap it in a `Content-Length`/`Content-Type` guard before parsing.
- **Barcode dependency:** `extractOrderItems` waits for `fetchBarcodeFromERP` per item (lines 294-305). When the barcode API slows down or a SKU is missing, the entire order fails. Add memoization, fall back to stored barcodes, or allow non-blocking warnings if this becomes noisy.
- **Browser-based bulk sync:** the bulk button in `app/order-reports/page.tsx:469-535` loops over `/api/erp/sync-order` from the browser, which is easy to throttle or close accidentally. Prefer the server-side batch endpoint (`/api/erp/sync-orders-batch`) for large reruns.

Keep those in mind when addressing bug reports—most issues come from external API drift or the duplicate ingestion implementations.

## Testing & Verification
- `npm run dev` and load `/invoices`, `/order-reports`, `/erp-settings` to confirm UI flows.
- Run `npx ts-node scripts/test-erp-sync.ts` (with `ERP_DEBUG_MODE=true`) before touching live ERP.
- Exercise API endpoints with a test order (sync, retry with `force`, batch sync, clear debug entries).
- Spot-check Prisma tables (`npx prisma studio`) to ensure monetary fields and raw payloads look sane.

Document any production fixes in this file so the next agent knows what changed.
