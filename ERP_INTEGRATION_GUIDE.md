# ERP Integration Guide

This guide explains how to sync SallaOrders to your ERP system.

## Overview

The ERP integration automatically transforms SallaOrders into invoice format compatible with your ERP system. It handles:

- Authentication with token caching and automatic refresh
- Order-to-invoice transformation
- Sales center mapping (Salla, Tamara, Tabby, SMSA)
- Sale vs. refund invoice detection
- Batch syncing capabilities
- **Duplicate prevention** - Orders are tracked to prevent duplicate invoices in ERP
- Error tracking and retry monitoring

## Architecture

### Files Created

1. **`app/lib/erp-auth.ts`** - Authentication service
   - Logs into ERP system
   - Caches access tokens
   - Automatically refreshes expired tokens

2. **`app/lib/erp-invoice.ts`** - Invoice transformation and posting
   - Transforms SallaOrder to ERP format
   - Maps payment methods to sales centers
   - Posts invoices to ERP API

3. **`app/api/erp/sync-order/route.ts`** - Single order sync endpoint
4. **`app/api/erp/sync-orders-batch/route.ts`** - Batch sync endpoint

## Setup

### 1. Environment Variables

Add these to your `.env` file:

```bash
ERP_LOGIN_URL="https://desktop-gt2mtiv.tail6f05fc.ts.net/api/Login"
ERP_INVOICE_URL="https://desktop-gt2mtiv.tail6f05fc.ts.net/api/PostInvoice"
ERP_USERNAME="InfoSoft"
ERP_PASSWORD="InfoSoftApi"
```

### 2. Initialize Settings (Optional - for auto-sync)

If you want to enable automatic syncing later:

```bash
npx ts-node scripts/init-erp-settings.ts
```

This creates settings for controlling automatic sync. **By default, auto-sync is disabled** - you'll sync manually.

See [ERP_AUTO_SYNC_SETUP.md](./ERP_AUTO_SYNC_SETUP.md) for details on automatic syncing.

### 3. Test the Integration

Test syncing a single order:

```bash
curl -X POST http://localhost:3000/api/erp/sync-order \
  -H "Content-Type: application/json" \
  -d '{"orderNumber": "YOUR_ORDER_NUMBER"}'
```

Or by order ID:

```bash
curl -X POST http://localhost:3000/api/erp/sync-order \
  -H "Content-Type: application/json" \
  -d '{"orderId": "YOUR_ORDER_ID"}'
```

## Duplicate Prevention

### How It Works

The system tracks synced orders in the database with these fields:

- **`erpSyncedAt`** - Timestamp when order was successfully synced
- **`erpInvoiceId`** - Invoice ID returned from ERP (if available)
- **`erpSyncError`** - Last error message if sync failed
- **`erpSyncAttempts`** - Number of sync attempts (for monitoring)

**By default:**
- Orders already synced (`erpSyncedAt` is set) will be **skipped**
- Batch sync only processes orders where `erpSyncedAt` is `null`
- This prevents duplicate invoices in your ERP system

**Force re-sync:**
- Use `force: true` to override and re-sync an order
- Useful for fixing errors or updating invoices

## API Endpoints

### Sync Single Order

**POST** `/api/erp/sync-order`

Request body:
```json
{
  "orderId": "123456789",
  // OR
  "orderNumber": "ORD-2025-001",
  // Optional: force re-sync even if already synced
  "force": false
}
```

Response (successful):
```json
{
  "success": true,
  "message": "Invoice posted to ERP successfully",
  "erpInvoiceId": "INV-123",
  "order": {
    "id": "cuid123",
    "orderId": "123456789",
    "orderNumber": "ORD-2025-001",
    "status": "completed",
    "erpSyncedAt": "2025-01-26T10:30:00Z"
  }
}
```

Response (already synced):
```json
{
  "success": true,
  "message": "Order already synced to ERP (use force=true to re-sync)",
  "erpInvoiceId": "INV-123",
  "order": {
    "id": "cuid123",
    "orderId": "123456789",
    "orderNumber": "ORD-2025-001",
    "status": "completed",
    "erpSyncedAt": "2025-01-26T10:30:00Z"
  }
}
```

### Sync Multiple Orders (Batch)

**POST** `/api/erp/sync-orders-batch`

Request body:
```json
{
  "orderIds": ["123", "456", "789"],
  // OR use filters
  "filters": {
    "statusSlug": "completed",
    "dateFrom": "2025-01-01",
    "dateTo": "2025-01-31",
    "onlyUnsynced": true  // Default: true (only sync orders not yet synced)
  },
  "limit": 100,
  "force": false  // Set to true to re-sync already synced orders
}
```

