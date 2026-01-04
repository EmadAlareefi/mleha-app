# Salla Shipment Webhook Setup (Correct Implementation)

This guide explains how to automatically print shipping labels when Salla creates shipments.

## How It Works

When you click "انشاء شحنة" (Create Shipment):

1. ✅ **Your app** calls Salla's `/orders/actions` API with `create_shipping_policy`
2. ✅ **Salla** creates the shipment with your configured courier (SMSA/Aramex/DHL)
3. ✅ **Salla** generates tracking number and shipping label PDF
4. ✅ **Salla** fires `order.shipment.created` webhook to your server
5. ✅ **Your webhook** receives shipment data including label URL
6. ✅ **Your webhook** stores tracking info in database
7. ✅ **Your webhook** sends label PDF URL to PrintNode
8. ✅ **PrintNode** prints the label on device 75006700
9. ✅ **Your app** fetches tracking number from database and displays it

## Key Point

**Salla creates the shipment**, not you! You just need to:
- Trigger the creation via API
- Receive the webhook with shipment details
- Print the label PDF that Salla provides

## Webhook Endpoint

**URL:** `https://your-domain.com/api/webhooks/salla/shipment-created`

**Method:** POST

**Event:** `order.shipment.created`

## Webhook Payload Example

```json
{
  "event": "order.shipment.created",
  "merchant": "123456789",
  "created_at": "2025-01-15T10:30:00Z",
  "data": {
    "reference_id": "ORD-123456",
    "status": {
      "name": "processing"
    },
    "shipping": {
      "company": "SMSA Express",
      "shipment_reference": "SMSA123456789",
      "shipment": {
        "id": "12345",
        "tracking_link": "https://track.smsaexpress.com/...",
        "label": {
          "url": "https://cdn.salla.sa/labels/shipment-12345.pdf"
        }
      },
      "receiver": {
        "name": "Ahmed Ali",
        "phone": "966501234567"
      },
      "address": {
        "city": "Riyadh"
      }
    }
  }
}
```

## Database Schema

Your `SallaShipment` model stores:

```typescript
{
  id: string
  merchantId: string
  orderId: string
  orderNumber: string
  trackingNumber: string  // From tracking_link
  courierName: string     // From shipping.company
  courierCode: string     // Normalized courier name
  status: string          // From status.name
  shipmentData: {
    shipment_id: string
    tracking_link: string
    label_url: string     // PDF URL for printing
    receiver_name: string
    receiver_phone: string
    city: string
    shipment_reference: string
    raw_payload: object
  }
}
```

## PrintNode Configuration

Already configured in `app/lib/printnode.ts`:
- **Device ID:** 75006700
- **API Key:** qnwXXDzp3JhLS5w1bBWy_F9aIWZgSys1LtMNN4tQcbU
- **Content Type:** `pdf_uri` (prints PDF from URL)

## Registering the Webhook

### Option 1: Salla Partners Dashboard

