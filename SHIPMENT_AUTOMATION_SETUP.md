# Automated Shipment Creation Setup

This guide explains how to configure and use the automated shipment creation feature in the order preparation workflow.

## Overview

The automated shipment creation feature allows warehouse staff to create shipments directly from the order preparation screen with a single click, eliminating the need to manually open Salla admin and create shipments there.

## Features

- ✅ **One-click shipment creation** - Create shipments directly from order prep screen
- ✅ **Automatic data extraction** - Customer address, order items, and payment method automatically populated
- ✅ **COD handling** - Automatically sets cash on delivery amount for COD orders
- ✅ **Tracking number storage** - Tracking numbers automatically saved to database
- ✅ **Visual feedback** - Shows success message with tracking number and courier name
- ✅ **Error handling** - Clear error messages if shipment creation fails

## Configuration

### 1. Find Your Courier ID

You need to configure the default courier (shipping company) ID from your Salla account:

1. Log into your **Salla Merchant Dashboard**: https://s.salla.sa
2. Go to **Settings** → **Shipping Settings**
3. View your active shipping companies
4. Note the courier ID (visible in URL or API response)

**Common Courier IDs** (these may vary per merchant):
- SMSA: `1927161457`
- Aramex: Check your Salla settings
- DHL: Check your Salla settings

### 2. Set Environment Variable

Add the courier ID to your `.env` file:

```bash
SALLA_DEFAULT_COURIER_ID="1927161457"
```

Replace `1927161457` with your actual courier ID.

### 3. Restart Application

After updating the `.env` file, restart your application:

```bash
npm run dev
# or in production
pm2 restart your-app
```

## How It Works

### API Endpoint

**POST** `/api/salla/create-shipment`

**Request Body:**
```json
{
  "assignmentId": "cm1234567890",
  "courierId": 1927161457  // Optional - uses SALLA_DEFAULT_COURIER_ID if not provided
}
```

**Success Response:**
```json
{
  "success": true,
  "message": "تم إنشاء الشحنة بنجاح",
  "data": {
    "shipmentId": 987654321,
    "trackingNumber": "918273645",
    "courierName": "SMSA",
    "status": "created"
  }
}
```

### Data Mapping

The system automatically extracts and maps order data to Salla shipment API:

| Order Data | Shipment Field | Notes |
|------------|----------------|-------|
| `order.id` | `order_id` | Links shipment to order |
| `customer.first_name + last_name` | `ship_to.name` | Recipient name |
| `customer.mobile` | `ship_to.phone` | Contact number |
| `customer.email` | `ship_to.email` | Email address |
| `shipping_address.*` | `ship_to.*` | Full address details |
| `items[].name` | `packages[].name` | Product names |
| `items[].sku` | `packages[].sku` | Product SKUs |
| `items[].quantity` | `packages[].quantity` | Item quantities |
| `items[].price` | `packages[].price` | Item prices |
| `items[].weight` | `packages[].weight` | Package weights |
| `payment_method` | `payment_method` | COD or pre_paid |
| `total_amount` | `cash_on_delivery.amount` | For COD orders |

### Service Types

The shipment is automatically tagged with:
- `fulfillment` - Marks it as a fulfillment order
- `normal` - Standard shipping service

## User Interface

### Order Preparation Screen

1. **Before Shipment Creation:**
   - Button shows: **"انشاء شحنة"** (Create Shipment)
   - Button is blue and clickable

2. **During Shipment Creation:**
   - Button shows: **"جاري إنشاء الشحنة..."** (Creating Shipment...)
   - Button is disabled and gray

