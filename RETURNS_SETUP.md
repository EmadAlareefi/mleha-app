# Return/Exchange System Setup Guide

This guide explains how to set up and use the Return/Exchange system integrated with Salla and SMSA APIs.

## Overview

The system provides a complete return/exchange workflow:
1. Customer looks up their order by order number
2. Selects items and quantities to return/exchange
3. Provides a reason for the return
4. System creates an SMSA return shipment automatically
5. Stores the return request in the database
6. Shows success screen with tracking numbers

## Features

✅ Salla OAuth integration with automatic token refresh (every 10 days)
✅ SMSA API integration for return shipment creation
✅ Order lookup by order number
✅ Item selection with quantity control
✅ Predefined return reasons + custom reason
✅ Automatic SMSA tracking number generation
✅ Database tracking of all return requests
✅ RTL Arabic interface
✅ Success screen with reference numbers

## Database Schema

### Tables Created

1. **SallaAuth** - Stores OAuth tokens for Salla API
   - Automatic token refresh with mutex locking
   - Tracks expiry and refresh attempts

2. **ReturnRequest** - Stores return/exchange requests
   - Links to Salla orders
   - Tracks SMSA shipment details
   - Status tracking (pending_review, approved, rejected, completed, cancelled)

3. **ReturnItem** - Individual items in a return request
   - Product details
   - Quantity and price

## Environment Variables Setup

Update your `.env` file with the following:

```env
# SMSA API Configuration
SMSA_API_ENVIRONMENT=sandbox
SMSA_API_BASE_URL=https://ecomapis-sandbox.azurewebsites.net/api
SMSA_TEST_API_KEY=556c502d784a49cbb6fb2baf6fb08bfe
SMSA_PRODUCTION_API_KEY=d34118ea30de40dd89e8f56535ab3069
SMSA_SERVICE_CODE=EDCR
SMSA_WAYBILL_TYPE=PDF
# Optional overrides
# SMSA_API_KEY=
# SMSA_RETAIL_ID=

# Cron Job Security
CRON_SECRET=generate_a_secure_random_string_here

# Merchant/Store Configuration for Returns
NEXT_PUBLIC_MERCHANT_ID=your_salla_merchant_id
NEXT_PUBLIC_MERCHANT_NAME=اسم متجرك
NEXT_PUBLIC_MERCHANT_PHONE=0501234567
NEXT_PUBLIC_MERCHANT_ADDRESS=عنوان متجرك أو المستودع
NEXT_PUBLIC_MERCHANT_CITY=الرياض
NEXT_PUBLIC_MERCHANT_LOGO=/logo.png
```

### How to Get the Credentials

#### SMSA Credentials
1. Contact SMSA Express to onboard your account for API access.
2. Download the official docs (`SMSA API DOCS.html` in this repo) for the latest keys and endpoints.
3. Choose the environment you need:

| Environment | Base URL | API Key |
|-------------|----------|---------|
| Sandbox/Test | `https://ecomapis-sandbox.azurewebsites.net` | `556c502d784a49cbb6fb2baf6fb08bfe` |
| Production | `https://ecomapis.smsaexpress.com` | `d34118ea30de40dd89e8f56535ab3069` |

4. Set `SMSA_API_ENVIRONMENT` to `sandbox` or `production` and keep the keys secret.
5. Optionally set `SMSA_RETAIL_ID` if SMSA provided a preferred drop-off branch.

#### Salla OAuth
- Tokens are automatically stored when a merchant authorizes your app
- The webhook at `/app/salla/webhook/route.ts` handles the `app.store.authorize` event
- Tokens auto-refresh every 10 days via cron job

## API Endpoints

### 1. Order Lookup
```
GET /api/orders/lookup?merchantId=XXX&orderNumber=ORD-123
```
Fetches order details from Salla by order number.

### 2. Create Return Request
```
POST /api/returns/create
```
Creates a return request and SMSA shipment.

**Request Body:**
```json
{
  "merchantId": "1234509876",
  "orderId": "12345",
  "type": "return",
  "reason": "defective",
  "reasonDetails": "Optional details",
  "items": [
    {
      "productId": "123",
      "productName": "Product Name",
      "quantity": 1,
      "price": 100
    }
  ],
  "merchantName": "Store Name",
  "merchantPhone": "0501234567",
  "merchantAddress": "Store Address",
  "merchantCity": "Riyadh"
}
```

### 3. Token Refresh (Cron)
```
GET /api/salla/refresh-tokens
Authorization: Bearer {CRON_SECRET}
```
Automatically refreshes expiring Salla tokens.

## Salla Webhook Integration

The system handles the `app.store.authorize` event to store OAuth tokens:

```json
{
  "event": "app.store.authorize",
  "merchant": 1234509876,
  "data": {
    "access_token": "...",
    "refresh_token": "...",
    "expires": 1634819484,
    "scope": "settings.read branches.read offline_access"
  }
}
```

