# Date Field Debug Fix

## Problem
Console error when searching for orders:
```
No date found for return validation {}
```

This means no date field was being extracted from the order data.

## Root Cause

The date field extraction was too narrow and only checked a few specific fields:
- `order.date?.updated`
- `order.updatedAt`
- `order.date?.created`
- `order.createdAt`

If Salla's API response used different field names (e.g., snake_case), the extraction would fail.

## Solution

### 1. Added Comprehensive Debug Logging

**Frontend (`app/returns/page.tsx`):**

```typescript
// Logs the full order structure
console.log('Full order data received:', orderData.order);

// Logs all possible date field variations
console.log('All possible date fields:', {
  'date.updated': orderData.order.date?.updated,
  'date.created': orderData.order.date?.created,
  'updated_at': orderData.order.updated_at,
  'created_at': orderData.order.created_at,
  'updatedAt': orderData.order.updatedAt,
  'createdAt': orderData.order.createdAt,
  'updatedAtRemote': orderData.order.updatedAtRemote,
  'placedAt': orderData.order.placedAt,
});
```

**Backend (`app/api/orders/lookup/route.ts`):**

```typescript
log.info('Order retrieved from Salla', {
  orderId: order.id,
  dateFields: {
    'date.updated': order.date?.updated,
    'date.created': order.date?.created,
  },
  hasDate: !!order.date,
  dateKeys: order.date ? Object.keys(order.date) : [],
});
```

### 2. Expanded Date Field Fallback Chain

**Updated extraction logic:**

```typescript
const orderUpdatedAt =
  orderData.order.date?.updated ||      // Salla API: date.updated (primary)
  orderData.order.date?.created ||      // Salla API: date.created
  orderData.order.updated_at ||         // Snake case variation
  orderData.order.created_at ||         // Snake case created
  orderData.order.updatedAt ||          // Camel case updatedAt
  orderData.order.createdAt ||          // Camel case createdAt
  orderData.order.updatedAtRemote ||    // Database field (from sync)
  orderData.order.placedAt;             // Database placedAt field
```

**Priority Order:**
1. `date.updated` - Salla's official updated field (most recent activity)
2. `date.created` - Salla's created field
3. `updated_at` - Snake case variant
4. `created_at` - Snake case created
5. `updatedAt` - Camel case variant
6. `createdAt` - Camel case created
7. `updatedAtRemote` - Database stored field
8. `placedAt` - Order placement date

### 3. Enhanced Date Source Logging

```typescript
const dateSource = orderData.order.date?.updated
  ? 'date.updated'
  : orderData.order.date?.created
  ? 'date.created'
  : orderData.order.updated_at
  ? 'updated_at'
  : orderData.order.created_at
  ? 'created_at'
  : orderData.order.updatedAt
  ? 'updatedAt'
  : orderData.order.createdAt
  ? 'createdAt'
  : orderData.order.updatedAtRemote
  ? 'updatedAtRemote'
  : orderData.order.placedAt
  ? 'placedAt'
  : 'none';

console.log('Return eligibility check:', {
  orderId: orderData.order.id,
  dateSource,    // Shows which field was actually used
  dateValue: orderUpdatedAt,
});
```

## How to Debug

### Step 1: Search for an Order
Open the browser console and search for an order on `/returns` page.

### Step 2: Check Console Output

Look for these console logs:

**1. Full Order Structure:**
```javascript
Full order data received: {
  id: 251263484,
  reference_id: "251263484",
  // ... all fields
}
```

**2. Date Fields Check:**
```javascript
All possible date fields: {
  'date.updated': '2025-12-04T10:30:00.000Z',  // ✅ Found!
  'date.created': '2025-12-01T10:00:00.000Z',  // ✅ Found!
  'updated_at': undefined,
  'created_at': undefined,
  // ... rest are undefined
}
```

**3. Which Field Was Used:**
```javascript
Return eligibility check: {
  orderId: 251263484,
  dateSource: 'date.updated',  // ← This shows which one was used
  dateValue: '2025-12-04T10:30:00.000Z'
}
```

### Step 3: Check Server Logs

In your server console, look for:

```
Order retrieved from Salla {
  orderId: 251263484,
  dateFields: {
    'date.updated': '2025-12-04T10:30:00.000Z',
    'date.created': '2025-12-01T10:00:00.000Z'
  },
  hasDate: true,
  dateKeys: ['updated', 'created']
}
```

## Possible Scenarios

### Scenario 1: Standard Salla Response (Expected)
```javascript
// Console shows:
dateSource: 'date.updated'
dateValue: '2025-12-04T10:30:00.000Z'

// Result: ✅ Works perfectly
```

### Scenario 2: Snake Case Fields
```javascript
// Console shows:
dateSource: 'updated_at'
dateValue: '2025-12-04T10:30:00.000Z'

// Result: ✅ Works with fallback
```

### Scenario 3: Only Created Date Available
```javascript
// Console shows:
dateSource: 'date.created'
dateValue: '2025-12-01T10:00:00.000Z'

// Result: ✅ Uses creation date as fallback
```

### Scenario 4: Database Fields (If from DB instead of API)
```javascript
// Console shows:
dateSource: 'updatedAtRemote'
dateValue: '2025-12-04T10:30:00.000Z'

// Result: ✅ Uses database stored field
```

### Scenario 5: No Date Fields (Error)
```javascript
// Console shows:
dateSource: 'none'
dateValue: undefined

// Result: ❌ Shows error dialog
// Error: "خطأ في التحقق من الطلب - لا يمكن التحقق من تاريخ الطلب"
```

## What to Share

If you still see "No date found" error, please share:

1. **Browser Console Logs:**
   - Full order data received
   - All possible date fields
   - Return eligibility check

2. **Server Logs:**
   - Order retrieved from Salla
   - Date fields log

This will show us exactly what fields Salla is returning and which ones are missing.

## Files Modified

1. **`app/returns/page.tsx`** (Lines 103-148)
   - Added debug logging
   - Expanded date field fallbacks
   - Enhanced date source tracking

2. **`app/api/orders/lookup/route.ts`** (Lines 41-50)
   - Added server-side logging for date fields
   - Logs actual Salla API response structure

## Next Steps

1. Search for an order
2. Check console logs (both browser and server)
3. Share the output if still getting "No date found"
4. We'll identify which field Salla is actually using

The enhanced logging will help us pinpoint exactly where the date information is in the Salla API response.
