# Hermes integration API

Read-only API that lets the Hermes assistant answer authorised employees'
questions about orders, customers, shipments and business performance, over
WhatsApp, Telegram and the Hermes dashboard.

- Contract: [`docs/hermes-openapi.json`](./hermes-openapi.json) (OpenAPI 3.1)
- Tool definitions: [`docs/hermes-tools-manifest.json`](./hermes-tools-manifest.json)
- Code: `app/api/integrations/hermes/**` (routes), `app/lib/hermes/**` (logic)
- Tests: `npm run test:hermes`

Phase 1 is strictly read-only. There is no endpoint that changes an order,
customer, shipment, refund or anything else. There is no SQL, GraphQL,
free-text search or listing endpoint either.

---

## 1. Architecture

```
Hermes gateway ──HTTPS + Bearer key──▶ /api/integrations/hermes/*  (Next.js route handlers, nodejs runtime)
                                         │
                                         ├─ handler.ts   kill switch → TLS → key → scope → rate limit → params → audit
                                         ├─ lookups.ts   orders / customers / shipments (exact identifiers only)
                                         ├─ reports.ts   aggregated reports (Decimal maths, SAR, time zones)
                                         ├─ dto.ts       allow-listed response shapes
                                         └─ store-prisma.ts  tenant-scoped, parameterised Prisma queries
```

- **Data source.** Salla orders mirrored in `SallaOrder` / `SallaOrderItem` by
  webhooks and the scheduled sync. Shipments come from `SallaShipment`
  (labels), `Shipment` (warehouse scans plus SMSA/AJEX live status),
  `LocalShipment` (own couriers) and `SmsaWebhookShipment` (carrier events).
  Returns come from `ReturnRequest`. The status timeline comes from
  `WebhookEvent`, using status and time only.
- **Existing rules reused:**
  - phone normalisation (`app/lib/phone.ts`)
  - order-number normalisation (`app/lib/salla-order-reference.ts`)
  - SAR conversion (`lib/erp-currency.ts`)
  - SMSA/AJEX status classification (`lib/smsa-status.ts`, `lib/ajex-status.ts`)
  - Salla status names (`app/lib/salla-statuses.ts`)
  - carrier tracking links (`lib/tracking-url.ts`, extracted from the order-search page)
- **Middleware.** `/api/integrations/hermes` is exempt from the NextAuth
  session middleware because every route authenticates its own credential.

## 2. Base URL

`https://<production-host>/api/integrations/hermes`

Plain HTTP is refused in production with `403 https_required`. The check uses
`x-forwarded-proto`, which Vercel sets. Every response carries
`Strict-Transport-Security`, `Cache-Control: private, no-store` and
`X-Request-Id`.

## 3. Authentication

The project has no OAuth2 server, so the API uses **scoped service API
keys**:

```
Authorization: Bearer hrm_<keyId>_<secret>
```

- The key is `hrm_` + a 16-character public `keyId` + a 43-character random
  secret (32 bytes).
- Only `HMAC-SHA256(HERMES_API_KEY_PEPPER, secret)` is stored, in
  `HermesApiCredential.secretHash`. It is compared in constant time. A database
  leak alone yields no usable keys.
- Each key is bound to one `merchantId` (the tenant). Every query is filtered
  by it.
- A key can have an expiry, can be revoked individually, and can be rotated
  with a grace period. `lastUsedAt` is updated at most every 5 minutes.
- Unknown key, wrong secret, revoked key and expired key all return the same
  `401 unauthenticated`.
- Keys in the query string (`api_key`, `token`, `key`, …) are rejected with
  `400`; they are never accepted.

### Scopes

| Scope | Grants |
|---|---|
| `hermes:support:read` | Order, customer and shipment lookups. Contact details are masked. |
| `hermes:manager:reports` | All `/reports/*` endpoints. |
| `hermes:manager:pii` | Unmasked phone and email, full street address and national short address, and the `top_customers` list in the customer report. |

