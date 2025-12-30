# ERP Auto-Sync Setup Guide

This guide explains how to configure automatic syncing of orders to your ERP system.

## Overview

The ERP integration supports two modes:
1. **Manual Sync** (default) - Sync orders manually via API or UI
2. **Automatic Sync** - Auto-sync orders when status changes

By default, **automatic sync is disabled** to give you full control.

## Quick Start

### 1. Initialize ERP Settings

Run the initialization script to create default settings:

```bash
npx ts-node scripts/init-erp-settings.ts
```

This creates three settings:
- `erp_auto_sync_enabled` = `false` (disabled by default)
- `erp_auto_sync_on_status` = `completed,ready_to_ship`
- `erp_sync_delay_seconds` = `0`

### 2. Access the Settings UI

Navigate to `/erp-settings` in your application to:
- View sync statistics (synced, unsynced, failed)
- Manually sync all unsynced orders with one click
- Enable/disable automatic sync
- Configure which statuses trigger auto-sync

### 3. Enable Auto-Sync (Optional)

**Via UI:**
1. Go to `/erp-settings`
2. Toggle "Automatic Sync" to enabled
3. Configure statuses that should trigger sync

**Via API:**
```bash
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "key": "erp_auto_sync_enabled",
    "value": "true"
  }'
```

**Via Database:**
```sql
UPDATE "Settings"
SET value = 'true'
WHERE key = 'erp_auto_sync_enabled';
```

## Settings Reference

### `erp_auto_sync_enabled`

**Type:** Boolean (`true` or `false`)
**Default:** `false`
**Description:** Master switch for automatic ERP syncing

When enabled, orders will automatically sync to ERP when their status changes to one of the configured statuses.

### `erp_auto_sync_on_status`

**Type:** Comma-separated list
**Default:** `completed,ready_to_ship`
**Description:** Order statuses that trigger automatic sync

Examples:
- `completed` - Only sync completed orders
- `completed,ready_to_ship` - Sync when completed or ready to ship
- `completed,processing,ready_to_ship` - Multiple statuses

Common Salla order statuses:
- `pending`
- `processing`
- `ready_to_ship`
- `completed`
- `cancelled`
- `refunded`

### `erp_sync_delay_seconds`

**Type:** Number
**Default:** `0`
**Description:** Delay in seconds before syncing (for batch processing)

Set to a higher value if you want to batch sync operations.

## Manual Sync

Even with auto-sync disabled, you can manually sync orders:

### Via UI

1. Go to `/erp-settings`
2. Click "Sync X Unsynced Orders" button
3. Confirm the action

### Via API

**Sync single order:**
```bash
curl -X POST http://localhost:3000/api/erp/sync-order \
  -H "Content-Type: application/json" \
  -d '{"orderNumber": "ORD-001"}'
```

**Sync all unsynced orders:**
```bash
curl -X POST http://localhost:3000/api/erp/sync-orders-batch \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"onlyUnsynced": true},
    "limit": 1000
  }'
```

**Sync orders by status:**
```bash
curl -X POST http://localhost:3000/api/erp/sync-orders-batch \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "statusSlug": "completed",
      "onlyUnsynced": true
    }
  }'
```

## Webhook Integration

To enable auto-sync in your webhook handler, use the `handleOrderWebhookSync` function.

### Example Webhook Handler

```typescript
import { handleOrderWebhookSync } from '@/app/lib/erp-webhook-sync';
import { prisma } from '@/app/lib/prisma';

// In your webhook handler
export async function POST(req: Request) {
  const event = await req.json();

  // Process the webhook and save/update the order
  const order = await prisma.sallaOrder.upsert({
    where: { orderId: event.data.id },
    update: {
      statusSlug: event.data.status,
      // ... other fields
    },
    create: {
      // ... create fields
    },
  });

  // Auto-sync to ERP if enabled and status matches
  await handleOrderWebhookSync(order, event.event);

  return Response.json({ success: true });
}
```

### How It Works

The `handleOrderWebhookSync` function:
1. Checks if order is already synced (skips if yes)
2. Checks if auto-sync is enabled
3. Checks if the order status matches configured statuses
4. Syncs to ERP if all conditions are met
5. Updates database with sync status

## Monitoring

### View Statistics

**Via UI:**
- Go to `/erp-settings`
- View dashboard with total, synced, unsynced, and failed counts

**Via API:**
```bash
curl http://localhost:3000/api/erp/stats
```

Response:
```json
{
  "success": true,
  "stats": {
    "total": 1000,
    "synced": 850,
    "unsynced": 100,
    "failed": 50
  }
}
```

### Query Orders by Sync Status