3. **After Successful Creation:**
   - Success alert appears with tracking number and courier name
   - Green card displays:
     - ✅ **تم إنشاء الشحنة** (Shipment Created)
     - **رقم التتبع:** Tracking number
     - **شركة الشحن:** Courier name
   - Button shows: **"✓ تم إنشاء الشحنة"** (Shipment Created)
   - Button is disabled (can't create duplicate shipments)

4. **When Moving to Next Order:**
   - Shipment info resets
   - Button becomes active again for new order

## Workflow Integration

### Updated Order Preparation Flow

```
1. Order Assigned
   ↓
2. User Views Order Details
   ↓
3. User Gathers Products from Warehouse
   ↓
4. User Clicks "انشاء شحنة" (Create Shipment)
   ↓
5. System Creates Shipment via Salla API
   ↓
6. Tracking Number Displayed
   ↓
7. User Clicks "إنهاء الطلب" (Complete Order)
   ↓
8. Order Archived to History
   ↓
9. Next Order Auto-Assigned
```

## Database Updates

When a shipment is created successfully, the system updates:

### `SallaOrder` Table
```sql
UPDATE SallaOrder
SET
  trackingNumber = '918273645',
  fulfillmentCompany = 'SMSA'
WHERE merchantId = ? AND orderId = ?
```

This ensures tracking information is stored for future reference and reporting.

## Troubleshooting

### Error: "لم يتم تحديد شركة الشحن"
**Problem:** Courier ID not configured

**Solution:**
1. Add `SALLA_DEFAULT_COURIER_ID` to `.env` file
2. Restart application

### Error: "فشل إنشاء الشحنة"
**Possible Causes:**
1. **Invalid courier ID** - Verify the courier ID matches your Salla account
2. **Missing address data** - Check that order has complete shipping address
3. **Invalid token** - Salla access token may have expired (should auto-refresh)
4. **Missing scope** - Ensure Salla app has `shipping.read_write` scope

**Solutions:**
- Check application logs for detailed error messages
- Verify order data includes shipping address
- Check Salla OAuth configuration
- Refresh Salla tokens manually if needed

### Error: Validation Error from Salla API
**Problem:** Required fields missing or invalid format

**Common Issues:**
- Missing phone number
- Invalid country/city ID
- Package weight = 0 (defaults to 0.5kg)
- Empty packages array

**Solution:**
- Check order data completeness in OrderAssignment
- Use "تحديث المنتجات" (Refresh Items) button to reload order data
- Verify order has items with SKUs

## API Scope Requirements

Ensure your Salla app has the following OAuth scope:

```
shipping.read_write
```

This scope is required to create shipments via the Salla API.

## Advanced Configuration

### Per-Order Courier Selection

If you need different couriers for different orders, you can pass `courierId` in the API request:

```javascript
const response = await fetch('/api/salla/create-shipment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    assignmentId: currentOrder.id,
    courierId: 1234567890  // Override default courier
  }),
});
```

### Custom Service Types

To modify service types, edit `/app/api/salla/create-shipment/route.ts`:

```typescript
service_types: ['fulfillment', 'express', 'cold'],  // Customize as needed
```

Available service types:
- `domestic` - Domestic shipping
- `international` - International shipping
- `normal` - Standard service
- `fulfillment` - Fulfillment orders
- `heavy` - Heavy items
- `express` - Express delivery
- `cash_on_delivery` - COD orders
- `cold` - Cold chain delivery

## Benefits

1. **Time Savings** - No need to switch to Salla admin
2. **Reduced Errors** - Automatic data entry eliminates manual typos
3. **Better Tracking** - Tracking numbers automatically stored
4. **Improved Workflow** - Seamless preparation-to-shipment process
5. **Audit Trail** - All shipment creations logged in database

## Related Documentation

- [Salla Shipment API Documentation](https://docs.salla.dev/5394231e0)
- [Order Preparation Workflow](./ORDER_WORKFLOW.md)
- [Salla OAuth Setup](./SALLA_OAUTH_SETUP.md)

## Support

If you encounter issues:

1. Check application logs for detailed error messages
2. Verify `.env` configuration
3. Test with Salla API documentation examples
4. Review Salla merchant dashboard for courier settings
5. Contact Salla support for API-specific issues
