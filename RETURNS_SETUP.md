# Return/Exchange System Setup Guide

This guide explains how to set up and use the Return/Exchange system integrated with Salla and SMSA APIs.

## Overview

The system provides a complete return/exchange workflow:
1. Customer looks up their order by order number
2. Selects items and quantities to return/exchange
3. Provides a reason for the return
4. System creates an SMSA return shipment automatically
5. Stores the return request in the database
6. Shows success screen with tracking numbers

## Features

✅ Salla OAuth integration with automatic token refresh (every 10 days)
✅ SMSA API integration for return shipment creation
✅ Order lookup by order number
✅ Item selection with quantity control
✅ Predefined return reasons + custom reason
✅ Automatic SMSA tracking number generation
✅ Database tracking of all return requests
✅ RTL Arabic interface
✅ Success screen with reference numbers

## Returns v2: per-piece choices and one-click processing

**Customer form (`/returns`).** Every physical piece is chosen on its own. A line with quantity 2 is two pieces, and each piece gets its own *return* or *exchange* choice and its own protection-ribbon answer. Category and window rules are keyed by product, so identical pieces get identical rules:

| Rule | Effect on a piece |
|---|---|
| 1 SAR offer, discounted categories | Blocked |
| Return window expired (unless an admin override exists) | Blocked |
| Outlet, National Day offers | Exchange only |
| Protection ribbon removed | Blocked |
| Already on an active request | Blocked (pieces are tracked by `orderItemId` + `unitIndex`) |

`GET /api/returns/check` returns a `pieces` array with each piece's allowed types and block reason. `POST /api/returns/create` takes `pieces: [{ orderItemId, unitIndex, type, ribbonRemoved }]`. The pre-v2 payload (`type` + `items[].quantity`) is still accepted for one deploy cycle.

**Money.** One request has one return shipment, so it is charged one fee. The rules are in `lib/returns/request-financials.ts` (`splitRequestFinancials`):
- If any piece is a return, the return fee applies; otherwise the exchange fee applies.
- Original shipping goes with the money refund when there is one; otherwise it goes into the coupon.
- The fee is deducted from the refund first; anything left over comes out of the coupon.
- `ReturnRequest.type` is `return`, `exchange` or `mixed`. `totalRefundAmount` is the money refund, except on exchange-only requests, where it keeps its old meaning (the credit). `couponAmount` holds the exchange credit.

**Stages.** Requests move on the server, not in the browser (`lib/returns/workflow.ts`):

| How it moves | Result |
|---|---|
| SMSA/AJEX delivery webhooks, or the `/api/returns/auto-progress` cron (every 15 min) | Status becomes `delivered` and `receivedAt` is set |
| Inspecting every piece in `/returns-inspection` | Request is **ready** |
| Pieces inspected as damaged, worn or missing parts | `refundIncluded` defaults to false; staff can switch it back in the drawer |
| Salla order already "مسترجع" before the app processed it | Flagged **needs attention**; the app never restocks or refunds it a second time |

**One-click processing.** `GET /api/returns/process` shows a preview and `POST /api/returns/process` runs it; the work is in `app/lib/returns/process-return.ts`. Steps run in this order:
1. Restock pieces inspected as `good` (`POST /products/quantities/bulk`, increment).
2. Refund the return pieces on the order's single refundable Salla transaction (`PUT /transactions/{id}` with `action: refund`).
3. Create the exchange coupon and send it on WhatsApp.
4. Set the Salla order to `RETURNS_SALLA_DONE_STATUS_SLUG` (default `restored`; empty disables it) and add a history note.
5. Close the request.

Every step is idempotent and logged in `processingAudit`, and any failure moves the request to **needs attention**. Safety rules:
- A refund whose outcome is unknown (timeout or 5xx) is **never resent**. The cron settles it from the Salla order history.
- If the Salla history already shows a refund, staff must confirm before the app refunds again.
- COD or bank-transfer orders become `refundStatus = manual`. Staff confirm the transfer in the drawer.
- The customer's refund WhatsApp comes from the existing `order.refunded` webhook journey.
- `POST /api/returns/process/bulk` processes up to 20 ready requests and skips any whose preview has warnings.

