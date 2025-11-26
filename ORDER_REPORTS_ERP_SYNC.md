# Order Reports - ERP Sync Feature

## Overview

The order reports page (`/order-reports`) now includes full ERP sync functionality, allowing you to sync orders directly from the reports interface.

## Features Added

### 1. **ERP Sync Status Indicators**

Each order card now displays its ERP sync status:

- ✅ **Synced** (Green) - Order successfully synced to ERP
- ❌ **Failed** (Red) - Sync attempt failed (with error message)
- 📦 **Not Synced** (Gray) - Order not yet synced

### 2. **Individual Order Sync Buttons**

Each order has a sync button:

- **"مزامنة مع ERP"** (Sync to ERP) - For unsynced orders
- **"إعادة مزامنة"** (Re-sync) - For already-synced orders (uses `force: true`)

Features:
- Loading state while syncing
- Disabled during sync operation
- Shows error messages inline if sync fails

### 3. **Bulk Sync Button**

A bulk sync button in the list view header:
- **"مزامنة الطلبات غير المزامنة"** (Sync Unsynced Orders)
- Syncs all unsynced orders in the current view
- Shows confirmation dialog before starting
- Displays progress and results

### 4. **Success/Error Messages**

Toast-style messages at the top of the page:
- Success: Green background with success message
- Error: Red background with error details
- Auto-dismisses after 5 seconds

### 5. **Real-time Updates**

Order status updates in real-time:
- `erpSyncedAt` timestamp updated on success
- `erpInvoiceId` stored from ERP response
- `erpSyncError` displayed for failed syncs
- UI reflects changes immediately

## How to Use

### Sync Individual Order

1. Navigate to `/order-reports`
2. Switch to "قائمة الطلبات" (Orders List) view
3. Find the order you want to sync
4. Click **"مزامنة مع ERP"** button in the order card
5. Wait for confirmation message

### Sync Multiple Orders

1. Navigate to `/order-reports`
2. Switch to "قائمة الطلبات" (Orders List) view
3. Apply filters if needed (status, date range)
4. Click **"مزامنة الطلبات غير المزامنة"** in the header
5. Confirm the action
6. Wait for all orders to sync

### Re-sync an Order

If an order was already synced but you need to update it:

1. Find the synced order (marked with ✅)
2. Click **"إعادة مزامنة"** button
3. This will force re-sync even though it's already synced

## API Integration

The page uses these endpoints:

### Single Order Sync
```typescript
POST /api/erp/sync-order
Body: { orderId: string, force?: boolean }
```

### Batch Sync
```typescript
POST /api/erp/sync-orders-batch
Body: {
  filters: { onlyUnsynced: true },
  limit: 1000
}
```

## Database Fields

The page now displays these ERP-related fields:

- `erpSyncedAt` - Timestamp when synced (ISO string)
- `erpInvoiceId` - Invoice ID from ERP system
- `erpSyncError` - Error message if sync failed

## Visual Indicators

### Sync Status Icons

- ✅ `CheckCircle2` - Successfully synced
- ❌ `XCircle` - Sync failed
- 📦 `Package` - Not yet synced
- 🔄 `RefreshCw` - Re-sync action
- ➤ `Send` - Sync action
- ⏳ `LoaderCircle` - Syncing in progress

### Button States

**Unsynced Order:**
```
┌─────────────────────┐
│ ➤ مزامنة مع ERP     │
└─────────────────────┘
```

**Syncing:**
```
┌─────────────────────┐
│ ⏳ جاري المزامنة...│
└─────────────────────┘
```

**Synced:**
```
┌─────────────────────┐
│ 🔄 إعادة مزامنة     │
└─────────────────────┘
```

## Error Handling

### Individual Sync Errors

Displayed in red box below the sync button:
```
┌─────────────────────────────┐
│ Error: Missing SKU for item │
└─────────────────────────────┘
```

### Bulk Sync Results

Shows summary after bulk sync:
```
تمت مزامنة 45 طلب بنجاح، فشل 2 طلب
(45 orders synced successfully, 2 failed)
```

## Filtering & Syncing

You can combine filters with sync:

1. Filter by status (e.g., "completed")
2. Filter by date range
3. Click bulk sync
4. Only visible filtered orders will be synced

## Performance

- Individual syncs are immediate
- Bulk sync processes orders sequentially with 100ms delay
- UI updates in real-time during bulk operations
- No page refresh needed

## Code Changes

### Files Modified

1. **`app/order-reports/page.tsx`**
   - Added ERP sync state management
   - Added `syncOrderToERP()` function
   - Added `syncAllUnsyncedOrders()` function
   - Updated order card UI with sync status
   - Added bulk sync button

2. **`app/api/order-history/admin/route.ts`**
   - Added `erpSyncedAt`, `erpInvoiceId`, `erpSyncError` to response

## Best Practices

1. **Filter before bulk sync** - Use status and date filters to sync specific order groups
2. **Check errors** - Review failed syncs and fix issues before retrying
3. **Use re-sync sparingly** - Only re-sync when needed (updates invoice in ERP)
4. **Monitor sync status** - Check for orders with errors regularly

## Next Steps

Consider adding:
- Export synced/unsynced orders to CSV
- Schedule automatic sync for specific statuses
- Webhook integration for real-time sync
- Sync history/audit log

## Troubleshooting

**Q: Bulk sync button is disabled**
- A: Wait for current sync operations to complete

**Q: Order shows as failed**
- A: Check the error message below the order
- Common issues: Missing SKU, invalid data, ERP connection

**Q: Sync status not updating**
- A: Refresh the page or check browser console for errors

**Q: Want to sync specific orders only**
- A: Use filters (status, date) then bulk sync, or sync individually

## Related Documentation

- [ERP_INTEGRATION_GUIDE.md](./ERP_INTEGRATION_GUIDE.md) - Main integration guide
- [ERP_AUTO_SYNC_SETUP.md](./ERP_AUTO_SYNC_SETUP.md) - Auto-sync configuration
- [ERP_QUICK_START.md](./ERP_QUICK_START.md) - Quick reference