Scopes do not imply each other. A manager credential that should also do
lookups is issued with all three scopes. A support credential gets `403
forbidden` on every report endpoint; this is enforced in the handler and
covered by tests, not left to the AI.

**Trust boundary.** Authorisation comes only from the scopes stored on the
authenticated credential. Request fields such as `role=manager` are rejected
as unsupported parameters. Headers such as `X-Hermes-Role` are ignored.

### Employee identity from the gateway (audit only)

Hermes may forward who is asking:

| Header | Value |
|---|---|
| `X-Hermes-Actor-Id` | Employee id, `[A-Za-z0-9_.:@+-]{1,64}` |
| `X-Hermes-Actor-Channel` | `whatsapp`, `telegram`, `dashboard` or `api` |
| `X-Hermes-Actor-Timestamp` | Unix seconds |
| `X-Hermes-Actor-Signature` | hex `HMAC-SHA256(HERMES_GATEWAY_SIGNING_SECRET, "${timestamp}.${actorId}.${channel}.${path}")` |

These values are **audit context only**. They never grant or remove access.
The audit row stores `actorVerified = true` only when the signature is valid,
is no more than 5 minutes old, and is bound to the request path. Without a
valid signature, the values are recorded as unverified claims.

## 4. Credential management

Credentials are managed from the CLI only. There is no HTTP endpoint for it.
`DATABASE_URL` and `HERMES_API_KEY_PEPPER` must be set.

```bash
# Support assistant (lookups only)
npm run hermes:credentials -- create --name "Hermes support" --merchant 1696031053 \
  --scopes hermes:support:read --created-by "<operator>" --expires-days 90

# Manager assistant
npm run hermes:credentials -- create --name "Hermes managers" --merchant 1696031053 \
  --scopes hermes:support:read,hermes:manager:reports,hermes:manager:pii \
  --created-by "<operator>" --expires-days 90

npm run hermes:credentials -- list --merchant 1696031053
npm run hermes:credentials -- rotate --id <credentialId> --by "<operator>" --grace-hours 24
npm run hermes:credentials -- revoke --id <credentialId> --by "<operator>" --reason "leaked"
```

- The plaintext key is printed **once**. Put it straight into the Hermes
  gateway's secret store; never paste it into chat, tickets or `.env` files in
  git.
- `rotate` issues a replacement with the same name, tenant and scopes. The old
  key keeps working for `--grace-hours` (0–168). With `0`, the old key is
  revoked immediately.
- Rotating `HERMES_API_KEY_PEPPER` invalidates **every** key and every
  `customer_ref`. Only do it during an incident, then reissue the keys.

## 5. Endpoints

Every response uses one envelope:

```json
{ "data": { }, "meta": { "request_id": "…", "generated_at": "…", "timezone": "Asia/Riyadh", "currency": "SAR" }, "error": null }
```

On failure, `data` is `null` and `error` is `{ "code", "message", "details"? }`.

- Dates are ISO 8601 in UTC.
- Money is a **string with exactly two decimals** (`"115.00"`), computed with
  Decimal arithmetic. It is never a float.
- Statuses carry a stable `code` and an Arabic `label_ar`.

### Support (`hermes:support:read`)

| Method & path | Purpose |
|---|---|
| `GET /orders/search` (or `POST` with a JSON body) | Exactly one of `order_number`, `phone`, `email`, `tracking_number`. Optional `page`, `page_size` (≤ 50). |
| `GET /orders/{orderReference}` | Full support view of an order. |
| `GET /customers/search` (or `POST`) | Exactly one of `phone`, `email`, `customer_id`. At most 5 customers. |
| `GET /customers/{customerRef}/summary` | Takes the opaque `customer_ref` from search or order responses. |
| `GET /shipments/search` (or `POST`) | Exactly one of `order_number`, `tracking_number`. |
| `GET /shipments/{shipmentReference}` | One shipment (by tracking number) with public tracking events. |