**Important:** By default, batch sync only processes **unsynced orders** (`erpSyncedAt` is `null`). To include already-synced orders, set `filters.onlyUnsynced: false` or use `force: true`.

Response:
```json
{
  "success": true,
  "message": "Synced 45 of 50 orders (3 already synced, 2 failed)",
  "results": [
    {
      "orderId": "123",
      "orderNumber": "ORD-001",
      "success": true,
      "message": "Invoice posted to ERP successfully",
      "erpInvoiceId": "INV-123"
    },
    {
      "orderId": "456",
      "orderNumber": "ORD-002",
      "success": true,
      "message": "Order already synced to ERP (use force=true to re-sync)",
      "erpInvoiceId": "INV-456"
    }
  ],
  "summary": {
    "total": 50,
    "successful": 45,
    "failed": 2,
    "skipped": 3
  }
}
```

## ERP Invoice Format

### Invoice Types

- **`ltrtype: "06"`** - Sale invoice (normal orders)
- **`ltrtype: "26"`** - Refund invoice (cancelled/returned orders)

The system automatically detects invoice type based on order status.

### Sales Center Mapping

The system maps payment methods and shipping companies to sales center codes:

| Payment Method / Fulfillment | SLCNTR Code | Description |
|------------------------------|-------------|-------------|
| Salla (default)              | 01          | Salla orders |
| Tamara                       | 02          | Tamara payments |
| Tabby                        | 03          | Tabby payments |
| SMSA                         | 04          | SMSA shipments |

**Note:** You mentioned you'll map these later. Update the `getSalesCenterCode()` function in `app/lib/erp-invoice.ts` to customize this mapping.

### Invoice Payload Structure

```typescript
{
  ltrtype: "06",              // "06" = sale, "26" = refund
  SLCNTR: "01",               // Sales center code
  BRANCH: "01",               // Branch code
  SLPRSN: "01",               // Salesperson code
  USRID: "web",               // User ID
  lcustcode: "",              // Customer code (empty for now)
  hinvdsvl: 0,                // Invoice discount value
  hinvdspc: 0,                // Invoice discount percentage
  hvat_amt_rcvd: 15,          // VAT amount
  htaxfree_sales: 0,          // Tax-free sales
  datetime_stamp: "2025-09-16T00:00:00",
  Description: "فاتورة رقم ORD-001",  // Description
  Taxno: "",                  // Tax number
  remarks2: "ORD-001",        // Order number (IMPORTANT)
  hrtnref: 0,                 // Return reference
  transport_code: "",         // Transport code
  transport_amt: 0,           // Shipping amount
  transport_onus: 1,          // Transport responsibility
  other_amt: 0,               // Other amount
  other_acct: "",             // Other account
  API_Inv: [                  // Invoice items
    {
      cmbkey: "GR597",        // SKU
      barcode: "GR597",       // SKU (same as cmbkey)
      qty: 1,                 // Quantity
      fqty: 0,                // Free quantity (always 0)
      price: 95,              // Original price WITH taxes, BEFORE discounts
      discpc: 0               // Discount percentage
    }
  ]
}
```

### Important Notes on Pricing

1. **Price includes tax**: The `price` field in `API_Inv` should be the original price INCLUDING taxes
2. **Price before discounts**: The price should be BEFORE any discounts are applied
3. **Discount percentage**: The `discpc` field contains the discount percentage applied to this item

Example:
- Original price with tax: 100 SAR
- Discount: 10 SAR (10%)
- Final price: 90 SAR

In the payload:
```json
{
  "price": 100,    // Original price with tax
  "discpc": 10     // Discount percentage
}
```

## Usage Examples

### From Your Application Code

```typescript
import { syncOrderToERP } from '@/app/lib/erp-invoice';
import { prisma } from '@/app/lib/prisma';

// Sync a single order (with duplicate prevention)
const order = await prisma.sallaOrder.findUnique({
  where: { orderId: '123456789' }
});

if (order) {
  const result = await syncOrderToERP(order);

  // Update database with sync status
  if (result.success) {
    await prisma.sallaOrder.update({
      where: { id: order.id },
      data: {
        erpSyncedAt: new Date(),
        erpInvoiceId: result.erpInvoiceId,
        erpSyncError: null,
        erpSyncAttempts: { increment: 1 },
      },
    });
  }

  console.log(result);
}

// Force re-sync an order
const result = await syncOrderToERP(order, true);  // force = true
```

### Query Sync Status

