# SMSA API Setup Guide

## Current Issue: 401 Unauthorized Error

The application is receiving a **401 Unauthorized** error when trying to create return shipments with SMSA. This indicates an authentication problem.

**Root Cause Identified:** The sandbox test API key (`556c502d784a49cbb6fb2baf6fb08bfe`) likely does not have C2B (return shipment) permissions. This is common with sandbox/test keys which often have limited API access.

**Recommended Solution:** Switch to production environment to test C2B functionality, or contact SMSA to request a sandbox key with C2B permissions.

## Troubleshooting Steps

### 1. Verify API Key
The current `.env` file has:
```
SMSA_API_ENVIRONMENT=sandbox
SMSA_TEST_API_KEY=556c502d784a49cbb6fb2baf6fb08bfe
```

**Action Required:**
- Contact SMSA to verify if this API key is valid for the sandbox environment
- Check if the API key has expired
- Confirm that the API key has permissions for C2B (Customer-to-Business / Return) shipments

### 2. Check API Key Permissions
SMSA API keys may have different permission levels:
- B2C (Business to Customer) - Forward shipments
- C2B (Customer to Business) - Return shipments
- Both

**Action Required:**
- Verify your API key includes C2B permissions
- If not, request C2B access from SMSA

### 3. Verify Endpoint
The application is using:
```
Sandbox Base URL: https://ecomapis-sandbox.azurewebsites.net
Production Base URL: https://ecomapis.smsaexpress.com
Endpoint: /api/c2b/new
Full URL: {base_url}/api/c2b/new
```

**Note:** The base URL should NOT include `/api` - it's added automatically by the endpoint path.

### 4. Switch to Production Environment (Recommended)
Since you have production credentials, you can test C2B functionality by changing your `.env` file:

```env
# Change this line:
SMSA_API_ENVIRONMENT=production

# The application will automatically use this key:
SMSA_PRODUCTION_API_KEY=d34118ea30de40dd89e8f56535ab3069
```

**Note:** Make sure to change back to `sandbox` once SMSA provides a test key with C2B permissions, or before going live if you're just testing.

## Environment Variables Reference

### Required for Sandbox
```env
SMSA_API_ENVIRONMENT=sandbox
SMSA_TEST_API_KEY=your_sandbox_api_key_here
```

### Required for Production
```env
SMSA_API_ENVIRONMENT=production
SMSA_PRODUCTION_API_KEY=your_production_api_key_here
```

### Optional Configuration
```env
SMSA_SERVICE_CODE=EDCR              # Service code for domestic returns
SMSA_WAYBILL_TYPE=PDF               # PDF or ZPL format
SMSA_RETAIL_ID=your_retail_id       # If you have a retail ID
```

## Getting SMSA API Credentials

1. **Contact SMSA Support**
   - Email: support@smsaexpress.com
   - Website: https://www.smsaexpress.com

2. **Request API Access**
   - Ask for E-commerce API access
   - Specify you need C2B (return shipment) capabilities
   - Request both sandbox and production credentials

3. **Documentation**
   - Request API documentation for C2B endpoints
   - Ask for sample requests/responses

## Testing the Fix

After updating the API key, test the return flow:

1. Navigate to `/returns`
2. Enter an order number
3. Select products to return
4. Submit the return request

Monitor the logs for:
```
{"level":"info","msg":"Creating SMSA return shipment",...}
```

A successful request will show:
```
{"level":"info","msg":"SMSA return shipment created successfully","sawb":"..."}
```

## Current API Request Format

The application sends this payload to SMSA:
```json
{
  "OrderNumber": "218964484",
  "DeclaredValue": 0.1,
  "Parcels": 1,
  "ShipDate": "2025-11-17T...",
  "ShipmentCurrency": "SAR",
  "Weight": 0.5,
  "WeightUnit": "KG",
  "ContentDescription": "Return for Order 218964484",
  "PickupAddress": {...},
  "ReturnToAddress": {...},
  "ServiceCode": "EDCR",
  "WaybillType": "PDF"
}
```

## Next Steps

1. ✅ Enhanced error logging (completed)
2. ⏳ Verify API key with SMSA
3. ⏳ Test with valid credentials
4. ⏳ Update documentation once working