Use `POST` with a JSON body for phone and email searches. Query strings end up
in platform access logs; JSON bodies do not. A request must not send both a
query string and a body.

**Matching rules:**

- **Order number:** Arabic-Indic digits, `#`, spaces and dashes are normalised.
- **Phone:** normalised to E.164 with the app's own rules (Saudi
  `05xxxxxxxx`, `5xxxxxxxx` and `+9665xxxxxxxx` are accepted). Stored numbers
  come in several spellings, so every candidate row is re-verified with the
  order's own dialling code. A UAE `5xxxxxxxx` never matches a Saudi search.
- **Email:** case-insensitive exact match. Candidates are re-verified in code,
  so `_` or `%` in the input cannot act as SQL `LIKE` wildcards.
- **Tracking number:** exact match (an upper-case variant is also tried)
  against Salla labels, local-courier labels and the order record.
- There is no partial matching, prefix search or listing anywhere.

**Order detail includes:**

- order reference and dates
- order status, with Salla's own Arabic name
- derived payment state and fulfillment state
- customer name, plus masked phone and email
- shipping country, region, city, district and receiver
- items with variant options, unit price, line total and the customer's
  product note
- discounts, with codes and titles
- shipping charge, cash-on-delivery fee, VAT and total
- every shipment, with tracking link
- status timeline
- returns, exchanges and refunds (full and partial)
- operational flags: `high_priority`, `do_not_ship`, `gift`

**Never returned:**

- passwords or hashes
- tokens
- card, bank and gateway data (`payment_methods`, `payment_actions`)
- raw webhook or Salla payloads
- cost prices
- shipper data
- the customer's IP and device
- staff notes (assignment, return review, delivery, flag notes)
- Salla's order-level `notes` (it is not documented as customer-authored)
- free-text return reasons
- coupon codes
- delivery-proof images
- OTP data

Salla does not populate `paymentStatus` on stored orders, so payment state is
derived from the order status, payment method and `is_pending_payment`:

| Payment state | When |
|---|---|
| `paid` | Default for a sale order. |
| `awaiting_payment` | Status `payment_pending`, `is_pending_payment = true`, or method `waiting`. |
| `cod_due` | Cash on delivery and not yet delivered. |
| `refunded` | Order is `restored`. |
| `free` | Payment method `free`. |
| `void` | Order is cancelled or deleted. |

Example (sanitised):

```http
GET /api/integrations/hermes/orders/71234567
Authorization: Bearer hrm_…
```

```json
{
  "data": {
    "order_reference": "71234567",
    "created_at": "2026-10-05T10:00:00.000Z",
    "status": { "code": "delivered", "label_ar": "تم التوصيل", "salla_status": "delivered", "salla_label": "تم التوصيل" },
    "payment": { "method": "mada", "code": "paid", "label_ar": "مدفوع" },
    "fulfillment": { "code": "fulfilled", "label_ar": "تم الشحن", "salla_fulfillment_status": "shipping_ready" },
    "customer": { "customer_ref": "cus_5001_Qm9ndXNTaWduYXR1cmUx", "name": "عميل تجريبي", "phone": "+966*******01", "email": "cu***@example.test" },
    "shipping_address": { "country": "السعودية", "region": "منطقة الرياض", "city": "الرياض", "district": "حي تجريبي", "receiver_name": "مستلم تجريبي", "receiver_phone": "+966*******09" },
    "items": [{ "name": "عباية تجريبية", "sku": "SKU-54", "product_id": "p1", "quantity": 2, "options": [{ "name": "المقاس", "value": "54" }], "unit_price": "57.50", "line_total": "115.00", "customer_note": null }],
    "amounts": { "currency": "SAR", "subtotal": "100.00", "discount_total": "0.00", "discounts": [], "shipping": "0.00", "cash_on_delivery_fee": "0.00", "tax": "15.00", "total": "115.00" },
    "shipments": [{ "shipment_reference": "AJX123456", "carrier": { "code": "ajex", "label_ar": "ايجكس", "name": "إيجكس" }, "tracking_url": "https://aj-ex.com/ar/shipment-status/AJX123456", "status": { "code": "delivered", "label_ar": "تم التسليم", "source": "carrier" }, "delivered_at": "2026-10-07T09:12:00.000Z", "…": "…" }],
    "timeline": [{ "status": "new", "label_ar": "طلب جديد", "salla_status": "under_review", "at": "…" }],
    "returns": [],
    "refunds": { "fully_refunded": false, "refund_in_progress": false, "partially_refunded_items": 0, "partially_refunded_amount": "0.00", "currency": "SAR" },
    "flags": { "high_priority": false, "do_not_ship": false, "gift": false }
  },
  "meta": { "request_id": "6f1c…", "generated_at": "2026-10-18T09:00:00.000Z", "timezone": "Asia/Riyadh", "currency": "SAR" },
  "error": null
}
```

