# Invoices & ERP Integration - Quick Start Guide

## What Was Built

A complete invoice management system that:
1. ✅ Displays Salla invoices in a table with filters
2. ✅ Allows you to sync invoices to your ERP system with one button click
3. ✅ Tracks sync status (synced, pending, failed) with error messages
4. ✅ Shows detailed invoice information including customer data and amounts

---

## How to Use

### 1. Access the Invoices Page

1. Open your app and log in
2. On the home page, click **"الفواتير"** (Invoices) card
3. You'll see a list of all synced invoices from Salla

### 2. View and Filter Invoices

**Filters Available:**
- **حالة المزامنة مع ERP** (ERP Sync Status):
  - الكل (All)
  - تم المزامنة (Synced)
  - غير متزامن (Not Synced)

- **حالة الفاتورة** (Invoice Status):
  - الكل (All)
  - صادرة (Issued)
  - مدفوعة (Paid)
  - غير مدفوعة (Unpaid)
  - ملغاة (Cancelled)

**Actions:**
- Click **"تحديث"** (Refresh) to reload the list
- Use pagination buttons to navigate pages

### 3. Sync an Invoice to ERP

1. Find an invoice with status: **"غير متزامن"** (Not Synced) - Gray badge
2. Click the **"مزامنة ERP"** button on that row
3. Confirm the action
4. Wait for sync to complete
5. Status badge will change to:
   - 🟢 **"تم المزامنة"** (Synced) - Green badge = Success
   - 🔴 **"خطأ"** (Error) - Red badge = Failed (hover to see error)

### 4. View Invoice Details

1. Click **"عرض"** (View) button on any invoice row
2. You'll see:
   - General information (invoice number, dates, status)
   - Customer details (name, phone, email)
   - Financial breakdown (subtotal, tax, shipping, total)
   - Order items (if available)
   - ERP sync status and error messages
   - Raw JSON data (collapsible)
3. You can also sync the invoice from this detail page

---

## Setup ERP Integration (Required)

### Step 1: Add Environment Variables

Create or edit your `.env` file and add:

```bash
# Your ERP API URL
ERP_API_URL=https://your-erp-system.com/api

# Option 1: API Key Authentication (recommended)
ERP_API_KEY=your-api-key-here

# Option 2: Basic Authentication (if your ERP uses username/password)
ERP_API_USERNAME=your-username
ERP_API_PASSWORD=your-password
```

**Example for common ERP systems:**

```bash
# Odoo ERP
ERP_API_URL=https://yourcompany.odoo.com/api
ERP_API_KEY=your-odoo-api-key

# SAP Business One
ERP_API_URL=https://your-sap-server.com/b1s/v1
ERP_API_USERNAME=manager
ERP_API_PASSWORD=your-password

# QuickBooks
ERP_API_URL=https://sandbox-quickbooks.api.intuit.com/v3
ERP_API_KEY=your-quickbooks-token

# Custom ERP
ERP_API_URL=http://localhost:8080/api
ERP_API_KEY=your-custom-api-key
```

### Step 2: Customize the ERP Integration Code

Open `app/lib/erp-integration.ts` and customize:

#### A. Update the API Endpoint (Line 85)

```typescript
// Change this line to match your ERP's invoice endpoint
const endpoint = `${erpApiUrl}/invoices`;

// Examples:
// Odoo: const endpoint = `${erpApiUrl}/account.move`;
// SAP: const endpoint = `${erpApiUrl}/Invoices`;
// QuickBooks: const endpoint = `${erpApiUrl}/company/${companyId}/invoice`;
```

#### B. Update Authentication Headers (Lines 68-78)

**For Bearer Token:**
```typescript
headers['Authorization'] = `Bearer ${erpApiKey}`;
```

**For API Key in Custom Header:**
```typescript
headers['X-API-Key'] = erpApiKey;
```

**For Basic Auth:**
```typescript
const credentials = Buffer.from(
  `${process.env.ERP_API_USERNAME}:${process.env.ERP_API_PASSWORD}`
).toString('base64');
headers['Authorization'] = `Basic ${credentials}`;
```

#### C. Customize Invoice Payload (Lines 25-51)

Update the `ERPInvoicePayload` interface to match your ERP's expected format:

```typescript
// Example for Odoo
export interface ERPInvoicePayload {
  partner_id: number;      // Customer ID
  invoice_date: string;
  invoice_line_ids: Array<{
    product_id: number;
    quantity: number;
    price_unit: number;
  }>;
}

// Example for SAP B1
export interface ERPInvoicePayload {
  CardCode: string;        // Customer code
  DocDate: string;
  DocumentLines: Array<{
    ItemCode: string;
    Quantity: number;
    UnitPrice: number;
  }>;
}
```

Then update `transformInvoiceToERPPayload()` function to create this format.

### Step 3: Test the Integration

1. **Start your app:**
   ```bash
   npm run dev
   ```

