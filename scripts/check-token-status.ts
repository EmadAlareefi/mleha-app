/**
 * Script to check current Salla token status
 *
 * Usage:
 *   npx ts-node scripts/check-token-status.ts
 */

import { loadEnvConfig } from '@next/env';
import process from 'process';
import { prisma } from '@/lib/prisma';

loadEnvConfig(process.cwd());

async function main() {
  try {
    console.log('=== Salla Token Status ===\n');

    const tokens = await prisma.sallaAuth.findMany({
      select: {
        merchantId: true,
        expiresAt: true,
        lastRefreshedAt: true,
        refreshAttempts: true,
        isRefreshing: true,
        createdAt: true,
      },
    });

    if (tokens.length === 0) {
      console.log('No tokens found in database.\n');
      process.exit(0);
    }

    const now = new Date();
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    tokens.forEach((token) => {
      const timeUntilExpiry = token.expiresAt.getTime() - now.getTime();
      const timeSinceRefresh = now.getTime() - token.lastRefreshedAt.getTime();

      const daysUntilExpiry = Math.floor(timeUntilExpiry / (24 * 60 * 60 * 1000));
      const daysSinceRefresh = Math.floor(timeSinceRefresh / (24 * 60 * 60 * 1000));

      console.log(`Merchant ID: ${token.merchantId}`);
      console.log(`  Expires at: ${token.expiresAt.toISOString()}`);
      console.log(`  Days until expiry: ${daysUntilExpiry} days`);
      console.log(`  Last refreshed: ${token.lastRefreshedAt.toISOString()}`);
      console.log(`  Days since last refresh: ${daysSinceRefresh} days`);
      console.log(`  Refresh attempts: ${token.refreshAttempts}`);
      console.log(`  Currently refreshing: ${token.isRefreshing}`);
      console.log(`  Token created: ${token.createdAt.toISOString()}`);

      // Check if token needs refresh
      const needsExpiryRefresh = timeUntilExpiry < twoDays;
      const needsForcedRefresh = timeSinceRefresh > sevenDays;

      if (needsExpiryRefresh || needsForcedRefresh) {
        console.log('  ⚠️  STATUS: NEEDS REFRESH');
        if (needsExpiryRefresh) console.log('     Reason: Expiring within 2 days');
        if (needsForcedRefresh) console.log('     Reason: Not refreshed in 7+ days');
      } else {
        console.log('  ✓ STATUS: OK');
      }

      console.log('');
    });

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Error checking token status:', error);
    process.exit(1);
  }
}

main();