**Shipment status codes:**

| Code | Meaning |
|---|---|
| `label_created` | Label exists; not yet with the carrier. |
| `in_transit` | With the carrier. |
| `out_for_delivery` | Out for delivery. |
| `delivered` | Delivered. |
| `exception` | Failed delivery or pickup, on hold, or an address problem. Comes with `exception_reason`. |
| `returning` | On its way back to the store. |
| `returned_to_sender` | Back at the store. |
| `returned` | Order-level return; no carrier data. |
| `cancelled` | Shipment cancelled. |
| `unknown` | No usable status. |

`status.source` says where the status came from: `carrier`, `local_courier`,
`salla` or `order_status`. An order with no tracking information returns an
empty `shipments` list.

### Reports (`hermes:manager:reports`)

| Path | Contents |
|---|---|
| `GET /reports/sales` | Gross and net sales, order count, average order value, discounts, shipping revenue, refunds (full and partial), VAT, cancelled orders. |
| `GET /reports/order-operations` | Orders by status, paid vs unpaid, fulfilled vs unfulfilled, cancellations, returns and refunds, return requests by type, status and customer-selected reason (`size_issue`, `changed_mind`, `defective`, `wrong_item`, `other`), aging open orders, work awaiting action. |
| `GET /reports/shipment-performance` | Shipments by status, hours order→label, order→dispatch and dispatch→delivery, delayed shipments (> 5 days), delivery exceptions, per-carrier performance, delivery success rate, data coverage. |
| `GET /reports/customers` | New vs returning, repeat purchase rate, customers by city; `top_customers` only with `hermes:manager:pii`. Lifetime value is reported as unavailable (history starts Sep 2025 and costs are not stored). |
| `GET /reports/products` | Best sellers by units, revenue by product, variants (by SKU), low performers, returns by product with their reasons, coverage. Categories and inventory are reported as unavailable (not stored locally). |
| `GET /reports/daily-trend` | Per local day: orders, revenue, refunds, shipments, with an optional aligned comparison series. |

**Common parameters:**

| Parameter | Rules |
|---|---|
| `from`, `to` | Required local dates (`YYYY-MM-DD`), inclusive. The range is at most **92 days**. `from` cannot be in the future. |
| `timezone` | IANA zone; default `Asia/Riyadh`. |
| `compare` | `none`, `previous_period` (same length, immediately before) or `previous_year`. |
| `status`, `payment_method`, `city`, `carrier`, `source` | Optional filters; comma-separated, up to 10 values each. |
| `page`, `page_size` | Pagination for detailed lists; `page_size` ≤ 100. |

**Every report's `meta` contains:**

- `applied_range` (with UTC bounds)
- `comparison_range`
- `timezone`
- `applied_filters`
- `definitions` (plain-language definition of each metric)
- `currency: "SAR"`
- `data_freshness` (last order, last webhook, cache state, computed time)
- `unconverted_orders` (orders left out of money totals because no SAR rate
  was available)