**Before the first production run:** check on a test order that setting the order to `restored` does not restock it in Salla by itself. Read `GET /products/quantities` before and after. If it does restock, set `RETURNS_SALLA_DONE_STATUS_SLUG` to a status that doesn't.

**Required Salla scopes.** See `SALLA_OAUTH_SCOPES.md`. `/api/returns/salla-permissions` reports the missing ones, and the management page shows a banner for them.

**Migration.** `prisma/migrations/20261103120000_returns_v2/migration.sql` is additive. Apply it manually with `prisma db execute` against `DIRECT_URL`.

## Exchange v3: replacement products and paying the difference

**Customer side.** When at least one piece is an exchange, the form asks how the customer wants it:
- **Choose replacements now** (default): the customer searches the store catalog, picks a size or colour, and builds a small cart.
  - The sticky bar shows the exchange credit, the replacements total, and one of: the amount left to pay, the credit left over, or "fully covered".
  - If money is due, the customer picks a payment method (`RETURNS_EXCHANGE_PAYMENT_METHODS`, intersected with the store's enabled methods).
  - After submitting, the customer is redirected to Salla's payment link.
- **Coupon for later**: the classic exchange coupon.

**What the server does** (`app/lib/returns/exchange-order-flow.ts`):
1. Prices the cart from Salla (`priceExchangeCart`) before the return shipment is booked. Browser prices are never used.
2. Stores the return request with its `ReturnExchangeLine` rows.
3. Creates a single-use `EXO…` coupon for the credit applied (with free shipping), then calls `POST /orders`. The order uses the original customer, the courier and national address from the original order's outbound shipment, the replacement products, `coupon_code`, and `payment.status = pending_payment`.
4. Stores the Salla order, the amount due, the `checkout_url` and the payment deadline. A fully covered order is put on hold (reservation status) immediately.
5. If anything fails: cancels the order, deletes the coupon, and falls back to coupon mode. The return itself is never undone.

**Payment.**
- `order.status.updated` webhooks, plus the 15-minute `auto-progress` cron as a backup, detect payment. A paid order is put on hold.
- One WhatsApp reminder goes out halfway through the payment window (`ZOKO_TPL_EXCHANGE_PAYMENT_PENDING`; args: name, order number, amount, pay link).
- After the deadline (Salla's `pending_payment_ends_at`, about 21h), the order is cancelled (stock restored), the credit coupon deleted, and the request falls back to the coupon (`ZOKO_TPL_EXCHANGE_ORDER_EXPIRED`; args: name, order number).
- Both templates are optional. When the env var is unset, the message is skipped and logged.

**Release.** `maybeReleaseExchangeOrderHold` releases the order once payment is settled (`paid` or `not_required`), the return has arrived, and the **exchanged** pieces are inspected `good`. One-click processing does this, then issues any leftover credit as an `EXCHANGE…` coupon. Pieces that aren't good make the request **needs attention**, and the drawer offers:
- ship anyway;
- cancel the replacement, which refunds any difference paid and falls back to the coupon;
- resend the payment link;
- retry creation.

**Customer status page.** `/returns/status/[id]?t=…` is signed with `RETURNS_STATUS_TOKEN_SECRET`, falling back to `NEXTAUTH_SECRET`. It shows progress, the exchange order and a "complete payment" button, and refreshes the payment state when the customer comes back from paying.

**Salla API facts** (verified on the live store with test orders that were then cancelled) are listed at the top of `app/lib/salla-exchange-order.ts`.

**Migration.** `prisma/migrations/20261104120000_exchange_orders/migration.sql` is additive. Apply it manually with `prisma db execute` against `DIRECT_URL`.

## Database Schema

### Tables Created

1. **SallaAuth** - Stores OAuth tokens for Salla API
   - Automatic token refresh with mutex locking
   - Tracks expiry and refresh attempts

2. **ReturnRequest** - Stores return/exchange requests
   - Links to Salla orders
   - Tracks SMSA shipment details
   - Status tracking (pending_review, approved, rejected, completed, cancelled)

3. **ReturnItem** - Individual items in a return request
   - Product details
   - Quantity and price

## Environment Variables Setup

Update your `.env` file with the following:

```env
# SMSA API Configuration
SMSA_API_ENVIRONMENT=sandbox
SMSA_API_BASE_URL=https://ecomapis-sandbox.azurewebsites.net/api
SMSA_TEST_API_KEY=556c502d784a49cbb6fb2baf6fb08bfe
SMSA_PRODUCTION_API_KEY=d34118ea30de40dd89e8f56535ab3069
SMSA_SERVICE_CODE=EDCR
SMSA_WAYBILL_TYPE=PDF
# Optional overrides
# SMSA_API_KEY=
# SMSA_RETAIL_ID=

# Cron Job Security
CRON_SECRET=generate_a_secure_random_string_here

# Merchant/Store Configuration for Returns
NEXT_PUBLIC_MERCHANT_ID=your_salla_merchant_id
NEXT_PUBLIC_MERCHANT_NAME=اسم متجرك
NEXT_PUBLIC_MERCHANT_PHONE=0501234567
NEXT_PUBLIC_MERCHANT_ADDRESS=عنوان متجرك أو المستودع
NEXT_PUBLIC_MERCHANT_CITY=الرياض
NEXT_PUBLIC_MERCHANT_LOGO=/logo.png

# Optional: SAR per one unit of order currency when Salla does not provide a rate
RETURN_FEE_SAR_RATES_JSON='{"USD":3.75,"AED":1.021}'

# Optional: require the customer's mobile as proof they own the order.
# Defaults to enabled; set to exactly "false" to turn it off.
RETURNS_REQUIRE_PHONE=true
```

### Customer verification (`RETURNS_REQUIRE_PHONE`)

`/returns` is public and Salla order numbers are sequential, so an order number
alone proves nothing. When this is enabled — the default — the customer must
also enter the mobile number on the order, and both `/api/orders/lookup` and
`/api/returns/create` check it against the order's customer before returning or
storing anything.

- Saudi numbers are accepted in any of `05XXXXXXXX`, `5XXXXXXXX`, `+966…` and
  `00966…`, including Arabic-Indic digits.
- International customers are matched using the dial code Salla stores
  separately from the local number.
- A wrong number returns the same "order not found" response as an unknown order
  number and counts against the per-IP rate limit, so the endpoint cannot be
  used to test numbers against a known order.
- Staff sessions are exempt, so internal tools that look orders up are unaffected.
- An order with no phone number on file can never be matched. Those customers
  have to go through support — that is deliberate, so verification fails closed.

Set `RETURNS_REQUIRE_PHONE=false` to restore the old order-number-only flow.

### How to Get the Credentials

#### SMSA Credentials
1. Contact SMSA Express to onboard your account for API access.
2. Download the official docs (`SMSA API DOCS.html` in this repo) for the latest keys and endpoints.
3. Choose the environment you need:

| Environment | Base URL | API Key |
|-------------|----------|---------|
| Sandbox/Test | `https://ecomapis-sandbox.azurewebsites.net` | `556c502d784a49cbb6fb2baf6fb08bfe` |
| Production | `https://ecomapis.smsaexpress.com` | `d34118ea30de40dd89e8f56535ab3069` |

4. Set `SMSA_API_ENVIRONMENT` to `sandbox` or `production` and keep the keys secret.
5. Optionally set `SMSA_RETAIL_ID` if SMSA provided a preferred drop-off branch.

#### Salla OAuth
- Tokens are automatically stored when a merchant authorizes your app
- The webhook at `/app/salla/webhook/route.ts` handles the `app.store.authorize` event
- Tokens auto-refresh (at most once every 10 days per merchant) via the scheduled cron job, using a database mutex so duplicate refreshes never overlap

## API Endpoints

### 1. Order Lookup
```
GET /api/orders/lookup?merchantId=XXX&orderNumber=251263484&mobile=05XXXXXXXX
```
Fetches order details from Salla by order number. `mobile` is required for
anonymous callers unless `RETURNS_REQUIRE_PHONE=false`; staff sessions are
exempt and also receive the full order rather than the trimmed public view.

Responses: `404` for an unknown order number **and** for a mobile that does not
match, `400` when `mobile` is missing, `429` once the per-IP budget is spent.

### 2. Create Return Request
```
POST /api/returns/create
```
Creates a return request and SMSA shipment.

Items are identified by `orderItemId` (the Salla order-item id). The server
looks each line up on the order and derives the product name, SKU, variant and
**price** from Salla — prices are never taken from the request. A line that is
not on the order, or a quantity above what was ordered, is rejected with `400`.

**Request Body:**
```json
{
  "merchantId": "1234509876",
  "orderId": "12345",
  "type": "return",
  "reason": "defective",
  "reasonDetails": "Optional details",
  "customerMobile": "05XXXXXXXX",
  "items": [
    {
      "orderItemId": 987654,
      "productId": "123",
      "quantity": 1
    }
  ],
  "merchantName": "Store Name",
  "merchantPhone": "0501234567",
  "merchantAddress": "Store Address",
  "merchantCity": "Riyadh"
}
```

### 3. Token Refresh (Cron)
```
GET /api/salla/refresh-tokens
Authorization: Bearer {CRON_SECRET}
```
Automatically refreshes expiring Salla tokens.

## Salla Webhook Integration

The system handles the `app.store.authorize` event to store OAuth tokens:

```json
{
  "event": "app.store.authorize",
  "merchant": 1234509876,
  "data": {
    "access_token": "...",
    "refresh_token": "...",
    "expires": 1634819484,
    "scope": "settings.read branches.read offline_access"
  }
}
```

When this webhook is received, tokens are automatically stored in the database.

## Token Refresh System

### Automatic Refresh (Recommended)
- Configured in `vercel.json` to run every 10 days
- Uses Vercel Cron (free on Vercel)
- Refreshes tokens 1 day before expiry (safe margin)

### Manual Refresh
You can manually trigger token refresh:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-domain.com/api/salla/refresh-tokens
```

### Mutex/Locking
The system implements proper locking to prevent parallel token refreshes:
- Uses database flag `isRefreshing`
- 30-second timeout for stale locks
- Automatic retry with exponential backoff

## Frontend Usage

### Access the Return Page
Navigate to: `https://your-domain.com/returns`

### User Flow
1. Enter order number
2. System fetches order from Salla
3. Select items to return/exchange
4. Choose return type (return or exchange)
5. Select reason (defective, wrong item, size issue, changed mind, other)
6. Submit request
7. View success screen with:
   - Return request ID
   - Original order number
   - SMSA tracking number
   - Expected refund amount

## Return Reasons

The system supports these predefined reasons:
- **معيب / تالف** (Defective/Damaged)
- **منتج خاطئ** (Wrong item)
- **مشكلة في المقاس** (Size/fit issue)
- **تغيير في الرأي** (Changed mind)
- **أخرى** (Other - with custom text)

## SMSA Integration Details

### Shipment Creation
When a return is created:
1. Customer details are used as sender (return origin)
2. Merchant details are used as receiver (return destination)
3. Shipment type is set to 'RET' (Return)
4. Weight is estimated as 0.5 kg per item
5. Order reference is included for tracking

### Tracking
The SMSA AWB (Airway Bill) number is:
- Stored in the database
- Displayed on success screen
- Can be used to track shipment on SMSA website

## Security Considerations

1. **Webhook Signature Verification**
   - All Salla webhooks are verified using HMAC SHA-256
   - Configured in `SALLA_WEBHOOK_SECRET`

2. **Cron Job Protection**
   - Token refresh endpoint requires `CRON_SECRET`
   - Prevents unauthorized token refresh attempts

3. **Token Security**
   - Tokens stored encrypted in database
   - Mutex locking prevents token theft via parallel requests
   - Single-use refresh tokens (as per Salla spec)

## Testing

### Test the Order Lookup
1. Get a valid order number from your Salla store
2. Make sure the merchant has authorized your app
3. Navigate to `/returns`
4. Enter the order number

### Test SMSA Integration
Before going live, make sure to:
1. Verify SMSA credentials work
2. Test with sandbox environment first
3. Confirm tracking numbers are generated correctly

### Test Token Refresh
```bash
# Manually trigger token refresh
curl -X GET http://localhost:3000/api/salla/refresh-tokens \
  -H "Authorization: Bearer your_cron_secret"
```

## Deployment Checklist

- [ ] Update all environment variables in Vercel
- [ ] Set real SMSA credentials (not sandbox)
- [ ] Set real merchant information
- [ ] Generate strong CRON_SECRET
- [ ] Configure Salla webhook URL
- [ ] Test merchant authorization flow
- [ ] Verify Vercel Cron is enabled
- [ ] Test end-to-end return flow
- [ ] Set up monitoring/alerts for failed token refreshes

## Monitoring

### Check Token Status
Query the database:
```sql
SELECT merchantId, expiresAt, lastRefreshedAt, refreshAttempts, isRefreshing
FROM SallaAuth;
```

### Check Return Requests
```sql
SELECT id, orderNumber, type, status, smsaTrackingNumber, createdAt
FROM ReturnRequest
ORDER BY createdAt DESC;
```

### Logs
All operations are logged using the structured logger:
- Token refresh events
- SMSA API calls
- Return request creation
- Errors and warnings

## Troubleshooting

### "No valid access token available"
- Check if merchant has authorized the app
- Verify tokens haven't expired (check `SallaAuth` table)
- Try manual token refresh

### "SMSA API error"
- Verify SMSA credentials are correct
- Check if SMSA API is accessible
- Review SMSA account status

### "Order not found"
- Ensure order number is correct
- Verify merchant ID matches
- Check if order exists in Salla

### Token refresh fails
- Check `isRefreshing` flag isn't stuck (run for >30 seconds)
- Verify refresh token hasn't been reused
- May need merchant to re-authorize app

## Support

### Missing return shipments in Returns Management

The amber **طلبات بدون شحنة مرتجع** notice counts active requests older than 30 minutes that have no tracking number, legacy AWB, or label URL. Its dedicated view includes uninspected requests regardless of the normal inspection/status filters; cancelled, rejected, delivered, and completed requests are excluded. Search and request-type filters still apply within that view.

Open the flagged order in Salla, check whether a return shipment already exists, and create the return label manually if needed. Then use **تحديث من سلة** on the request to retrieve the label and clear the warning.

Regression fixtures in `lib/returns/__tests__/missing-shipment.test.ts` use synthetic requests and mocked Prisma reads to cover the grace period, existing shipment evidence, terminal statuses, and filtering/counting before pagination. Run with `node --test --import tsx lib/returns/__tests__/missing-shipment.test.ts`.

For issues or questions:
1. Check the logs in Vercel dashboard
2. Review database tables for stuck states
3. Verify all environment variables are set correctly
4. Test API endpoints individually

## Protection ribbon eligibility

The customer form requires a yes/no protection-ribbon declaration for each otherwise eligible piece before product selection, for both returns and exchanges. Removed ribbons exclude only the affected pieces; quantities and refund estimates are capped to intact pieces. Answers can be corrected and reset when looking up a different order.

`POST /api/returns/create` requires `ribbonRemoved: boolean[]` on every submitted item, with one entry per ordered piece (`true` means removed). Missing or malformed declarations, duplicate order-item entries, and quantities above the intact-piece count are rejected before creating a return or shipment. This is a customer declaration, not a physical inspection; no database migration is required.

Synthetic fixtures in `lib/returns/__tests__/protection-ribbon.test.ts` cover missing answers, partial quantities, mixed products, duplicate lines, invalid quantities, and answer corrections. Run with `node --test --import tsx lib/returns/__tests__/protection-ribbon.test.ts` alongside `npm run test:returns-pricing`.

## Next Steps

Optional enhancements you can add:
- Email notifications for return status updates
- Admin dashboard to manage returns
- Integration with Salla API to update order status
- Barcode printing for return labels
- Return analytics and reporting
- WhatsApp notifications using existing Zoko integration

## Expense automation fixtures

Expense automation uses synthetic, in-memory fixtures in `app/lib/expenses/__tests__/` for provider invoice responses, subscription schedules, and transaction behavior. They contain no customer identifiers or credentials and do not contact Prisma databases or external carriers/providers. Run `npm run test:expenses`; deployment and manual verification are described in `EXPENSE_AUTOMATION_SETUP.md`.
