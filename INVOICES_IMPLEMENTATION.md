# Invoices Management System - Implementation Guide

## Overview

This document describes the complete implementation of the Salla Invoices Management and ERP Integration system. The system allows you to:

1. **View invoices** synced from Salla in a paginated table
2. **Filter invoices** by ERP sync status, invoice status, and date range
3. **Sync individual invoices** to your ERP system with a button click
4. **Track sync status** with error handling and retry attempts
5. **View detailed invoice information** including customer data, amounts, and order items

---

## Architecture

### Database Schema

**Model: `SallaInvoice`** (`prisma/schema.prisma`)

```prisma
model SallaInvoice {
  id             String   @id @default(cuid())
  merchantId     String
  invoiceId      String
  orderId        String?
  orderNumber    String?
  invoiceNumber  String?
  status         String?
  paymentStatus  String?
  currency       String?

  // Financial fields
  subtotalAmount Decimal? @db.Decimal(12, 2)
  taxAmount      Decimal? @db.Decimal(12, 2)
  totalAmount    Decimal? @db.Decimal(12, 2)
  shippingAmount Decimal? @db.Decimal(12, 2)
  discountAmount Decimal? @db.Decimal(12, 2)

  // Dates
  issueDate      DateTime?
  dueDate        DateTime?

  // Customer information
  customerId     String?
  customerName   String?
  customerMobile String?
  customerEmail  String?
  notes          String?  @db.Text

  // Raw data storage
  rawInvoice     Json
  rawOrder       Json?

  // ERP integration fields
  erpSyncedAt    DateTime?
  erpSyncError   String?  @db.Text
  erpSyncAttempts Int     @default(0)

  // Timestamps
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([merchantId, invoiceId])
  @@index([merchantId, status])
  @@index([merchantId, orderId])
  @@index([merchantId, erpSyncedAt])
}
```

**Key Features:**
- Stores all invoice data from Salla API
- Preserves raw JSON for audit trail
- Tracks ERP sync status with timestamps, errors, and retry attempts
- Optimized indexes for filtering and queries

---

## Backend Components

### 1. Invoice Sync Service

**File:** `app/lib/salla-invoices.ts` (existing)

**Purpose:** Syncs invoices from Salla API to database

**Key Functions:**
- `syncSallaInvoices()` - Main sync function
- `syncInvoicesForMerchant()` - Per-merchant sync with pagination
- `fetchInvoicesPage()` - Fetches invoices from Salla API
- Multiple normalizer functions for data transformation

**Usage:**
```bash
# Sync all merchants
POST /api/salla/sync-invoices

# Sync specific merchant
POST /api/salla/sync-invoices?merchantId=MERCHANT_ID
```

---

### 2. ERP Integration Service

**File:** `app/lib/erp-integration.ts` (new)

**Purpose:** Handles syncing invoices to your ERP system

**Key Functions:**
- `syncInvoiceToERP(invoice)` - Syncs invoice to ERP via API
- `transformInvoiceToERPPayload(invoice)` - Transforms data for ERP
- `syncInvoiceToLocalERP(invoice)` - Alternative for local database ERP

**Configuration (Environment Variables):**
```bash
ERP_API_URL=https://your-erp-api.com/api
ERP_API_KEY=your-api-key-here
# OR for basic auth:
ERP_API_USERNAME=your-username
ERP_API_PASSWORD=your-password
```

**Customization Required:**
You need to customize the ERP integration based on your ERP system:

1. **API Endpoint:** Update the endpoint URL in `syncInvoiceToERP()`
2. **Authentication:** Configure the auth method (Bearer token, API key, Basic auth)
3. **Payload Format:** Modify `transformInvoiceToERPPayload()` to match your ERP's expected format
4. **Response Handling:** Update success/error detection based on your ERP's response format

**Example ERP Payload:**
```typescript
{
  invoiceNumber: "INV-12345",
  orderNumber: "ORD-67890",
  issueDate: "2025-11-25T10:30:00Z",
  customer: {
    name: "Ahmed Ali",
    email: "ahmed@example.com",
    phone: "05xxxxxxxx"
  },
  amounts: {
    subtotal: 500.00,
    tax: 75.00,
    shipping: 25.00,
    discount: 0.00,
    total: 600.00
  },
  currency: "SAR",
  metadata: {
    sallaInvoiceId: "123456",
    sallaMerchantId: "merchant_123"
  }
}
```