```typescript
// Unsynced orders
const unsynced = await prisma.sallaOrder.findMany({
  where: { erpSyncedAt: null, erpSyncError: null }
});

// Failed orders
const failed = await prisma.sallaOrder.findMany({
  where: { erpSyncedAt: null, erpSyncError: { not: null } }
});

// Recently synced
const recentlySynced = await prisma.sallaOrder.findMany({
  where: {
    erpSyncedAt: {
      gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
    }
  },
  orderBy: { erpSyncedAt: 'desc' }
});
```

## Best Practices

### 1. Start with Manual Sync

Keep auto-sync disabled initially:
- Test the integration with a few orders
- Verify invoice format is correct
- Ensure pricing and items are accurate
- Check sales center mappings

### 2. Enable Auto-Sync Gradually

Once confident:
1. Enable auto-sync for one status (e.g., `completed`)
2. Monitor for a few days
3. Add more statuses as needed

### 3. Monitor Failed Syncs

Regularly check for failed syncs:
```bash
curl http://localhost:3000/api/erp/stats
```

Fix issues and re-sync with `force: true`:
```bash
curl -X POST http://localhost:3000/api/erp/sync-order \
  -H "Content-Type: application/json" \
  -d '{"orderNumber": "ORD-001", "force": true}'
```

### 4. Batch Sync Historical Orders

To sync existing orders:
```bash
# Sync last 30 days of completed orders
curl -X POST http://localhost:3000/api/erp/sync-orders-batch \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "statusSlug": "completed",
      "dateFrom": "2025-01-01",
      "dateTo": "2025-01-31",
      "onlyUnsynced": true
    },
    "limit": 1000
  }'
```

### 5. Handle Errors Gracefully

Orders with sync errors are tracked with:
- `erpSyncError` - Error message
- `erpSyncAttempts` - Number of attempts

Review errors and fix underlying issues before retrying.

## Troubleshooting

### Auto-Sync Not Working

1. **Check if enabled:**
   ```bash
   curl http://localhost:3000/api/settings?key=erp_auto_sync_enabled
   ```

2. **Verify status is configured:**
   ```bash
   curl http://localhost:3000/api/settings?key=erp_auto_sync_on_status
   ```

3. **Check webhook handler includes sync logic:**
   - Ensure `handleOrderWebhookSync` is called in your webhook

4. **Review logs:**
   - Look for "Auto-syncing order to ERP" messages
   - Check for "Auto-sync not enabled for this status" messages

### Orders Not Syncing

1. **Already synced?** - Check `erpSyncedAt` field
2. **Status mismatch?** - Verify status is in configured list
3. **Auto-sync disabled?** - Check `erp_auto_sync_enabled` setting
4. **ERP credentials?** - Verify `ERP_LOGIN_URL`, `ERP_USERNAME`, `ERP_PASSWORD`

### UI Not Showing Stats

1. Ensure `/api/erp/stats` endpoint is accessible
2. Check database connection
3. Review browser console for errors

## Advanced Configuration

### Custom Sync Logic

Create your own sync handler:

```typescript
import { shouldAutoSyncForStatus } from '@/app/lib/settings';
import { syncOrderToERP } from '@/app/lib/erp-invoice';

async function customSyncHandler(order: SallaOrder) {
  // Custom conditions
  if (order.totalAmount > 1000 && await shouldAutoSyncForStatus(order.statusSlug)) {
    const result = await syncOrderToERP(order);

    // Update database
    if (result.success) {
      await prisma.sallaOrder.update({
        where: { id: order.id },
        data: {
          erpSyncedAt: new Date(),
          erpInvoiceId: result.erpInvoiceId,
        },
      });
    }
  }
}
```

### Scheduled Batch Sync

Use a cron job to sync unsynced orders periodically:

```typescript
// app/api/cron/sync-erp/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { syncOrderToERP } from '@/app/lib/erp-invoice';

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find unsynced orders
  const orders = await prisma.sallaOrder.findMany({
    where: { erpSyncedAt: null },
    take: 100,
  });

  let synced = 0;
  for (const order of orders) {
    const result = await syncOrderToERP(order);
    if (result.success) {
      await prisma.sallaOrder.update({
        where: { id: order.id },
        data: { erpSyncedAt: new Date(), erpInvoiceId: result.erpInvoiceId },
      });
      synced++;
    }
  }

  return NextResponse.json({ synced, total: orders.length });
}
```

Set up in Vercel cron or use a service like cron-job.org to call this endpoint periodically.

## Summary

- **Default:** Auto-sync is **disabled** - you have full control
- **Manual sync:** Available via UI (`/erp-settings`), CLI (`npm run sync:erp-orders`), or API
- **Auto-sync:** Optional, configurable per order status
- **Monitoring:** Real-time stats and error tracking
- **Safe:** Duplicate prevention ensures no duplicate invoices

Start with manual sync, test thoroughly, then optionally enable auto-sync when ready!
