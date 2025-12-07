# Salla Token Refresh System

## Overview

Salla OAuth tokens expire every **14 days**. This system automatically refreshes tokens to ensure uninterrupted access to the Salla API.

## Configuration

Located in `app/lib/salla-oauth.ts`:

- **TOKEN_REFRESH_BEFORE_EXPIRY_MS**: Refresh tokens 2 days before expiry
- **FORCED_REFRESH_INTERVAL_MS**: Force refresh every 7 days (even if not expired)

This ensures tokens are refreshed well before expiration with a safety margin.

## Automatic Refresh

### Vercel Cron Job

Configured in `vercel.json` to run daily at midnight:

```json
{
  "crons": [
    {
      "path": "/api/salla/refresh-tokens",
      "schedule": "0 0 * * *"
    }
  ]
}
```

The cron job calls `/api/salla/refresh-tokens` which:
1. Finds all tokens that need refreshing (expiring soon OR not refreshed in 7+ days)
2. Refreshes them using the Salla OAuth API
3. Updates the database with new tokens

### Security

The API endpoint supports optional authentication via `CRON_SECRET` environment variable:

```bash
curl -X POST https://your-app.vercel.app/api/salla/refresh-tokens \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Manual Refresh Commands

### Refresh Tokens

```bash
npm run refresh:salla-tokens
```

Manually triggers the token refresh process for all merchants.

### Check Token Status

```bash
npm run check:salla-tokens
```

Displays current token status including:
- Merchant ID
- Expiration date and days until expiry
- Last refresh date and days since refresh
- Refresh attempt count
- Whether token needs refresh

## How Token Refresh Works

1. **Mutex Locking**: Prevents multiple processes from refreshing the same token simultaneously
2. **Retry Logic**: Up to 3 retry attempts with exponential backoff
3. **Error Handling**: Failed refresh attempts are logged and tracked
4. **Automatic Integration**: `getSallaAccessToken()` automatically refreshes expired tokens

## Environment Variables Required

```bash
SALLA_CLIENT_ID="your-salla-client-id"
SALLA_CLIENT_SECRET="your-salla-client-secret"
```

These credentials are required for the OAuth refresh token grant.

## Database Schema

The `SallaAuth` table tracks:

```prisma
model SallaAuth {
  merchantId      String   @unique
  accessToken     String
  refreshToken    String
  expiresAt       DateTime
  isRefreshing    Boolean  @default(false)
  lastRefreshedAt DateTime @default(now())
  refreshAttempts Int      @default(0)
}
```

## Monitoring

Check the logs for refresh status:

- **Success**: `"Salla token refreshed successfully"`
- **Failure**: `"Salla token refresh failed"` with error details
- **Status**: Token status updates in the `refreshAttempts` counter

## Troubleshooting

### Token Refresh Failing

1. Check `SALLA_CLIENT_ID` and `SALLA_CLIENT_SECRET` are set correctly
2. Verify the refresh token is still valid (not revoked in Salla)
3. Check the `refreshAttempts` counter in the database
4. Review error logs for specific API error messages

### Manual Token Reset

If tokens become invalid, you'll need to re-authorize the app through Salla's OAuth flow to get new tokens.

## API Integration

All Salla API calls automatically use fresh tokens:

```typescript
import { getSallaAccessToken } from '@/app/lib/salla-oauth';

// Automatically refreshes if needed
const token = await getSallaAccessToken(merchantId);
```

Or use the convenience wrapper:

```typescript
import { sallaMakeRequest } from '@/app/lib/salla-oauth';

const data = await sallaMakeRequest(merchantId, '/orders');
```