---

## API Endpoints

### 1. Get Invoices (Paginated)

**Endpoint:** `GET /api/invoices`

**Query Parameters:**
- `merchantId` - Filter by merchant (optional)
- `status` - Filter by invoice status (optional)
- `paymentStatus` - Filter by payment status (optional)
- `erpSynced` - Filter by ERP sync status: `"true"`, `"false"` (optional)
- `startDate` - Filter by issue date (ISO string) (optional)
- `endDate` - Filter by issue date (ISO string) (optional)
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `sortBy` - Sort field (default: `"issueDate"`)
- `sortOrder` - `"asc"` or `"desc"` (default: `"desc"`)

**Example Request:**
```bash
GET /api/invoices?erpSynced=false&page=1&limit=20
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx123...",
      "invoiceNumber": "INV-12345",
      "orderNumber": "ORD-67890",
      "customerName": "Ahmed Ali",
      "totalAmount": 600.00,
      "currency": "SAR",
      "issueDate": "2025-11-25T10:30:00Z",
      "status": "issued",
      "paymentStatus": "unpaid",
      "erpSyncedAt": null,
      "erpSyncError": null,
      "erpSyncAttempts": 0
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalCount": 150,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

### 2. Get Invoice by ID

**Endpoint:** `GET /api/invoices/[id]`

**Example Request:**
```bash
GET /api/invoices/clx123abc456def
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clx123...",
    "invoiceNumber": "INV-12345",
    "customerName": "Ahmed Ali",
    "rawInvoice": { /* full Salla invoice JSON */ },
    "rawOrder": { /* full Salla order JSON */ },
    // ... all invoice fields
  }
}
```

---

### 3. Sync Invoice to ERP

**Endpoint:** `POST /api/invoices/[id]/sync-to-erp`

**Example Request:**
```bash
POST /api/invoices/clx123abc456def/sync-to-erp
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Invoice synced to ERP successfully",
  "data": {
    "invoiceId": "clx123...",
    "invoiceNumber": "INV-12345",
    "erpSyncedAt": "2025-11-25T12:00:00Z",
    "erpSyncAttempts": 1,
    "erpInvoiceId": "erp_invoice_789"
  }
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "ERP API returned 400: Invalid customer ID",
  "message": "Failed to sync invoice to ERP",
  "data": {
    "invoiceId": "clx123...",
    "erpSyncError": "ERP API returned 400: Invalid customer ID",
    "erpSyncAttempts": 3
  }
}
```

**Behavior:**
- On success: Sets `erpSyncedAt` to current timestamp, clears `erpSyncError`
- On failure: Sets `erpSyncError` to error message, does NOT set `erpSyncedAt`
- Always increments `erpSyncAttempts`

---

## Frontend Components

### 1. Invoice List Page

**File:** `app/invoices/page.tsx`

**Features:**
- Paginated table showing all invoices
- Filters:
  - ERP sync status (All / Synced / Not Synced)
  - Invoice status (All / Issued / Paid / Unpaid / Cancelled)
- Real-time sync button on each row
- Color-coded sync status badges:
  - 🟢 Green: Synced successfully
  - 🔴 Red: Sync error (hover to see error message)
  - ⚪ Gray: Not synced yet
- Pagination controls
- Responsive design with Arabic RTL support

**Screenshot:**
```
┌──────────────────────────────────────────────────────────────┐
│  الفواتير                                                     │
│  إدارة ومزامنة فواتير سلة مع نظام ERP                        │
├──────────────────────────────────────────────────────────────┤
│  [حالة المزامنة ▼] [حالة الفاتورة ▼] [تحديث]              │
├──────────────────────────────────────────────────────────────┤
│  Invoice # │ Order # │ Customer │ Total │ Status │ Actions  │
│  INV-001   │ ORD-123 │ Ahmed    │ 600   │ ⚪ غير │ [عرض]    │
│            │         │          │  SAR  │ متزامن │ [مزامنة]  │
│  INV-002   │ ORD-124 │ Fatima   │ 450   │ 🟢 تم  │ [عرض]    │
│            │         │          │  SAR  │المزامنة│ [تمت]    │
└──────────────────────────────────────────────────────────────┘
```

---

### 2. Invoice Detail Page

**File:** `app/invoices/[id]/page.tsx`

**Features:**
- Complete invoice details in organized cards:
  - General information (invoice #, order #, status, dates)
  - Customer information (name, phone, email)
  - Financial breakdown (subtotal, tax, shipping, discount, total)
  - Order items (from rawOrder JSON)
  - Notes
  - System metadata
- ERP sync status banner at top
- Sync button in header
- Collapsible raw JSON data viewer
- Back navigation to invoice list

---

## User Workflow

### Complete User Journey

1. **Access Invoices:**
   - User logs into admin dashboard
   - Clicks "الفواتير" (Invoices) card on homepage
   - Redirected to `/invoices`

2. **View Invoice List:**
   - See paginated table of all invoices
   - Filter by ERP sync status or invoice status
   - Identify unsync'd invoices (gray badge)

3. **Sync Individual Invoice:**
   - Click "مزامنة ERP" (Sync ERP) button
   - Confirm sync action
   - System calls ERP API
   - Badge updates to green (success) or red (error)

4. **View Invoice Details:**
   - Click "عرض" (View) button
   - See full invoice breakdown
   - Review ERP sync status/errors
   - Option to re-sync if needed

5. **Handle Sync Errors:**
   - Identify failed syncs (red badge with attempt count)
   - Hover over error badge to see error message
   - Click into invoice detail for full error text
   - Fix issue in ERP system
   - Click sync button to retry

---

## Setup Instructions

### 1. Database Migration

Already completed! The schema includes:
- `erpSyncedAt` - Timestamp of successful sync
- `erpSyncError` - Error message from failed sync
- `erpSyncAttempts` - Number of sync attempts

### 2. Configure ERP Integration

Edit `app/lib/erp-integration.ts`:

```typescript
// Line 85: Update endpoint
const endpoint = `${erpApiUrl}/invoices`; // Change to your ERP endpoint