2. **Sync one test invoice:**
   - Go to http://localhost:3000/invoices
   - Click "مزامنة ERP" on any invoice
   - Check the result

3. **Verify in your ERP:**
   - Log into your ERP system
   - Check if the invoice was created
   - Verify all data is correct

4. **Check for errors:**
   - If sync fails, hover over the red error badge
   - Fix the issue in `erp-integration.ts`
   - Click sync again to retry

---

## Common ERP Integration Examples

### Example 1: Odoo ERP

**Environment Variables:**
```bash
ERP_API_URL=https://yourcompany.odoo.com/api/v1
ERP_API_KEY=your-odoo-access-token
```

**Code Changes in `erp-integration.ts`:**
```typescript
const endpoint = `${erpApiUrl}/account.move`;

const payload = {
  partner_id: invoice.customerId,
  move_type: 'out_invoice',
  invoice_date: invoice.issueDate,
  invoice_line_ids: [
    [0, 0, {
      name: `Invoice ${invoice.invoiceNumber}`,
      price_unit: Number(invoice.totalAmount),
      quantity: 1,
    }]
  ],
};
```

### Example 2: SAP Business One

**Environment Variables:**
```bash
ERP_API_URL=https://your-sap-server:50000/b1s/v1
ERP_API_USERNAME=manager
ERP_API_PASSWORD=your-password
```

**Code Changes in `erp-integration.ts`:**
```typescript
const endpoint = `${erpApiUrl}/Invoices`;

const payload = {
  CardCode: invoice.customerId,
  DocDate: invoice.issueDate?.toISOString().split('T')[0],
  DocDueDate: invoice.dueDate?.toISOString().split('T')[0],
  DocumentLines: [
    {
      ItemDescription: `Order ${invoice.orderNumber}`,
      Quantity: 1,
      Price: Number(invoice.totalAmount),
      TaxCode: 'VAT15',
    }
  ],
};
```

### Example 3: QuickBooks Online

**Environment Variables:**
```bash
ERP_API_URL=https://quickbooks.api.intuit.com/v3
ERP_API_KEY=your-oauth-access-token
```

**Code Changes in `erp-integration.ts`:**
```typescript
const companyId = process.env.QUICKBOOKS_COMPANY_ID;
const endpoint = `${erpApiUrl}/company/${companyId}/invoice`;

const payload = {
  CustomerRef: {
    value: invoice.customerId,
  },
  Line: [
    {
      Amount: Number(invoice.totalAmount),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: {
          value: "1", // Your QuickBooks item ID
        },
        Qty: 1,
        UnitPrice: Number(invoice.totalAmount),
      },
    },
  ],
};
```

---

## Troubleshooting

### Issue: "ERP_API_URL environment variable is not configured"

**Fix:** Add `ERP_API_URL` to your `.env` file and restart the app.

### Issue: Sync button is disabled

**Cause:** Invoice already synced.

**Fix:** Invoices can only be synced once. To allow re-syncing, edit `app/invoices/page.tsx` line 165 and remove `|| !!invoice.erpSyncedAt`.

### Issue: ERP returns 401 Unauthorized

**Fix:**
1. Check your `ERP_API_KEY` or credentials in `.env`
2. Verify the authentication method in `erp-integration.ts`
3. Test your ERP API with Postman/curl to confirm credentials work

### Issue: Sync succeeds but invoice not created in ERP

**Fix:**
1. Check your ERP's response format
2. Add logging in `erp-integration.ts` to see the full response:
   ```typescript
   const result = await response.json();
   console.log('ERP Response:', result);
   ```
3. Verify the payload format matches your ERP's requirements

### Issue: "Failed to sync invoice to ERP"

**Steps:**
1. Check browser console for detailed error
2. Look at the `erpSyncError` field in the invoice detail page
3. Test your ERP API independently
4. Review `app/lib/erp-integration.ts` for any bugs

---

## Next Steps

1. ✅ Configure your `.env` with ERP credentials
2. ✅ Customize `app/lib/erp-integration.ts` for your ERP
3. ✅ Test with one invoice
4. ✅ Monitor and verify invoices in your ERP system
5. 📊 Set up automatic syncing (optional)
6. 🔔 Set up error notifications (optional)

---

## File Locations

**Frontend:**
- Invoice list: `app/invoices/page.tsx`
- Invoice detail: `app/invoices/[id]/page.tsx`

**Backend:**
- ERP integration: `app/lib/erp-integration.ts` (⚠️ CUSTOMIZE THIS)
- API endpoints: `app/api/invoices/`

**Database:**
- Schema: `prisma/schema.prisma`

**Documentation:**
- Full guide: `INVOICES_IMPLEMENTATION.md`
- This guide: `INVOICES_QUICKSTART.md`

---

## Support

Need help? Check:
1. Error messages in invoice detail page
2. Browser console for frontend errors
3. Server logs for backend errors
4. `INVOICES_IMPLEMENTATION.md` for detailed docs

---

**That's it! You're ready to sync invoices to your ERP. 🎉**
