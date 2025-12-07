# 3-Day Return Restriction - Bug Fix

## Problem Summary

The 3-day return restriction was **not working** when users searched for old orders. Users could proceed to create return requests even for orders that were more than 3 days old.

### Root Cause

The validation in `/api/returns/check` had an optional check:

```typescript
// BEFORE (BROKEN)
if (orderUpdatedAt) {  // ❌ If this is undefined/null, validation is SKIPPED!
  const updatedDate = new Date(orderUpdatedAt);
  const daysDifference = (now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDifference > 3) {
    // Block return
  }
}
// If orderUpdatedAt is missing, code continues without blocking! ❌
```

**Issues:**
1. If `orderUpdatedAt` was `undefined` or `null`, the entire validation was **skipped**
2. No fallback to use `order.date.created` if `order.date.updated` was missing
3. No validation of date format (invalid dates would be skipped)
4. Old orders could slip through if the date wasn't extracted properly from Salla API

---

## Solution

### 1. **Backend Fix** (`app/api/returns/check/route.ts`)

**Changes:**
- ✅ Made `orderUpdatedAt` parameter **required** - returns error if missing
- ✅ Added date format validation
- ✅ Moved validation outside of optional check
- ✅ Added specific error codes for different failure scenarios

```typescript
// AFTER (FIXED)
if (!orderUpdatedAt) {
  return NextResponse.json({
    error: 'لا يمكن التحقق من تاريخ الطلب',
    errorCode: 'MISSING_ORDER_DATE',
    message: 'لم يتم تقديم تاريخ الطلب للتحقق من صلاحية الإرجاع.',
    canCreateNew: false,
  }, { status: 400 });
}

const updatedDate = new Date(orderUpdatedAt);

if (isNaN(updatedDate.getTime())) {
  return NextResponse.json({
    error: 'تاريخ الطلب غير صالح',
    errorCode: 'INVALID_DATE_FORMAT',
    message: 'تاريخ الطلب المقدم غير صالح.',
    canCreateNew: false,
  }, { status: 400 });
}

const daysDifference = (now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);

if (daysDifference > 3 + EPSILON) {
  return NextResponse.json({
    error: 'انتهت مدة الإرجاع المسموحة',
    errorCode: 'RETURN_PERIOD_EXPIRED',
    message: 'لقد تجاوز الطلب مدة 3 أيام من آخر تحديث. لا يمكن إنشاء طلب إرجاع.',
    daysSinceUpdate: Math.floor(daysDifference),
    canCreateNew: false,
  }, { status: 400 });
}
```

---

### 2. **Frontend Fix** (`app/returns/page.tsx`)

**Changes:**
- ✅ Added fallback chain to extract date from multiple possible fields
- ✅ Always sends date to API (required, not optional)
- ✅ Shows error dialog if date cannot be found
- ✅ Handles new error codes from API

```typescript
// Extract date with fallbacks
const orderUpdatedAt =
  orderData.order.date?.updated ||      // Primary: Salla date.updated
  orderData.order.updatedAt ||          // Fallback 1
  orderData.order.date?.created ||      // Fallback 2: Use created date
  orderData.order.createdAt;            // Fallback 3

// Validate before sending to API
if (!orderUpdatedAt) {
  setErrorDetails({
    title: 'خطأ في التحقق من الطلب',
    message: 'لا يمكن التحقق من تاريخ الطلب',
    description: 'لم نتمكن من العثور على تاريخ الطلب. يرجى الاتصال بالدعم.',
    variant: 'error',
  });
  setErrorDialogOpen(true);
  return;
}

// Always send date (no longer optional)
checkUrl.searchParams.set('orderUpdatedAt', orderUpdatedAt);
```

---

### 3. **Error Handling**

**New Error Codes:**

| Error Code | When It Happens | User Message |
|------------|----------------|--------------|
| `MISSING_ORDER_DATE` | Date not provided to API | "لا يمكن التحقق من تاريخ الطلب" |
| `INVALID_DATE_FORMAT` | Date format is invalid | "تاريخ الطلب غير صالح" |
| `RETURN_PERIOD_EXPIRED` | Order >3 days old | "انتهت مدة الإرجاع" + days count |

**Frontend Handling:**

