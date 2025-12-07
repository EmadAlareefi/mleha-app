import { prisma } from '@/lib/prisma';
import { log } from './logger';

const SALLA_OAUTH_URL = 'https://accounts.salla.sa/oauth2/token';
const TOKEN_REFRESH_BEFORE_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000; // Refresh 2 days before expiry
const FORCED_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // Force refresh every 7 days (Salla tokens expire every 14 days)

interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope?: string;
}

/**
 * Stores or updates Salla OAuth tokens for a merchant
 */
export async function storeSallaTokens(
  merchantId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  scope?: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  await prisma.sallaAuth.upsert({
    where: { merchantId: merchantId.toString() },
    create: {
      merchantId: merchantId.toString(),
      accessToken,
      refreshToken,
      expiresAt,
      scope,
      tokenType: 'bearer',
    },
    update: {
      accessToken,
      refreshToken,
      expiresAt,
      scope,
      lastRefreshedAt: new Date(),
      refreshAttempts: 0, // Reset attempts on successful update
      isRefreshing: false, // Clear refresh lock
    },
  });

  log.info('Salla tokens stored successfully', { merchantId, expiresAt });
}

/**
 * Gets the current valid access token for a merchant
 * Automatically refreshes if the token is expired or about to expire
 */
export async function getSallaAccessToken(merchantId: string): Promise<string | null> {
  const auth = await prisma.sallaAuth.findUnique({
    where: { merchantId: merchantId.toString() },
  });

  if (!auth) {
    log.warn('No Salla auth found for merchant', { merchantId });
    return null;
  }

  // Check if token needs refresh (expired or expiring soon)
  const now = new Date();
  const shouldRefresh = auth.expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_BEFORE_EXPIRY_MS;

  if (shouldRefresh) {
    log.info('Token expiring soon, refreshing...', {
      merchantId,
      expiresAt: auth.expiresAt,
      timeUntilExpiry: auth.expiresAt.getTime() - now.getTime()
    });

    const newToken = await refreshSallaToken(merchantId);
    return newToken;
  }

  return auth.accessToken;
}

/**
 * Refreshes the Salla access token using the refresh token
 * Implements mutex/locking to prevent parallel refresh attempts
 */
export async function refreshSallaToken(merchantId: string): Promise<string | null> {
  const maxRetries = 3;
  const lockTimeoutMs = 30000; // 30 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Try to acquire the refresh lock
      const auth = await prisma.sallaAuth.findUnique({
        where: { merchantId: merchantId.toString() },
      });

      if (!auth) {
        log.error('No Salla auth found for merchant', { merchantId });
        return null;
      }

      // Check if another process is already refreshing
      if (auth.isRefreshing) {
        const lockAge = Date.now() - auth.lastRefreshedAt.getTime();

        if (lockAge < lockTimeoutMs) {
          // Wait and retry
          log.info('Another process is refreshing token, waiting...', { merchantId, attempt });
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          continue;
        } else {
          log.warn('Refresh lock timed out, forcing refresh', { merchantId, lockAge });
        }
      }

      // Acquire the lock
      const lockAcquired = await prisma.sallaAuth.updateMany({
        where: {
          merchantId: merchantId.toString(),
          isRefreshing: false,
        },
        data: {
          isRefreshing: true,
          lastRefreshedAt: new Date(),
        },
      });

      if (lockAcquired.count === 0) {
        // Lock was acquired by another process, retry
        log.info('Failed to acquire refresh lock, retrying...', { merchantId, attempt });
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        continue;
      }

      log.info('Refresh lock acquired, calling Salla API...', { merchantId });

      // Call Salla API to refresh token
      const response = await fetch(SALLA_OAUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: process.env.SALLA_CLIENT_ID,
          client_secret: process.env.SALLA_CLIENT_SECRET,
          refresh_token: auth.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error('Salla token refresh failed', {
          merchantId,
          status: response.status,
          error: errorText
        });

        // Release the lock
        await prisma.sallaAuth.update({
          where: { merchantId: merchantId.toString() },
          data: {
            isRefreshing: false,
            refreshAttempts: auth.refreshAttempts + 1,
          },
        });

        return null;
      }

      const data: SallaTokenResponse = await response.json();

      // Store the new tokens and release the lock
      await storeSallaTokens(
        merchantId,
        data.access_token,
        data.refresh_token,
        data.expires_in,
        data.scope
      );

      log.info('Salla token refreshed successfully', { merchantId });
      return data.access_token;

    } catch (error) {
      log.error('Error refreshing Salla token', { merchantId, attempt, error });

      // Release the lock on error
      try {
        await prisma.sallaAuth.update({
          where: { merchantId: merchantId.toString() },
          data: {
            isRefreshing: false,
            refreshAttempts: { increment: 1 },
          },
        });
      } catch (unlockError) {
        log.error('Failed to release refresh lock', { merchantId, error: unlockError });
      }

      if (attempt === maxRetries) {
        return null;
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return null;
}

/**
 * Checks all merchants and refreshes tokens that are expiring soon
 * Should be called by a scheduled job (cron)
 */
export async function refreshExpiringTokens(): Promise<void> {
  log.info('Starting scheduled token refresh check...');

  const expiryThreshold = new Date(Date.now() + TOKEN_REFRESH_BEFORE_EXPIRY_MS);
  const forcedRefreshThreshold = new Date(Date.now() - FORCED_REFRESH_INTERVAL_MS);

  const authsNeedingRefresh = await prisma.sallaAuth.findMany({
    where: {
      OR: [
        {
          expiresAt: {
            lte: expiryThreshold,
          },
        },
        {
          lastRefreshedAt: {
            lte: forcedRefreshThreshold,
          },
        },
      ],
      isRefreshing: false, // Don't refresh if already in progress
    },
  });

  log.info('Tokens selected for refresh', {
    count: authsNeedingRefresh.length,
    forcedRefreshThreshold,
  });

  for (const auth of authsNeedingRefresh) {
    try {
      const sinceLast = Date.now() - auth.lastRefreshedAt.getTime();
      const daysSinceLast = Math.floor(sinceLast / (24 * 60 * 60 * 1000));
      const reason = auth.expiresAt <= expiryThreshold ? 'expiry-window' : 'forced-interval';

      log.info('Refreshing token for merchant', {
        merchantId: auth.merchantId,
        expiresAt: auth.expiresAt,
        lastRefreshedAt: auth.lastRefreshedAt,
        daysSinceLast,
        reason,
      });

      await refreshSallaToken(auth.merchantId);
    } catch (error) {
      log.error('Failed to refresh token for merchant', {
        merchantId: auth.merchantId,
        error
      });
    }
  }

  log.info('Scheduled token refresh check completed');
}

/**
 * Makes an authenticated request to Salla API
 */
export async function sallaMakeRequest<T>(
  merchantId: string,
  endpoint: string,
  options?: RequestInit
): Promise<T | null> {
  const accessToken = await getSallaAccessToken(merchantId);

  if (!accessToken) {
    log.error('No valid access token available', { merchantId, endpoint });
    return null;
  }

  try {
    // Salla API base URL - use admin/v2 for merchant API calls
    const baseUrl = 'https://api.salla.dev/admin/v2';
    const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Salla API request failed', {
        merchantId,
        endpoint,
        status: response.status,
        error: errorText
      });
      return null;
    }

    return await response.json() as T;
  } catch (error) {
    log.error('Error making Salla API request', { merchantId, endpoint, error });
    return null;
  }
}
