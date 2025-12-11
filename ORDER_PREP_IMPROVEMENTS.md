# Order Preparation Page Improvements

This document describes the improvements made to the order preparation workflow to ensure orders are always up-to-date and visible.

## 🎯 Problem Solved

**Issue:** New orders in Salla were not showing up on the order-prep page, requiring manual refresh or relying on background sync scripts.

**Solution:** Direct real-time fetching from Salla API with automatic refresh and comprehensive debugging tools.

---

## ✨ New Features

### 1. **Auto-Refresh (Every 30 Seconds)**

The page now automatically checks for new orders every 30 seconds when:
- User has no active orders
- User has completed their current order

**Toggle Control:**
- ✅ **مفعّل** (Enabled) - Green indicator
- ❌ **متوقف** (Disabled) - Gray indicator

**How it works:**
- Runs in background without disrupting user's work
- Only triggers when user is ready for new orders
- Can be toggled on/off using the switch

### 2. **Manual Refresh Button**

**Location:** Top of page, left side

**Button:** 🔄 تحديث الطلبات (Update Orders)

**What it does:**
1. Validates existing orders (removes orders that changed status in Salla)
2. Fetches new orders directly from Salla API
3. Filters by user's configured order type (all/COD/prepaid)
4. Assigns oldest order first (FIFO - First In First Out)
5. Updates Salla status to "جاري التجهيز" (In Progress)

**Status Messages:**
- ✅ "تم تعيين X طلب جديد" - Orders assigned successfully
- ℹ️ "لا توجد طلبات جديدة" - No new orders available
- ℹ️ "لديك طلب نشط بالفعل" - You already have an active order
- ❌ Error messages if something goes wrong

### 3. **Debug Panel (🔍 فحص)**

**New diagnostic tool** to help troubleshoot why orders aren't showing up.

**Click the "🔍 فحص" button to see:**

#### Status Configuration
- Order type filter (all/COD/prepaid)
- Status being searched for (usually "تحت المراجعة")
- Status ID being used

#### Orders in Salla
- **Total orders** with the target status
- **After payment filter** - Orders matching your payment method filter
- **Available for assignment** - Orders not yet assigned
- **Already assigned** - Orders currently being prepared by users

#### Your Assignments
- **Active orders** - How many orders you currently have
- **Can assign more** - Whether you can receive a new order

#### Sample Orders
- Shows first 5 available orders with:
  - Order number
  - Payment method
  - Creation date

#### Diagnosis Section
Provides automatic analysis:
- ❌ No orders in Salla with target status
- ⚠️ All orders already assigned
- ⚠️ Orders available but you have active order
- ✅ Orders available and you can receive one

---

## 🔄 How Order Fetching Works

### Previous Flow (Background Sync)
```
Salla Store → Background Script → Local Database → Order Prep Page
                 (manual/scheduled)
```

**Problems:**
- Sync may be outdated
- Requires manual script execution
- Delay between order placement and visibility

### New Flow (Direct API)
```
Salla Store ← Order Prep Page (fetches directly every 30 seconds)
```

**Benefits:**
- ✅ Always up-to-date
- ✅ No sync delay
- ✅ Automatic refresh
- ✅ Manual refresh option
- ✅ Oldest orders first

---

## 📋 Order Status Flow

1. **New Order Placed** → Salla status: "تحت المراجعة" (under_review)
2. **Auto-Assign Triggers** → Fetches from Salla API
3. **Order Assigned** → Salla status changed to "جاري التجهيز" (in_progress)
4. **User Prepares Order** → Gathers products
5. **Shipment Created** → Automated via API
6. **Order Completed** → Moved to OrderHistory

---

## 🎮 User Interface

### Top Control Bar

```
┌─────────────────────────────────────────────────────────────┐
│  [🔄 تحديث الطلبات]  [🔍 فحص]  آخر تحديث: 12:34:56       │
│                                                               │
│  تحديث تلقائي (كل 30 ثانية): [●──] مفعّل                   │
│                                                               │
│  ℹ️ لا توجد طلبات جديدة                                    │
└─────────────────────────────────────────────────────────────┘
```

### When No Orders Available

```
┌─────────────────────────────────────────────────────────────┐
│                        📄                                     │
│                                                               │
│          لا توجد طلبات للتحضير حالياً                       │
│                                                               │
│    سيتم البحث عن طلبات جديدة تلقائياً كل 30 ثانية          │
│                                                               │
│         [🔍 البحث عن طلبات جديدة]                           │
└─────────────────────────────────────────────────────────────┘
```

### When Order is Available

- Shows order details
- Customer info
- Product list with images and SKUs
- **[انشاء شحنة]** - Create shipment (automated)
- **[إنهاء الطلب]** - Complete order

---

## 🔧 Configuration

### User Settings (OrderUser model)

```typescript
{
  orderType: "all" | "cod" | "prepaid" | "specific_status",
  specificStatus?: string,  // Custom status ID if orderType = specific_status
  autoAssign: boolean,       // Auto-assign on login
  maxOrders: number          // Currently limited to 1 active order
}
```

### Environment Variables