**Key definitions** (`meta.definitions` has the full list):

| Term | Definition |
|---|---|
| Sale order | Placed in the range and not `awaiting_payment`, `cancelled` or `deleted`. |
| `total_sales` | `gross_sales − discounts + shipping_revenue + tax`. Reconciles with Salla totals for 99.2% of orders. |
| `full_refunds` | Totals of orders whose **first** transition to Salla status `restored` happened in the range (refund-date basis). |
| `partial_refunds` | Salla `refunded_items` on orders placed in the range that were not fully returned (order-date basis). |
| `net_sales` | `total_sales − refunds`. |
| Currency | Every amount is converted to SAR with the order's Salla `exchange_rate`, the same rule the ERP sync uses. |

## 6. Errors

| HTTP | `error.code` | Meaning |
|---|---|---|
| 400 | `validation_error` | `details.field` and `details.reason` say what is wrong. This includes unknown or repeated parameters and keys in the query string. |
| 401 | `unauthenticated` | Missing, malformed, unknown, revoked or expired key. These are indistinguishable by design. |
| 403 | `forbidden` | The credential lacks `details.required_scope`. |
| 403 | `https_required` | The request was plain HTTP in production. |
| 404 | `not_found` | Lookup found nothing. Counts toward the miss budget. |
| 429 | `rate_limited` | Honour the `Retry-After` header. |
| 503 | `temporarily_unavailable` | Database unreachable, configuration missing, or `HERMES_API_ENABLED` is not `true`. |
| 500 | `internal_error` | Unexpected failure. The details are in the server logs under the same `request_id`. |

Search endpoints answer "nothing found" with `200` and `items: []`. That
result still counts as a miss.

## 7. Rate limits and enumeration protection

| Limit | Default | Env override |
|---|---|---|
| Requests per credential per minute | 60 | `HERMES_RATE_LIMIT_PER_MINUTE` |
| Lookup misses per credential per 10 minutes | 20 | `HERMES_LOOKUP_MISS_BUDGET` |

- Counting uses the audit table, the same database-ledger pattern as
  `/api/orders/lookup`. This works across serverless instances without new
  infrastructure.
- **Enumeration protection:**
  - exact identifiers only
  - one identifier per search
  - at most 5 customers per customer search
  - a bounded miss budget
- **Opaque customer references.** Salla customer ids are sequential, so the
  summary endpoint takes `cus_<id>_<signature>`. The signature is an HMAC with
  the pepper, bound to the merchant. A guessed or incremented reference
  returns 404.
- **IDOR and tenant isolation.** Every query filters by the credential's
  `merchantId`. Records from another merchant, and references minted for
  another merchant, return 404.

## 8. Data classification

| Class | Where | Who |
|---|---|---|
| `pii:masked` | Order and customer lookups with a support credential: name, masked phone and email, city or district | Support and managers |
| `pii:full` | Same lookups with `hermes:manager:pii`; `top_customers` | Managers with the PII scope |
| `operational` | Shipment lookups (no contact data) | Support and managers |
| `aggregate` | Reports (order references and tracking numbers only in lists) | Managers |

Each audit row records the class that was returned.

## 9. Audit log

- **Table:** `HermesAuditLog`. One row per request, including failures before
  authentication. Successful responses are only sent after their audit row is
  written (fail closed).
- **Columns:**
  - `createdAt`, `requestId`, `credentialId`, `merchantId`
  - `action` (e.g. `orders.get`), `scopeUsed`
  - `targetType`, `targetId` (the resolved record id, never the search input)
  - `outcome` (`success`, `not_found`, `denied`, `unauthenticated`, `invalid`,
    `rate_limited`, `error`), `httpStatus`
  - `classification`, `resultCount`, `durationMs`
  - `ipHash` (salted)
  - `actorId`, `actorChannel`, `actorVerified`
- **Never stored:** response bodies, phone numbers or emails that were
  searched, keys.
