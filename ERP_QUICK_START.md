# ERP Integration - Quick Start

## TL;DR

✅ **Automatic sync is DISABLED by default**
✅ **Duplicate prevention is ENABLED** - orders won't sync twice
✅ **Manual sync available** via UI and API

## For Manual Sync (Recommended to Start)

### Option 1: Use the UI

1. Navigate to `/erp-settings` in your app
2. View sync statistics
3. Click "Sync X Unsynced Orders" to sync all at once

### Option 2: Use the API

Sync a single order:
```bash
curl -X POST http://localhost:3000/api/erp/sync-order \
  -H "Content-Type: application/json" \
  -d '{"orderNumber": "YOUR_ORDER_NUMBER"}'
```

Sync all unsynced orders:
```bash
curl -X POST http://localhost:3000/api/erp/sync-orders-batch \
  -H "Content-Type: application/json" \
  -d '{"filters": {"onlyUnsynced": true}, "limit": 1000}'
```

## To Enable Auto-Sync Later

When you're ready for automatic syncing:

1. Go to `/erp-settings`
2. Toggle "Automatic Sync" to enabled
3. Orders will auto-sync when their status becomes `completed` or `ready_to_ship`

Or via API:
```bash
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"key": "erp_auto_sync_enabled", "value": "true"}'
```

## What's Already Set Up

✅ Environment variables configured:
- `ERP_LOGIN_URL`
- `ERP_INVOICE_URL`
- `ERP_USERNAME`
- `ERP_PASSWORD`

✅ Settings initialized:
- `erp_auto_sync_enabled` = `false` (disabled)
- `erp_auto_sync_on_status` = `completed,ready_to_ship`

✅ Database schema updated:
- Tracking fields added to `SallaOrder`
- Duplicate prevention in place

✅ UI available at `/erp-settings`

## Files Created

1. **`app/lib/erp-auth.ts`** - Authentication with token caching
2. **`app/lib/erp-invoice.ts`** - Invoice transformation and sync logic
3. **`app/lib/erp-webhook-sync.ts`** - Webhook auto-sync helper
4. **`app/lib/settings.ts`** - Settings management
5. **`app/api/erp/sync-order/route.ts`** - Single order sync API
6. **`app/api/erp/sync-orders-batch/route.ts`** - Batch sync API
7. **`app/api/erp/stats/route.ts`** - Sync statistics API
8. **`app/erp-settings/page.tsx`** - Settings UI
9. **`scripts/init-erp-settings.ts`** - Settings initialization

## Documentation

- **[ERP_INTEGRATION_GUIDE.md](./ERP_INTEGRATION_GUIDE.md)** - Complete integration guide
- **[ERP_AUTO_SYNC_SETUP.md](./ERP_AUTO_SYNC_SETUP.md)** - Auto-sync configuration guide

## Next Steps

1. **Test with a single order** using manual sync
2. **Verify the invoice** in your ERP system
3. **Check pricing and items** are correct
4. **Sync more orders** via UI or batch API
5. **Enable auto-sync** when confident (optional)

## Need Help?

- Check sync statistics at `/erp-settings`
- View failed orders and error messages
- Review logs for detailed error information
- Re-sync with `force: true` if needed

## Safety Features

🛡️ **Duplicate Prevention**
- Orders track `erpSyncedAt` timestamp
- Already-synced orders are skipped
- Use `force: true` to override

🛡️ **Error Tracking**
- Failed syncs store error messages
- Retry counts tracked in database
- Easy to identify and fix issues

🛡️ **Manual Control**
- Auto-sync disabled by default
- You decide when to sync
- Full control over the process

Start syncing! 🚀
