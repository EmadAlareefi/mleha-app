/**
 * ERP Authentication Service
 *
 * Handles authentication with the ERP system, including:
 * - Login and token acquisition
 * - Token caching and refresh
 * - Automatic re-authentication when token expires
 */

import { log as logger } from './logger';

interface ERPAuthResponse {
  tokenType: string;
  expireIn: string;
  accessToken: string;
}

interface ERPTokenCache {
  accessToken: string;
  expiresAt: Date;
}

// In-memory token cache
let tokenCache: ERPTokenCache | null = null;

/**
 * Login to ERP and get access token
 */
async function loginToERP(): Promise<string> {
  const erpLoginUrl = process.env.ERP_LOGIN_URL;
  const erpUsername = process.env.ERP_USERNAME;
  const erpPassword = process.env.ERP_PASSWORD;

  if (!erpLoginUrl || !erpUsername || !erpPassword) {
    throw new Error('ERP credentials not configured. Please set ERP_LOGIN_URL, ERP_USERNAME, and ERP_PASSWORD.');
  }

  logger.info('Logging in to ERP system');

  try {
    const response = await fetch(erpLoginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: erpUsername,
        password: erpPassword,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ERP login failed with status ${response.status}: ${errorText}`);
    }

    const data: ERPAuthResponse = await response.json();

    if (!data.accessToken) {
      throw new Error('ERP login response missing accessToken');
    }

    // Parse expiration time (format: "7199.4430552 Seconed")
    const expireInSeconds = parseFloat(data.expireIn.split(' ')[0]);
    const expiresAt = new Date(Date.now() + (expireInSeconds * 1000));

    // Cache the token with a 5-minute buffer before expiration
    const bufferSeconds = 300; // 5 minutes
    const expiresAtWithBuffer = new Date(expiresAt.getTime() - (bufferSeconds * 1000));

    tokenCache = {
      accessToken: data.accessToken,
      expiresAt: expiresAtWithBuffer,
    };

    logger.info('ERP login successful', {
      expiresIn: expireInSeconds,
      expiresAt: expiresAt.toISOString(),
    });

    return data.accessToken;
  } catch (error: any) {
    logger.error('ERP login failed', { error: error.message });
    throw error;
  }
}

/**
 * Get a valid ERP access token
 * Automatically refreshes if expired
 */
export async function getERPAccessToken(): Promise<string> {
  // Check if we have a valid cached token
  if (tokenCache && tokenCache.expiresAt > new Date()) {
    logger.info('Using cached ERP token');
    return tokenCache.accessToken;
  }

  // Token expired or not cached, login again
  logger.info('ERP token expired or not cached, logging in');
  return await loginToERP();
}

/**
 * Clear the token cache (useful for testing or forcing re-authentication)
 */
export function clearERPTokenCache(): void {
  tokenCache = null;
  logger.info('ERP token cache cleared');
}