```typescript
// Find all unsynced orders
const unsyncedOrders = await prisma.sallaOrder.findMany({
  where: { erpSyncedAt: null },
  take: 100,
});

// Find orders with sync errors
const failedOrders = await prisma.sallaOrder.findMany({
  where: {
    erpSyncError: { not: null },
    erpSyncedAt: null,
  },
});

// Find recently synced orders
const recentlySynced = await prisma.sallaOrder.findMany({
  where: {
    erpSyncedAt: {
      gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
    },
  },
  orderBy: { erpSyncedAt: 'desc' },
});
```

### Automatic Sync on Order Status Change (Optional)

**By default, automatic sync is disabled.** You sync orders manually via the UI at `/erp-settings` or via API.

To enable automatic syncing when order status changes, see the complete guide: [ERP_AUTO_SYNC_SETUP.md](./ERP_AUTO_SYNC_SETUP.md)

Quick example using the provided helper:

```typescript
import { handleOrderWebhookSync } from '@/app/lib/erp-webhook-sync';

// In your webhook handler after saving the order
await handleOrderWebhookSync(order, event.event);
```

This will automatically:
- Check if auto-sync is enabled in settings
- Check if the order status matches configured statuses
- Skip if already synced
- Sync to ERP and update database

**Manual sync is recommended initially** until you've tested the integration thoroughly.

## Customization

### 1. Sales Center Mapping

Edit `app/lib/erp-invoice.ts`, function `getSalesCenterCode()`:

```typescript
function getSalesCenterCode(order: SallaOrder): string {
  const paymentMethod = order.paymentMethod?.toLowerCase() || '';
  const fulfillmentCompany = order.fulfillmentCompany?.toLowerCase() || '';

  // Add your custom mappings here
  if (paymentMethod.includes('tamara')) return '02';
  if (paymentMethod.includes('tabby')) return '03';
  if (fulfillmentCompany.includes('smsa')) return '04';

  return '01'; // Default
}
```

### 2. Item Price Extraction

If the order structure is different, edit the `extractOrderItems()` function in `app/lib/erp-invoice.ts` to match your data structure.

### 3. Invoice Type Detection

Edit the `getInvoiceType()` function to customize when invoices are marked as refunds:

```typescript
function getInvoiceType(order: SallaOrder): '06' | '26' {
  const statusSlug = order.statusSlug?.toLowerCase() || '';

  // Add your custom logic here
  if (statusSlug.includes('refund') || statusSlug.includes('return')) {
    return '26'; // Refund
  }

  return '06'; // Sale
}
```

## Troubleshooting

### Duplicate Invoices

**Problem:** Orders are being synced multiple times to ERP

**Solutions:**
1. Check that you're not calling the sync function with `force: true` unnecessarily
2. Verify the database `erpSyncedAt` field is being updated correctly
3. Use the batch endpoint with default settings (`onlyUnsynced: true`)
4. Check logs to see if sync is being triggered from multiple places

### Token Expiration

The system automatically refreshes tokens. If you see authentication errors:

1. Check that `ERP_LOGIN_URL`, `ERP_USERNAME`, and `ERP_PASSWORD` are correct
2. Verify the ERP login endpoint is accessible
3. Check logs for detailed error messages

### Missing Items

If items are missing from the invoice:

1. Check that items in the order have a `sku` field
2. Review the `extractOrderItems()` function to ensure it matches your order structure
3. Check application logs for warnings about missing SKUs

### Incorrect Prices

If prices are wrong:

1. Verify that the order data includes tax amounts
2. Check the `extractOrderItems()` function logic for price calculation
3. Ensure discounts are being calculated correctly

### Orders Stuck with Errors

**Problem:** Orders have `erpSyncError` set and won't re-sync

**Solutions:**
1. Review the error message in `erpSyncError` field
2. Fix the underlying issue (missing SKU, invalid data, etc.)
3. Re-sync with `force: true` to retry after fixing
4. Monitor `erpSyncAttempts` to track retry counts

## Monitoring

Check the application logs for detailed information about sync operations:

```bash
# View logs
pm2 logs your-app-name

# Or if running directly
npm run dev
```

Log entries include:
- Login attempts and token refreshes
- Order sync operations
- Success/failure messages
- Error details

## Security Notes

1. Store ERP credentials in environment variables, never in code
2. Use HTTPS for all ERP API calls
3. The access token is cached in memory and refreshed automatically
4. Tokens are never logged or exposed in responses

## Next Steps

1. **Configure sales center mapping** based on your requirements
2. **Test with sample orders** to verify data transformation
3. **Add automatic sync** to your order webhook handler
4. **Set up monitoring** for failed sync operations
5. **Consider adding retry logic** for failed syncs