- **Structured logs** (`hermes.request`, `hermes.request_rejected`,
  `hermes.request_failed`) go to stdout as JSON (Vercel runtime logs) through
  `app/lib/logger.ts`. Anything derived from a request is passed through
  `redactForLog`, which removes keys, phone numbers, emails and sensitive
  field names.

```sql
-- Who looked up what, last 24 h
SELECT "createdAt", "credentialId", "actorId", "actorVerified", action, "targetId", outcome, classification
FROM "HermesAuditLog" WHERE "createdAt" > now() - interval '24 hours' ORDER BY "createdAt" DESC;

-- Possible enumeration
SELECT "credentialId", count(*) FROM "HermesAuditLog"
WHERE outcome = 'not_found' AND "createdAt" > now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC;
```

There is no automatic retention policy yet. Agree one (for example 12 months)
and prune with a scheduled `DELETE … WHERE "createdAt" < now() - interval '12 months'`.

## 10. Caching and performance

- **Report cache.** Reports are cached per serverless instance for 60 seconds,
  in memory, with no new infrastructure. The key is a SHA-256 of merchant,
  the credential's full scope set, action, range, comparison, time zone and
  filters. It holds no raw values.
- **Lookups are never cached.**
- **Precomputed order facts.** Reports would otherwise have to decompress each
  order's Salla JSON. New `SallaOrder` columns hold the values reports need:
  `discountTotal`, `refundedItemsTotal`, `refundedItemsCount`,
  `isPendingPayment`, `exchangeRate` and `factsComputedAt`. They are filled on
  every order write (`app/lib/salla-order-facts.ts`) and by
  `npm run backfill:salla-order-facts` for existing rows. Until a row is
  backfilled, queries fall back to reading the JSON with identical rules, so
  results are correct either way; only speed differs.
- **New indexes** (each justified by `EXPLAIN ANALYZE`):

  | Index | Replaces |
  |---|---|
  | `SallaOrder(merchantId, customerEmail)` | Seq scan, email lookup |
  | `SallaOrder(merchantId, customerId, placedAt)` | Seq scan, customer summary and first-order dates |
  | `SallaOrder(merchantId, trackingNumber)` | Seq scan, tracking lookup |
  | `WebhookEvent(status, receivedAt)` | Bitmap scan of every "restored" event for refund-by-date |
  | `HermesAuditLog(credentialId, createdAt)` | Rate-limit counting |

  Order-number, phone and report-range queries already use existing indexes.

## 11. Setup (local)

```bash
cp .env.example .env.local            # then set:
# HERMES_API_ENABLED="true"
# HERMES_API_KEY_PEPPER="$(openssl rand -base64 48)"
# HERMES_GATEWAY_SIGNING_SECRET="$(openssl rand -base64 48)"   # optional
npx prisma migrate deploy             # against a local/staging database only
npm run backfill:salla-order-facts
npm run hermes:credentials -- create --name "local" --merchant <merchantId> \
  --scopes hermes:support:read,hermes:manager:reports --created-by "<you>"
npm run dev
curl -s -H "Authorization: Bearer $HERMES_KEY" \
  "http://localhost:3000/api/integrations/hermes/orders/search?order_number=<number>"
curl -s -X POST -H "Authorization: Bearer $HERMES_KEY" -H "Content-Type: application/json" \
  -d '{"phone":"05XXXXXXXX"}' http://localhost:3000/api/integrations/hermes/orders/search
curl -s -H "Authorization: Bearer $HERMES_KEY" \
  "http://localhost:3000/api/integrations/hermes/reports/sales?from=2026-10-01&to=2026-10-17&compare=previous_period"
```

## 12. Deployment