When this webhook is received, tokens are automatically stored in the database.

## Token Refresh System

### Automatic Refresh (Recommended)
- Configured in `vercel.json` to run every 10 days
- Uses Vercel Cron (free on Vercel)
- Refreshes tokens 1 day before expiry (safe margin)

### Manual Refresh
You can manually trigger token refresh:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-domain.com/api/salla/refresh-tokens
```

### Mutex/Locking
The system implements proper locking to prevent parallel token refreshes:
- Uses database flag `isRefreshing`
- 30-second timeout for stale locks
- Automatic retry with exponential backoff

## Frontend Usage

### Access the Return Page
Navigate to: `https://your-domain.com/returns`

### User Flow
1. Enter order number
2. System fetches order from Salla
3. Select items to return/exchange
4. Choose return type (return or exchange)
5. Select reason (defective, wrong item, size issue, changed mind, other)
6. Submit request
7. View success screen with:
   - Return request ID
   - Original order number
   - SMSA tracking number
   - Expected refund amount

## Return Reasons

The system supports these predefined reasons:
- **معيب / تالف** (Defective/Damaged)
- **منتج خاطئ** (Wrong item)
- **مشكلة في المقاس** (Size/fit issue)
- **تغيير في الرأي** (Changed mind)
- **أخرى** (Other - with custom text)

## SMSA Integration Details

### Shipment Creation
When a return is created:
1. Customer details are used as sender (return origin)
2. Merchant details are used as receiver (return destination)
3. Shipment type is set to 'RET' (Return)
4. Weight is estimated as 0.5 kg per item
5. Order reference is included for tracking

### Tracking
The SMSA AWB (Airway Bill) number is:
- Stored in the database
- Displayed on success screen
- Can be used to track shipment on SMSA website

## Security Considerations

1. **Webhook Signature Verification**
   - All Salla webhooks are verified using HMAC SHA-256
   - Configured in `SALLA_WEBHOOK_SECRET`

2. **Cron Job Protection**
   - Token refresh endpoint requires `CRON_SECRET`
   - Prevents unauthorized token refresh attempts

3. **Token Security**
   - Tokens stored encrypted in database
   - Mutex locking prevents token theft via parallel requests
   - Single-use refresh tokens (as per Salla spec)

## Testing

### Test the Order Lookup
1. Get a valid order number from your Salla store
2. Make sure the merchant has authorized your app
3. Navigate to `/returns`
4. Enter the order number

### Test SMSA Integration
Before going live, make sure to:
1. Verify SMSA credentials work
2. Test with sandbox environment first
3. Confirm tracking numbers are generated correctly

### Test Token Refresh
```bash
# Manually trigger token refresh
curl -X GET http://localhost:3000/api/salla/refresh-tokens \
  -H "Authorization: Bearer your_cron_secret"
```

## Deployment Checklist

- [ ] Update all environment variables in Vercel
- [ ] Set real SMSA credentials (not sandbox)
- [ ] Set real merchant information
- [ ] Generate strong CRON_SECRET
- [ ] Configure Salla webhook URL
- [ ] Test merchant authorization flow
- [ ] Verify Vercel Cron is enabled
- [ ] Test end-to-end return flow
- [ ] Set up monitoring/alerts for failed token refreshes

## Monitoring

### Check Token Status
Query the database:
```sql
SELECT merchantId, expiresAt, lastRefreshedAt, refreshAttempts, isRefreshing
FROM SallaAuth;
```

### Check Return Requests
```sql
SELECT id, orderNumber, type, status, smsaTrackingNumber, createdAt
FROM ReturnRequest
ORDER BY createdAt DESC;
```

### Logs
All operations are logged using the structured logger:
- Token refresh events
- SMSA API calls
- Return request creation
- Errors and warnings

## Troubleshooting

### "No valid access token available"
- Check if merchant has authorized the app
- Verify tokens haven't expired (check `SallaAuth` table)
- Try manual token refresh

### "SMSA API error"
- Verify SMSA credentials are correct
- Check if SMSA API is accessible
- Review SMSA account status

### "Order not found"
- Ensure order number is correct
- Verify merchant ID matches
- Check if order exists in Salla

### Token refresh fails
- Check `isRefreshing` flag isn't stuck (run for >30 seconds)
- Verify refresh token hasn't been reused
- May need merchant to re-authorize app

## Support

For issues or questions:
1. Check the logs in Vercel dashboard
2. Review database tables for stuck states
3. Verify all environment variables are set correctly
4. Test API endpoints individually

## Next Steps

Optional enhancements you can add:
- Email notifications for return status updates
- Admin dashboard to manage returns
- Integration with Salla API to update order status
- Barcode printing for return labels
- Return analytics and reporting
- WhatsApp notifications using existing Zoko integration