No additional environment variables needed. Uses existing:
- `NEXT_PUBLIC_MERCHANT_ID` - Salla merchant ID
- Salla OAuth tokens (automatically managed)

---

## 🐛 Troubleshooting

### Orders Not Showing Up?

1. **Click "🔍 فحص" button** to see diagnostic panel
2. **Check the diagnosis section** for specific issue:

   **Problem:** "لا توجد طلبات في سلة بحالة 'تحت المراجعة'"
   - **Cause:** No new orders in your Salla store
   - **Solution:** Place test orders or wait for customer orders

   **Problem:** "جميع الطلبات معينة بالفعل"
   - **Cause:** All available orders are currently assigned
   - **Solution:** Complete current orders or wait for new orders

   **Problem:** "يوجد X طلب متاح ولكن لديك طلب نشط"
   - **Cause:** You have an active order (limit: 1 at a time)
   - **Solution:** Complete your current order first

   **Problem:** "يمكنك استلام طلب جديد"
   - **Cause:** System is ready
   - **Solution:** Click "تحديث الطلبات" button

3. **Check auto-refresh is enabled** (should show green "مفعّل")

4. **Manually click "تحديث الطلبات"** to force refresh

### Status ID Issues

If orders exist but aren't being fetched, the status ID might be different:

1. Check debug panel → "⚙️ إعدادات الحالة"
2. Note the "معرف الحالة" (Status ID)
3. Verify this matches your Salla status configuration
4. If using custom status, update user's `specificStatus` field

### Auto-Refresh Not Working

1. Check if toggle shows "مفعّل" (enabled)
2. Open browser console (F12) and check for errors
3. Ensure you have no active orders (auto-refresh pauses when working)

---

## 📊 API Endpoints

### GET `/api/order-assignments/debug`

**Query Params:**
- `userId` - User ID to debug

**Response:**
```json
{
  "success": true,
  "debug": {
    "user": { "id": "...", "name": "...", "orderType": "all" },
    "statusConfig": {
      "statusFilter": "566146469",
      "statusName": "تحت المراجعة",
      "statusSlug": "under_review"
    },
    "ordersInSalla": {
      "total": 5,
      "afterPaymentFilter": 3,
      "available": 2,
      "alreadyAssigned": 1
    },
    "assignments": {
      "totalAssignments": 3,
      "userActiveAssignments": 1,
      "canAssignMore": false
    },
    "sampleOrders": [...]
  }
}
```

### POST `/api/order-assignments/auto-assign`

**Request:**
```json
{
  "userId": "cm123..."
}
```

**Response:**
```json
{
  "success": true,
  "assigned": 1,
  "totalAssignments": 1,
  "message": "تم تعيين طلب جديد"
}
```

---

## 🔐 Order Assignment Logic

### Fetching Orders

1. **Get user configuration**
   - Order type (all/COD/prepaid/specific_status)
   - Active status

2. **Fetch from Salla API**
   - URL: `GET /admin/v2/orders?status={statusId}&per_page=50&sort_by=created_at-asc`
   - Status: "تحت المراجعة" (under_review) by default
   - Sorted: Oldest first

3. **Filter by payment method**
   - COD: `payment_method = "cash_on_delivery"` or `"cod"`
   - Prepaid: Everything else

4. **Remove already assigned orders**
   - Checks `OrderAssignment` table
   - Excludes orders in progress by other users

5. **Limit to 1 order**
   - Only assigns if user has 0 active orders
   - Prevents overlap

6. **Fetch full order details**
   - GET `/admin/v2/orders/{orderId}` - Order details
   - GET `/admin/v2/orders/items?order_id={orderId}` - Order items

7. **Create assignment**
   - Insert into `OrderAssignment` table
   - Update Salla status to "جاري التجهيز"

---

## 🎓 Best Practices

1. **Keep auto-refresh enabled** for optimal workflow
2. **Use debug panel** when troubleshooting
3. **Complete orders promptly** to receive new ones
4. **Check status messages** in the top bar
5. **Use manual refresh** if you suspect new orders arrived

---

## 📈 Performance

- **Auto-refresh interval:** 30 seconds (configurable in code)
- **API calls:** ~2-3 per refresh (status fetch + orders fetch)
- **Order fetching:** Sorted by oldest first (FIFO)
- **Caching:** Salla OAuth tokens cached and auto-refreshed

---

## 🔄 Related Documentation

- [Order Workflow](./ORDER_WORKFLOW.md) - Complete order flow documentation
- [Shipment Automation](./SHIPMENT_AUTOMATION_SETUP.md) - Automated shipment creation
- [Salla API](https://docs.salla.dev) - Official Salla API docs

---

## 🆕 Summary of Changes

| File | Change | Description |
|------|--------|-------------|
| `app/order-prep/page.tsx` | ✏️ Modified | Added auto-refresh, debug panel, status indicators |
| `app/api/order-assignments/debug/route.ts` | ✨ Created | New diagnostic endpoint |
| `app/api/order-assignments/auto-assign/route.ts` | ✅ Verified | Already fetches from Salla API directly |

---

**The order preparation page now provides real-time order visibility with comprehensive debugging tools!** 🎉
