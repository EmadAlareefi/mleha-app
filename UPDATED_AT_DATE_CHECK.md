# UpdatedAt Date Check - Implementation Details

## Overview
The 3-day return restriction now properly checks the **`updatedAt`** date field to ensure returns are only allowed within 3 days of the **most recent order activity**.

## Date Field Priority

### Salla API Response Structure
According to the `SallaOrder` interface, Salla API returns:
```typescript
{
  id: number;
  reference_id: string;
  date: {
    created: string;    // ISO 8601 date string
    updated: string;    // ISO 8601 date string - MOST RECENT ACTIVITY
  }
  // ... other fields
}
```

### Date Extraction Priority (Frontend)

**File:** `app/returns/page.tsx` (Lines 106-110)

```typescript
const orderUpdatedAt =
  orderData.order.date?.updated ||     // ✅ PRIMARY: Salla date.updated
  orderData.order.updatedAt ||          // Fallback: Alternative field name
  orderData.order.date?.created ||      // Fallback: Creation date if no updates
  orderData.order.createdAt;            // Fallback: Alternative created field
```

**Why this order?**
1. **`date.updated`** - Official Salla API field for most recent activity (status changes, updates, etc.)
2. **`updatedAt`** - Alternative field name (in case of API variations)
3. **`date.created`** - Fallback to order creation date if updated date not available
4. **`createdAt`** - Alternative creation field name

### Date Extraction (Backend Create Endpoint)

**File:** `app/api/returns/create/route.ts` (Line 200)

```typescript
const orderDateToCheck = order.date?.updated || order.date?.created;
```

Simplified approach:
- Uses `date.updated` (primary)
- Falls back to `date.created` if not available
- Returns error if neither exists

### Date Extraction (Backend Check Endpoint)

**File:** `app/api/returns/check/route.ts`

Receives the date as a parameter from frontend (already extracted).

---

## Why UpdatedAt is Important

### Scenario: Order Status Changes

```
Order Created: Dec 1, 2025
  ↓
Status Change to "Processing": Dec 3, 2025
  ↓
Status Change to "Shipped": Dec 5, 2025
  ↓
Status Change to "Delivered": Dec 7, 2025  ← date.updated = Dec 7
```

**If we used `date.created`:**
- Today is Dec 10
- Days since created: **9 days** → BLOCKED ❌ (Wrong!)
- Order was delivered only 3 days ago, should be allowed

**Using `date.updated` (correct):**
- Today is Dec 10
- Days since updated: **3 days** → ALLOWED ✅ (Correct!)
- Customer received order 3 days ago

### Why This Matters

The 3-day period should start from when:
- ✅ Order was **delivered** (most recent status update)
- ✅ Order had its **last activity** (payment, status change, etc.)
- ❌ NOT from when order was initially created

---

## Debugging & Logging

### Frontend Logging

The returns page now logs which date field was used:

```typescript
console.log('Return eligibility check:', {
  orderId: orderData.order.id,
  dateSource,        // 'date.updated', 'updatedAt', 'date.created', etc.
  dateValue: orderUpdatedAt,
});
```

**Example Output:**
```
Return eligibility check: {
  orderId: 251263484,
  dateSource: 'date.updated',
  dateValue: '2025-12-04T10:30:00.000Z'
}
```

### Backend Logging

Both endpoints log date validation:

**Check Endpoint:**
```typescript
log.info('Checking for existing return requests', {
  merchantId,
  orderId,
  orderUpdatedAt   // The date string being validated
});

log.warn('Order update date exceeds 3 days', {
  merchantId,
  orderId,
  orderUpdatedAt,
  daysDifference: daysDifference.toFixed(2)
});
```

**Create Endpoint:**
```typescript
log.error('No date found on order for 3-day validation', {
  merchantId,
  orderId,
  orderDateFields: {
    dateUpdated: order.date?.updated,
    dateCreated: order.date?.created,
  }
});

log.warn('Order update date exceeds 3 days', {
  merchantId,
  orderId,
  orderUpdatedAt: orderDateToCheck,
  daysDifference: daysDifference.toFixed(2)
});
```

---

## Validation Flow

### Complete Flow (Search to Create)

