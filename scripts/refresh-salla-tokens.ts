/**
 * Script to manually refresh Salla OAuth tokens
 *
 * Usage:
 *   npx ts-node scripts/refresh-salla-tokens.ts
 */

import { loadEnvConfig } from '@next/env';
import process from 'process';
import { refreshExpiringTokens } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

loadEnvConfig(process.cwd());

async function main() {
  try {
    console.log('=== Manual Salla Token Refresh ===');
    console.log('Starting token refresh process...\n');

    await refreshExpiringTokens();

    console.log('\n✓ Token refresh completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Error refreshing tokens:', error);
    process.exit(1);
  }
}

main();
