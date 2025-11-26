# How to Sync Invoices from Salla - Complete Guide

## Quick Answer: Sync Past 3 Months

I've created an easy script for you. Just run:

```bash
# Sync all merchants (past 3 months)
./scripts/sync-invoices-3-months.sh

# Sync specific merchant (past 3 months)
./scripts/sync-invoices-3-months.sh YOUR_MERCHANT_ID
```

That's it! The script will automatically:
- Calculate dates for the past 3 months
- Call the Salla API with date filters
- Store invoices in your database
- Show you the results

## Direct CLI (Hits Salla API)

Need to bypass the local API altogether? Use the new TypeScript CLI which talks straight to `https://api.salla.dev/admin/v2/orders/invoices` using the bearer tokens stored in your `SallaAuth` table.

```bash
# Basic usage (all merchants, default pagination)
npm run sync:salla-invoices

# Target a merchant and restrict the date window
npm run sync:salla-invoices -- \
  --merchant 1234567890 \
  --start-date 2024-01-01 \
  --end-date 2024-03-31 \
  --per-page 100
```

**What it does**
- Loads `DATABASE_URL` (and the rest of your Next.js env) via `@next/env`
- Pulls the latest bearer token from `prisma.sallaAuth`
- Calls the Salla admin API page by page until it exhausts pagination
- Upserts every invoice through the same Prisma mapping used by the App Router feature
- Prints stats + top error samples per merchant, and exits with non-zero status when anything fails

**Flags**

| Flag | Description |
|------|-------------|
| `-m, --merchant` | Limit sync to one merchant ID |
| `-s, --start-date` | Inclusive start date (YYYY-MM-DD) |
| `-e, --end-date` | Inclusive end date (YYYY-MM-DD) |
| `-p, --per-page` | Items per page (10–200, defaults to 50) |
| `-h, --help` | Prints the usage guide |

## Sync All Orders (New)

Need the full order catalog saved locally too? Run the companion CLI that pages through `/orders`, normalizes each record, and stores it in the new `SallaOrder` table (plus the full raw payload for auditing).

```bash
# Basic usage
npm run sync:salla-orders

# With filters
npm run sync:salla-orders -- \
  --merchant 1234567890 \
  --start-date 2024-06-01 \
  --end-date 2024-07-31 \
  --per-page 100
```

It shares the exact same flag set and environment loading as the invoices script, and prints per-merchant stats (pages processed, fetched vs stored orders, and any API/storage errors).

---

## Manual Methods

### Method 1: Using curl (Command Line)

#### Sync Past 3 Months - All Merchants
```bash
curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=2025-08-25&endDate=2025-11-25"
```

#### Sync Past 3 Months - Specific Merchant
```bash
curl -X POST "http://localhost:3000/api/salla/sync-invoices?merchantId=YOUR_MERCHANT_ID&startDate=2025-08-25&endDate=2025-11-25"
```

#### Sync All Invoices (No Date Filter)
```bash
curl -X POST "http://localhost:3000/api/salla/sync-invoices"
```

### Method 2: Using Browser/Postman

**URL:**
```
POST http://localhost:3000/api/salla/sync-invoices
```

**Query Parameters:**
- `startDate` (optional) - Format: `YYYY-MM-DD` (e.g., `2025-08-25`)
- `endDate` (optional) - Format: `YYYY-MM-DD` (e.g., `2025-11-25`)
- `merchantId` (optional) - Your Salla merchant ID
- `perPage` (optional) - Items per page (10-200, default 50)

**Example:**
```
POST http://localhost:3000/api/salla/sync-invoices?startDate=2025-08-25&endDate=2025-11-25&perPage=100
```

**Note:** No authentication required for local use.

---

## API Reference

### Endpoint: `/api/salla/sync-invoices`

**Methods:** `GET` or `POST`

**Authentication:** None (disabled for local use)

**Query Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `merchantId` | string | Sync specific merchant (optional) | `1234567890` |
| `startDate` | string | Start date (YYYY-MM-DD) (optional) | `2025-08-25` |
| `endDate` | string | End date (YYYY-MM-DD) (optional) | `2025-11-25` |
| `perPage` | number | Items per page (10-200) (optional) | `100` |

**Response Format:**

**Success (200):**
```json
{
  "success": true,
  "merchantsProcessed": 1,
  "stats": [
    {
      "merchantId": "1234567890",
      "invoicesFetched": 150,
      "invoicesStored": 150,
      "orderLookups": 45,
      "pagesProcessed": 3,
      "errors": []
    }
  ],
  "timestamp": "2025-11-25T12:00:00.000Z"
}
```

**Partial Failure (207):**
```json
{
  "success": false,
  "merchantsProcessed": 2,
  "stats": [...],
  "failedMerchants": ["merchant_xyz"],
  "error": "Failed to sync invoices for some merchants",
  "timestamp": "2025-11-25T12:00:00.000Z"
}
```

---

## Date Filtering Examples

### Example 1: Last 3 Months
```bash
# Calculate dates
START_DATE=$(date -d "3 months ago" +%Y-%m-%d)
END_DATE=$(date +%Y-%m-%d)

# Sync
curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=$START_DATE&endDate=$END_DATE"
```

### Example 2: Specific Month (October 2025)
```bash
curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=2025-10-01&endDate=2025-10-31"
```

### Example 3: Last Week
```bash
START_DATE=$(date -d "7 days ago" +%Y-%m-%d)
END_DATE=$(date +%Y-%m-%d)

curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=$START_DATE&endDate=$END_DATE"
```

### Example 4: Custom Date Range
```bash
# January 1, 2025 to March 31, 2025
curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=2025-01-01&endDate=2025-03-31"
```

