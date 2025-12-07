# Error Dialog Implementation for Returns Page

## Overview
Added an Arabic error dialog component to the returns page to display errors in a user-friendly modal dialog instead of inline error messages.

## Files Created

### 1. `/components/ui/error-dialog.tsx`
A reusable error dialog component with:
- **Arabic text support** (RTL-friendly)
- **Three variants**: error (red), warning (yellow), info (blue)
- **Icons**: Visual feedback for each variant type
- **Responsive**: Works on mobile and desktop
- **Accessible**: ARIA labels and keyboard support
- **Modal backdrop**: Prevents interaction with background
- **Clean animations**: Smooth entrance transition

#### Component API:
```typescript
interface ErrorDialogProps {
  open: boolean;                          // Controls dialog visibility
  onClose: () => void;                    // Called when user closes dialog
  title?: string;                         // Optional title (defaults to Arabic)
  message: string;                        // Main error message (required)
  description?: string;                   // Additional details
  variant?: 'error' | 'warning' | 'info'; // Visual style (default: 'error')
}
```

#### Default Titles (Arabic):
- `error`: "خطأ" (Error)
- `warning`: "تحذير" (Warning)
- `info`: "معلومة" (Information)

## Files Modified

### 2. `/app/returns/page.tsx`
Updated the returns page to use the error dialog:

#### Added State:
```typescript
const [errorDialogOpen, setErrorDialogOpen] = useState(false);
const [errorDetails, setErrorDetails] = useState<{
  title?: string;
  message: string;
  description?: string;
  variant?: 'error' | 'warning' | 'info';
} | null>(null);
```

#### Error Handling Examples:

**1. Return Period Expired (3-day restriction):**
```typescript
setErrorDetails({
  title: 'انتهت مدة الإرجاع',
  message: 'لقد تجاوز الطلب مدة 3 أيام من آخر تحديث. لا يمكن إنشاء طلب إرجاع.',
  description: `مرت ${daysSinceUpdate} يوم على آخر تحديث للطلب. الحد الأقصى المسموح به هو 3 أيام.`,
  variant: 'error',
});
setErrorDialogOpen(true);
```

**2. General Errors:**
```typescript
setErrorDetails({
  title: 'خطأ',
  message: errorMessage,
  variant: 'error',
});
setErrorDialogOpen(true);
```

**3. Cancel Return Errors:**
```typescript
setErrorDetails({
  title: 'خطأ في الإلغاء',
  message: errorMessage,
  variant: 'error',
});
setErrorDialogOpen(true);
```

## Visual Design

### Error Variant (Red)
```
┌────────────────────────────────────┐
│  [X]  انتهت مدة الإرجاع           │
│       لقد تجاوز الطلب مدة 3 أيام...│
│       مرت 4 يوم على آخر تحديث...   │
├────────────────────────────────────┤
│                         [  حسناً  ] │
└────────────────────────────────────┘
```

### Features:
- **Icon**: Red X icon in circular background
- **Title**: Bold text in red-900
- **Message**: Error message in red-700
- **Description**: Additional details in slightly lighter red
- **Background**: Red-50 with red-200 border
- **Button**: Primary button with "حسناً" (OK) text

### Warning Variant (Yellow)
- Warning triangle icon
- Yellow color scheme
- Same layout structure

### Info Variant (Blue)
- Info circle icon
- Blue color scheme
- Same layout structure

## Usage Examples

### Example 1: Show Error Dialog
```typescript
setErrorDetails({
  title: 'خطأ في الطلب',
  message: 'لم يتم العثور على الطلب',
  variant: 'error',
});
setErrorDialogOpen(true);
```

### Example 2: Show Warning
```typescript
setErrorDetails({
  title: 'تحذير',
  message: 'بعض المنتجات غير متوفرة للإرجاع',
  description: 'يرجى التحقق من المنتجات المحددة',
  variant: 'warning',
});
setErrorDialogOpen(true);
```

### Example 3: Show Info
```typescript
setErrorDetails({
  title: 'معلومة',
  message: 'تم حفظ التغييرات بنجاح',
  variant: 'info',
});
setErrorDialogOpen(true);
```

## Integration with 3-Day Restriction

The error dialog is specifically integrated with the 3-day return restriction feature:

1. **Order Lookup**: When checking if an order can be returned
2. **API Response**: Backend returns error with `errorCode: 'RETURN_PERIOD_EXPIRED'`
3. **Dialog Display**: Shows formatted error with:
   - Title: "انتهت مدة الإرجاع" (Return period expired)
   - Message: Main error message from API
   - Description: Number of days since last update
   - Variant: 'error' (red theme)

## Accessibility

- **ARIA Labels**: Dialog has `role="dialog"` and `aria-modal="true"`
- **Keyboard Support**: Click outside or press button to close
- **Screen Reader**: Title has `id="dialog-title"` for aria-labelledby
- **Focus Management**: Modal prevents background interaction

## Browser Support

Works on all modern browsers with Tailwind CSS support:
- Chrome, Firefox, Safari, Edge
- Mobile browsers (iOS Safari, Chrome Mobile)

## Notes

- Dialog uses fixed positioning with z-50 to appear above all content
- Backdrop click closes the dialog
- Only one dialog can be open at a time
- Dialog state is managed by parent component
- All text is in Arabic for consistent UX
