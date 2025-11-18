# Salla OAuth Scopes Configuration

## Required Scopes for Full Functionality

The application requires the following OAuth scopes from Salla to function properly:

### 1. **Orders Management** (Currently Active)
- Required for: Fetching order details, order items, customer information
- Scope: `offline_access` (basic order access)
- Status: ✅ Active

### 2. **Marketing/Coupons Management** (Required for Auto-Coupon Creation)
- Required for: Auto-creating coupon codes for exchange requests
- Scope: `marketing.read_write`
- Status: ⚠️ **Not Currently Active**

## How to Add Marketing Scope

To enable automatic coupon creation for exchanges, you need to request the `marketing.read_write` scope during OAuth authorization:

### Option 1: Update OAuth Authorization URL (Recommended)

When redirecting users to Salla for authorization, include the marketing scope in your authorization URL:

```
https://accounts.salla.sa/oauth2/authorize?
  client_id=YOUR_CLIENT_ID
  &redirect_uri=YOUR_REDIRECT_URI
  &response_type=code
  &scope=offline_access,marketing.read_write
```

### Option 2: Re-authorize the Application

1. Navigate to your Salla App settings
2. Update the requested scopes to include `marketing.read_write`
3. Ask the merchant to re-authorize the app
4. New tokens will include the marketing scope

## Workaround: Manual Coupon Entry

Until the marketing scope is added, the system provides a manual workaround:

1. Admin clicks "إنشاء كوبون" button
2. System attempts auto-creation
3. If permission error occurs, shows a prompt:
   - Asks admin to create coupon manually in Salla dashboard
   - Displays the suggested coupon amount
   - Allows admin to enter the manually-created coupon code
4. Coupon code is saved to the return request

## Testing Scopes

To check which scopes are currently active for a merchant:

```bash
# Check the scope field in SallaAuth table
SELECT merchantId, scope, expiresAt FROM SallaAuth;
```

The `scope` field should include `marketing.read_write` for auto-coupon creation to work.

## Error Messages

- **Auto-creation fails with 401 Unauthorized**: Missing `marketing.read_write` scope
- Error in logs: `The access token should have access to one of those scopes: marketing.read_write`
- User-facing message: `صلاحيات غير كافية. يتطلب إنشاء الكوبونات صلاحية marketing.read_write من سلة`

## References

- [Salla OAuth Documentation](https://docs.salla.dev/docs/merchant/openapi.json/paths/~1oauth2~1token/post)
- [Salla Coupons API](https://docs.salla.dev/docs/merchant/openapi.json/paths/~1coupons/post)