---

## Advanced Usage

### Sync Multiple Merchants with Different Date Ranges

**Option 1: Programmatically**

Create a script `sync-multiple-merchants.sh`:
```bash
#!/bin/bash

API_URL="http://localhost:3000/api/salla/sync-invoices"

# Merchant 1: Last 3 months
curl -X POST "$API_URL?merchantId=merchant_1&startDate=2025-08-25&endDate=2025-11-25"

# Merchant 2: Last 6 months
curl -X POST "$API_URL?merchantId=merchant_2&startDate=2025-05-25&endDate=2025-11-25"
```

**Option 2: Loop Through Merchants**
```bash
#!/bin/bash

MERCHANTS=("merchant_1" "merchant_2" "merchant_3")
START_DATE="2025-08-25"
END_DATE="2025-11-25"

for merchant in "${MERCHANTS[@]}"; do
  echo "Syncing $merchant..."
  curl -X POST "http://localhost:3000/api/salla/sync-invoices?merchantId=$merchant&startDate=$START_DATE&endDate=$END_DATE"
  echo ""
done
```

### Sync in Batches for Large Datasets

For performance, sync in monthly batches:

```bash
#!/bin/bash

# Sync each month separately
for month in {08..11}; do
  START="2025-${month}-01"
  END="2025-${month}-31"

  echo "Syncing month: 2025-$month"
  curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=$START&endDate=$END&perPage=100"

  sleep 5  # Wait 5 seconds between batches
done
```

---

## Automated Scheduling

### Option 1: Cron Job (Linux/Mac)

Add to your crontab (`crontab -e`):

```cron
# Sync invoices from past 3 months every day at 2 AM
0 2 * * * cd /path/to/mleha-app && ./scripts/sync-invoices-3-months.sh >> /var/log/invoice-sync.log 2>&1

# Sync invoices from past week every 6 hours
0 */6 * * * cd /path/to/mleha-app && curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=$(date -d '7 days ago' +\%Y-\%m-\%d)&endDate=$(date +\%Y-\%m-\%d)"
```

### Option 2: External Cron Service

Use services like **cron-job.org** or **EasyCron**:

**URL to call:**
```
https://your-domain.com/api/salla/sync-invoices?startDate=2025-08-25&endDate=2025-11-25
```

**Method:** POST

**Schedule:** Every 24 hours

**Note:** For production, you may want to re-enable authentication in the API endpoint.

### Option 3: Vercel Cron (if deployed on Vercel)

Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/salla/sync-invoices?startDate=2025-08-25&endDate=2025-11-25",
      "schedule": "0 2 * * *"
    }
  ]
}
```

**Note:** You'll need to update the dates programmatically or use a wrapper function.

---

## Troubleshooting

### Issue: Connection Error

**Solution:** Make sure your app is running:
```bash
npm run dev
# or
npm run start
```

The endpoint should be accessible at `http://localhost:3000`

### Issue: No Invoices Returned

**Possible causes:**
1. No invoices exist in Salla for that date range
2. Salla API date parameters might use different field names

**Solution:** Try without date filters first:
```bash
curl -X POST "http://localhost:3000/api/salla/sync-invoices"
```

### Issue: Date Format Error

**Solution:** Always use `YYYY-MM-DD` format:
- ✅ Correct: `2025-11-25`
- ❌ Wrong: `11/25/2025`, `25-11-2025`, `2025/11/25`

### Issue: Too Many Invoices (Slow Sync)

**Solution:** Use smaller date ranges or increase `perPage`:
```bash
# Increase items per page
curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=2025-08-25&endDate=2025-11-25&perPage=200"
```

---

## How It Works

1. **Date Filtering:** The API passes `date_from` and `date_to` to Salla's invoice API
2. **Pagination:** Automatically fetches all pages for the date range
3. **Storage:** Upserts invoices to database (no duplicates)
4. **Order Enrichment:** Fetches order details if not included in invoice
5. **Caching:** Caches order lookups to minimize API calls

---

## What Gets Synced

For each invoice in the date range:
- Invoice number, status, amounts
- Customer information (name, email, phone)
- Financial details (subtotal, tax, shipping, discount, total)
- Dates (issue date, due date)
- Related order information
- Raw JSON data for audit trail

All data is stored in the `SallaInvoice` table and can be viewed at:
```
http://localhost:3000/invoices
```

---

## Performance Tips

1. **Use Date Filters:** Always specify a date range to avoid syncing all invoices
2. **Increase perPage:** Use `perPage=100` or `perPage=200` for faster syncs
3. **Sync Off-Peak:** Run syncs during low-traffic hours (e.g., 2 AM)
4. **Monitor Logs:** Check logs for errors or slow API responses
5. **Batch Large Syncs:** Split 1-year syncs into monthly batches

---

## Quick Reference

### Get invoices from past 3 months:
```bash
./scripts/sync-invoices-3-months.sh
```

### Get invoices for specific dates:
```bash
curl -X POST "http://localhost:3000/api/salla/sync-invoices?startDate=2025-08-25&endDate=2025-11-25"
```

### View synced invoices:
```
http://localhost:3000/invoices
```

---

## Summary

✅ **Added Features:**
- Date filtering support (`startDate`, `endDate`)
- Helper script for past 3 months sync
- Flexible API parameters
- Works with all existing features

✅ **No Breaking Changes:**
- Old API calls still work (without dates = all invoices)
- Backward compatible

✅ **Ready to Use:**
- Just run `./scripts/sync-invoices-3-months.sh`
- Or use curl with your preferred dates

**Need help?** Check the troubleshooting section or review the API response for detailed error messages.