```typescript
if (!returnsResponse.ok) {
  if (returnsData.errorCode === 'RETURN_PERIOD_EXPIRED') {
    // Show period expired dialog with days count
  } else if (returnsData.errorCode === 'MISSING_ORDER_DATE' ||
             returnsData.errorCode === 'INVALID_DATE_FORMAT') {
    // Show date validation error dialog
  }
}
```

---

## Test Results

All 9 test cases pass:

```
✅ Missing date (undefined) → Blocked with MISSING_ORDER_DATE
✅ Invalid date format → Blocked with INVALID_DATE_FORMAT
✅ Order 1 day old → Allowed
✅ Order 2 days old → Allowed
✅ Order exactly 3 days old → Allowed
✅ Order 3.5 days old → Blocked with RETURN_PERIOD_EXPIRED
✅ Order 4 days old → Blocked with RETURN_PERIOD_EXPIRED
✅ Order 7 days old → Blocked with RETURN_PERIOD_EXPIRED
✅ Order 30 days old → Blocked with RETURN_PERIOD_EXPIRED
```

**Test Command:**
```bash
npx ts-node scripts/test-3-day-check-fix.ts
```

---

## What Changed

### Before (Broken):
```
User searches for 7-day-old order
  ↓
Order lookup succeeds
  ↓
Check returns API (date missing or not extracted)
  ↓
Validation SKIPPED (if statement fails)
  ↓
User proceeds to return form ❌
```

### After (Fixed):
```
User searches for 7-day-old order
  ↓
Order lookup succeeds
  ↓
Extract date (with fallbacks)
  ↓
Send date to check API (required)
  ↓
API validates date (not optional)
  ↓
7 days > 3 days → BLOCKED ✅
  ↓
Error dialog: "انتهت مدة الإرجاع"
  ↓
Shows "مرت 7 يوم على آخر تحديث"
```

---

## Files Modified

1. **`app/api/returns/check/route.ts`** (Lines 28-72)
   - Made date validation required (not optional)
   - Added date format validation
   - Added specific error codes

2. **`app/returns/page.tsx`** (Lines 103-173)
   - Added fallback date extraction
   - Validates date before API call
   - Always sends date parameter
   - Handles new error codes

3. **`app/api/returns/create/route.ts`** (Lines 198-220)
   - Same validation logic in create endpoint
   - Ensures consistency

---

## Testing in Production

### Test Case 1: Recent Order (Should Allow)
```
Order Number: [Order from yesterday]
Expected: Proceeds to return form
```

### Test Case 2: Old Order (Should Block)
```
Order Number: [Order from 2 weeks ago]
Expected: Error dialog "انتهت مدة الإرجاع - مرت XX يوم"
```

### Test Case 3: Exactly 3 Days
```
Order Number: [Order from exactly 72 hours ago]
Expected: Proceeds to return form (edge case - should allow)
```

---

## Impact

**Before Fix:**
- ❌ Old orders could create returns
- ❌ 3-day policy not enforced
- ❌ Business rule violated
- ❌ Potential abuse/fraud

**After Fix:**
- ✅ All orders >3 days are blocked
- ✅ 3-day policy strictly enforced
- ✅ Clear error messages to users
- ✅ Business rule protected

---

## Additional Notes

1. **Date Field Priority:**
   - `order.date.updated` (preferred - most recent activity)
   - `order.updatedAt` (fallback)
   - `order.date.created` (fallback if no updates)
   - `order.createdAt` (last resort)

2. **Epsilon Value:**
   - Used `0.001` days (≈1.5 minutes) to handle floating-point precision
   - Ensures exactly 3.00 days is still allowed

3. **Error Dialog:**
   - Shows exact number of days passed
   - Provides clear Arabic messaging
   - Professional modal display

4. **Backwards Compatibility:**
   - Inline error display kept as fallback
   - Error state still managed for other UI components

---

## Deployment Checklist

- [x] Backend validation fixed
- [x] Frontend date extraction improved
- [x] Error handling comprehensive
- [x] All test cases passing
- [x] TypeScript compilation clean
- [x] Documentation complete
- [ ] Deploy to production
- [ ] Monitor error logs for MISSING_ORDER_DATE
- [ ] Test with real orders
- [ ] Verify 3-day blocking works