1. **Review and apply the migration.** It is
   `prisma/migrations/20261018120000_hermes_integration/migration.sql` and is
   additive:
   - two new tables
   - six nullable `SallaOrder` columns (no table rewrite on PostgreSQL 17)
   - five indexes

   `CREATE INDEX` briefly blocks writes on `SallaOrder` (38k rows) and
   `WebhookEvent` (208k rows). Run it outside peak hours, or create those
   indexes `CONCURRENTLY` by hand first and then mark the migration applied
   with `prisma migrate resolve --applied 20261018120000_hermes_integration`.
   The working tree also contains the unrelated pending migration
   `20260906120000_return_window_override_expiry`; check the deployment's
   migration history before running `migrate deploy`.
2. **Set the Vercel environment variables:**
   - `HERMES_API_KEY_PEPPER` (required, ≥ 32 chars)
   - `HERMES_GATEWAY_SIGNING_SECRET` (optional)
   - leave `HERMES_API_ENABLED="false"` for now
3. **Deploy.**
4. **Backfill:** `npm run backfill:salla-order-facts` with production
   `DATABASE_URL`. It is idempotent and works in batches of 200.
5. **Create credentials** (section 4) and load them into the Hermes gateway.
6. **Enable:** set `HERMES_API_ENABLED="true"` and redeploy (or update the
   variable).
7. **Smoke test** with a support key and a manager key:
   - a support key gets `403` on `/reports/sales`
   - lookups return masked contact details
   - rows appear in `HermesAuditLog`

## 13. Rollback

| Severity | Action |
|---|---|
| Fastest | Set `HERMES_API_ENABLED` to anything but `true`. Every endpoint returns `503` without touching the database. |
| One credential | `npm run hermes:credentials -- revoke --id …`. Takes effect on the next request; there is no credential cache. |
| Code | Redeploy the previous build. The new `SallaOrder` columns are nullable and unused by older code, so the database can stay as it is. |
| Schema (only if really needed) | `DROP TABLE "HermesApiCredential", "HermesAuditLog";` drop the five indexes; `ALTER TABLE "SallaOrder" DROP COLUMN …` for the six fact columns. Export `HermesAuditLog` first if it must be retained. Then remove the migration from history with `prisma migrate resolve --rolled-back`. |

## 14. Recommended Hermes tool mapping

Use `docs/hermes-tools-manifest.json`. Give each channel the narrowest
credential it needs:

| Hermes surface | Credential scopes | Tools |
|---|---|---|
| Customer-support staff (WhatsApp, Telegram) | `hermes:support:read` | `find_order`, `get_order`, `find_customer`, `get_customer_summary`, `find_shipment`, `get_shipment` |
| Managers (dashboard, manager Telegram) | `hermes:support:read`, `hermes:manager:reports`, `hermes:manager:pii` | all of the above plus `get_sales_report`, `get_order_operations_report`, `get_shipment_performance_report`, `get_customer_report`, `get_product_report`, `get_daily_trend_report` |

Guidance for the assistant prompt:

- Search with **one identifier the employee or customer actually provided**.
  Never iterate or guess identifiers; misses are rate-limited.
- Prefer the `POST` form of the search tools for phone and email.
- On `403`, explain that the request needs a manager. Do not try another tool.
- When quoting a report figure, use `meta.definitions` and mention the applied
  range and time zone.
- Do not reveal masked digits or try to reconstruct them.

## 15. Known limitations

- Reports cover at most 92 days per request; longer views need several
  requests.
- The product report relies on `SallaOrderItem`. That is complete for recent
  orders but missing for about half of orders before item storage existed;
  see `coverage`. Categories and stock levels are not stored locally.
- Partial refunds have no refund date in the mirrored data, so they are dated
  by order placement.
- Shipment timing metrics depend on warehouse scans (≈60% of outgoing scans
  link to an order by tracking number) and carrier live status. Every average
  reports its `sample_size`.
- The report cache is per instance. Two instances may compute the same report
  once each within a minute.
- Unauthenticated floods are not rate-limited per IP by this API. Rely on
  Vercel Firewall rules for `/api/integrations/hermes/*`.
