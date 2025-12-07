# Error Dialog Usage in Returns Page

## Overview
The returns page now displays all errors in a modal dialog instead of inline error messages, providing a better user experience with clear Arabic messaging.

## Error Scenarios

### 1. **Order Not Found** (When searching)
**Trigger:** User enters an invalid order number and clicks "البحث عن الطلب"

**Dialog Display:**
```
┌─────────────────────────────────────────────┐
│  [X]  لم يتم العثور على الطلب              │
│                                             │
│  لم يتم العثور على الطلب                   │
│                                             │
│  يرجى التحقق من رقم الطلب والمحاولة         │
│  مرة أخرى. يمكنك العثور على رقم الطلب      │
│  في رسالة التأكيد المرسلة إليك عبر         │
│  البريد الإلكتروني أو الرسائل النصية.      │
│                                             │
├─────────────────────────────────────────────┤
│                              [    حسناً    ]│
└─────────────────────────────────────────────┘
```

**Code Location:** `app/returns/page.tsx:86-97`

---

### 2. **Return Period Expired** (3-day restriction)
**Trigger:** Order was last updated more than 3 days ago

**Dialog Display:**
```
┌─────────────────────────────────────────────┐
│  [X]  انتهت مدة الإرجاع                    │
│                                             │
│  لقد تجاوز الطلب مدة 3 أيام من آخر تحديث.  │
│  لا يمكن إنشاء طلب إرجاع.                  │
│                                             │
│  مرت 4 يوم على آخر تحديث للطلب.            │
│  الحد الأقصى المسموح به هو 3 أيام.         │
│                                             │
├─────────────────────────────────────────────┤
│                              [    حسناً    ]│
└─────────────────────────────────────────────┘
```

**Code Location:** `app/returns/page.tsx:107-118`

---

### 3. **General Search Error** (Network issues, etc.)
**Trigger:** Exception during order lookup (network error, API failure, etc.)

**Dialog Display:**
```
┌─────────────────────────────────────────────┐
│  [X]  حدث خطأ                              │
│                                             │
│  [Error message from exception]             │
│                                             │
│  حدث خطأ أثناء البحث عن الطلب.             │
│  يرجى المحاولة مرة أخرى.                   │
│                                             │
├─────────────────────────────────────────────┤
│                              [    حسناً    ]│
└─────────────────────────────────────────────┘
```

**Code Location:** `app/returns/page.tsx:143-150`

---

### 4. **Cancel Return Error**
**Trigger:** Error when trying to cancel an existing return request

**Dialog Display:**
```
┌─────────────────────────────────────────────┐
│  [X]  خطأ في الإلغاء                       │
│                                             │
│  [Error message from API]                   │
│                                             │
│  لم نتمكن من إلغاء طلب الإرجاع.            │
│  يرجى المحاولة مرة أخرى.                   │
│                                             │
├─────────────────────────────────────────────┤
│                              [    حسناً    ]│
└─────────────────────────────────────────────┘
```

**Code Location:** `app/returns/page.tsx:206-212`

---

## Implementation Details

### Error State Management

The returns page uses two state variables for error dialog:

```typescript
const [errorDialogOpen, setErrorDialogOpen] = useState(false);
const [errorDetails, setErrorDetails] = useState<{
  title?: string;
  message: string;
  description?: string;
  variant?: 'error' | 'warning' | 'info';
} | null>(null);
```

### Dialog Component

Located at: `components/ui/error-dialog.tsx`

**Props:**
- `open`: Controls visibility
- `onClose`: Called when user dismisses
- `title`: Dialog title (defaults to "خطأ")
- `message`: Main error message (required)
- `description`: Additional details (optional)
- `variant`: Visual style - 'error', 'warning', or 'info'

### Error Clearing

Errors are automatically cleared when:
- User submits a new search (before API call)
- User closes the dialog

```typescript
// Before search
setError('');
setErrorDialogOpen(false);
setErrorDetails(null);

// After closing dialog
setErrorDialogOpen(false);
setErrorDetails(null);
```

---

## User Flow with Error Dialog

### Success Flow:
1. User enters order number
2. Clicks "البحث عن الطلب"
3. Loading state: "جاري البحث..."
4. Order found → Proceeds to returns form or existing returns

### Error Flow (Order Not Found):
1. User enters invalid order number
2. Clicks "البحث عن الطلب"
3. Loading state: "جاري البحث..."
4. **Error dialog appears** with clear message
5. User clicks "حسناً" to dismiss
6. Returns to search form
7. Can try again with correct order number

### Error Flow (3-Day Restriction):
1. User enters valid order number (>3 days old)
2. Clicks "البحث عن الطلب"
3. Loading state: "جاري البحث..."
4. Order found, checking return eligibility
5. **Error dialog appears** showing period expired
6. Dialog shows how many days have passed
7. User clicks "حسناً" to dismiss
8. Returns to search form

---

## Benefits

### Before (Inline Error):
- Error appears below input field
- Easy to miss
- No additional context
- Stays on page until next search

### After (Error Dialog):
- **Modal dialog** - Cannot be missed
- **Prominent display** with icon and color coding
- **Additional context** in description field
- **Clear action** to dismiss and retry
- **Better UX** - More professional and user-friendly

---

## Testing the Error Dialog

### Test Case 1: Invalid Order Number
```
Input: "999999999"
Expected: Dialog shows "لم يتم العثور على الطلب"
```

### Test Case 2: Empty Order Number
```
Input: ""
Expected: Button disabled, no dialog
```

### Test Case 3: Order Older Than 3 Days
```
Input: Valid order number from >3 days ago
Expected: Dialog shows "انتهت مدة الإرجاع" with days count
```

### Test Case 4: Network Error
```
Scenario: Disconnect network, submit search
Expected: Dialog shows "حدث خطأ" with network error message
```

---

## Customization

To change error messages, edit the `setErrorDetails` calls in:
- Order not found: Line 88-94
- Period expired: Line 107-115
- General error: Line 144-149
- Cancel error: Line 206-211

To change dialog styling, edit:
- Component: `components/ui/error-dialog.tsx`
- Color schemes: Lines 17-39
- Icons: Lines 86-128
- Button text: Line 151
