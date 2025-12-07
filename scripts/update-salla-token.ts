import { loadEnvConfig } from '@next/env';
import process from 'process';
import { prisma } from '@/lib/prisma';

loadEnvConfig(process.cwd());

async function updateSallaToken() {
  const merchantId = '1696031053';
  const accessToken = 'ory_at_msWlpgG53IXu8nzjEDoMBllFsvD5hHHksVZcSVTNF3o.5GsmBhBkGVo8YUXWK-F5Hn7p5DTfFmsRuEiYCbo-BnQ';
  const refreshToken = 'ory_rt_Tq3hXgRK49Ttats-3g7_ayUmRGgNsjXoJK2IZ5kGjmQ.GqCpIygAMx_DyGEJ6S0kQXLiCbgKx1XKsrhJSJY3Ces';
  const expires = 1766302173;
  const scope = 'settings.read orders.read_write webhooks.read_write marketing.read_write offline_access';

  // Calculate expires_in from expires timestamp
  const expiresIn = Math.max(0, Math.floor((expires * 1000 - Date.now()) / 1000));
  const expiresAt = new Date(expires * 1000);

  try {
    const result = await prisma.sallaAuth.upsert({
      where: { merchantId },
      create: {
        merchantId,
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
        refreshAttempts: 0,
        isRefreshing: false,
      },
    });

    console.log('✅ Successfully updated SallaAuth token');
    console.log(`Merchant ID: ${merchantId}`);
    console.log(`Expires at: ${expiresAt.toISOString()}`);
    console.log(`Expires in: ${Math.floor(expiresIn / 86400)} days, ${Math.floor((expiresIn % 86400) / 3600)} hours`);
    console.log(`Scope: ${scope}`);
  } catch (error) {
    console.error('❌ Failed to update SallaAuth token:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateSallaToken();