// Line 68-78: Configure authentication
if (erpApiKey) {
  headers['Authorization'] = `Bearer ${erpApiKey}`;
  // OR use your ERP's auth header format
}

// Line 25-51: Customize payload structure
export interface ERPInvoicePayload {
  // Update fields to match your ERP's requirements
}
```

### 3. Set Environment Variables

Add to `.env`:
```bash
# Option 1: API Key Authentication
ERP_API_URL=https://your-erp-api.com/api
ERP_API_KEY=your-api-key-here

# Option 2: Basic Authentication
ERP_API_URL=https://your-erp-api.com/api
ERP_API_USERNAME=your-username
ERP_API_PASSWORD=your-password
```

### 4. Test the Integration

1. **Sync invoices from Salla:**
   ```bash
   curl -X POST http://localhost:3000/api/salla/sync-invoices \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
   ```

2. **View invoices:**
   - Navigate to http://localhost:3000/invoices

3. **Test ERP sync:**
   - Click "مزامنة ERP" button on any invoice
   - Check your ERP system to verify invoice was created
   - Verify `erpSyncedAt` is set in database

4. **Test error handling:**
   - Intentionally break ERP API (wrong URL or auth)
   - Click sync button
   - Verify error is captured in `erpSyncError`
   - Fix ERP config and retry

---

## Code Structure

```
app/
├── lib/
│   ├── salla-invoices.ts        # Salla API sync (existing)
│   ├── erp-integration.ts       # ERP sync service (new)
│   ├── salla-oauth.ts           # OAuth handling (existing)
│   └── logger.ts                # Logging (existing)
├── api/
│   ├── invoices/
│   │   ├── route.ts             # GET /api/invoices (new)
│   │   └── [id]/
│   │       ├── route.ts         # GET /api/invoices/[id] (new)
│   │       └── sync-to-erp/
│   │           └── route.ts     # POST /api/invoices/[id]/sync-to-erp (new)
│   └── salla/
│       └── sync-invoices/
│           └── route.ts         # POST /api/salla/sync-invoices (existing)
└── invoices/
    ├── page.tsx                 # Invoice list (new)
    └── [id]/
        └── page.tsx             # Invoice detail (new)

prisma/
└── schema.prisma                # SallaInvoice model (updated)
```

---

## Automation & Scheduling

### Auto-Sync Invoices from Salla

You can set up a cron job to automatically sync invoices:

**Option 1: External Cron Service (Recommended)**

Use a service like cron-job.org or EasyCron:
```bash
# Runs every 6 hours
POST https://your-app.com/api/salla/sync-invoices
Headers:
  Authorization: Bearer YOUR_CRON_SECRET