```
1. User searches for order
   ↓
2. Frontend extracts date (priority: date.updated)
   ↓ Logs: "Return eligibility check"
   ↓
3. Frontend sends to /api/returns/check
   ↓
4. Backend validates date exists
   ↓
5. Backend validates date format
   ↓
6. Backend calculates days difference
   ↓
7. If > 3 days: Return error dialog
   ↓
8. If ≤ 3 days: Allow proceed to form
   ↓
9. User submits return request
   ↓
10. Backend re-validates in /api/returns/create
    ↓
11. Same validation (date.updated → date.created)
    ↓
12. If > 3 days: Reject creation
    ↓
13. If ≤ 3 days: Create return request
```

---

## Error Scenarios

### 1. Date.updated Missing
```typescript
// Frontend extracts
orderData.order.date?.updated    // undefined
orderData.order.date?.created    // "2025-12-01T10:00:00.000Z"

// Result: Uses date.created as fallback
// Logs: dateSource = 'date.created'
```

### 2. All Date Fields Missing
```typescript
// Frontend extracts
orderData.order.date?.updated    // undefined
orderData.order.updatedAt        // undefined
orderData.order.date?.created    // undefined
orderData.order.createdAt        // undefined

// Result: Show error dialog
// Error: "خطأ في التحقق من الطلب - لا يمكن التحقق من تاريخ الطلب"
```

### 3. Invalid Date Format
```typescript
// Backend receives
orderUpdatedAt = "invalid-date-string"

// Result: Validation fails
// Error: INVALID_DATE_FORMAT
// Message: "تاريخ الطلب غير صالح"
```

---

## Testing

### Check Which Date Field is Used

**Browser Console:**
```javascript
// After searching for an order, check console
// Look for: "Return eligibility check"
// Check: dateSource field

// Examples:
// ✅ dateSource: 'date.updated'  → Using updatedAt (correct!)
// ⚠️  dateSource: 'date.created'  → Fallback to created (missing updated)
// ❌ dateSource: 'none'          → No date found (will error)
```

### Test Different Order Ages

**Test Case 1: Recent Order (Updated Yesterday)**
```
date.updated: "2025-12-06T10:00:00.000Z"
Current: 2025-12-07T10:00:00.000Z
Days: 1
Expected: ✅ ALLOWED
```

**Test Case 2: Order Updated 4 Days Ago**
```
date.updated: "2025-12-03T10:00:00.000Z"
Current: 2025-12-07T10:00:00.000Z
Days: 4
Expected: ❌ BLOCKED - "مرت 4 يوم على آخر تحديث"
```

**Test Case 3: Old Order (Created 10 Days Ago, Updated Yesterday)**
```
date.created: "2025-11-27T10:00:00.000Z"
date.updated: "2025-12-06T10:00:00.000Z"
Current: 2025-12-07T10:00:00.000Z
Days: 1 (using date.updated)
Expected: ✅ ALLOWED (recent activity)
```

---

## Key Improvements

### Before
```typescript
// BROKEN: Optional check
if (order.date?.updated) {
  // Validate
}
// If missing, validation SKIPPED! ❌
```

### After
```typescript
// FIXED: Required with fallback
const dateToCheck = order.date?.updated || order.date?.created;

if (!dateToCheck) {
  // Return error - validation NEVER skipped ✅
}

// Always validate ✅
```

---

## Files Modified

1. **`app/returns/page.tsx`** (Lines 103-145)
   - Added detailed comments explaining date priority
   - Added logging to track which date field is used
   - Ensures `date.updated` is checked first
   - Comprehensive error handling if no date found

2. **`app/api/returns/check/route.ts`** (Lines 26-72)
   - Made date validation mandatory
   - No optional checks
   - Proper error codes

3. **`app/api/returns/create/route.ts`** (Lines 198-255)
   - Updated to match check endpoint
   - Uses `date.updated` with fallback to `date.created`
   - Validates date exists and is valid format
   - Consistent error handling

---

## Summary

✅ **Primary Date:** `order.date.updated` (Salla's official updatedAt field)
✅ **Fallback:** `order.date.created` (if no updates recorded)
✅ **Logging:** Console logs show which field was used
✅ **Validation:** Never skipped, always required
✅ **Error Handling:** Clear messages for missing/invalid dates
✅ **Consistency:** Same logic in check and create endpoints

The 3-day restriction now correctly uses the **most recent order activity date** to determine return eligibility.