1. Go to [Salla Partners Portal](https://s.salla.sa/partners)
2. Navigate to your app → Webhooks
3. Add webhook:
   - **Event:** `order.shipment.created`
   - **URL:** `https://your-domain.com/api/webhooks/salla/shipment-created`
   - **Active:** Yes

### Option 2: Via API

```bash
POST https://api.salla.sa/admin/v2/webhooks
Authorization: Bearer {merchant_access_token}
Content-Type: application/json

{
  "name": "Shipment Created - Auto Print",
  "url": "https://your-domain.com/api/webhooks/salla/shipment-created",
  "event": "order.shipment.created"
}
```

## Testing

### 1. Local Testing with ngrok

```bash
# Start ngrok
ngrok http 3000

# Register webhook with ngrok URL
# https://abc123.ngrok.io/api/webhooks/salla/shipment-created
```

### 2. Test the Flow

1. Open your order-prep page
2. Click "انشاء شحنة" on an order
3. Check server logs:
   ```
   ✅ Create shipment request received
   ✅ Creating shipping policy via Salla
   ✅ Salla API response received
   ✅ Received shipment.created webhook from Salla
   ✅ Sending label to PrintNode
   ✅ Label sent to PrintNode successfully
   ```
4. Verify label prints on device 75006700
5. Check tracking number appears in UI

### 3. Manual Webhook Test

```bash
curl -X POST http://localhost:3000/api/webhooks/salla/shipment-created \
  -H "Content-Type: application/json" \
  -d '{
    "event": "order.shipment.created",
    "merchant": "test",
    "data": {
      "reference_id": "TEST-001",
      "status": {"name": "processing"},
      "shipping": {
        "company": "SMSA Express",
        "shipment": {
          "id": "test123",
          "tracking_link": "https://track.test.com/123",
          "label": {
            "url": "https://example.com/label.pdf"
          }
        },
        "receiver": {"name": "Test User", "phone": "966500000000"},
        "address": {"city": "Riyadh"}
      }
    }
  }'
```

## Troubleshooting

### Webhook Not Firing

1. **Check webhook registration:**
   ```bash
   GET https://api.salla.sa/admin/v2/webhooks
   ```

2. **Verify URL is accessible:**
   ```bash
   curl -I https://your-domain.com/api/webhooks/salla/shipment-created
   ```

3. **Check Salla webhook logs** in Partners Portal

### Label Not Printing

1. **Check webhook logs:**
   - Verify `label.url` is present in payload
   - Check PrintNode API response

2. **Test PrintNode directly:**
   ```bash
   curl -X POST https://api.printnode.com/printjobs \
     -u qnwXXDzp3JhLS5w1bBWy_F9aIWZgSys1LtMNN4tQcbU: \
     -H "Content-Type: application/json" \
     -d '{
       "printerId": 75006700,
       "title": "Test Label",
       "contentType": "pdf_uri",
       "content": "https://example.com/label.pdf"
     }'
   ```

3. **Verify device online:**
   ```bash
   curl https://api.printnode.com/computers/75006700 \
     -u qnwXXDzp3JhLS5w1bBWy_F9aIWZgSys1LtMNN4tQcbU:
   ```

### Tracking Number Not Showing

1. **Check database:**
   ```sql
   SELECT * FROM "SallaShipment"
   WHERE "orderNumber" = 'ORD-123456';
   ```

2. **Increase wait time** in create-shipment endpoint (currently 3 seconds)

3. **Check webhook processing time** in logs

## Monitoring

### Database Queries

```sql
-- Recent shipments
SELECT
  "orderNumber",
  "courierName",
  "trackingNumber",
  "status",
  "createdAt"
FROM "SallaShipment"
ORDER BY "createdAt" DESC
LIMIT 10;

-- Shipments with labels
SELECT
  "orderNumber",
  "shipmentData"->>'label_url' as label_url,
  "createdAt"
FROM "SallaShipment"
WHERE "shipmentData"->>'label_url' IS NOT NULL
ORDER BY "createdAt" DESC
LIMIT 10;

-- Orders without shipments (potential issues)
SELECT
  oa."orderNumber",
  oa."status",
  oa."completedAt"
FROM "OrderAssignment" oa
LEFT JOIN "SallaShipment" ss ON oa."orderId" = ss."orderId"
WHERE oa.status = 'shipped'
  AND ss.id IS NULL
ORDER BY oa."completedAt" DESC;
```

## Files Structure

```
app/
├── api/
│   ├── salla/
│   │   └── create-shipment/
│   │       └── route.ts          # Calls Salla's create_shipping_policy
│   └── webhooks/
│       └── salla/
│           └── shipment-created/
│               └── route.ts      # Receives webhook, prints label
├── lib/
│   └── printnode.ts              # PrintNode integration
└── order-prep/
    └── page.tsx                  # Order prep UI

prisma/
└── schema.prisma                 # SallaShipment model
```

## Flow Diagram

```
┌─────────────────┐
│  User clicks    │
│  "انشاء شحنة"  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  /api/salla/create-shipment │
│  POST /orders/actions       │
│  {create_shipping_policy}   │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Salla Platform             │
│  - Creates shipment         │
│  - Calls SMSA/Aramex/DHL    │
│  - Gets tracking number     │
│  - Generates label PDF      │
└────────┬────────────────────┘
         │
         │ Fires webhook
         ▼
┌──────────────────────────────┐
│  /api/webhooks/salla/        │
│  shipment-created            │
│  - Receives shipment data    │
│  - Stores in database        │
│  - Sends PDF to PrintNode    │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  PrintNode                  │
│  - Receives PDF URL         │
│  - Prints to device 75006700│
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Label printed! ✅          │
└─────────────────────────────┘
```

## Important Notes

1. **No SMSA API needed** - Salla handles courier integration
2. **No manual shipment creation** - Salla creates it for you
3. **Just print the PDF** - Label URL comes from Salla webhook
4. **Automatic process** - Everything happens on webhook receive

## Next Steps

1. ✅ Webhook endpoint created
2. ✅ Database schema ready
3. ✅ PrintNode configured
4. 🔲 Register webhook in Salla Partners Portal
5. 🔲 Test with real order
6. 🔲 Verify label prints correctly

---

**Last Updated:** 2025-12-14
