# PrintNode Auto-Print Integration for Salla Shipments

## What Was Implemented

Automatic printing of shipping labels to PrintNode device **75006700** when shipments are created in Salla.

## How It Works

```
User clicks "انشاء شحنة"
  → Salla creates shipment with courier (SMSA/Aramex/DHL)
  → Salla fires webhook with label PDF URL
  → Your server sends PDF to PrintNode
  → Label prints automatically ✅
```

## Files Modified/Created

### New Files
- `app/api/webhooks/salla/shipment-created/route.ts` - Webhook handler
- `app/lib/printnode.ts` - PrintNode API integration
- `SHIPMENT_WEBHOOK_SETUP.md` - Complete documentation

### Modified Files
- `app/order-prep/page.tsx` - Removed manual printing (webhook handles it)
- `app/api/salla/create-shipment/route.ts` - Waits for webhook to process
- `prisma/schema.prisma` - Added `SallaShipment` model

### Database
- ✅ `SallaShipment` table created (stores tracking numbers and label URLs)

## Setup Required

### 1. Register Webhook

**URL:** `https://your-domain.com/api/webhooks/salla/shipment-created`

**Event:** `order.shipment.created`

Register at: https://s.salla.sa/partners → Your App → Webhooks

### 2. Configuration

PrintNode is already configured:
- **Device ID:** 75006700
- **API Key:** qnwXXDzp3JhLS5w1bBWy_F9aIWZgSys1LtMNN4tQcbU

No additional environment variables needed!

## Testing

### 1. Local Testing

```bash
# Start ngrok
ngrok http 3000

# Register webhook with ngrok URL
# https://abc123.ngrok.io/api/webhooks/salla/shipment-created
```

### 2. Test Flow

1. Go to order-prep page
2. Click "انشاء شحنة" on any order
3. Label should print automatically
4. Tracking number appears in UI

### 3. Check Logs

```bash
# Should see:
✅ Received shipment.created webhook from Salla
✅ Sending label to PrintNode
✅ Label sent to PrintNode successfully
```

## What Happens When You Click "انشاء شحنة"

1. **API call** to `/api/salla/create-shipment`
2. **Salla creates** shipment with your courier
3. **Webhook fires** to `/api/webhooks/salla/shipment-created`
4. **Webhook stores** tracking info in database
5. **Webhook sends** label PDF to PrintNode
6. **PrintNode prints** label on device 75006700
7. **UI shows** tracking number

## Monitoring

### Check Recent Shipments

```sql
SELECT
  "orderNumber",
  "courierName",
  "trackingNumber",
  "createdAt"
FROM "SallaShipment"
ORDER BY "createdAt" DESC
LIMIT 10;
```

### Check Printed Labels

```sql
SELECT
  "orderNumber",
  "shipmentData"->>'label_url' as pdf_url,
  "createdAt"
FROM "SallaShipment"
WHERE "shipmentData"->>'label_url' IS NOT NULL
ORDER BY "createdAt" DESC;
```

## Troubleshooting

### Label Not Printing?

1. **Check webhook received:**
   - Look for log: `Received shipment.created webhook`

2. **Check label URL exists:**
   ```sql
   SELECT "shipmentData"->>'label_url'
   FROM "SallaShipment"
   WHERE "orderNumber" = 'YOUR-ORDER';
   ```

3. **Test PrintNode:**
   ```bash
   curl -X POST https://api.printnode.com/printjobs \
     -u qnwXXDzp3JhLS5w1bBWy_F9aIWZgSys1LtMNN4tQcbU: \
     -H "Content-Type: application/json" \
     -d '{
       "printerId": 75006700,
       "title": "Test",
       "contentType": "pdf_uri",
       "content": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
     }'
   ```

### Tracking Number Not Showing?

The endpoint waits 3 seconds for webhook. If still not showing:

1. **Check webhook processed:**
   ```sql
   SELECT * FROM "SallaShipment" WHERE "orderNumber" = 'YOUR-ORDER';
   ```

2. **Increase wait time** in `app/api/salla/create-shipment/route.ts`:
   ```typescript
   await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
   ```

## Important Notes

- ✅ Salla creates the shipment (not you)
- ✅ Salla provides the label PDF URL
- ✅ You just print the PDF automatically
- ✅ No SMSA API credentials needed
- ✅ Works with any courier (SMSA/Aramex/DHL)

## Next Steps

1. Register webhook in Salla Partners Portal
2. Test with a real order
3. Verify label prints correctly
4. Monitor for any issues

---

**Need Help?**

See full documentation in `SHIPMENT_WEBHOOK_SETUP.md`

**Last Updated:** 2025-12-14