```

**Option 2: Vercel Cron (if deployed on Vercel)**

Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/salla/sync-invoices",
    "schedule": "0 */6 * * *"
  }]
}
```

### Bulk ERP Sync

To sync all unsync'd invoices in bulk, you can create a new endpoint:

**File:** `app/api/invoices/bulk-sync/route.ts` (optional - not implemented)

```typescript
export async function POST(request: NextRequest) {
  // 1. Fetch all invoices where erpSyncedAt is null
  const unsynced = await prisma.sallaInvoice.findMany({
    where: { erpSyncedAt: null },
    take: 100, // Process 100 at a time
  });

  // 2. Loop and sync each invoice
  for (const invoice of unsynced) {
    await syncInvoiceToERP(invoice);
    // Update database accordingly
  }

  return NextResponse.json({ synced: unsynced.length });
}
```

---

## Troubleshooting

### Issue: ERP sync button disabled

**Cause:** Invoice already synced (`erpSyncedAt` is set)

**Solution:**
- Invoices can only be synced once by default
- To allow re-sync, modify `app/invoices/page.tsx` line 165:
  ```typescript
  disabled={syncing[invoice.id]} // Remove: || !!invoice.erpSyncedAt
  ```

### Issue: "ERP_API_URL environment variable is not configured"

**Cause:** Missing environment variable

**Solution:** Add to `.env`:
```bash
ERP_API_URL=https://your-erp-api.com/api
```

### Issue: ERP sync returns 401 Unauthorized

**Cause:** Authentication misconfigured

**Solution:**
1. Check `ERP_API_KEY` or `ERP_API_USERNAME`/`ERP_API_PASSWORD` in `.env`
2. Verify auth header format in `app/lib/erp-integration.ts` line 68
3. Test ERP API directly with curl to confirm credentials work

### Issue: Sync succeeds but invoice not in ERP

**Cause:** Response parsing issue

**Solution:**
1. Check `app/lib/erp-integration.ts` line 99
2. Update success detection logic:
   ```typescript
   if (!response.ok) {
     // Check your ERP's error response format
   }
   ```

---

## Performance Considerations

### Database Queries

- **Indexes:** Already optimized with indexes on:
  - `(merchantId, invoiceId)` - Unique constraint
  - `(merchantId, status)` - Status filtering
  - `(merchantId, erpSyncedAt)` - ERP sync filtering

### API Rate Limiting

- Salla API: Rate limits apply (check Salla docs)
- ERP API: Implement retry with exponential backoff if needed

### Pagination

- Default: 20 invoices per page
- Max: 100 invoices per page
- Adjust in `app/invoices/page.tsx` line 66

---

## Security

### Authentication

- Frontend pages: Require authentication via NextAuth
- API endpoints: No auth by default (add if needed)

### Data Protection

- Sensitive data stored in environment variables
- Raw invoice JSON stored for audit trail
- HTTPS required for production

---

## Future Enhancements

1. **Batch Sync:** Bulk sync all unsync'd invoices
2. **Webhooks:** Real-time invoice sync via Salla webhooks
3. **Retry Queue:** Auto-retry failed syncs with exponential backoff
4. **Export:** CSV/Excel export of invoice list
5. **Advanced Filters:** Date range picker, customer search
6. **Dashboard:** Statistics (total synced, errors, pending)
7. **Notifications:** Email alerts for sync failures
8. **Multi-Merchant:** Merchant selector in UI

---

## Support

For questions or issues:
1. Check logs in console/terminal
2. Review `erpSyncError` field in database
3. Test ERP API independently with Postman/curl
4. Verify environment variables are loaded

---

## Summary

✅ **Completed:**
- Database schema with ERP tracking fields
- Invoice list page with filtering and pagination
- Invoice detail page with full data display
- ERP sync integration service
- API endpoints for fetching and syncing
- Navigation integration in home page
- Error handling and retry tracking

🎯 **Next Steps:**
1. Configure your ERP API credentials in `.env`
2. Customize `app/lib/erp-integration.ts` for your ERP system
3. Test sync with one invoice
4. Deploy and monitor sync success rate

---

**End of Documentation**
